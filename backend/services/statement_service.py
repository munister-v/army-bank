"""Сервіс генерації банківських виписок у PDF-форматі."""
from __future__ import annotations

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from ..repositories.account_repository import AccountRepository
from ..repositories.user_repository import UserRepository
from ..repositories.feature_repository import FeatureRepository


# ── Кольорова схема Army Bank ──────────────────────────────────────────────
_NAVY    = colors.HexColor('#162c5c')
_BLUE    = colors.HexColor('#1a56db')
_LIGHT   = colors.HexColor('#e8eef8')
_GREEN   = colors.HexColor('#16a34a')
_RED     = colors.HexColor('#dc2626')
_MUTED   = colors.HexColor('#6b7280')
_BG      = colors.HexColor('#f8fafc')
_WHITE   = colors.white


class StatementService:
    def __init__(self) -> None:
        self._accounts  = AccountRepository()
        self._users     = UserRepository()
        self._features  = FeatureRepository()

    # ──────────────────────────────────────────────────────────────────────
    def generate_pdf(
        self,
        user_id:   int,
        from_date: str | None = None,
        to_date:   str | None = None,
    ) -> bytes:
        """Повертає байти PDF-виписки для user_id за вказаний період."""
        account = self._accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок не знайдено.')
        user = self._users.get_by_id(user_id)
        if not user:
            raise ValueError('Користувача не знайдено.')

        txs = self._accounts.list_transactions(
            account['id'],
            from_date=from_date,
            to_date=to_date,
        )

        # Логуємо факт формування виписки
        period_str = self._period_label(from_date, to_date)
        self._features.add_audit_log(
            user_id,
            'statement_pdf',
            f'Виписка PDF: рахунок {account["account_number"]}, {period_str}, '
            f'{len(txs)} транз.',
        )

        return self._build_pdf(account, user, txs, from_date, to_date)

    # ──────────────────────────────────────────────────────────────────────
    def generate_receipt(self, user_id: int, tx_id: int) -> bytes:
        """Повертає байти PDF-чека для одної транзакції."""
        account = self._accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок не знайдено.')
        user = self._users.get_by_id(user_id)
        if not user:
            raise ValueError('Користувача не знайдено.')

        tx = self._accounts.get_transaction(tx_id, account['id'])
        if not tx:
            raise ValueError('Транзакцію не знайдено або немає доступу.')

        return self._build_receipt(account, user, dict(tx))

    def _build_receipt(self, account: dict, user: dict, tx: dict) -> bytes:
        """Генерує A6-подібний PDF чек для однієї транзакції."""
        buf = io.BytesIO()
        W, H = 105 * mm, 148 * mm   # A6
        doc = SimpleDocTemplate(
            buf,
            pagesize=(W, H),
            leftMargin=10 * mm, rightMargin=10 * mm,
            topMargin=10 * mm, bottomMargin=8 * mm,
        )

        styles  = getSampleStyleSheet()
        normal  = ParagraphStyle('n', fontName='Helvetica', fontSize=9, leading=13, textColor=_MUTED)
        bold    = ParagraphStyle('b', fontName='Helvetica-Bold', fontSize=9, leading=13)
        heading = ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=13, leading=18, textColor=_NAVY)
        small   = ParagraphStyle('s', fontName='Helvetica', fontSize=8, leading=11, textColor=_MUTED)

        direction = tx.get('direction', 'out')
        amount    = float(tx.get('amount', 0))
        amt_color = _GREEN if direction == 'in' else _RED
        sign      = '+' if direction == 'in' else '−'
        amt_str   = f'{sign}₴{amount:,.2f}'.replace(',', ' ')

        tx_date = tx.get('created_at', '')
        try:
            dt = datetime.fromisoformat(str(tx_date).replace('Z', '+00:00'))
            date_str = dt.strftime('%d.%m.%Y %H:%M')
        except Exception:
            date_str = str(tx_date)

        tx_type_ua = {
            'transfer': 'Переказ', 'topup': 'Поповнення',
            'payout': 'Виплата', 'donation': 'Донат', 'savings': 'Накопичення',
        }
        type_label = tx_type_ua.get(tx.get('tx_type', ''), tx.get('tx_type', ''))

        story = []

        # Header
        header_data = [[
            Paragraph('<font color="#162c5c"><b>Army</b></font><font color="#1a56db"><b>Bank</b></font>', heading),
            Paragraph('ЧЕК', ParagraphStyle('chek', fontName='Helvetica-Bold', fontSize=10, textColor=_MUTED, alignment=2)),
        ]]
        header_t = Table(header_data, colWidths=[None, 20 * mm])
        header_t.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('BOTTOMPADDING', (0,0), (-1,-1), 0)]))
        story.append(header_t)
        story.append(HRFlowable(width='100%', thickness=0.5, color=_LIGHT, spaceAfter=6))

        # Big amount
        story.append(Paragraph(
            f'<font color="#{("16a34a" if direction == "in" else "dc2626")}"><b>{amt_str}</b></font>',
            ParagraphStyle('amt', fontName='Helvetica-Bold', fontSize=22, leading=28, alignment=1),
        ))
        story.append(Paragraph(type_label, ParagraphStyle('tl', fontName='Helvetica', fontSize=10, textColor=_MUTED, alignment=1, spaceAfter=6)))
        story.append(HRFlowable(width='100%', thickness=0.4, color=_LIGHT, spaceAfter=4))

        # Details rows
        def row(label, value):
            return [Paragraph(label, small), Paragraph(f'<b>{value}</b>', bold)]

        details = [
            row('Номер транзакції', f'#{tx["id"]}'),
            row('Дата та час', date_str),
            row('Рахунок відправника', account.get('account_number', '—')),
            row('Рахунок отримувача', tx.get('related_account') or '—'),
            row('Власник', user.get('full_name', '—')),
            row('Опис', tx.get('description') or '—'),
            row('Статус', '✓ Виконано'),
        ]
        dt = Table(details, colWidths=[35 * mm, None])
        dt.setStyle(TableStyle([
            ('FONTSIZE',      (0,0), (-1,-1), 8),
            ('TOPPADDING',    (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING',   (0,0), (-1,-1), 0),
            ('RIGHTPADDING',  (0,0), (-1,-1), 0),
            ('LINEBELOW',     (0,0), (-1,-2), 0.3, colors.HexColor('#e2e8f0')),
        ]))
        story.append(dt)
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width='100%', thickness=0.4, color=_LIGHT, spaceAfter=4))
        story.append(Paragraph('Цифровий банкінг для захисників України', small))

        doc.build(story)
        return buf.getvalue()

    # ──────────────────────────────────────────────────────────────────────
    def _period_label(self, from_date: str | None, to_date: str | None) -> str:
        if from_date and to_date:
            return f'{from_date} — {to_date}'
        if from_date:
            return f'з {from_date}'
        if to_date:
            return f'по {to_date}'
        return 'весь час'

    # ──────────────────────────────────────────────────────────────────────
    def _build_pdf(
        self,
        account:   dict,
        user:      dict,
        txs:       list,
        from_date: str | None,
        to_date:   str | None,
    ) -> bytes:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=A4,
            rightMargin=18 * mm,
            leftMargin=18 * mm,
            topMargin=16 * mm,
            bottomMargin=16 * mm,
        )

        styles = getSampleStyleSheet()
        story  = []

        # ── ШАПКА ─────────────────────────────────────────────────────────
        story.append(self._header_table(account, user, from_date, to_date))
        story.append(Spacer(1, 6 * mm))
        story.append(HRFlowable(width='100%', thickness=1.5, color=_NAVY, spaceAfter=4 * mm))

        # ── ЗВЕДЕННЯ ──────────────────────────────────────────────────────
        summary = self._calc_summary(txs)
        story.append(self._summary_table(summary))
        story.append(Spacer(1, 5 * mm))

        # ── ТАБЛИЦЯ ТРАНЗАКЦІЙ ────────────────────────────────────────────
        if txs:
            story.append(self._tx_table(txs))
        else:
            no_tx = Paragraph(
                '<font color="#6b7280">Транзакцій за вказаний період не знайдено.</font>',
                styles['Normal'],
            )
            story.append(no_tx)

        story.append(Spacer(1, 6 * mm))
        story.append(HRFlowable(width='100%', thickness=0.5, color=_MUTED))
        story.append(Spacer(1, 2 * mm))

        # ── ПІДВАЛ ────────────────────────────────────────────────────────
        now_str = datetime.utcnow().strftime('%d.%m.%Y %H:%M UTC')
        footer_style = ParagraphStyle(
            'footer', parent=styles['Normal'],
            fontSize=7, textColor=_MUTED, alignment=1,
        )
        story.append(Paragraph(
            f'Army Bank · Сформовано: {now_str} · munister.com.ua',
            footer_style,
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    # ──────────────────────────────────────────────────────────────────────
    def _header_table(
        self,
        account:   dict,
        user:      dict,
        from_date: str | None,
        to_date:   str | None,
    ):
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'title', parent=styles['Normal'],
            fontSize=18, fontName='Helvetica-Bold',
            textColor=_NAVY,
        )
        sub_style = ParagraphStyle(
            'sub', parent=styles['Normal'],
            fontSize=9, textColor=_MUTED, spaceAfter=2,
        )
        val_style = ParagraphStyle(
            'val', parent=styles['Normal'],
            fontSize=10, fontName='Helvetica-Bold', textColor=_NAVY,
        )

        period_label = self._period_label(from_date, to_date)
        balance_fmt  = f'₴ {float(account["balance"]):,.2f}'.replace(',', ' ')

        left_col = [
            Paragraph('Army Bank', title_style),
            Spacer(1, 2 * mm),
            Paragraph('Банківська виписка', ParagraphStyle('h2', parent=styles['Normal'],
                fontSize=11, textColor=_BLUE, fontName='Helvetica-Bold')),
            Spacer(1, 3 * mm),
            Paragraph(f'Власник рахунку:', sub_style),
            Paragraph(user.get('full_name') or '—', val_style),
            Spacer(1, 2 * mm),
            Paragraph('Рахунок:', sub_style),
            Paragraph(account.get('account_number') or '—', val_style),
            Spacer(1, 2 * mm),
            Paragraph('Телефон / e-mail:', sub_style),
            Paragraph(
                f'{user.get("phone") or "—"}   {user.get("email") or ""}',
                ParagraphStyle('contact', parent=styles['Normal'], fontSize=9, textColor=_MUTED),
            ),
        ]
        right_col = [
            Paragraph('Поточний баланс', sub_style),
            Paragraph(balance_fmt, ParagraphStyle('balance', parent=styles['Normal'],
                fontSize=22, fontName='Helvetica-Bold', textColor=_NAVY)),
            Spacer(1, 3 * mm),
            Paragraph('Валюта:', sub_style),
            Paragraph(account.get('currency') or 'UAH', val_style),
            Spacer(1, 2 * mm),
            Paragraph('Період виписки:', sub_style),
            Paragraph(period_label, val_style),
            Spacer(1, 2 * mm),
            Paragraph('Дата формування:', sub_style),
            Paragraph(datetime.utcnow().strftime('%d.%m.%Y'), val_style),
        ]

        t = Table([[left_col, right_col]], colWidths=['55%', '45%'])
        t.setStyle(TableStyle([
            ('VALIGN',   (0, 0), (-1, -1), 'TOP'),
            ('ALIGN',    (1, 0), (1, 0),   'RIGHT'),
            ('LEFTPADDING',  (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING',   (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING',(0, 0), (-1, -1), 0),
        ]))
        return t

    # ──────────────────────────────────────────────────────────────────────
    def _calc_summary(self, txs: list) -> dict:
        total_in  = sum(float(t['amount']) for t in txs if t['direction'] == 'in')
        total_out = sum(float(t['amount']) for t in txs if t['direction'] == 'out')
        return {
            'count':     len(txs),
            'total_in':  total_in,
            'total_out': total_out,
            'net':       total_in - total_out,
        }

    # ──────────────────────────────────────────────────────────────────────
    def _summary_table(self, summary: dict):
        styles = getSampleStyleSheet()
        lbl = ParagraphStyle('lbl', parent=styles['Normal'],
            fontSize=8, textColor=_MUTED, alignment=1)
        val = ParagraphStyle('val', parent=styles['Normal'],
            fontSize=13, fontName='Helvetica-Bold', alignment=1)
        net_color = _GREEN if summary['net'] >= 0 else _RED
        net_style = ParagraphStyle('net', parent=styles['Normal'],
            fontSize=13, fontName='Helvetica-Bold', textColor=net_color, alignment=1)

        def fmt(v): return f'₴ {v:,.2f}'.replace(',', ' ')

        data = [[
            [Paragraph('Транзакцій', lbl), Paragraph(str(summary['count']), val)],
            [Paragraph('Надходження', lbl), Paragraph(fmt(summary['total_in']),
                ParagraphStyle('green', parent=styles['Normal'],
                    fontSize=13, fontName='Helvetica-Bold', textColor=_GREEN, alignment=1))],
            [Paragraph('Витрати', lbl), Paragraph(fmt(summary['total_out']),
                ParagraphStyle('red', parent=styles['Normal'],
                    fontSize=13, fontName='Helvetica-Bold', textColor=_RED, alignment=1))],
            [Paragraph('Баланс руху', lbl), Paragraph(fmt(summary['net']), net_style)],
        ]]
        t = Table(data, colWidths=['25%', '25%', '25%', '25%'])
        t.setStyle(TableStyle([
            ('BACKGROUND',   (0, 0), (-1, -1), _LIGHT),
            ('ROUNDEDCORNERS', [4]),
            ('TOPPADDING',   (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
            ('LEFTPADDING',  (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('BOX',          (0, 0), (-1, -1), 0.5, colors.HexColor('#d1daf0')),
            ('INNERGRID',    (0, 0), (-1, -1), 0.5, colors.HexColor('#d1daf0')),
            ('VALIGN',       (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN',        (0, 0), (-1, -1), 'CENTER'),
        ]))
        return t

    # ──────────────────────────────────────────────────────────────────────
    def _tx_table(self, txs: list):
        styles = getSampleStyleSheet()
        hdr_style = ParagraphStyle('hdr', parent=styles['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=_WHITE, alignment=1)
        cell_style = ParagraphStyle('cell', parent=styles['Normal'],
            fontSize=8, textColor=colors.HexColor('#1e293b'))
        muted_style = ParagraphStyle('muted', parent=styles['Normal'],
            fontSize=7, textColor=_MUTED)

        # Header
        headers = ['#', 'Дата', 'Опис / Контрагент', 'Тип', 'Сума']
        rows = [[Paragraph(h, hdr_style) for h in headers]]

        for i, tx in enumerate(txs, 1):
            direction = tx.get('direction', '')
            amount    = float(tx.get('amount', 0))
            sign      = '+' if direction == 'in' else '−'
            amt_color = _GREEN if direction == 'in' else _RED
            amt_str   = f'{sign}₴ {amount:,.2f}'.replace(',', ' ')

            # Date formatting
            raw_dt = str(tx.get('created_at') or '')
            try:
                dt = datetime.fromisoformat(raw_dt[:19])
                date_str = dt.strftime('%d.%m.%Y\n%H:%M')
            except Exception:
                date_str = raw_dt[:16]

            desc = str(tx.get('description') or '—')
            related = tx.get('related_account')
            desc_block = [Paragraph(desc[:60] + ('…' if len(desc) > 60 else ''), cell_style)]
            if related:
                desc_block.append(Paragraph(related, muted_style))

            tx_type_map = {
                'transfer': 'Переказ',
                'topup':    'Поповнення',
                'payout':   'Виплата',
                'donation': 'Донат',
                'savings':  'Накопичення',
            }
            tx_type_str = tx_type_map.get(tx.get('tx_type', ''), tx.get('tx_type', '—'))

            row_bg = _BG if i % 2 == 0 else _WHITE
            rows.append([
                Paragraph(str(i), ParagraphStyle('idx', parent=styles['Normal'],
                    fontSize=7, textColor=_MUTED, alignment=1)),
                Paragraph(date_str, ParagraphStyle('date', parent=styles['Normal'],
                    fontSize=7.5, textColor=colors.HexColor('#374151'))),
                desc_block,
                Paragraph(tx_type_str, ParagraphStyle('type', parent=styles['Normal'],
                    fontSize=7.5, textColor=_MUTED)),
                Paragraph(amt_str, ParagraphStyle('amt', parent=styles['Normal'],
                    fontSize=9, fontName='Helvetica-Bold', textColor=amt_color, alignment=2)),
            ])

        col_widths = [8 * mm, 22 * mm, None, 22 * mm, 30 * mm]

        t = Table(rows, colWidths=col_widths, repeatRows=1)
        # Build per-row background styles
        style_cmds = [
            ('BACKGROUND',    (0, 0), (-1, 0),  _NAVY),
            ('TEXTCOLOR',     (0, 0), (-1, 0),  _WHITE),
            ('FONTNAME',      (0, 0), (-1, 0),  'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, 0),  8),
            ('ALIGN',         (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING',    (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING',   (0, 0), (-1, -1), 5),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 5),
            ('GRID',          (0, 0), (-1, -1), 0.3, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [_WHITE, _BG]),
        ]
        t.setStyle(TableStyle(style_cmds))
        return t
