"""
In-memory stand-in for a SQLAlchemy session.

Deliberately mirrors the SQLAlchemy query idiom
(`session.query(Invoice).filter_by(...).first()`) so the white-box AST rule
in src/sast.py matches real Python ORM code rather than a shape invented for
the spike. The spike proves the correlation path, not the database layer.
"""

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class Invoice:
    id: str
    owner_id: str
    amount_cents: int
    reference: str


@dataclass
class User:
    id: str
    email: str
    token: str


_USERS = [
    User(id="user_alice", email="alice@example.com", token="tok_alice"),
    User(id="user_bob", email="bob@example.com", token="tok_bob"),
]

_INVOICES = [
    Invoice(id="inv_1001", owner_id="user_alice", amount_cents=480000, reference="ACME-2026-0001"),
    Invoice(id="inv_1002", owner_id="user_bob", amount_cents=125000, reference="HOOLI-2026-0044"),
]


class _Query:
    def __init__(self, rows: list[Any]):
        self._rows = rows

    def filter_by(self, **kwargs: Any) -> "_Query":
        rows = [r for r in self._rows if all(getattr(r, k, None) == v for k, v in kwargs.items())]
        return _Query(rows)

    def first(self) -> Optional[Any]:
        return self._rows[0] if self._rows else None


class Session:
    def query(self, model: type) -> _Query:
        if model is Invoice:
            return _Query(list(_INVOICES))
        if model is User:
            return _Query(list(_USERS))
        return _Query([])


session = Session()


def user_by_token(token: str) -> Optional[User]:
    return session.query(User).filter_by(token=token).first()
