"""Helpers for request-scoped metadata (request id, audit correlation)."""
from __future__ import annotations

from flask import g, has_request_context


def get_request_id() -> str:
    if not has_request_context():
        return ''
    rid = getattr(g, 'request_id', '') or ''
    return str(rid).strip()


def append_request_id(details: str | None) -> str:
    base = (details or '').strip()
    rid = get_request_id()
    if not rid:
        return base
    marker = f'[req:{rid}]'
    if marker in base:
        return base
    if not base:
        return marker
    return f'{base} {marker}'
