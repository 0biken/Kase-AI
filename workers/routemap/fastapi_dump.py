"""kase-routemap for FastAPI: dump the live routing table as a commit-bound route artifact.

    python -I fastapi_dump.py --root <checkout> --app <module>:<attr> --commit <40-hex sha> [--out file]

Imports the target application object (without serving it), walks
``app.routes`` and records, per method, the path template, the handler's
``module.__qualname__`` symbol and its source file relative to the checkout.
FastAPI keeps the real endpoint function on each route, so the symbol comes
from the live routing table rather than a parse (spike/correlation-fastapi).

The output is untrusted input to Kase: the API re-validates the schema, the
commit binding, and that every file and symbol exists in the checkout.
"""

import argparse
import datetime
import importlib
import inspect
import json
import os
import re
import sys

SCHEMA = "kase.routemap/v1"
COMMIT = re.compile(r"^[0-9a-f]{40}$")
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"}
MAX_ROUTES = 5000


def _relative(path, root):
    """Return the checkout-relative path with '/' separators, or None if outside it."""
    if not path:
        return None
    real_root = os.path.realpath(root)
    real_path = os.path.realpath(path)
    try:
        common = os.path.commonpath([real_root, real_path])
    except ValueError:  # different drives on Windows
        return None
    if common != real_root:
        return None
    return os.path.relpath(real_path, real_root).replace(os.sep, "/")


def dump(app, root, commit, now=None):
    from fastapi.routing import APIRoute

    routes = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue  # /openapi.json, /docs, mounts and websockets are not handlers
        endpoint = inspect.unwrap(route.endpoint)
        handler = {"symbol": f"{endpoint.__module__}.{endpoint.__qualname__}"}
        try:
            relative = _relative(inspect.getsourcefile(endpoint), root)
        except TypeError:
            relative = None
        if relative:
            handler["file"] = relative
            try:
                handler["line"] = inspect.getsourcelines(endpoint)[1]
            except (OSError, TypeError):
                pass
        for method in sorted(set(route.methods or ()) & METHODS - {"HEAD"}):
            routes.append({"method": method, "pathTemplate": route.path, "handler": dict(handler)})
        if len(routes) > MAX_ROUTES:
            raise SystemExit("route count limit exceeded")

    routes.sort(key=lambda r: (r["pathTemplate"], r["method"]))
    stamp = (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return {
        "schema": SCHEMA,
        "source": "runtime_dump",
        "framework": "fastapi",
        "commitSha": commit,
        "generatedAt": stamp,
        "routes": routes,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", required=True, help="checkout root; added to sys.path")
    parser.add_argument("--app", required=True, help="application object as module:attribute")
    parser.add_argument("--commit", required=True, help="full commit SHA of the checkout")
    parser.add_argument("--out", help="write the artifact here instead of stdout")
    args = parser.parse_args(argv)

    commit = args.commit.lower()
    if not COMMIT.match(commit):
        raise SystemExit("--commit must be a full 40-character SHA")
    if ":" not in args.app:
        raise SystemExit("--app must be module:attribute")
    module_name, attribute = args.app.split(":", 1)

    root = os.path.realpath(args.root)
    sys.path.insert(0, root)
    app = getattr(importlib.import_module(module_name), attribute)
    artifact = json.dumps(dump(app, root, commit), indent=2, sort_keys=True)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(artifact + "\n")
    else:
        sys.stdout.write(artifact + "\n")


if __name__ == "__main__":
    main()
