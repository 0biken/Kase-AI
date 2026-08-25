from typing import Optional

from .db import Invoice, session


class InvoiceService:
    def find(self, invoice_id: str, requester_id: str) -> Optional[Invoice]:
        """
        SEEDED VULNERABILITY (IDOR).

        The lookup filters on the record id alone. `requester_id` is accepted
        but never constrains the query, so any authenticated caller can read
        any invoice by guessing or enumerating an id.

        This is the exact line the correlation path must arrive at, starting
        from an externally observed 200 on GET /api/invoices/{invoice_id}.
        """
        return session.query(Invoice).filter_by(id=invoice_id).first()

    def find_scoped(self, invoice_id: str, requester_id: str) -> Optional[Invoice]:
        """
        The fixed form, used by --fixed to prove the finding clears.
        Ownership is part of the filter, so a non-owner gets None.
        """
        return session.query(Invoice).filter_by(id=invoice_id, owner_id=requester_id).first()


_service = InvoiceService()


def get_invoice_service() -> InvoiceService:
    """FastAPI dependency provider. Resolved via Depends() at the route."""
    return _service
