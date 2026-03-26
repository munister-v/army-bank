"""HTTP cache headers for immediate update delivery."""
from __future__ import annotations


def test_html_is_not_cached(client):
    resp = client.get('/')
    assert resp.status_code == 200
    cache = (resp.headers.get('Cache-Control') or '').lower()
    assert 'no-cache' in cache


def test_service_worker_is_not_cached(client):
    resp = client.get('/sw.js?v=17')
    assert resp.status_code == 200
    cache = (resp.headers.get('Cache-Control') or '').lower()
    assert 'no-cache' in cache
    assert 'no-store' in cache


def test_manifest_is_not_cached(client):
    resp = client.get('/manifest.json?v=2')
    assert resp.status_code == 200
    cache = (resp.headers.get('Cache-Control') or '').lower()
    assert 'no-cache' in cache
