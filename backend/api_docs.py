"""API catalog, docs page and OpenAPI schema for developer handoff."""
from __future__ import annotations

import os
import platform
from datetime import datetime, timezone
from html import escape


API_DOCS_VERSION = '2026-03-25'


def _join(prefix: str, path: str) -> str:
    p = prefix or ''
    return f'{p}{path}' if p else path


def build_api_version() -> dict:
    commit = (
        os.getenv('RENDER_GIT_COMMIT')
        or os.getenv('SOURCE_VERSION')
        or os.getenv('GIT_COMMIT')
        or ''
    )
    short_commit = commit[:12] if commit else ''
    return {
        'api_version': API_DOCS_VERSION,
        'git_commit': commit or None,
        'git_commit_short': short_commit or None,
        'runtime': {
            'python': platform.python_version(),
            'platform': platform.platform(),
        },
    }


def build_api_catalog(prefix: str = '') -> dict:
    api_base = _join(prefix, '/api')
    now_iso = datetime.now(timezone.utc).isoformat()
    version_url = _join(prefix, '/api/version')
    return {
        'ok': True,
        'service': 'WeeGo Army Bank API',
        'version': API_DOCS_VERSION,
        'generated_at': now_iso,
        'base_path': prefix or '/',
        'api_base': api_base,
        'health_url': _join(prefix, '/health'),
        'version_url': version_url,
        'docs_url': _join(prefix, '/api/docs'),
        'openapi_url': _join(prefix, '/api/openapi.json'),
        'postman_collection_url': _join(prefix, '/api/postman/collection'),
        'postman_environment_url': _join(prefix, '/api/postman/environment'),
        'auth': {
            'type': 'Bearer JWT token',
            'header': 'Authorization: Bearer <token>',
            'refresh_header': 'X-Refresh-Token',
            'request_id_header': 'X-Request-Id',
            'idempotency_header': 'Idempotency-Key (required for monetary mutations)',
            'roles': ['soldier', 'operator', 'admin', 'platform_admin'],
        },
        'response_format': {
            'success': {'ok': True, 'data': '<payload>', 'meta': '<optional>'},
            'error': {'ok': False, 'error': '<human-readable message>'},
        },
        'groups': [
            {
                'name': 'System',
                'endpoints': [
                    {'method': 'GET', 'path': _join(prefix, '/health')},
                    {'method': 'GET', 'path': _join(prefix, '/api')},
                    {'method': 'GET', 'path': version_url},
                    {'method': 'GET', 'path': _join(prefix, '/api/docs')},
                    {'method': 'GET', 'path': _join(prefix, '/api/openapi.json')},
                    {'method': 'GET', 'path': _join(prefix, '/api/postman/collection')},
                    {'method': 'GET', 'path': _join(prefix, '/api/postman/environment')},
                ],
            },
            {
                'name': 'Auth',
                'endpoints': [
                    {'method': 'POST', 'path': _join(prefix, '/api/auth/register')},
                    {'method': 'POST', 'path': _join(prefix, '/api/auth/login')},
                    {'method': 'GET', 'path': _join(prefix, '/api/auth/me')},
                    {'method': 'POST', 'path': _join(prefix, '/api/auth/logout')},
                    {'method': 'GET', 'path': _join(prefix, '/api/auth/sessions')},
                ],
            },
            {
                'name': 'Client Account',
                'endpoints': [
                    {'method': 'GET', 'path': _join(prefix, '/api/dashboard')},
                    {'method': 'GET', 'path': _join(prefix, '/api/accounts/main')},
                    {'method': 'POST', 'path': _join(prefix, '/api/transactions/topup')},
                    {'method': 'POST', 'path': _join(prefix, '/api/transactions/transfer')},
                    {'method': 'POST', 'path': _join(prefix, '/api/transactions/statement/order')},
                    {'method': 'GET', 'path': _join(prefix, '/api/transactions/statement/orders')},
                    {'method': 'GET', 'path': _join(prefix, '/api/transactions/statement')},
                    {'method': 'GET', 'path': _join(prefix, '/api/transactions/history')},
                    {'method': 'GET', 'path': _join(prefix, '/api/cards')},
                ],
            },
            {
                'name': 'Admin',
                'endpoints': [
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/stats')},
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/transactions')},
                    {'method': 'POST', 'path': _join(prefix, '/api/admin/payouts')},
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/audit-logs')},
                ],
            },
            {
                'name': 'Processing',
                'endpoints': [
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/payments/orders')},
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/payments/sla-queue')},
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/payments/approval-inbox')},
                    {'method': 'POST', 'path': _join(prefix, '/api/admin/payments/sla-bulk-action')},
                    {'method': 'GET', 'path': _join(prefix, '/api/admin/payments/fraud-stats')},
                ],
            },
            {
                'name': 'Push',
                'endpoints': [
                    {'method': 'GET', 'path': _join(prefix, '/api/push/vapid-public-key')},
                    {'method': 'POST', 'path': _join(prefix, '/api/push/subscribe')},
                    {'method': 'DELETE', 'path': _join(prefix, '/api/push/unsubscribe')},
                ],
            },
        ],
    }


def build_openapi_schema(prefix: str = '') -> dict:
    docs_url = _join(prefix, '/api/docs')
    health_url = _join(prefix, '/health')
    api_server_url = prefix or '/'
    return {
        'openapi': '3.0.3',
        'info': {
            'title': 'WeeGo Army Bank API',
            'version': API_DOCS_VERSION,
            'description': (
                'Core API for Army Bank web and admin apps. '
                f'Human docs: {docs_url}. Health: {health_url}.'
            ),
        },
        'servers': [
            {'url': api_server_url, 'description': 'Current environment base path'},
            {'url': 'https://army-bank.onrender.com', 'description': 'Render production'},
        ],
        'security': [{'BearerAuth': []}],
        'tags': [
            {'name': 'Auth'},
            {'name': 'Account'},
            {'name': 'Cards'},
            {'name': 'Features'},
            {'name': 'Admin'},
            {'name': 'Processing'},
            {'name': 'Push'},
            {'name': 'System'},
        ],
        'paths': {
            '/api': {
                'get': {
                    'tags': ['System'],
                    'summary': 'API catalog entry point',
                    'responses': {
                        '200': {'description': 'API metadata and endpoint groups.'}
                    },
                }
            },
            '/api/openapi.json': {
                'get': {
                    'tags': ['System'],
                    'summary': 'OpenAPI schema',
                    'responses': {'200': {'description': 'OpenAPI 3.0 JSON schema.'}},
                }
            },
            '/api/version': {
                'get': {
                    'tags': ['System'],
                    'summary': 'API runtime and version metadata',
                    'responses': {'200': {'description': 'Version payload.'}},
                }
            },
            '/api/docs': {
                'get': {
                    'tags': ['System'],
                    'summary': 'Human-readable API documentation page',
                    'responses': {'200': {'description': 'HTML docs.'}},
                }
            },
            '/api/auth/register': {
                'post': {
                    'tags': ['Auth'],
                    'summary': 'Register a new user',
                    'security': [],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/RegisterRequest'}
                            }
                        },
                    },
                    'responses': {
                        '200': {'description': 'Registered and authenticated.'},
                        '400': {'$ref': '#/components/responses/ErrorResponse'},
                    },
                }
            },
            '/api/auth/login': {
                'post': {
                    'tags': ['Auth'],
                    'summary': 'Login and get bearer token',
                    'security': [],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/LoginRequest'}
                            }
                        },
                    },
                    'responses': {
                        '200': {'description': 'Authenticated session.'},
                        '401': {'$ref': '#/components/responses/ErrorResponse'},
                    },
                }
            },
            '/api/auth/me': {
                'get': {
                    'tags': ['Auth'],
                    'summary': 'Current user profile',
                    'responses': {
                        '200': {'description': 'Current authenticated user.'},
                        '401': {'$ref': '#/components/responses/ErrorResponse'},
                    },
                }
            },
            '/api/auth/logout': {
                'post': {
                    'tags': ['Auth'],
                    'summary': 'Logout current session',
                    'responses': {'200': {'description': 'Session invalidated.'}},
                }
            },
            '/api/dashboard': {
                'get': {
                    'tags': ['Account'],
                    'summary': 'Client dashboard payload',
                    'responses': {'200': {'description': 'Dashboard data.'}},
                }
            },
            '/api/accounts/main': {
                'get': {
                    'tags': ['Account'],
                    'summary': 'Main account',
                    'responses': {'200': {'description': 'Account payload.'}},
                }
            },
            '/api/transactions/topup': {
                'post': {
                    'tags': ['Account'],
                    'summary': 'Top up account',
                    'parameters': [
                        {'$ref': '#/components/parameters/RequestIdHeader'},
                        {'$ref': '#/components/parameters/IdempotencyKeyHeader'},
                    ],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/TopupRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Topup completed.'}},
                }
            },
            '/api/transactions/transfer': {
                'post': {
                    'tags': ['Account'],
                    'summary': 'Transfer by account number',
                    'parameters': [
                        {'$ref': '#/components/parameters/RequestIdHeader'},
                        {'$ref': '#/components/parameters/IdempotencyKeyHeader'},
                    ],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/TransferRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Transfer completed.'}},
                }
            },
            '/api/transactions/statement/order': {
                'post': {
                    'tags': ['Account'],
                    'summary': 'Create statement order and return download params',
                    'requestBody': {
                        'required': False,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/StatementOrderRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Statement order created.'}},
                }
            },
            '/api/transactions/statement/orders': {
                'get': {
                    'tags': ['Account'],
                    'summary': 'List recent statement orders for current user',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                    ],
                    'responses': {'200': {'description': 'Recent statement orders.'}},
                }
            },
            '/api/transactions/statement': {
                'get': {
                    'tags': ['Account'],
                    'summary': 'Download statement PDF by period/report type',
                    'parameters': [
                        {'name': 'from_date', 'in': 'query', 'schema': {'type': 'string', 'format': 'date'}},
                        {'name': 'to_date', 'in': 'query', 'schema': {'type': 'string', 'format': 'date'}},
                        {'name': 'report_type', 'in': 'query', 'schema': {'type': 'string', 'enum': ['standard', 'detailed', 'tax']}},
                        {'name': 'order_id', 'in': 'query', 'schema': {'type': 'string'}},
                    ],
                    'responses': {'200': {'description': 'PDF document bytes.'}},
                }
            },
            '/api/transactions/history': {
                'get': {
                    'tags': ['Account'],
                    'summary': 'Paginated transaction history',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                        {'$ref': '#/components/parameters/Offset'},
                        {'name': 'tx_type', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'direction', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'from_date', 'in': 'query', 'schema': {'type': 'string', 'format': 'date'}},
                        {'name': 'to_date', 'in': 'query', 'schema': {'type': 'string', 'format': 'date'}},
                    ],
                    'responses': {'200': {'description': 'Transaction list.'}},
                }
            },
            '/api/cards': {
                'get': {
                    'tags': ['Cards'],
                    'summary': 'List user cards',
                    'responses': {'200': {'description': 'Card list.'}},
                },
                'post': {
                    'tags': ['Cards'],
                    'summary': 'Issue new card',
                    'responses': {'200': {'description': 'Card issued.'}},
                },
            },
            '/api/admin/stats': {
                'get': {
                    'tags': ['Admin'],
                    'summary': 'Admin dashboard stats',
                    'responses': {
                        '200': {'description': 'Stats payload.'},
                        '403': {'$ref': '#/components/responses/ErrorResponse'},
                    },
                }
            },
            '/api/admin/transactions': {
                'get': {
                    'tags': ['Admin'],
                    'summary': 'Global transaction registry',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                        {'$ref': '#/components/parameters/Offset'},
                        {'name': 'tx_type', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'direction', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'search', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'high_value_only', 'in': 'query', 'schema': {'type': 'boolean'}},
                        {'name': 'high_value_min', 'in': 'query', 'schema': {'type': 'number'}},
                        {'name': 'sort_by', 'in': 'query', 'schema': {'type': 'string'}},
                    ],
                    'responses': {'200': {'description': 'Transaction registry + summary.'}},
                }
            },
            '/api/admin/payouts': {
                'post': {
                    'tags': ['Admin'],
                    'summary': 'Create payout for user',
                    'parameters': [
                        {'$ref': '#/components/parameters/RequestIdHeader'},
                        {'$ref': '#/components/parameters/IdempotencyKeyHeader'},
                    ],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/PayoutRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Payout posted.'}},
                }
            },
            '/api/admin/payments/orders': {
                'get': {
                    'tags': ['Processing'],
                    'summary': 'Payment orders registry',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                        {'$ref': '#/components/parameters/Offset'},
                        {'name': 'status', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'risk_level', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'review_state', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'approval_state', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'assigned_admin_id', 'in': 'query', 'schema': {'type': 'integer'}},
                        {'name': 'assigned_mode', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'open_only', 'in': 'query', 'schema': {'type': 'boolean'}},
                    ],
                    'responses': {'200': {'description': 'Orders payload.'}},
                }
            },
            '/api/admin/payments/sla-queue': {
                'get': {
                    'tags': ['Processing'],
                    'summary': 'SLA queue with priority ordering',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                        {'$ref': '#/components/parameters/Offset'},
                        {'name': 'overdue', 'in': 'query', 'schema': {'type': 'boolean'}},
                        {'name': 'priority', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'assigned_admin_id', 'in': 'query', 'schema': {'type': 'integer'}},
                        {'name': 'assigned_mode', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'risk_level', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'approval_state', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'search', 'in': 'query', 'schema': {'type': 'string'}},
                    ],
                    'responses': {'200': {'description': 'SLA queue payload.'}},
                }
            },
            '/api/admin/payments/approval-inbox': {
                'get': {
                    'tags': ['Processing'],
                    'summary': 'Approval request inbox',
                    'parameters': [
                        {'$ref': '#/components/parameters/Limit'},
                        {'$ref': '#/components/parameters/Offset'},
                        {'name': 'approval_action', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'priority', 'in': 'query', 'schema': {'type': 'string'}},
                        {'name': 'overdue', 'in': 'query', 'schema': {'type': 'boolean'}},
                        {'name': 'search', 'in': 'query', 'schema': {'type': 'string'}},
                    ],
                    'responses': {'200': {'description': 'Approval inbox payload.'}},
                }
            },
            '/api/admin/payments/sla-bulk-action': {
                'post': {
                    'tags': ['Processing'],
                    'summary': 'Bulk actions for selected SLA queue orders',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/SlaBulkActionRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Bulk action result.'}},
                }
            },
            '/api/admin/payments/fraud-stats': {
                'get': {
                    'tags': ['Processing'],
                    'summary': 'Fraud and processing metrics',
                    'responses': {'200': {'description': 'Fraud stats payload.'}},
                }
            },
            '/api/push/vapid-public-key': {
                'get': {
                    'tags': ['Push'],
                    'summary': 'Public VAPID key',
                    'security': [],
                    'responses': {'200': {'description': 'VAPID public key.'}},
                }
            },
            '/api/push/subscribe': {
                'post': {
                    'tags': ['Push'],
                    'summary': 'Subscribe current user to push notifications',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/PushSubscribeRequest'}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Subscription saved.'}},
                }
            },
            '/api/push/unsubscribe': {
                'delete': {
                    'tags': ['Push'],
                    'summary': 'Remove push subscription by endpoint',
                    'requestBody': {
                        'required': False,
                        'content': {
                            'application/json': {
                                'schema': {'type': 'object', 'properties': {'endpoint': {'type': 'string'}}}
                            }
                        },
                    },
                    'responses': {'200': {'description': 'Subscription removed.'}},
                }
            },
        },
        'components': {
            'securitySchemes': {
                'BearerAuth': {
                    'type': 'http',
                    'scheme': 'bearer',
                    'bearerFormat': 'JWT',
                }
            },
            'parameters': {
                'Limit': {
                    'name': 'limit',
                    'in': 'query',
                    'schema': {'type': 'integer', 'minimum': 1, 'maximum': 500, 'default': 50},
                },
                'Offset': {
                    'name': 'offset',
                    'in': 'query',
                    'schema': {'type': 'integer', 'minimum': 0, 'default': 0},
                },
                'RequestIdHeader': {
                    'name': 'X-Request-Id',
                    'in': 'header',
                    'required': False,
                    'schema': {'type': 'string', 'maxLength': 120},
                    'description': 'Client-provided correlation id. Echoed in response header.',
                },
                'IdempotencyKeyHeader': {
                    'name': 'Idempotency-Key',
                    'in': 'header',
                    'required': True,
                    'schema': {'type': 'string', 'maxLength': 128},
                    'description': 'Required for monetary mutations to prevent duplicate execution.',
                },
            },
            'responses': {
                'ErrorResponse': {
                    'description': 'Unified API error envelope.',
                    'content': {
                        'application/json': {
                            'schema': {'$ref': '#/components/schemas/ErrorEnvelope'}
                        }
                    },
                }
            },
            'schemas': {
                'ErrorEnvelope': {
                    'type': 'object',
                    'properties': {
                        'ok': {'type': 'boolean', 'example': False},
                        'error': {'type': 'string', 'example': 'Потрібна авторизація.'},
                    },
                    'required': ['ok', 'error'],
                },
                'RegisterRequest': {
                    'type': 'object',
                    'properties': {
                        'full_name': {'type': 'string'},
                        'phone': {'type': 'string'},
                        'email': {'type': 'string'},
                        'password': {'type': 'string', 'minLength': 6},
                    },
                    'required': ['full_name', 'password'],
                },
                'LoginRequest': {
                    'type': 'object',
                    'properties': {
                        'identity': {'type': 'string', 'description': 'phone or email'},
                        'password': {'type': 'string'},
                    },
                    'required': ['identity', 'password'],
                },
                'TopupRequest': {
                    'type': 'object',
                    'properties': {'amount': {'type': 'number', 'minimum': 0.01}},
                    'required': ['amount'],
                },
                'TransferRequest': {
                    'type': 'object',
                    'properties': {
                        'recipient_account_number': {'type': 'string'},
                        'amount': {'type': 'number', 'minimum': 0.01},
                        'description': {'type': 'string'},
                    },
                    'required': ['recipient_account_number', 'amount'],
                },
                'StatementOrderRequest': {
                    'type': 'object',
                    'properties': {
                        'from_date': {'type': 'string', 'format': 'date'},
                        'to_date': {'type': 'string', 'format': 'date'},
                        'report_type': {'type': 'string', 'enum': ['standard', 'detailed', 'tax']},
                    },
                },
                'PayoutRequest': {
                    'type': 'object',
                    'properties': {
                        'user_id': {'type': 'integer', 'minimum': 1},
                        'amount': {'type': 'number', 'minimum': 0.01},
                        'title': {'type': 'string'},
                        'payout_type': {'type': 'string'},
                    },
                    'required': ['user_id', 'amount'],
                },
                'SlaBulkActionRequest': {
                    'type': 'object',
                    'properties': {
                        'ids': {'type': 'array', 'items': {'type': 'integer'}},
                        'action': {'type': 'string'},
                        'admin_user_id': {'type': 'integer'},
                        'note': {'type': 'string'},
                        'only_overdue': {'type': 'boolean'},
                    },
                    'required': ['ids', 'action'],
                },
                'PushSubscribeRequest': {
                    'type': 'object',
                    'properties': {
                        'endpoint': {'type': 'string'},
                        'p256dh': {'type': 'string'},
                        'auth': {'type': 'string'},
                    },
                    'required': ['endpoint', 'p256dh', 'auth'],
                },
            },
        },
    }


def build_postman_collection(prefix: str = '') -> dict:
    api_prefix = _join(prefix, '/api')
    return {
        'info': {
            'name': 'Army Bank API',
            'description': (
                'Starter collection for external developers. '
                'Set baseUrl/token variables in environment.'
            ),
            '_postman_id': 'army-bank-api-collection',
            'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        'variable': [
            {'key': 'baseUrl', 'value': 'https://army-bank.onrender.com'},
            {'key': 'apiPrefix', 'value': api_prefix},
            {'key': 'token', 'value': ''},
            {'key': 'identity', 'value': 'admin@army-bank.ua'},
            {'key': 'password', 'value': ''},
            {'key': 'userId', 'value': '1'},
            {'key': 'idempotencyKey', 'value': 'demo-payout-001'},
            {'key': 'requestId', 'value': 'req-demo-001'},
        ],
        'item': [
            {
                'name': 'System',
                'item': [
                    {
                        'name': 'API Catalog',
                        'request': {
                            'method': 'GET',
                            'header': [],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}', 'host': ['{{baseUrl}}'], 'path': ['{{apiPrefix}}']},
                        },
                    },
                    {
                        'name': 'API Version',
                        'request': {
                            'method': 'GET',
                            'header': [],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/version'},
                        },
                    },
                    {
                        'name': 'OpenAPI JSON',
                        'request': {
                            'method': 'GET',
                            'header': [],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/openapi.json'},
                        },
                    },
                ],
            },
            {
                'name': 'Auth',
                'item': [
                    {
                        'name': 'Login',
                        'event': [
                            {
                                'listen': 'test',
                                'script': {
                                    'type': 'text/javascript',
                                    'exec': [
                                        "const json = pm.response.json();",
                                        "if (json && json.ok && json.data && json.data.token) {",
                                        "  pm.environment.set('token', json.data.token);",
                                        "}",
                                    ],
                                },
                            }
                        ],
                        'request': {
                            'method': 'POST',
                            'header': [{'key': 'Content-Type', 'value': 'application/json'}],
                            'body': {
                                'mode': 'raw',
                                'raw': '{\n  "identity": "{{identity}}",\n  "password": "{{password}}"\n}',
                            },
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/auth/login'},
                        },
                    },
                    {
                        'name': 'Me',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/auth/me'},
                        },
                    },
                ],
            },
            {
                'name': 'Account',
                'item': [
                    {
                        'name': 'Order Statement PDF',
                        'request': {
                            'method': 'POST',
                            'header': [
                                {'key': 'Authorization', 'value': 'Bearer {{token}}'},
                                {'key': 'Content-Type', 'value': 'application/json'},
                            ],
                            'body': {
                                'mode': 'raw',
                                'raw': '{\n  \"report_type\": \"detailed\",\n  \"from_date\": \"2026-03-01\",\n  \"to_date\": \"2026-03-25\"\n}',
                            },
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/transactions/statement/order'},
                        },
                    },
                    {
                        'name': 'List Statement Orders',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/transactions/statement/orders?limit=10'},
                        },
                    },
                ],
            },
            {
                'name': 'Admin',
                'item': [
                    {
                        'name': 'Transactions Registry',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {
                                'raw': '{{baseUrl}}{{apiPrefix}}/admin/transactions?limit=50&offset=0&sort_by=newest',
                            },
                        },
                    },
                    {
                        'name': 'Create Payout',
                        'request': {
                            'method': 'POST',
                            'header': [
                                {'key': 'Authorization', 'value': 'Bearer {{token}}'},
                                {'key': 'Content-Type', 'value': 'application/json'},
                                {'key': 'Idempotency-Key', 'value': '{{idempotencyKey}}'},
                                {'key': 'X-Request-Id', 'value': '{{requestId}}'},
                            ],
                            'body': {
                                'mode': 'raw',
                                'raw': '{\n  "user_id": {{userId}},\n  "amount": 1000,\n  "title": "Test payout",\n  "payout_type": "combat"\n}',
                            },
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/admin/payouts'},
                        },
                    },
                ],
            },
            {
                'name': 'Processing',
                'item': [
                    {
                        'name': 'SLA Queue',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {
                                'raw': '{{baseUrl}}{{apiPrefix}}/admin/payments/sla-queue?limit=20&offset=0&open_only=true',
                            },
                        },
                    },
                    {
                        'name': 'Approval Inbox',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {
                                'raw': '{{baseUrl}}{{apiPrefix}}/admin/payments/approval-inbox?limit=20&offset=0&open_only=true',
                            },
                        },
                    },
                    {
                        'name': 'Fraud Stats',
                        'request': {
                            'method': 'GET',
                            'header': [{'key': 'Authorization', 'value': 'Bearer {{token}}'}],
                            'url': {'raw': '{{baseUrl}}{{apiPrefix}}/admin/payments/fraud-stats'},
                        },
                    },
                ],
            },
        ],
    }


def build_postman_environment(prefix: str = '') -> dict:
    return {
        'name': 'Army Bank API (Render)',
        'values': [
            {'key': 'baseUrl', 'value': 'https://army-bank.onrender.com', 'enabled': True},
            {'key': 'apiPrefix', 'value': _join(prefix, '/api'), 'enabled': True},
            {'key': 'identity', 'value': 'admin@army-bank.ua', 'enabled': True},
            {'key': 'password', 'value': '', 'enabled': True},
            {'key': 'token', 'value': '', 'enabled': True},
            {'key': 'userId', 'value': '1', 'enabled': True},
            {'key': 'idempotencyKey', 'value': 'demo-payout-001', 'enabled': True},
            {'key': 'requestId', 'value': 'req-demo-001', 'enabled': True},
        ],
        '_postman_variable_scope': 'environment',
        '_postman_exported_at': datetime.now(timezone.utc).isoformat(),
        '_postman_exported_using': 'Army Bank API docs',
    }


def build_docs_html(prefix: str = '') -> str:
    catalog = build_api_catalog(prefix)
    docs_url = escape(catalog['docs_url'])
    openapi_url = escape(catalog['openapi_url'])
    health_url = escape(catalog['health_url'])
    version_url = escape(catalog['version_url'])
    postman_collection_url = escape(catalog['postman_collection_url'])
    postman_environment_url = escape(catalog['postman_environment_url'])
    api_base = escape(catalog['api_base'])
    generated_at = escape(catalog['generated_at'])

    groups_html = []
    for group in catalog['groups']:
        items = ''.join(
            f"<li><code>{escape(ep['method'])}</code> <code>{escape(ep['path'])}</code></li>"
            for ep in group['endpoints']
        )
        groups_html.append(f"<section><h3>{escape(group['name'])}</h3><ul>{items}</ul></section>")

    curl_login = (
        "curl -X POST https://army-bank.onrender.com/api/auth/login "
        "-H 'Content-Type: application/json' "
        "-d '{\"identity\":\"admin@army-bank.ua\",\"password\":\"******\"}'"
    )
    curl_me = (
        "curl https://army-bank.onrender.com/api/auth/me "
        "-H 'Authorization: Bearer <token>'"
    )
    curl_tx = (
        "curl 'https://army-bank.onrender.com/api/admin/transactions?limit=50&offset=0&sort_by=newest' "
        "-H 'Authorization: Bearer <admin_token>'"
    )

    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Army Bank API Docs</title>
  <style>
    :root {{
      --bg:#0d1117; --card:#161b22; --text:#dbe4ee; --muted:#9fb0c2;
      --line:#2a3340; --accent:#4da3ff; --ok:#30c281;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:var(--bg); color:var(--text); }}
    .wrap {{ max-width: 980px; margin: 0 auto; padding: 24px 16px 40px; }}
    h1 {{ margin:0 0 8px; font-size: 1.55rem; }}
    h2 {{ margin:24px 0 10px; font-size: 1.1rem; }}
    h3 {{ margin:14px 0 8px; font-size: .95rem; color: var(--accent); }}
    p, li {{ color: var(--muted); line-height: 1.45; }}
    a {{ color: var(--accent); }}
    .card {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-top:12px; }}
    .meta {{ display:flex; flex-wrap: wrap; gap: 12px; margin:8px 0 0; }}
    .pill {{ border:1px solid var(--line); border-radius:999px; padding:5px 10px; font-size:.78rem; color:var(--muted); }}
    .ok {{ color: var(--ok); }}
    code {{ background:#0f141b; border:1px solid var(--line); border-radius:6px; padding:2px 6px; color:#cfe7ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
    pre {{ background:#0f141b; border:1px solid var(--line); border-radius:10px; padding:10px 12px; overflow:auto; }}
    ul {{ margin:8px 0 0; padding-left: 18px; }}
    section + section {{ margin-top: 10px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Army Bank API — Developer Docs</h1>
    <p>Стабільна точка входу для інтеграцій та зовнішніх розробників.</p>
    <div class="meta">
      <span class="pill">API base: <code>{api_base}</code></span>
      <span class="pill">Docs: <a href="{docs_url}">{docs_url}</a></span>
      <span class="pill">OpenAPI: <a href="{openapi_url}">{openapi_url}</a></span>
      <span class="pill">Health: <a href="{health_url}">{health_url}</a></span>
      <span class="pill">Version: <a href="{version_url}">{version_url}</a></span>
      <span class="pill">Generated: {generated_at}</span>
    </div>

    <div class="card">
      <h2>Auth Flow</h2>
      <p>1) <code>POST /api/auth/login</code> to get token. 2) Pass token in <code>Authorization: Bearer &lt;token&gt;</code>. 3) If response includes <code>X-Refresh-Token</code>, replace stored token with it.</p>
      <p>Unified error envelope: <code>{{"ok": false, "error": "..."}}</code></p>
    </div>

    <div class="card">
      <h2>Quick Curl</h2>
      <pre>{escape(curl_login)}</pre>
      <pre>{escape(curl_me)}</pre>
      <pre>{escape(curl_tx)}</pre>
    </div>

    <div class="card">
      <h2>Endpoint Groups</h2>
      {''.join(groups_html)}
    </div>

    <div class="card">
      <h2>Machine-readable schema</h2>
      <p class="ok">Use <a href="{openapi_url}">{openapi_url}</a> to generate typed clients (OpenAPI 3.0.3).</p>
      <p>Postman collection: <a href="{postman_collection_url}">{postman_collection_url}</a></p>
      <p>Postman environment: <a href="{postman_environment_url}">{postman_environment_url}</a></p>
    </div>
  </div>
</body>
</html>
"""
