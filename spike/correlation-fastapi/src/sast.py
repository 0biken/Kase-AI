"""
Stand-in for the Semgrep adapter, Python side.

Emits the SAME FIELDS a Semgrep finding would — rule_id, cwe, file, line, and
an enclosing symbol resolved from the AST rather than a bare line number —
because those are what the join and the fingerprint consume.

RULE kase.idor.missing-ownership-predicate (CWE-639)

Fires when an ORM read inside a method that receives a requester/owner
identifier filters on the record id alone, never constraining on the caller.
Matches the idiomatic SQLAlchemy shape:

    session.query(Invoice).filter_by(id=invoice_id).first()
"""

import ast
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from .codemap import SourceLocation

RULE_ID = "kase.idor.missing-ownership-predicate"
CWE = "CWE-639"

OWNER_PARAM_HINTS = {"requester_id", "user_id", "owner_id", "current_user_id", "actor_id"}
OWNERSHIP_FIELD_HINTS = {"owner_id", "user_id", "account_id", "tenant_id", "organization_id"}
FILTER_CALLS = {"filter_by", "find_unique", "find_first", "get_by"}


@dataclass
class Evidence:
    id: str
    tool: str
    type: str
    evidence_class: str          # 'replayable' | 'observational'
    sha256: str
    payload: Any


@dataclass
class Finding:
    id: str
    origin: str
    tool: str
    rule_id: Optional[str]
    category: str
    cwe: Optional[str]
    title: str
    severity_proposed: str
    affected_target: Optional[str]
    source_locations: list[SourceLocation] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    description: str = ""


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def short_hash(s: str) -> str:
    return sha256(s)[:8]


def run_sast(root: str) -> list[Finding]:
    root = os.path.abspath(root)
    findings: list[Finding] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {"__pycache__", ".venv", "node_modules"}]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            try:
                tree = ast.parse(open(full, encoding="utf-8").read())
            except (SyntaxError, UnicodeDecodeError):
                continue

            for cls in [n for n in tree.body if isinstance(n, ast.ClassDef)]:
                for method in [
                    n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                ]:
                    owner_param = _owner_param(method)
                    if not owner_param:
                        continue

                    for node in ast.walk(method):
                        if not isinstance(node, ast.Call):
                            continue
                        func = node.func
                        if not isinstance(func, ast.Attribute):
                            continue
                        if func.attr not in FILTER_CALLS:
                            continue

                        fields = _filter_fields(node)
                        if fields is None:
                            continue
                        if any(f in OWNERSHIP_FIELD_HINTS for f in fields):
                            continue

                        symbol = f"{cls.name}.{method.name}"
                        line = node.lineno
                        excerpt = ast.unparse(node)

                        findings.append(
                            Finding(
                                id=f"WB-{short_hash(f'{rel}:{symbol}:{RULE_ID}')}",
                                origin="whitebox",
                                tool="semgrep-equivalent",
                                rule_id=RULE_ID,
                                category="authorization",
                                cwe=CWE,
                                title="Resource lookup lacks an ownership predicate",
                                severity_proposed="critical",
                                affected_target=None,
                                source_locations=[
                                    SourceLocation(file=rel, enclosing_symbol=symbol, line=line)
                                ],
                                evidence=[
                                    _evidence(rel, symbol, line, excerpt, owner_param, fields)
                                ],
                                description=(
                                    f"`{symbol}` accepts `{owner_param}` but filters on "
                                    f"{{ {', '.join(fields)} }} only. The caller identity never "
                                    f"reaches the query predicate, so any authenticated caller "
                                    f"can read any record by id."
                                ),
                            )
                        )

    return findings


def _owner_param(fn: ast.FunctionDef) -> Optional[str]:
    for arg in [*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs]:
        if arg.arg in OWNER_PARAM_HINTS:
            return arg.arg
    return None


def _filter_fields(call: ast.Call) -> Optional[list[str]]:
    """Returns the keyword names passed to the filter call, or None if none."""
    names = [kw.arg for kw in call.keywords if kw.arg]
    return names or None


def _evidence(
    file: str, symbol: str, line: int, excerpt: str, owner_param: str, fields: list[str]
) -> Evidence:
    payload = {
        "ruleId": RULE_ID,
        "cwe": CWE,
        "file": file,
        "enclosingSymbol": symbol,
        "line": line,
        "excerpt": excerpt,
        "ownerParamAvailable": owner_param,
        "queryConstrainedOn": fields,
    }
    blob = json.dumps(payload, sort_keys=True)
    return Evidence(
        id=f"EV-{short_hash(blob)}",
        tool="semgrep-equivalent",
        type="sast_json",
        # Rule + file + symbol is re-derivable from source: replayable.
        evidence_class="replayable",
        sha256=sha256(blob),
        payload=payload,
    )
