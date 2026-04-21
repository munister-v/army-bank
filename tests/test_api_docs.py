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
    assert data['version_url'] == '/api/version'
    assert data['postman_collection_url'] == '/api/postman/collection'
    assert data['postman_environment_url'] == '/api/postman/environment'
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
    assert '/api/version' in data['paths']


def test_api_docs_html_ok(client):
    resp = client.get('/api/docs')
    assert resp.status_code == 200
    ctype = (resp.headers.get('Content-Type') or '').lower()
    assert 'text/html' in ctype
    body = resp.get_data(as_text=True)
    assert 'Army Bank API' in body
    assert '/api/openapi.json' in body
    assert '/api/postman/collection' in body


def test_api_version_ok(client):
    resp = client.get('/api/version')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True
    assert data['api_version']
    assert 'runtime' in data
    assert 'feature_flags' in data
    assert isinstance(data['feature_flags'].get('allow_platform_demo_seed'), bool)
    assert isinstance(data['feature_flags'].get('allow_demo_payout_accrual'), bool)


def test_api_postman_exports_ok(client):
    collection = client.get('/api/postman/collection')
    assert collection.status_code == 200
    cjson = collection.get_json()
    assert cjson['info']['name'] == 'Army Bank API'
    assert isinstance(cjson['item'], list)

    environment = client.get('/api/postman/environment')
    assert environment.status_code == 200
    ejson = environment.get_json()
    assert ejson['name'].startswith('Army Bank API')
    assert isinstance(ejson['values'], list)
