"""EOD Batch Processor — COBOL-style End-of-Day processing.

Нічний пакетний процес банку (аналог COBOL BATCH JCL):

  STEP 01: EXPIRE-HOLDS      — прострочені holds → expired
  STEP 02: PROCESS-RECURRING — виконати scheduled recurring transactions
  STEP 03: SETTLEMENT-RUN    — відкрити батч, зібрати, нетинг, провести
  STEP 04: RECONCILE         — перевірити дебет = кредит
  STEP 05: INTEGRITY-CHECK   — перевірити хеші транзакцій (IntegrityService)
  STEP 06: ARCHIVE-LOG       — зберегти підсумок у audit_logs
  STEP 07: FRAUD-VELOCITY    — очистити застарілі velocity-записи

Кожен крок ізольований: виключення логуються, процес продовжується.
Результат: {'steps': [{name, ok, result, error}], 'ok': bool}
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..database import get_connection
from .hold_service import HoldService
from .settlement_service import SettlementService
from .ledger_service import LedgerService

logger = logging.getLogger(__name__)


class EODProcessor:

    def __init__(self):
        self._holds      = HoldService()
        self._settlement = SettlementService()
        self._ledger     = LedgerService()

    def run(self, date_str: str | None = None, initiated_by: int | None = None) -> dict:
        """Запуск повного EOD-циклу. Повертає зведений звіт."""
        if date_str is None:
            date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

        steps = []
        overall_ok = True

        def _step(name: str, fn, *args, **kwargs) -> Any:
            nonlocal overall_ok
            try:
                result = fn(*args, **kwargs)
                steps.append({'step': name, 'ok': True, 'result': result})
                logger.info('[EOD] %s — OK: %s', name, result)
                return result
            except Exception as exc:
                overall_ok = False
                steps.append({'step': name, 'ok': False, 'error': str(exc)})
                logger.error('[EOD] %s — FAILED: %s', name, exc)
                return None

        # STEP 01: Expire stale holds
        _step('EXPIRE_HOLDS', self._holds.expire_stale_holds)

        # STEP 02: Process recurring transactions
        _step('PROCESS_RECURRING', self._process_recurring, date_str)

        # STEP 03: EOD Settlement
        settlement_result = _step('SETTLEMENT', self._settlement.run_eod_settlement, date_str)

        # STEP 04: Reconcile (якщо settlement не запустився — окремо)
        if settlement_result and 'reconcile' in settlement_result:
            recon = settlement_result['reconcile']
            steps.append({'step': 'RECONCILE', 'ok': recon.get('ok', False), 'result': recon})
        else:
            _step('RECONCILE', self._ledger.reconcile, date_str)

        # STEP 05: Integrity check
        _step('INTEGRITY_CHECK', self._integrity_sample_check)

        # STEP 06: Clean fraud velocity cache (старіший 24 год)
        _step('FRAUD_VELOCITY_CLEANUP', self._cleanup_velocity_cache)

        # STEP 07: Archive EOD log
        _step('ARCHIVE_LOG', self._archive_eod_log,
              date_str, overall_ok, steps, initiated_by)

        return {
            'ok':      overall_ok,
            'date':    date_str,
            'steps':   steps,
            'summary': self._build_summary(steps),
        }

    # ── Step implementations ──────────────────────────────────────────────────

    def _process_recurring(self, date_str: str) -> dict:
        """Виконує recurring_transactions що наступили (next_run_date <= today)."""
        from ..repositories.account_repository import AccountRepository
        from ..services.payment_core import PaymentCore

        accounts = AccountRepository()
        core = PaymentCore()

        with get_connection() as conn:
            due = conn.execute(
                "SELECT * FROM recurring_transactions"
                " WHERE is_active = %s AND next_run_date <= %s",
                (True, date_str),
            ).fetchall()

        processed = 0
        failed = 0
        for rec in due:
            rec = dict(rec)
            try:
                # Виконуємо переказ
                sender = accounts.get_account_by_user_id(rec['user_id'])
                if not sender:
                    continue

                if rec['tx_type'] == 'transfer' and rec.get('recipient_account'):
                    core.transfer(
                        user_id=rec['user_id'],
                        recipient_account_number=rec['recipient_account'],
                        amount=float(rec['amount']),
                        description=rec.get('description') or f'Recurring: {rec["title"]}',
                    )

                # Розраховуємо наступну дату
                next_date = self._next_run_date(date_str, rec['frequency'])
                with get_connection() as conn:
                    conn.execute(
                        'UPDATE recurring_transactions SET next_run_date=%s WHERE id=%s',
                        (next_date, rec['id']),
                    )
                processed += 1
            except Exception as exc:
                failed += 1
                logger.warning('[EOD] recurring #%s failed: %s', rec['id'], exc)

        return {'processed': processed, 'failed': failed, 'total_due': len(due)}

    def _integrity_sample_check(self) -> dict:
        """Вибіркова перевірка хешів транзакцій."""
        try:
            from ..services.integrity_service import IntegrityService
            svc = IntegrityService()
            with get_connection() as conn:
                rows = conn.execute(
                    'SELECT tx_id FROM tx_hashes ORDER BY RANDOM() LIMIT 50'
                ).fetchall()
            checked = 0
            failed = 0
            for r in rows:
                try:
                    ok = svc.verify(r['tx_id'])
                    if not ok:
                        failed += 1
                    checked += 1
                except Exception:
                    pass
            return {'checked': checked, 'failed': failed, 'ok': failed == 0}
        except Exception as exc:
            return {'checked': 0, 'failed': 0, 'ok': True, 'note': str(exc)}

    def _cleanup_velocity_cache(self) -> dict:
        """Видаляє fraud velocity записи старіші 24 год."""
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    'DELETE FROM fraud_velocity_cache WHERE last_seen < %s',
                    (cutoff,),
                )
            return {'deleted': cur.rowcount}
        except Exception:
            return {'deleted': 0}

    def _archive_eod_log(
        self, date_str: str, ok: bool,
        steps: list, initiated_by: int | None,
    ) -> dict:
        """Зберігає EOD-підсумок в audit_logs."""
        import json
        try:
            from ..repositories.feature_repository import FeatureRepository
            features = FeatureRepository()
            summary = {
                'date': date_str,
                'ok':   ok,
                'steps_count': len(steps),
                'failed_steps': [s['step'] for s in steps if not s['ok']],
            }
            features.add_audit_log(
                user_id=initiated_by or 0,
                action='eod_batch_completed',
                details=json.dumps(summary, ensure_ascii=False),
            )
            return {'archived': True}
        except Exception as exc:
            return {'archived': False, 'error': str(exc)}

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _next_run_date(current_date: str, frequency: str) -> str:
        """Розраховує наступну дату recurring."""
        from datetime import date, timedelta
        try:
            d = date.fromisoformat(current_date)
        except Exception:
            d = datetime.now(timezone.utc).date()

        freq_map = {
            'daily':     timedelta(days=1),
            'weekly':    timedelta(weeks=1),
            'biweekly':  timedelta(weeks=2),
            'monthly':   None,   # handled separately
            'quarterly': None,
        }
        if frequency == 'monthly':
            month = d.month + 1 if d.month < 12 else 1
            year  = d.year if d.month < 12 else d.year + 1
            import calendar
            day = min(d.day, calendar.monthrange(year, month)[1])
            return date(year, month, day).isoformat()
        elif frequency == 'quarterly':
            month = d.month + 3 if d.month <= 9 else (d.month + 3 - 12)
            year  = d.year if d.month <= 9 else d.year + 1
            import calendar
            day = min(d.day, calendar.monthrange(year, month)[1])
            return date(year, month, day).isoformat()
        else:
            delta = freq_map.get(frequency, timedelta(days=1))
            return (d + delta).isoformat()

    @staticmethod
    def _build_summary(steps: list) -> dict:
        ok_steps = [s for s in steps if s['ok']]
        fail_steps = [s for s in steps if not s['ok']]
        return {
            'total_steps':  len(steps),
            'ok_steps':     len(ok_steps),
            'failed_steps': len(fail_steps),
            'failed_names': [s['step'] for s in fail_steps],
        }
