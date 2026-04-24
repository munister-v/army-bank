"""Bilateral Netting Engine — COBOL-style payment netting.

Двостороннє нетинг:
  Якщо A→B на 1000 і B→A на 700 очікують в батчі,
  після нетингу: A→B на 300 (нетто), B→A скасовується.
  Результат: одна транзакція замість двох.

Багатостороннє нетинг (multilateral):
  Розраховується нетто-позиція кожного учасника.
  Учасники з позитивною позицією отримують від центрального кліринг-рахунку,
  з від'ємною — платять до нього.

Формат position:
  { account_id → net_position }   (додатня = отримуємо, від'ємна = платимо)
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id


class NettingEngine:

    # ── Двостороннє нетинг ────────────────────────────────────────────────────

    def bilateral_net(
        self,
        pairs: list[dict],
    ) -> list[dict]:
        """Нетує список платежів між парами рахунків.

        Args:
            pairs: [{'sender': acc_id, 'recipient': acc_id, 'amount': float, 'order_id': int}]

        Returns:
            Список нетованих платежів + список скасованих (netted_out).
        """
        # Агрегуємо по парі (min_id, max_id) → (a→b_sum, b→a_sum)
        flows: dict[tuple, dict] = defaultdict(lambda: {'a_to_b': 0.0, 'b_to_a': 0.0,
                                                         'a_orders': [], 'b_orders': []})
        for p in pairs:
            s, r = int(p['sender']), int(p['recipient'])
            key = (min(s, r), max(s, r))
            if s < r:
                flows[key]['a_to_b'] += float(p['amount'])
                flows[key]['a_orders'].append(p.get('order_id'))
            else:
                flows[key]['b_to_a'] += float(p['amount'])
                flows[key]['b_orders'].append(p.get('order_id'))

        result = []
        for (acc_a, acc_b), f in flows.items():
            a2b = f['a_to_b']
            b2a = f['b_to_a']
            net = round(a2b - b2a, 2)

            if abs(net) < 0.01:
                # Повний нетинг — обидва напрямки скасовуються
                result.append({
                    'type': 'fully_netted',
                    'account_a': acc_a, 'account_b': acc_b,
                    'gross_a_to_b': a2b, 'gross_b_to_a': b2a,
                    'net_amount': 0.0,
                    'netted_orders': f['a_orders'] + f['b_orders'],
                })
            elif net > 0:
                # A платить B нетто
                result.append({
                    'type': 'partial_net',
                    'sender': acc_a, 'recipient': acc_b,
                    'gross_a_to_b': a2b, 'gross_b_to_a': b2a,
                    'net_amount': net,
                    'netted_orders': f['a_orders'] + f['b_orders'],
                    'savings': round(min(a2b, b2a), 2),
                })
            else:
                # B платить A нетто
                result.append({
                    'type': 'partial_net',
                    'sender': acc_b, 'recipient': acc_a,
                    'gross_a_to_b': a2b, 'gross_b_to_a': b2a,
                    'net_amount': abs(net),
                    'netted_orders': f['a_orders'] + f['b_orders'],
                    'savings': round(min(a2b, b2a), 2),
                })

        return result

    # ── Багатостороннє нетинг ─────────────────────────────────────────────────

    def multilateral_positions(
        self,
        payments: list[dict],
    ) -> dict[int, float]:
        """Розраховує нетто-позицію кожного учасника.

        Args:
            payments: [{'sender': acc_id, 'recipient': acc_id, 'amount': float}]

        Returns:
            {account_id: net_position}
            Додатня позиція = отримуємо кошти (нам повинні)
            Від'ємна позиція = платимо (ми повинні)
        """
        positions: dict[int, float] = defaultdict(float)
        for p in payments:
            s, r, amt = int(p['sender']), int(p['recipient']), float(p['amount'])
            positions[s] -= amt
            positions[r] += amt
        return dict(positions)

    # ── Нетинг Settlement Batch ───────────────────────────────────────────────

    def net_batch(self, batch_id: int) -> dict:
        """Застосовує двостороннє нетинг до всіх pending-платежів батчу.

        Оновлює settlement_items:
          - net_amount = нетована сума
          - status = 'netted' для скасованих, 'pending' для нетованих
          - netting_group = ідентифікатор пари

        Returns: {'total_items', 'netted_items', 'savings_amount', 'net_items'}
        """
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM settlement_items"
                " WHERE batch_id=%s AND status='pending'",
                (batch_id,),
            ).fetchall()

        items = [dict(r) for r in rows]
        if not items:
            return {'total_items': 0, 'netted_items': 0, 'savings_amount': 0.0, 'net_items': 0}

        payments = [
            {
                'sender':    r['sender_account_id'],
                'recipient': r['recipient_account_id'],
                'amount':    float(r['amount']),
                'order_id':  r['payment_order_id'],
                'item_id':   r['id'],
            }
            for r in items
            if r['sender_account_id'] and r['recipient_account_id']
        ]

        netted_results = self.bilateral_net(payments)

        # Будуємо карту order_id → netting_group
        savings_total = 0.0
        fully_netted_orders: set[int] = set()
        netting_map: dict[int, tuple[str, float]] = {}  # order_id → (group, net_amount)

        for i, nr in enumerate(netted_results):
            group = f'net_{batch_id}_{i:04d}'
            for oid in (nr.get('netted_orders') or []):
                if oid is None:
                    continue
                if nr['type'] == 'fully_netted':
                    netting_map[oid] = (group, 0.0)
                    fully_netted_orders.add(oid)
                else:
                    # Частковий: залишаємо одну транзакцію з net_amount
                    netting_map[oid] = (group, nr['net_amount'])
            savings_total += nr.get('savings', 0.0)

        # Оновлюємо items у БД
        netted_count = 0
        for item in items:
            oid = item['payment_order_id']
            if oid in netting_map:
                group, net_amt = netting_map[oid]
                new_status = 'netted' if oid in fully_netted_orders else 'pending'
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE settlement_items"
                        " SET net_amount=%s, netting_group=%s, status=%s"
                        " WHERE id=%s",
                        (net_amt, group, new_status, item['id']),
                    )
                if new_status == 'netted':
                    netted_count += 1

        # Оновлюємо batch net_amount
        remaining = sum(
            float(r.get('net_amount', r['amount']))
            for r in items
            if r['payment_order_id'] not in fully_netted_orders
        )
        with get_connection() as conn:
            conn.execute(
                'UPDATE settlement_batches SET net_amount=%s WHERE id=%s',
                (round(remaining, 2), batch_id),
            )

        return {
            'total_items':    len(items),
            'netted_items':   netted_count,
            'savings_amount': round(savings_total, 2),
            'net_items':      len(items) - netted_count,
        }
