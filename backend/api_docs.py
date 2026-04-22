"""API catalog, docs page and OpenAPI schema for developer handoff."""
from __future__ import annotations

import os
import platform
import re
from datetime import datetime, timezone
from html import escape


API_DOCS_VERSION = '2026-04-08'


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
                    'security': [],
                    'responses': {
                        '200': {'description': 'API metadata and endpoint groups.'}
                    },
                }
            },
            '/api/openapi.json': {
                'get': {
                    'tags': ['System'],
                    'summary': 'OpenAPI schema',
                    'security': [],
                    'responses': {'200': {'description': 'OpenAPI 3.0 JSON schema.'}},
                }
            },
            '/api/version': {
                'get': {
                    'tags': ['System'],
                    'summary': 'API runtime and version metadata',
                    'security': [],
                    'responses': {'200': {'description': 'Version payload.'}},
                }
            },
            '/api/docs': {
                'get': {
                    'tags': ['System'],
                    'summary': 'Human-readable API documentation page',
                    'security': [],
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


def _is_api_path(path: str) -> bool:
    return bool(re.match(r'^/api(?:/|$)', path or ''))


def _rule_to_openapi_path(rule_path: str, prefix: str = '') -> str:
    path = str(rule_path or '')
    pref = prefix or ''
    if pref and path.startswith(pref):
        path = path[len(pref):] or '/'
    if not path.startswith('/'):
        path = '/' + path
    # Flask converters: <int:id> -> {id}
    path = re.sub(r'<(?:[^:<>]+:)?([^<>]+)>', r'{\1}', path)
    return path


def _guess_tag(path: str) -> str:
    tail = (path or '').removeprefix('/api').strip('/')
    head = tail.split('/', 1)[0] if tail else ''
    mapping = {
        '': 'System',
        'auth': 'Auth',
        'accounts': 'Account',
        'transactions': 'Account',
        'cards': 'Cards',
        'admin': 'Admin',
        'platform': 'Platform',
        'operator': 'Operator',
        'push': 'Push',
        'messenger': 'Messenger',
        'notifications': 'Features',
        'budget-limits': 'Features',
        'recurring-transactions': 'Features',
        'debts': 'Features',
        'family-contacts': 'Features',
        'payment-templates': 'Features',
        'savings-goals': 'Features',
        'donations': 'Features',
        'analytics': 'Features',
        'audit-logs': 'Features',
    }
    return mapping.get(head, 'Features')


def _is_public_runtime_endpoint(path: str, method: str) -> bool:
    pub = {
        ('GET', '/api'),
        ('GET', '/api/'),
        ('GET', '/api/version'),
        ('GET', '/api/docs'),
        ('GET', '/api/openapi.json'),
        ('GET', '/api/postman/collection'),
        ('GET', '/api/postman/environment'),
        ('GET', '/api/push/vapid-public-key'),
        ('POST', '/api/auth/register'),
        ('POST', '/api/auth/login'),
    }
    return (method, path) in pub


def _runtime_operation(method: str, path: str) -> dict:
    tag = _guess_tag(path)
    op = {
        'tags': [tag],
        'summary': f'Auto-discovered {method} {path}',
        'responses': {
            '200': {'description': 'Runtime-discovered endpoint.'},
            '400': {'$ref': '#/components/responses/ErrorResponse'},
            '401': {'$ref': '#/components/responses/ErrorResponse'},
            '403': {'$ref': '#/components/responses/ErrorResponse'},
            '500': {'$ref': '#/components/responses/ErrorResponse'},
        },
    }
    if _is_public_runtime_endpoint(path, method):
        op['security'] = []

    params = []
    for name in re.findall(r'\{([^}]+)\}', path):
        params.append({
            'name': name,
            'in': 'path',
            'required': True,
            'schema': {'type': 'string'},
        })
    if params:
        op['parameters'] = params
    return op


def augment_openapi_with_runtime_routes(schema: dict, app, prefix: str = '') -> dict:
    """Доповнює статичну OpenAPI-схему всіма runtime-маршрутами Flask.

    Це знімає ризик, коли нові endpoint-и додані в backend, але ще не внесені
    вручну в build_openapi_schema().
    """
    paths = schema.setdefault('paths', {})
    tags = schema.setdefault('tags', [])
    tag_names = {t.get('name') for t in tags if isinstance(t, dict)}

    for rule in app.url_map.iter_rules():
        methods = sorted((rule.methods or set()) - {'HEAD', 'OPTIONS'})
        if not methods:
            continue

        openapi_path = _rule_to_openapi_path(rule.rule, prefix)
        if not _is_api_path(openapi_path):
            continue

        path_item = paths.setdefault(openapi_path, {})
        for method in methods:
            key = method.lower()
            if key in path_item:
                continue
            op = _runtime_operation(method, openapi_path)
            path_item[key] = op
            tag = op['tags'][0]
            if tag not in tag_names:
                tags.append({'name': tag})
                tag_names.add(tag)

    return schema


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


def _operation_requires_auth(operation: dict, global_security: list) -> bool:
    if not isinstance(operation, dict):
        return bool(global_security)
    if 'security' in operation:
        security = operation.get('security')
        return bool(security)
    return bool(global_security)


def _endpoint_groups_from_schema(schema: dict) -> list[dict]:
    paths = schema.get('paths') or {}
    global_security = schema.get('security') or []
    grouped: dict[str, list[dict]] = {}
    seen_endpoints: set[tuple[str, str]] = set()
    methods_order = ('get', 'post', 'put', 'patch', 'delete', 'options', 'head')

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method in methods_order:
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            method_name = method.upper()
            raw_path = str(path)
            normalized_path = raw_path if raw_path == '/' else raw_path.rstrip('/')
            endpoint_key = (method_name, normalized_path)
            if endpoint_key in seen_endpoints:
                continue
            seen_endpoints.add(endpoint_key)
            tags = operation.get('tags') or ['System']
            tag = str(tags[0] if tags else 'System')
            endpoint = {
                'method': method_name,
                'path': normalized_path or '/',
                'summary': str(operation.get('summary') or '—'),
                'auth': 'Bearer' if _operation_requires_auth(operation, global_security) else 'Public',
            }
            grouped.setdefault(tag, []).append(endpoint)

    groups: list[dict] = []
    ordered_tags = sorted(grouped.keys(), key=lambda x: (x != 'System', x.lower()))
    for tag in ordered_tags:
        endpoints = sorted(grouped[tag], key=lambda ep: (ep['path'], ep['method']))
        groups.append({'name': tag, 'endpoints': endpoints})
    return groups


def build_docs_html(prefix: str = '', app=None) -> str:
    catalog = build_api_catalog(prefix)
    schema = build_openapi_schema(prefix)
    if app is not None:
        schema = augment_openapi_with_runtime_routes(schema, app, prefix)

    groups = _endpoint_groups_from_schema(schema)
    total_endpoints = sum(len(group['endpoints']) for group in groups)
    public_endpoints = sum(
        1
        for group in groups
        for endpoint in group['endpoints']
        if endpoint['auth'] == 'Public'
    )
    protected_endpoints = max(0, total_endpoints - public_endpoints)

    docs_url = escape(catalog['docs_url'])
    openapi_url = escape(catalog['openapi_url'])
    health_url = escape(catalog['health_url'])
    version_url = escape(catalog['version_url'])
    postman_collection_url = escape(catalog['postman_collection_url'])
    postman_environment_url = escape(catalog['postman_environment_url'])
    api_base = escape(catalog['api_base'])
    generated_at = escape(catalog['generated_at'])
    groups_count = str(len(groups))

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

    group_blocks: list[str] = []
    for index, group in enumerate(groups):
        group_name = escape(group['name'])
        group_count = len(group['endpoints'])
        rows = []
        for ep in group['endpoints']:
            method = escape(ep['method'])
            method_cls = re.sub(r'[^a-z]', '', ep['method'].lower()) or 'unknown'
            path = escape(ep['path'])
            summary = escape(ep['summary'])
            auth = escape(ep['auth'])
            auth_cls = 'auth-public' if ep['auth'] == 'Public' else 'auth-protected'
            rows.append(
                f"""
                <li class="endpoint-row">
                  <span class="method method-{method_cls}">{method}</span>
                  <code class="path">{path}</code>
                  <span class="auth {auth_cls}">{auth}</span>
                  <span class="summary">{summary}</span>
                </li>
                """
            )
        open_attr = ' open' if index < 2 else ''
        group_blocks.append(
            f"""
            <details class="group"{open_attr}>
              <summary>
                <span>{group_name}</span>
                <span class="group-count">{group_count} endpoint(s)</span>
              </summary>
              <ul class="endpoint-list">{''.join(rows)}</ul>
            </details>
            """
        )

    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Army Bank API Docs</title>
  <style>
    :root {{
      --bg: #edf3ef;
      --surface: #ffffff;
      --surface-soft: #f5faf6;
      --ink: #11291d;
      --muted: #5f776b;
      --line: rgba(17, 41, 29, 0.15);
      --brand-700: #0f5b36;
      --brand-600: #167545;
      --brand-500: #24a75d;
      --ok: #148344;
      --warn: #a3700f;
      --shadow: 0 20px 54px rgba(9, 40, 24, 0.12);
      --radius-xl: 24px;
      --radius-md: 14px;
    }}
    * {{
      box-sizing: border-box;
    }}
    html, body {{
      margin: 0;
      padding: 0;
      font-family: "Manrope", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(900px 260px at 12% -8%, rgba(255, 202, 110, 0.24), transparent 62%),
        radial-gradient(760px 280px at 100% 0, rgba(74, 185, 122, 0.24), transparent 58%),
        linear-gradient(180deg, #0f5a35 0 250px, var(--bg) 250px 100%);
    }}
    .wrap {{
      max-width: 1260px;
      margin: 0 auto;
      padding: clamp(14px, 3.2vw, 30px);
    }}
    .hero {{
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: var(--radius-xl);
      padding: clamp(18px, 2.8vw, 28px);
      background:
        radial-gradient(900px 220px at 0 0, rgba(255, 218, 137, 0.16), transparent 58%),
        linear-gradient(125deg, rgba(15, 88, 51, 0.98), rgba(10, 71, 40, 0.95));
      color: #f6fbf7;
      box-shadow: 0 24px 60px rgba(8, 37, 22, 0.34);
    }}
    .kicker {{
      margin: 0 0 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 11px;
      color: rgba(220, 246, 229, 0.88);
      font-weight: 700;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(30px, 4.4vw, 48px);
      line-height: 1.03;
      letter-spacing: -0.03em;
      color: #ffffff;
    }}
    .lead {{
      margin: 10px 0 0;
      max-width: 900px;
      color: rgba(233, 248, 238, 0.95);
      line-height: 1.45;
    }}
    .hero-links {{
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      border-radius: 999px;
      border: 1px solid transparent;
      padding: 0 14px;
      font-size: 12px;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      text-decoration: none;
      font-weight: 800;
      transition: transform 0.14s ease, background-color 0.18s ease, border-color 0.18s ease;
    }}
    .btn-primary {{
      background: linear-gradient(180deg, #d9efdf 0%, #bde2ca 100%);
      color: #123321;
      border-color: rgba(200, 231, 209, 0.96);
    }}
    .btn-ghost {{
      background: rgba(255, 255, 255, 0.1);
      color: #e8f5ed;
      border-color: rgba(233, 245, 236, 0.4);
    }}
    .btn:hover {{
      transform: translateY(-1px);
    }}
    .stats {{
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }}
    .stat {{
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(227, 246, 234, 0.28);
      border-radius: 12px;
      padding: 10px 12px;
      min-width: 0;
    }}
    .stat-label {{
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(223, 245, 231, 0.92);
      display: block;
    }}
    .stat-value {{
      margin-top: 6px;
      font-size: clamp(20px, 2.6vw, 28px);
      line-height: 1;
      font-weight: 800;
      color: #ffffff;
    }}
    .grid {{
      margin-top: 14px;
      display: grid;
      grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }}
    .card {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 16px;
      min-width: 0;
    }}
    .card h2 {{
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }}
    .card p {{
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }}
    .meta {{
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .pill {{
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--muted);
      background: var(--surface-soft);
    }}
    .pill code {{
      font-size: 11px;
    }}
    a {{
      color: var(--brand-700);
      text-decoration: none;
      font-weight: 700;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    pre {{
      margin: 10px 0 0;
      border: 1px solid rgba(18, 55, 35, 0.2);
      border-radius: 12px;
      background: #0f2e1f;
      color: #d6f4df;
      font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      padding: 11px 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }}
    code {{
      font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
      background: #eff7f1;
      border: 1px solid rgba(18, 55, 35, 0.18);
      border-radius: 7px;
      padding: 2px 6px;
      color: #123524;
      font-size: 12px;
    }}
    .groups {{
      display: grid;
      gap: 10px;
    }}
    .group {{
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbf9 100%);
      overflow: clip;
    }}
    .group summary {{
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 13px;
      font-weight: 800;
    }}
    .group summary::-webkit-details-marker {{
      display: none;
    }}
    .group-count {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }}
    .endpoint-list {{
      margin: 0;
      padding: 0 10px 10px;
      list-style: none;
      display: grid;
      gap: 8px;
    }}
    .endpoint-row {{
      border: 1px solid rgba(17, 41, 29, 0.14);
      border-radius: 12px;
      background: #ffffff;
      padding: 9px 10px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 8px 10px;
      align-items: start;
    }}
    .method {{
      font-size: 11px;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      font-weight: 800;
      letter-spacing: 0.06em;
    }}
    .method-get {{
      color: #0f6a37;
      background: rgba(19, 163, 82, 0.15);
      border-color: rgba(19, 163, 82, 0.33);
    }}
    .method-post, .method-put, .method-patch {{
      color: #125d79;
      background: rgba(10, 153, 191, 0.14);
      border-color: rgba(10, 153, 191, 0.3);
    }}
    .method-delete {{
      color: #9a1f1f;
      background: rgba(220, 62, 62, 0.14);
      border-color: rgba(220, 62, 62, 0.3);
    }}
    .path {{
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .auth {{
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 11px;
      min-height: 24px;
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
    }}
    .auth-public {{
      color: #18593a;
      background: rgba(39, 177, 98, 0.13);
      border-color: rgba(39, 177, 98, 0.28);
    }}
    .auth-protected {{
      color: #8c6308;
      background: rgba(201, 158, 58, 0.14);
      border-color: rgba(201, 158, 58, 0.31);
    }}
    .summary {{
      grid-column: 2 / -1;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      min-width: 0;
      overflow-wrap: anywhere;
    }}
    .machine p {{
      margin: 8px 0 0;
    }}
    .footer-note {{
      margin-top: 10px;
      color: #638072;
      font-size: 12px;
      line-height: 1.45;
    }}
    @media (max-width: 1060px) {{
      .grid {{
        grid-template-columns: 1fr;
      }}
    }}
    @media (max-width: 760px) {{
      .stats {{
        grid-template-columns: 1fr 1fr;
      }}
      .hero-links {{
        width: 100%;
      }}
      .btn {{
        flex: 1 1 auto;
      }}
      .endpoint-row {{
        grid-template-columns: auto minmax(0, 1fr);
      }}
      .auth {{
        grid-column: 2;
        justify-self: start;
      }}
      .summary {{
        grid-column: 1 / -1;
      }}
    }}
    @media (max-width: 520px) {{
      .wrap {{
        padding: 10px;
      }}
      .hero {{
        border-radius: 18px;
      }}
      .card {{
        border-radius: 14px;
        padding: 13px;
      }}
      .stats {{
        grid-template-columns: 1fr;
      }}
      .btn {{
        width: 100%;
      }}
      .meta {{
        gap: 6px;
      }}
      .group summary {{
        padding: 10px 11px;
      }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      .btn {{
        transition: none;
      }}
    }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <p class="kicker">Army Bank · API · Developer Experience</p>
      <h1>API Docs Center</h1>
      <p class="lead">Актуальна карта endpoint-ів, зведена по runtime OpenAPI. Сторінка автоматично підтягує нові API-маршрути без ручного дублювання.</p>
      <div class="hero-links">
        <a class="btn btn-primary" href="{openapi_url}" target="_blank" rel="noopener">OpenAPI JSON</a>
        <a class="btn btn-ghost" href="/api-status">API Status Center</a>
        <a class="btn btn-ghost" href="/">Повернутись у банк</a>
      </div>
      <div class="stats">
        <article class="stat">
          <span class="stat-label">Всього endpoint-ів</span>
          <div class="stat-value">{total_endpoints}</div>
        </article>
        <article class="stat">
          <span class="stat-label">Public</span>
          <div class="stat-value">{public_endpoints}</div>
        </article>
        <article class="stat">
          <span class="stat-label">Protected</span>
          <div class="stat-value">{protected_endpoints}</div>
        </article>
        <article class="stat">
          <span class="stat-label">Групи</span>
          <div class="stat-value">{groups_count}</div>
        </article>
      </div>
    </section>

    <section class="grid">
      <aside class="left-column">
        <article class="card">
          <h2>Meta & Links</h2>
          <div class="meta">
            <span class="pill">API base: <code>{api_base}</code></span>
            <span class="pill">Docs: <a href="{docs_url}">{docs_url}</a></span>
            <span class="pill">Health: <a href="{health_url}">{health_url}</a></span>
            <span class="pill">Version: <a href="{version_url}">{version_url}</a></span>
            <span class="pill">Generated: {generated_at}</span>
          </div>
        </article>

        <article class="card">
          <h2>Auth Flow</h2>
          <p>1) Виклич <code>POST /api/auth/login</code>. 2) Передай токен в <code>Authorization: Bearer &lt;token&gt;</code>. 3) Якщо прийшов <code>X-Refresh-Token</code>, заміни токен у клієнті. 4) Для грошових мутацій передавай <code>Idempotency-Key</code>.</p>
          <p>Уніфікований error envelope: <code>{{"ok": false, "error": "..."}}</code></p>
        </article>

        <article class="card">
          <h2>Quick Curl</h2>
          <pre>{escape(curl_login)}</pre>
          <pre>{escape(curl_me)}</pre>
          <pre>{escape(curl_tx)}</pre>
        </article>

        <article class="card machine">
          <h2>Machine-readable</h2>
          <p><a href="{openapi_url}" target="_blank" rel="noopener">OpenAPI schema</a></p>
          <p><a href="{postman_collection_url}" target="_blank" rel="noopener">Postman collection</a></p>
          <p><a href="{postman_environment_url}" target="_blank" rel="noopener">Postman environment</a></p>
          <p class="footer-note">OpenAPI version: <code>{escape(str(schema.get('openapi') or '3.0.3'))}</code> · Docs version: <code>{escape(API_DOCS_VERSION)}</code></p>
        </article>
      </aside>

      <section class="card">
        <h2>Endpoint Matrix by Tags</h2>
        <p>Список нижче формується з OpenAPI + runtime auto-discovery (тобто включає нові маршрути, додані у Flask URL map).</p>
        <div class="groups">
          {''.join(group_blocks)}
        </div>
      </section>
    </section>
  </main>
</body>
</html>
"""
