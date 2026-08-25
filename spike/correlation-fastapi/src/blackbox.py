"""
Black-box probe + build provenance resolution.

Runs real HTTP against a real uvicorn server on an ephemeral port — not
FastAPI's TestClient. The point of a black-box probe is that it observes the
system from outside; an in-process test client would quietly skip the
middleware and serialization path a real client goes through.
"""

import json
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import uvicorn

from .sast import Evidence, Finding, sha256, short_hash


@dataclass
class HttpExchange:
    request: dict[str, Any]
    response: dict[str, Any]
    replay_hash: str


@dataclass
class ProbeAccount:
    user_id: str
    token: str
    owned_invoice_id: str


class FixtureServer:
    """Runs uvicorn in a background thread on a free port."""

    def __init__(self, app):
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="error")
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start(self, timeout: float = 15.0) -> None:
        self._thread.start()
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._server.started:
                return
            time.sleep(0.05)
        raise RuntimeError("fixture server failed to start")

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def probe_idor(
    base_url: str, owner: ProbeAccount, attacker: ProbeAccount
) -> tuple[Optional[Finding], HttpExchange]:
    """
    Needs two accounts — one to own the record, one to attempt the read.
    A single-account audit cannot detect IDOR at all, which is why scoping
    asks for two.
    """
    url = f"{base_url}/api/invoices/{owner.owned_invoice_id}"
    request_headers = {"authorization": f"Bearer {attacker.token}"}

    resp = httpx.get(url, headers=request_headers, timeout=10.0)
    body = resp.text

    exchange = HttpExchange(
        request={"method": "GET", "url": url, "headers": request_headers},
        response={"status": resp.status_code, "headers": dict(resp.headers), "body": body},
        replay_hash=sha256(f"GET {url} {attacker.token}"),
    )

    leaked = resp.status_code == 200 and owner.owned_invoice_id in body
    if not leaked:
        return None, exchange

    evidence = Evidence(
        id=f"EV-{short_hash(exchange.replay_hash)}",
        tool="http",
        type="http_exchange",
        # Re-executable against the target: gate-eligible under ADR-002.
        evidence_class="replayable",
        sha256=sha256(json.dumps(exchange.response, sort_keys=True)),
        payload={"request": exchange.request, "response": exchange.response},
    )

    finding = Finding(
        id=f"BB-{short_hash(url)}",
        origin="blackbox",
        tool="http",
        rule_id=None,
        category="authorization",
        cwe="CWE-639",
        title="IDOR — invoice readable across user boundary",
        severity_proposed="critical",
        affected_target=httpx.URL(url).path,   # concrete; templatized at correlation
        source_locations=[],                   # black box cannot know this
        evidence=[evidence],
        description=(
            f"{attacker.user_id} requested an invoice owned by {owner.user_id} and received "
            f"HTTP {resp.status_code} with the record body. Authentication succeeded and "
            f"authorization was never enforced."
        ),
    )
    return finding, exchange


def replay(exchange: HttpExchange) -> bool:
    """
    Confirms the finding still reproduces. The gate requires this before
    blocking — a finding that no longer reproduces must not fail a build.
    """
    try:
        resp = httpx.get(
            exchange.request["url"], headers=exchange.request["headers"], timeout=10.0
        )
        return resp.status_code == exchange.response["status"] and resp.text == exchange.response["body"]
    except httpx.HTTPError:
        return False


def resolve_provenance(base_url: str, ci_supplied_sha: Optional[str]) -> dict[str, Any]:
    """Resolves build provenance from CI input and/or the build-info endpoint (ADR-003)."""
    if ci_supplied_sha:
        try:
            data = httpx.get(f"{base_url}/healthz", timeout=10.0).json()
            reported = data.get("commit")
            if reported and reported != ci_supplied_sha:
                # Deployment and checkout disagree — correlation would point at
                # the wrong source. Refuse to verify.
                return {"commit_sha": None, "source": "assumed", "verified": False}
        except (httpx.HTTPError, ValueError):
            pass
        return {"commit_sha": ci_supplied_sha, "source": "ci_supplied", "verified": True}

    try:
        data = httpx.get(f"{base_url}/healthz", timeout=10.0).json()
        if data.get("commit"):
            return {
                "commit_sha": data["commit"],
                "source": "build_info_endpoint",
                "verified": True,
            }
    except (httpx.HTTPError, ValueError):
        pass

    return {"commit_sha": None, "source": "assumed", "verified": False}
