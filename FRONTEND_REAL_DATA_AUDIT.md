# Frontend Audit: Real Data vs Visual Layer

Date: 2026-04-21

## Goal
Привязать мобильный и десктоп UI только к реальным backend endpoint-ам и убрать скрытые/тихие демо-подмены.

## Critical Findings

1. `/src/App.tsx` (React app for `/bank`) uses hardcoded visual data instead of API.
- Hardcoded activity feed (`ACTIVITY_ROWS`) and quick actions live data mismatch.
- Hardcoded balances and account labels (example: fixed `7 986 232,00`, `AB-100023`).
- Hardcoded card list (`cards` in `OverviewScreen`) not synced with `/api/cards`.
- Risk: пользователь видит красивый интерфейс, но данные не из production backend.

2. `/frontend/js/marketplace.js` had automatic local fallback catalog.
- On API failure/empty response it silently switched to `FALLBACK_PRODUCTS`.
- Risk: каталог выглядел рабочим даже при недоступном API.

3. `/frontend/js/app.js` card design has local-only persistence fallback.
- If backend PATCH fails, design still applies from `localStorage`.
- Risk: локальное состояние может расходиться с серверным состоянием на другом устройстве.

## Changes Done In This Pass

1. Disabled fake catalog substitution in marketplace.
- File: `frontend/js/marketplace.js`
- Added `REAL_DATA_ONLY_MODE = true`.
- In fallback path, UI now shows "catalog unavailable" and keeps data source strict (real API only).
- Toast now explicitly reports that fake data is disabled.

## Recommended Next Steps (Implementation Queue)

1. `/src/App.tsx`: replace hardcoded dashboard/card/activity blocks with API data layer.
- Add auth bootstrap (`/api/auth/me`), account fetch (`/api/accounts/main`), cards (`/api/cards`), history (`/api/transactions/history`).
- Create loading/empty/error states instead of static demo content.

2. `/src/App.tsx`: add single API client (shared with `frontend/js/api.js` behavior).
- Token handling, error normalization, 401 recovery, refresh-token support.

3. `/frontend/js/app.js`: make card design strictly server-authoritative.
- Show error if design PATCH fails; do not leave local success illusion.
- Optionally keep local optimistic UI but rollback on failure.

4. Add runtime environment flag for demo data policy.
- Example: `ARMY_BANK_ALLOW_DEMO_DATA=false` by default in production.
- Block demo fallbacks in CI/prod builds.

## Validation Checklist

- Marketplace never renders local synthetic products when API is down.
- `/bank` dashboard values equal backend responses after login.
- Cards and transactions match `/api/cards` + `/api/transactions/history`.
- Same account on second device shows identical state (no local-only drift).
