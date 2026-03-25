# Army Bank API — Handoff for External Developers

This document is a practical integration guide for backend/API consumers.

## 1. Base URLs

- Production (Render): `https://army-bank.onrender.com`
- API base: `https://army-bank.onrender.com/api`
- API version: `https://army-bank.onrender.com/api/version`
- Human docs: `https://army-bank.onrender.com/api/docs`
- OpenAPI schema: `https://army-bank.onrender.com/api/openapi.json`
- Postman collection: `https://army-bank.onrender.com/api/postman/collection`
- Postman environment: `https://army-bank.onrender.com/api/postman/environment`
- Healthcheck: `https://army-bank.onrender.com/health`

If deployment uses `BASE_PATH` (for example `/bank`), prepend it to all paths:

- `/bank/api/...`
- `/bank/api/version`
- `/bank/api/docs`
- `/bank/api/openapi.json`
- `/bank/api/postman/collection`
- `/bank/api/postman/environment`

## 2. Authentication

Auth type: **Bearer token**

Header:

```http
Authorization: Bearer <token>
```

### Login flow

1. `POST /api/auth/login` with credentials.
2. Save token from response body.
3. Send bearer token with every protected request.
4. If response contains header `X-Refresh-Token`, replace stored token.

## 3. Roles

- `soldier` — end-user operations.
- `operator` — processing operations.
- `admin` — admin operations.
- `platform_admin` — full admin + platform scope.

## 4. Response format

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "error": "Human-readable message"
}
```

Typical status codes:

- `200` success
- `400` validation or bad input
- `401` unauthorized / invalid token
- `403` forbidden by role
- `404` not found
- `500` internal server error

## 5. Pagination & filters

Most list endpoints support:

- `limit` (1..500)
- `offset` (>=0)

Many admin/processing registries also support:

- `search`
- date range (`from_date`, `to_date`)
- sorting (`sort_by`)
- role-specific filters (`assigned_admin_id`, `risk_level`, etc.)

## 6. Key endpoints (practical subset)

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/auth/sessions`

### User account

- `GET /api/dashboard`
- `GET /api/accounts/main`
- `POST /api/transactions/topup`
- `POST /api/transactions/transfer`
- `GET /api/transactions/history`
- `GET /api/cards`

### Admin

- `GET /api/admin/stats`
- `GET /api/admin/transactions`
- `POST /api/admin/payouts`
- `GET /api/admin/audit-logs`

### Processing

- `GET /api/admin/payments/orders`
- `GET /api/admin/payments/sla-queue`
- `GET /api/admin/payments/approval-inbox`
- `POST /api/admin/payments/sla-bulk-action`
- `GET /api/admin/payments/fraud-stats`

### Push

- `GET /api/push/vapid-public-key`
- `POST /api/push/subscribe`
- `DELETE /api/push/unsubscribe`

## 7. Ready-to-run curl examples

### Login

```bash
curl -X POST https://army-bank.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@army-bank.ua","password":"******"}'
```

### Current user profile

```bash
curl https://army-bank.onrender.com/api/auth/me \
  -H "Authorization: Bearer <token>"
```

### Admin transaction registry

```bash
curl "https://army-bank.onrender.com/api/admin/transactions?limit=50&offset=0&sort_by=newest" \
  -H "Authorization: Bearer <admin_token>"
```

### Processing SLA queue

```bash
curl "https://army-bank.onrender.com/api/admin/payments/sla-queue?limit=20&offset=0&open_only=true&overdue=true" \
  -H "Authorization: Bearer <admin_or_operator_token>"
```

## 8. Contract-first integration

For typed SDK/client generation use OpenAPI:

- `https://army-bank.onrender.com/api/openapi.json`

Recommended pipeline:

1. Pull OpenAPI schema.
2. Generate client for your stack.
3. Keep a local contract snapshot in your integration repo.
4. Diff schema on each backend release.

## 9. Postman quick start

1. Import collection URL:
   - `https://army-bank.onrender.com/api/postman/collection`
2. Import environment URL:
   - `https://army-bank.onrender.com/api/postman/environment`
3. Fill environment variables:
   - `identity`
   - `password`
4. Run `Auth / Login` request to auto-save `token`.
5. Run protected requests (Admin/Processing folders).
