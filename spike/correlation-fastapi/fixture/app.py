import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException

from .db import user_by_token
from .invoice_service import InvoiceService, get_invoice_service

app = FastAPI(title="kase-fixture-fastapi")


def current_user_id(authorization: Optional[str] = Header(default=None)) -> str:
    """
    Resolves `Authorization: Bearer <token>` to a user id.

    Authentication works correctly here — the vulnerability is authorization,
    one layer deeper. The caller is always who they claim to be.
    """
    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    user = user_by_token(token) if token else None
    if not user:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return user.id


@app.get("/api/invoices/{invoice_id}")
def find_one(
    invoice_id: str,
    requester_id: str = Depends(current_user_id),
    service: InvoiceService = Depends(get_invoice_service),
):
    """
    The route handler is NOT where the bug lives.

    A naive correlation stops at the handler the route resolves to. The code
    map has to follow the Depends() annotation into InvoiceService.find, or
    the finding points at the wrong file and the remediation is useless.
    """
    invoice = service.find(invoice_id, requester_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="not found")
    return invoice


@app.get("/api/invoices")
def list_invoices(requester_id: str = Depends(current_user_id)):
    return {"owner_id": requester_id}


@app.get("/healthz")
def healthz():
    """
    Build-info endpoint — the target-side half of build provenance (ADR-003).
    Without this (or a CI-supplied SHA) correlation is unverified and must
    not be allowed to block a release.
    """
    return {"status": "ok", "commit": os.environ.get("FIXTURE_COMMIT_SHA")}
