"""API docs and catalog endpoints tests."""
from __future__ import annotations


def test_api_catalog_ok(client):
    resp = client.get('/api')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True
    assert data['service'] == 'WeeGo Army Bank API'
    assert data['docs_url'] == '/api/docs'
    assert data['openapi_url'] == '/api/openapi.json'
    assert isinstance(data['groups'], list)
    assert len(data['groups']) >= 3


def test_api_catalog_slash_alias_ok(client):
    resp = client.get('/api/')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True


def test_openapi_schema_ok(client):
    resp = client.get('/api/openapi.json')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['openapi'] == '3.0.3'
    assert data['info']['title'] == 'WeeGo Army Bank API'
    assert '/api/auth/login' in data['paths']
    assert '/api/admin/payments/sla-queue' in data['paths']


def test_api_docs_html_ok(client):
    resp = client.get('/api/docs')
    assert resp.status_code == 200
    ctype = (resp.headers.get('Content-Type') or '').lower()
    assert 'text/html' in ctype
    body = resp.get_data(as_text=True)
    assert 'Army Bank API' in body
    assert '/api/openapi.json' in body
