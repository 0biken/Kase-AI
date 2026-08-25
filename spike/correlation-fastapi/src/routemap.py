"""
LAYER 1 — deterministic route dump (FastAPI).

FastAPI keeps the actual handler function object on every route, so the
symbol is directly available — no metadata reflection needed, unlike Nest.
This is the strongest form of layer 1: not a parse, not a guess, the live
routing table of the running application.
"""

import re
from dataclasses import dataclass
from typing import Optional

from fastapi.routing import APIRoute


@dataclass
class RouteMapping:
    method: str
    path_template: str          # '/api/invoices/{invoice_id}'
    framework: str              # 'fastapi'
    handler_symbol: str         # 'fixture.app.find_one'
    handler_module: str
    handler_function: str
    source: str                 # 'runtime_dump'


def dump_routes(app) -> list[RouteMapping]:
    routes: list[RouteMapping] = []

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue                      # skips /openapi.json, /docs, etc.

        endpoint = route.endpoint
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            routes.append(
                RouteMapping(
                    method=method,
                    # FastAPI already stores brace form; Nest stores ':id'.
                    # Both sides of the join must normalize identically.
                    path_template=route.path,
                    framework="fastapi",
                    handler_symbol=f"{endpoint.__module__}.{endpoint.__qualname__}",
                    handler_module=endpoint.__module__,
                    handler_function=endpoint.__qualname__,
                    source="runtime_dump",
                )
            )

    return sorted(routes, key=lambda r: r.path_template)


def templatize(observed_path: str, routes: list[RouteMapping]) -> Optional[str]:
    """
    Maps a concrete observed path back to its template.

    Note the parameter NAME differs across frameworks for the same endpoint
    ('{id}' in the Nest fixture, '{invoice_id}' here). Matching must therefore
    be name-agnostic — the template is canonicalized by the route, never by
    string equality against a crawler's output.
    """
    for route in routes:
        pattern = "^" + re.sub(r"\{[A-Za-z0-9_]+\}", "[^/]+", route.path_template) + "$"
        if re.match(pattern, observed_path):
            return route.path_template
    return None
