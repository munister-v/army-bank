"""Сервіс генерації банківських виписок у PDF-форматі."""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

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

# ── Реєстрація Unicode-шрифтів (підтримка кирилиці) ──────────────────────────
_FONTS_DIR = os.path.join(os.path.dirname(__file__), 'fonts')
_FONTS_REGISTERED = False
_FONT_NAME = 'Helvetica'        # буде перезаписано після успішної реєстрації
_FONT_NAME_BOLD = 'Helvetica-Bold'

# Каскад пошуку Cyrillic-сумісних TTF: спочатку бандл проекту, потім системні
_FONT_CANDIDATES = [
    # bundled DejaVu Sans (BSD-license, Cyrillic, ships with the repo — works everywhere)
    (os.path.join(_FONTS_DIR, 'DejaVuSans.ttf'),
     os.path.join(_FONTS_DIR, 'DejaVuSans-Bold.ttf'),
     'DejaVu'),
    # bundled Arial (macOS local dev legacy)
    (os.path.join(_FONTS_DIR, 'Arial.ttf'),
     os.path.join(_FONTS_DIR, 'Arial-Bold.ttf'),
     'Arial'),
    # Ubuntu / Debian system DejaVu (Render, Railway, Heroku)
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
     '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
     'DejaVu'),
    ('/usr/share/fonts/dejavu/DejaVuSans.ttf',
     '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
     'DejaVu'),
    # Liberation Sans (also Cyrillic-capable)
    ('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
     '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
     'Liberation'),
    # macOS system Arial
    ('/System/Library/Fonts/Supplemental/Arial.ttf',
     '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
     'Arial'),
]


def _ensure_fonts() -> None:
    global _FONTS_REGISTERED, _FONT_NAME, _FONT_NAME_BOLD
    if _FONTS_REGISTERED:
        return
    from reportlab.pdfbase import pdfmetrics as pm
    for normal_path, bold_path, family in _FONT_CANDIDATES:
        if not (os.path.isfile(normal_path) and os.path.isfile(bold_path)):
            continue
        try:
            reg_normal = f'{family}'
            reg_bold = f'{family}-Bold'
            pdfmetrics.registerFont(TTFont(reg_normal, normal_path))
            pdfmetrics.registerFont(TTFont(reg_bold, bold_path))
            pm.registerFontFamily(
                family,
                normal=reg_normal,
                bold=reg_bold,
                italic=reg_normal,
                boldItalic=reg_bold,
            )
            _FONT_NAME = reg_normal
            _FONT_NAME_BOLD = reg_bold
            _FONTS_REGISTERED = True
            return
        except Exception:
            continue
    # усі варіанти вичерпані — залишаємось на Helvetica (без кирилиці)


def _f(bold: bool = False) -> str:
    """Повертає зареєстроване ім'я шрифту (з підтримкою кирилиці) або Helvetica."""
    return _FONT_NAME_BOLD if bold else _FONT_NAME


# ── Кольорова схема Army Bank (glass green + champagne) ────────────────────
_NAVY   = colors.HexColor('#173126')
_NAVY2  = colors.HexColor('#0c1f16')
_BLUE   = colors.HexColor('#7b7264')
_LIGHT  = colors.HexColor('#d8d2c2')
_GREEN  = colors.HexColor('#66b08c')
_RED    = colors.HexColor('#d57c74')
_MUTED  = colors.HexColor('#8f9288')
_BG     = colors.HexColor('#f2efe6')
_WHITE  = colors.white
_STEEL  = colors.HexColor('#213229')
_LGGREEN = colors.HexColor('#e6f5ed')
_LGRED   = colors.HexColor('#f9e9e7')
_GOLD    = colors.HexColor('#b9ab8f')

_TX_TYPE_LABELS = {
    'transfer': 'Переказ',
    'topup': 'Поповнення',
    'payout': 'Виплата',
    'donation': 'Донат',
    'savings': 'Накопичення',
}

_REPORT_TYPE_LABELS = {
    'standard': 'Стандартна виписка',
    'detailed': 'Детальна виписка',
    'tax': 'Розрахунковий звіт',
}


class StatementService:
    def __init__(self) -> None:
        self._accounts = AccountRepository()
        self._users = UserRepository()
        self._features = FeatureRepository()

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────
    def normalize_period(self, from_date: str | None, to_date: str | None) -> tuple[str | None, str | None]:
        def _norm(value: str | None) -> str | None:
            if not value:
                return None
            text = str(value).strip()[:10]
            datetime.strptime(text, '%Y-%m-%d')
            return text

        frm = _norm(from_date)
        to = _norm(to_date)
        if frm and to and frm > to:
            raise ValueError('from_date не може бути пізніше за to_date.')
        return frm, to

    @staticmethod
    def build_statement_filename(
        account_number: str,
        from_date: str | None,
        to_date: str | None,
        report_type: str,
        generated_at: datetime | None = None,
    ) -> str:
        now = generated_at or datetime.now(timezone.utc)
        stamp = now.strftime('%Y%m%d_%H%M')
        acc = re.sub(r'[^A-Za-z0-9-]', '', str(account_number or 'ACCOUNT')) or 'ACCOUNT'
        report = re.sub(r'[^a-z]', '', str(report_type or 'standard').lower()) or 'standard'

        if from_date and to_date:
            period = f'{from_date}_{to_date}'
        elif from_date:
            period = f'from_{from_date}'
        elif to_date:
            period = f'to_{to_date}'
        else:
            period = 'all_time'

        period = re.sub(r'[^0-9A-Za-z_-]', '', period)
        return f'armybank_statement_{report}_{acc}_{period}_{stamp}.pdf'

    @staticmethod
    def build_receipt_filename(tx: dict, generated_at: datetime | None = None) -> str:
        now = generated_at or datetime.now(timezone.utc)
        tx_id = int(tx.get('id') or 0)
        tx_type = re.sub(r'[^a-z]', '', str(tx.get('tx_type') or 'tx').lower()) or 'tx'
        direction = 'in' if str(tx.get('direction') or '').lower() == 'in' else 'out'

        created_raw = str(tx.get('created_at') or '').strip()
        created_stamp = now.strftime('%Y%m%d_%H%M')
        if created_raw:
            try:
                parsed = datetime.fromisoformat(created_raw.replace('Z', '+00:00'))
                created_stamp = parsed.strftime('%Y%m%d_%H%M')
            except Exception:
                pass

        return f'armybank_receipt_tx{tx_id}_{tx_type}_{direction}_{created_stamp}.pdf'

    def create_statement_order(
        self,
        user_id: int,
        from_date: str | None = None,
        to_date: str | None = None,
        report_type: str = 'detailed',
    ) -> dict:
        report_type = (report_type or 'detailed').strip().lower()
        if report_type not in _REPORT_TYPE_LABELS:
            raise ValueError('Недійсний report_type. Дозволено: standard, detailed, tax.')

        from_date, to_date = self.normalize_period(from_date, to_date)

        account = self._accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок не знайдено.')

        now = datetime.now(timezone.utc)
        order_id = f'ST-{now.strftime("%Y%m%d%H%M%S")}-{uuid.uuid4().hex[:6].upper()}'
        filename = self.build_statement_filename(account.get('account_number') or 'ACCOUNT', from_date, to_date, report_type, generated_at=now)

        query = {}
        if from_date:
            query['from_date'] = from_date
        if to_date:
            query['to_date'] = to_date
        if report_type:
            query['report_type'] = report_type
        query['order_id'] = order_id
        query_text = urlencode(query)

        details = (
            f'order_id={order_id};report={report_type};period={self._period_label(from_date, to_date)};'
            f'filename={filename}'
        )
        self._features.add_audit_log(user_id, 'statement_order', details)

        return {
            'order_id': order_id,
            'status': 'ready',
            'report_type': report_type,
            'report_type_label': _REPORT_TYPE_LABELS[report_type],
            'from_date': from_date,
            'to_date': to_date,
            'period_label': self._period_label(from_date, to_date),
            'filename': filename,
            'download_query': query_text,
            'created_at': now.isoformat(),
        }

    def list_statement_orders(self, user_id: int, limit: int = 10) -> list[dict]:
        limit = max(1, min(int(limit), 50))
        logs = self._features.list_audit_logs(user_id=user_id, limit=max(80, limit * 8))
        orders: list[dict] = []

        for log in logs:
            if (log.get('action') or '') != 'statement_order':
                continue
            details = str(log.get('details') or '')
            parsed = self._parse_statement_order_details(details)
            if not parsed:
                continue
            parsed['created_at'] = log.get('created_at')
            orders.append(parsed)
            if len(orders) >= limit:
                break

        return orders

    def generate_pdf(
        self,
        user_id: int,
        from_date: str | None = None,
        to_date: str | None = None,
        report_type: str = 'detailed',
        order_id: str | None = None,
    ) -> bytes:
        """Повертає байти PDF-виписки для user_id за вказаний період."""
        report_type = (report_type or 'detailed').strip().lower()
        if report_type not in _REPORT_TYPE_LABELS:
            raise ValueError('Недійсний report_type. Дозволено: standard, detailed, tax.')

        from_date, to_date = self.normalize_period(from_date, to_date)

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
            limit=1000,
        )

        opening_balance = self._accounts.get_balance_before(account['id'], from_date)
        closing_balance = (
            self._accounts.get_balance_until(account['id'], to_date)
            if to_date else float(account.get('balance') or 0)
        )

        summary = self._calc_summary(txs, opening_balance, closing_balance)

        # Логуємо факт формування виписки
        period_str = self._period_label(from_date, to_date)
        order_part = f', order={order_id}' if order_id else ''
        self._features.add_audit_log(
            user_id,
            'statement_pdf',
            f'Виписка PDF ({report_type}): рахунок {account["account_number"]}, {period_str}, '
            f'{len(txs)} транз.{order_part}',
        )

        _ensure_fonts()
        return self._build_pdf(
            account=account,
            user=user,
            txs=txs,
            summary=summary,
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
            order_id=order_id,
        )

    def generate_receipt(self, user_id: int, tx_id: int) -> bytes:
        """Повертає байти PDF-чека для одної транзакції."""
        receipt = self.generate_receipt_with_meta(user_id, tx_id)
        return receipt['pdf_bytes']

    def generate_receipt_with_meta(self, user_id: int, tx_id: int) -> dict:
        """Повертає PDF + метадані чека (tx, filename)."""
        account = self._accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок не знайдено.')
        user = self._users.get_by_id(user_id)
        if not user:
            raise ValueError('Користувача не знайдено.')

        tx = self._accounts.get_transaction(tx_id, account['id'])
        if not tx:
            raise ValueError('Транзакцію не знайдено або немає доступу.')

        tx_dict = dict(tx)
        filename = self.build_receipt_filename(tx_dict)

        _ensure_fonts()
        pdf_bytes = self._build_receipt(account, user, tx_dict)

        self._features.add_audit_log(
            user_id,
            'receipt_pdf',
            f'Чек PDF: tx_id={tx_id};filename={filename}',
        )

        return {
            'pdf_bytes': pdf_bytes,
            'tx': tx_dict,
            'filename': filename,
        }

    # ──────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────
    def _parse_statement_order_details(self, details: str) -> dict | None:
        if not details:
            return None
        pairs = [p.strip() for p in details.split(';') if p.strip()]
        result = {}
        for pair in pairs:
            if '=' not in pair:
                continue
            k, v = pair.split('=', 1)
            result[k.strip()] = v.strip()

        order_id = result.get('order_id')
        if not order_id:
            return None

        report_type = (result.get('report') or 'detailed').strip().lower()
        if report_type not in _REPORT_TYPE_LABELS:
            report_type = 'detailed'

        filename = result.get('filename') or 'armybank_statement.pdf'
        query = {'report_type': report_type, 'order_id': order_id}

        return {
            'order_id': order_id,
            'report_type': report_type,
            'report_type_label': _REPORT_TYPE_LABELS[report_type],
            'period_label': result.get('period') or 'весь час',
            'filename': filename,
            'download_query': urlencode(query),
        }

    def _period_label(self, from_date: str | None, to_date: str | None) -> str:
        if from_date and to_date:
            return f'{from_date} — {to_date}'
        if from_date:
            return f'з {from_date}'
        if to_date:
            return f'по {to_date}'
        return 'весь час'

    def _money(self, value: float) -> str:
        return f'₴ {float(value):,.2f}'.replace(',', ' ')

    # ──────────────────────────────────────────────────────────────────────
    # Receipt PDF
    # ──────────────────────────────────────────────────────────────────────
    def _build_receipt(self, account: dict, user: dict, tx: dict) -> bytes:
        """Генерує A6 PDF квитанцію для однієї транзакції."""
        buf = io.BytesIO()
        width, height = 105 * mm, 165 * mm   # A6 extended
        doc = SimpleDocTemplate(
            buf,
            pagesize=(width, height),
            leftMargin=0,
            rightMargin=0,
            topMargin=0,
            bottomMargin=6 * mm,
        )

        direction = str(tx.get('direction') or 'out').lower()
        is_in = direction == 'in'
        amount = float(tx.get('amount') or 0)
        commission = 0.0
        total = amount if is_in else amount + commission
        sign = '+' if is_in else '−'
        amount_str = f'{sign}{self._money(amount)}'

        raw_dt = str(tx.get('created_at') or '')
        try:
            dt = datetime.fromisoformat(raw_dt.replace('Z', '+00:00'))
            date_str = dt.strftime('%d.%m.%Y %H:%M')
            date_short = dt.strftime('%d.%m.%Y')
        except Exception:
            date_str = raw_dt[:16] or '—'
            date_short = '—'

        tx_type = _TX_TYPE_LABELS.get(tx.get('tx_type'), tx.get('tx_type') or 'Операція')
        tx_num = int(tx.get('id') or 0)

        story = []

        # ── Navy header band ─────────────────────────────────────────────────
        wt = ParagraphStyle('wt', fontName=_f(True), fontSize=14, textColor=_WHITE, leading=18)
        wn = ParagraphStyle('wn', fontName=_f(), fontSize=8.5, textColor=colors.HexColor('#c9c3b4'),
                            leading=11, alignment=2)
        hdr = Table(
            [[Paragraph('Army<font color="#b9ab8f">Bank</font>', wt),
              Paragraph(f'Квитанція\n#{tx_num}', wn)]],
            colWidths=[None, 28 * mm],
        )
        hdr.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _NAVY2),
            ('TOPPADDING', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
            ('LEFTPADDING', (0, 0), (-1, -1), 11),
            ('RIGHTPADDING', (0, 0), (-1, -1), 11),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(hdr)

        # ── Amount block ─────────────────────────────────────────────────────
        amt_bg  = _LGGREEN if is_in else _LGRED
        amt_fg  = colors.HexColor('#2d6f54') if is_in else colors.HexColor('#a24f47')
        lbl_fg  = colors.HexColor('#376950') if is_in else colors.HexColor('#8c4b43')
        amt_t = Table(
            [[Paragraph(amount_str,
                        ParagraphStyle('aa', fontName=_f(True), fontSize=24, textColor=amt_fg,
                                       alignment=1, leading=28))],
             [Paragraph(tx_type,
                        ParagraphStyle('at', fontName=_f(), fontSize=9, textColor=lbl_fg,
                                       alignment=1, leading=12))]],
            colWidths=['100%'],
        )
        amt_t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), amt_bg),
            ('TOPPADDING', (0, 0), (0, 0), 10),
            ('BOTTOMPADDING', (0, -1), (0, -1), 10),
            ('TOPPADDING', (0, 1), (0, 1), 1),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(amt_t)
        story.append(Spacer(1, 3))

        # ── Details table ────────────────────────────────────────────────────
        lbl_s = ParagraphStyle('ls', fontName=_f(), fontSize=7.8, leading=11, textColor=_MUTED)
        val_s = ParagraphStyle('vs', fontName=_f(True), fontSize=8.5, leading=12, textColor=_STEEL)
        ok_s  = ParagraphStyle('ok', fontName=_f(True), fontSize=8.5, leading=12, textColor=_GREEN)

        def _row(label: str, value: str, val_style=None):
            return [Paragraph(label, lbl_s), Paragraph(value, val_style or val_s)]

        related = tx.get('related_account') or '—'
        desc = str(tx.get('description') or '—')
        if len(desc) > 50:
            desc = desc[:47] + '…'

        rows = [
            _row('Транзакція',   f'#{tx_num}'),
            _row('Дата та час',  date_str),
            _row('Тип операції', tx_type),
            _row('Власник',      user.get('full_name') or '—'),
            _row('Рахунок',      account.get('account_number') or '—'),
            _row('Контрагент',   related),
            _row('Сума',         self._money(amount)),
            _row('Комісія',      self._money(commission)),
            _row('Разом',        self._money(total)),
            _row('Опис',         desc),
            _row('Статус',       '✓  ПІДТВЕРДЖЕНО', ok_s),
        ]

        det_t = Table(rows, colWidths=[30 * mm, None])
        n_rows = len(rows)
        det_t.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, n_rows - 2), 0.25, colors.HexColor('#d8d2c2')),
            ('BACKGROUND', (0, n_rows - 1), (-1, n_rows - 1), colors.HexColor('#f0fdf4')),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 11),
            ('RIGHTPADDING', (0, 0), (-1, -1), 11),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(det_t)

        # ── Footer ───────────────────────────────────────────────────────────
        story.append(Spacer(1, 4))
        story.append(HRFlowable(width='100%', thickness=0.4, color=_LIGHT, spaceAfter=3))
        ft = Table(
            [[Paragraph(f'Сформовано: {date_short}',
                        ParagraphStyle('fl', fontName=_f(), fontSize=7, textColor=_MUTED)),
              Paragraph('army-bank.com.ua',
                        ParagraphStyle('fr', fontName=_f(), fontSize=7, textColor=_MUTED, alignment=2))]],
            colWidths=['50%', '50%'],
        )
        ft.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 11),
            ('RIGHTPADDING', (0, 0), (-1, -1), 11),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(ft)

        doc.build(story)
        return buf.getvalue()

    # ──────────────────────────────────────────────────────────────────────
    # Statement PDF
    # ──────────────────────────────────────────────────────────────────────
    def _build_pdf(
        self,
        account: dict,
        user: dict,
        txs: list,
        summary: dict,
        from_date: str | None,
        to_date: str | None,
        report_type: str,
        order_id: str | None,
    ) -> bytes:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=A4,
            rightMargin=16 * mm,
            leftMargin=16 * mm,
            topMargin=14 * mm,
            bottomMargin=14 * mm,
        )

        styles = getSampleStyleSheet()
        story = []

        story.append(self._header_table(account, user, from_date, to_date, report_type, order_id))
        story.append(Spacer(1, 4 * mm))
        story.append(self._summary_table(summary))
        story.append(Spacer(1, 3 * mm))
        story.append(self._detail_metrics_table(summary))
        story.append(Spacer(1, 3 * mm))

        if summary.get('monthly') and len(summary['monthly']) > 1:
            story.append(Paragraph('Помісячний рух коштів', ParagraphStyle(
                'sec0', parent=styles['Normal'], fontName=_f(True), fontSize=10.5, textColor=_NAVY, spaceAfter=2,
            )))
            story.append(self._monthly_table(summary['monthly']))
            story.append(Spacer(1, 3 * mm))

        if summary.get('by_type'):
            story.append(Paragraph('Розподіл за типами операцій', ParagraphStyle(
                'sec1', parent=styles['Normal'], fontName=_f(True), fontSize=10.5, textColor=_NAVY, spaceAfter=2,
            )))
            story.append(self._by_type_table(summary.get('by_type') or []))
            story.append(Spacer(1, 3 * mm))

        if report_type in {'detailed', 'tax'} and summary.get('daily'):
            label = 'Денний підсумок руху коштів' if report_type == 'detailed' else 'Розрахунковий денний реєстр'
            story.append(Paragraph(label, ParagraphStyle(
                'sec2', parent=styles['Normal'], fontName=_f(True), fontSize=10.5, textColor=_NAVY, spaceAfter=2,
            )))
            story.append(self._daily_table(summary.get('daily') or []))
            story.append(Spacer(1, 3 * mm))

        story.append(Paragraph('Деталізація транзакцій', ParagraphStyle(
            'sec3', parent=styles['Normal'], fontName=_f(True), fontSize=10.5, textColor=_NAVY, spaceAfter=2,
        )))
        if txs:
            story.append(self._tx_table(txs, summary.get('opening_balance') or 0.0))
        else:
            story.append(Paragraph(
                'Транзакцій за вказаний період не знайдено.',
                ParagraphStyle('empty', parent=styles['Normal'], fontName=_f(), fontSize=9, textColor=_MUTED),
            ))

        story.append(Spacer(1, 5 * mm))
        story.append(HRFlowable(width='100%', thickness=0.6, color=_LIGHT, spaceAfter=2 * mm))
        now_str = datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M UTC')
        story.append(Paragraph(
            f'Army Bank · {_REPORT_TYPE_LABELS.get(report_type, report_type)} · Сформовано: {now_str}',
            ParagraphStyle('footer', parent=styles['Normal'], fontName=_f(), fontSize=7.5, textColor=_MUTED, alignment=1),
        ))

        doc.build(story)
        return buf.getvalue()

    def _header_table(
        self,
        account: dict,
        user: dict,
        from_date: str | None,
        to_date: str | None,
        report_type: str,
        order_id: str | None,
    ):
        styles = getSampleStyleSheet()

        # Banner styles (white on navy)
        banner_brand  = ParagraphStyle('bb', parent=styles['Normal'], fontSize=18, fontName=_f(True), textColor=_WHITE)
        banner_type   = ParagraphStyle('bt', parent=styles['Normal'], fontSize=9.5, fontName=_f(True),
                                       textColor=colors.HexColor('#b9ab8f'), alignment=1)
        banner_period = ParagraphStyle('bp', parent=styles['Normal'], fontSize=9.5, fontName=_f(),
                                       textColor=colors.HexColor('#c9c3b4'), alignment=2)

        # Info styles
        subtitle = ParagraphStyle('sub', parent=styles['Normal'], fontSize=8.3, fontName=_f(), textColor=_MUTED)
        value    = ParagraphStyle('val', parent=styles['Normal'], fontSize=9.5, fontName=_f(True), textColor=_NAVY)
        balance  = ParagraphStyle('bal', parent=styles['Normal'], fontSize=21, fontName=_f(True), textColor=_NAVY)

        period_label = self._period_label(from_date, to_date)
        report_label = _REPORT_TYPE_LABELS.get(report_type, report_type)
        current_balance = self._money(float(account.get('balance') or 0))
        now_str = datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M UTC')

        # ── Row 0: navy banner spanning full width ────────────────────────────
        banner = Table(
            [[Paragraph('Army<font color="#b9ab8f">Bank</font>', banner_brand),
              Paragraph(report_label.upper(), banner_type),
              Paragraph(period_label, banner_period)]],
            colWidths=['35%', '35%', '30%'],
        )
        banner.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _NAVY2),
            ('TOPPADDING', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('LEFTPADDING', (1, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))

        # ── Row 1: account info (two columns) ────────────────────────────────
        left = [
            Paragraph('Власник рахунку', subtitle),
            Paragraph(user.get('full_name') or '—', value),
            Spacer(1, 2 * mm),
            Paragraph('Рахунок', subtitle),
            Paragraph(account.get('account_number') or '—', value),
            Spacer(1, 2 * mm),
            Paragraph('Телефон / Email', subtitle),
            Paragraph(
                user.get('phone') or user.get('email') or '—',
                ParagraphStyle('ph', parent=styles['Normal'], fontSize=8.5, fontName=_f(), textColor=_STEEL),
            ),
        ]

        right = [
            Paragraph('Поточний баланс', subtitle),
            Paragraph(current_balance, balance),
            Spacer(1, 1.5 * mm),
            Paragraph('Валюта', subtitle),
            Paragraph(account.get('currency') or 'UAH', value),
            Spacer(1, 1.5 * mm),
            Paragraph('Дата формування', subtitle),
            Paragraph(now_str, ParagraphStyle('nw', parent=styles['Normal'], fontSize=8.5, fontName=_f(), textColor=_STEEL)),
        ]
        if order_id:
            right.extend([
                Spacer(1, 1.5 * mm),
                Paragraph('ID замовлення', subtitle),
                Paragraph(order_id, ParagraphStyle('oid', parent=styles['Normal'], fontSize=8, fontName=_f(),
                                                   textColor=_MUTED)),
            ])

        info = Table([[left, right]], colWidths=['62%', '38%'])
        info.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        # Wrap banner + info into a single outer table
        outer = Table([[banner], [info]], colWidths=['100%'])
        outer.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        return outer

    def _calc_summary(self, txs: list, opening_balance: float, closing_balance: float) -> dict:
        total_in = 0.0
        total_out = 0.0
        count_in = 0
        count_out = 0
        max_in = 0.0
        max_out = 0.0
        min_tx = None
        max_tx = None

        by_type: dict[str, dict] = {}
        by_day: dict[str, dict] = {}

        for tx in txs:
            amount = float(tx.get('amount') or 0)
            direction = str(tx.get('direction') or '').lower()
            tx_type = str(tx.get('tx_type') or 'other')

            if min_tx is None or amount < min_tx:
                min_tx = amount
            if max_tx is None or amount > max_tx:
                max_tx = amount

            if direction == 'in':
                total_in += amount
                count_in += 1
                max_in = max(max_in, amount)
            else:
                total_out += amount
                count_out += 1
                max_out = max(max_out, amount)

            bucket = by_type.setdefault(tx_type, {
                'tx_type': tx_type,
                'label': _TX_TYPE_LABELS.get(tx_type, tx_type),
                'count': 0,
                'in_total': 0.0,
                'out_total': 0.0,
                'total_turnover': 0.0,
            })
            bucket['count'] += 1
            if direction == 'in':
                bucket['in_total'] += amount
            else:
                bucket['out_total'] += amount
            bucket['total_turnover'] += amount

            day = str(tx.get('created_at') or '')[:10]
            day_bucket = by_day.setdefault(day, {'day': day, 'in': 0.0, 'out': 0.0, 'count': 0})
            if direction == 'in':
                day_bucket['in'] += amount
            else:
                day_bucket['out'] += amount
            day_bucket['count'] += 1

        count_total = len(txs)
        net = total_in - total_out
        avg_ticket = (total_in + total_out) / count_total if count_total else 0.0

        by_type_rows   = sorted(by_type.values(), key=lambda x: (-x['total_turnover'], -x['count']))
        daily_rows     = sorted(by_day.values(), key=lambda x: x['day'])

        # Monthly breakdown
        by_month: dict[str, dict] = {}
        for tx in txs:
            amount    = float(tx.get('amount') or 0)
            direction = str(tx.get('direction') or '').lower()
            month_key = str(tx.get('created_at') or '')[:7]   # 'YYYY-MM'
            mb = by_month.setdefault(month_key, {'month': month_key, 'in': 0.0, 'out': 0.0, 'count': 0})
            if direction == 'in':
                mb['in'] += amount
            else:
                mb['out'] += amount
            mb['count'] += 1
        monthly_rows = sorted(by_month.values(), key=lambda x: x['month'])

        return {
            'count': count_total,
            'count_in': count_in,
            'count_out': count_out,
            'total_in': total_in,
            'total_out': total_out,
            'net': net,
            'opening_balance': opening_balance,
            'closing_balance': closing_balance,
            'avg_ticket': avg_ticket,
            'avg_in': (total_in / count_in) if count_in else 0.0,
            'avg_out': (total_out / count_out) if count_out else 0.0,
            'max_in': max_in,
            'max_out': max_out,
            'min_tx': float(min_tx or 0.0),
            'max_tx': float(max_tx or 0.0),
            'by_type': by_type_rows,
            'daily': daily_rows,
            'monthly': monthly_rows,
        }

    def _summary_table(self, summary: dict):
        """5 карток: баланс на початку | надходження | витрати | баланс на кінці | чистий рух."""
        styles = getSampleStyleSheet()
        lbl   = ParagraphStyle('lbl', parent=styles['Normal'], fontName=_f(), fontSize=7.5, textColor=_MUTED, alignment=1)
        val   = ParagraphStyle('val', parent=styles['Normal'], fontName=_f(True), fontSize=11.5, textColor=_NAVY, alignment=1)
        pos   = ParagraphStyle('pos', parent=val, textColor=_GREEN)
        neg   = ParagraphStyle('neg', parent=val, textColor=_RED)

        net = float(summary.get('net') or 0)
        net_style = pos if net >= 0 else neg
        net_sign  = '+' if net >= 0 else ''

        icons = ['≡', '↓', '↑', '≡', '~']
        icon_s = ParagraphStyle('ic', parent=styles['Normal'], fontName=_f(True), fontSize=11,
                                textColor=_MUTED, alignment=1)

        cards_data = [
            ('Поч. баланс', self._money(summary.get('opening_balance') or 0), val, '≡'),
            ('Надходження', self._money(summary.get('total_in') or 0),        pos, '↓'),
            ('Витрати',     self._money(summary.get('total_out') or 0),       neg, '↑'),
            ('Кін. баланс', self._money(summary.get('closing_balance') or 0), val, '≡'),
            ('Чистий рух',  f'{net_sign}{self._money(abs(net))}',             net_style, '~'),
        ]

        top_row = [
            Table(
                [[Paragraph(ic, icon_s)], [Paragraph(lbl_txt, lbl)], [Paragraph(val_txt, vs)]],
                colWidths=['100%'],
            )
            for lbl_txt, val_txt, vs, ic in cards_data
        ]
        for card in top_row:
            card.setStyle(TableStyle([
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ]))

        table = Table([top_row], colWidths=['20%', '20%', '20%', '20%', '20%'])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _LIGHT),
            ('BACKGROUND', (1, 0), (1, 0), colors.HexColor('#f0fdf4')),
            ('BACKGROUND', (2, 0), (2, 0), colors.HexColor('#fff1f2')),
            ('BOX',        (0, 0), (-1, -1), 0.6, colors.HexColor('#cfc8b7')),
            ('INNERGRID',  (0, 0), (-1, -1), 0.5, colors.HexColor('#ddd7c8')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        return table

    def _detail_metrics_table(self, summary: dict):
        styles = getSampleStyleSheet()
        left = ParagraphStyle('l', parent=styles['Normal'], fontName=_f(), fontSize=8.3, textColor=_MUTED)
        right = ParagraphStyle('r', parent=styles['Normal'], fontName=_f(True), fontSize=8.8, textColor=_NAVY, alignment=2)

        rows = [
            [Paragraph('Кількість операцій (усього)', left), Paragraph(str(int(summary.get('count') or 0)), right)],
            [Paragraph('Кількість надходжень / витрат', left), Paragraph(f"{int(summary.get('count_in') or 0)} / {int(summary.get('count_out') or 0)}", right)],
            [Paragraph('Середній чек', left), Paragraph(self._money(summary.get('avg_ticket') or 0), right)],
            [Paragraph('Середнє надходження', left), Paragraph(self._money(summary.get('avg_in') or 0), right)],
            [Paragraph('Середня витрата', left), Paragraph(self._money(summary.get('avg_out') or 0), right)],
            [Paragraph('Максимальне надходження', left), Paragraph(self._money(summary.get('max_in') or 0), right)],
            [Paragraph('Максимальна витрата', left), Paragraph(self._money(summary.get('max_out') or 0), right)],
            [Paragraph('Мінімальна сума операції', left), Paragraph(self._money(summary.get('min_tx') or 0), right)],
            [Paragraph('Максимальна сума операції', left), Paragraph(self._money(summary.get('max_tx') or 0), right)],
        ]

        table = Table(rows, colWidths=['68%', '32%'])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _WHITE),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#d6d0bf')),
            ('INNERGRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#e2dccd')),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        return table

    def _by_type_table(self, rows: list[dict]):
        styles = getSampleStyleSheet()
        hdr = ParagraphStyle('h', parent=styles['Normal'], fontName=_f(True), fontSize=8, textColor=_WHITE, alignment=1)
        cell = ParagraphStyle('c', parent=styles['Normal'], fontName=_f(), fontSize=8, textColor=colors.HexColor('#1f2937'))
        num = ParagraphStyle('n', parent=cell, alignment=2)

        data = [[
            Paragraph('Тип', hdr),
            Paragraph('К-сть', hdr),
            Paragraph('Надходження', hdr),
            Paragraph('Витрати', hdr),
            Paragraph('Оборот', hdr),
        ]]

        for row in rows[:12]:
            data.append([
                Paragraph(str(row.get('label') or row.get('tx_type') or '—'), cell),
                Paragraph(str(int(row.get('count') or 0)), num),
                Paragraph(self._money(row.get('in_total') or 0), num),
                Paragraph(self._money(row.get('out_total') or 0), num),
                Paragraph(self._money(row.get('total_turnover') or 0), num),
            ])

        table = Table(data, colWidths=['28%', '12%', '20%', '20%', '20%'], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), _NAVY),
            ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#d6d0bf')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [_WHITE, _BG]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        return table

    def _daily_table(self, rows: list[dict]):
        styles = getSampleStyleSheet()
        hdr = ParagraphStyle('h', parent=styles['Normal'], fontName=_f(True), fontSize=8, textColor=_WHITE, alignment=1)
        cell = ParagraphStyle('c', parent=styles['Normal'], fontName=_f(), fontSize=7.8, textColor=colors.HexColor('#1f2937'))
        num = ParagraphStyle('n', parent=cell, alignment=2)

        data = [[
            Paragraph('Дата', hdr),
            Paragraph('Операцій', hdr),
            Paragraph('Надходження', hdr),
            Paragraph('Витрати', hdr),
            Paragraph('Чистий рух', hdr),
        ]]

        tail = rows[-31:] if len(rows) > 31 else rows
        for row in tail:
            net = float(row.get('in') or 0) - float(row.get('out') or 0)
            data.append([
                Paragraph(str(row.get('day') or '—'), cell),
                Paragraph(str(int(row.get('count') or 0)), num),
                Paragraph(self._money(row.get('in') or 0), num),
                Paragraph(self._money(row.get('out') or 0), num),
                Paragraph(self._money(net), num),
            ])

        table = Table(data, colWidths=['20%', '14%', '22%', '22%', '22%'], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), _NAVY),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#d6d0bf')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [_WHITE, _BG]),
            ('TOPPADDING', (0, 0), (-1, -1), 3.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))
        return table

    def _monthly_table(self, rows: list[dict]):
        """Помісячний зведений реєстр руху коштів."""
        styles = getSampleStyleSheet()
        hdr  = ParagraphStyle('h', parent=styles['Normal'], fontName=_f(True), fontSize=8, textColor=_WHITE, alignment=1)
        cell = ParagraphStyle('c', parent=styles['Normal'], fontName=_f(), fontSize=8, textColor=_STEEL)
        num  = ParagraphStyle('n', parent=cell, alignment=2)
        pos  = ParagraphStyle('p', parent=num, textColor=_GREEN)
        neg  = ParagraphStyle('ng', parent=num, textColor=_RED)

        _MONTH_UA = {
            '01': 'Січень', '02': 'Лютий', '03': 'Березень',
            '04': 'Квітень', '05': 'Травень', '06': 'Червень',
            '07': 'Липень', '08': 'Серпень', '09': 'Вересень',
            '10': 'Жовтень', '11': 'Листопад', '12': 'Грудень',
        }

        data = [[
            Paragraph('Місяць', hdr),
            Paragraph('К-сть', hdr),
            Paragraph('Надходження', hdr),
            Paragraph('Витрати', hdr),
            Paragraph('Чистий рух', hdr),
        ]]

        for row in rows:
            month_key = str(row.get('month') or '')
            year_part  = month_key[:4] if len(month_key) >= 7 else '—'
            month_part = month_key[5:7] if len(month_key) >= 7 else '—'
            month_label = f'{_MONTH_UA.get(month_part, month_part)} {year_part}'
            net = float(row.get('in') or 0) - float(row.get('out') or 0)
            net_s = pos if net >= 0 else neg
            net_sign = '+' if net >= 0 else ''
            data.append([
                Paragraph(month_label, cell),
                Paragraph(str(int(row.get('count') or 0)), num),
                Paragraph(self._money(row.get('in') or 0), pos),
                Paragraph(self._money(row.get('out') or 0), neg),
                Paragraph(f'{net_sign}{self._money(abs(net))}', net_s),
            ])

        # Totals row
        if len(rows) > 1:
            tot_in  = sum(float(r.get('in') or 0) for r in rows)
            tot_out = sum(float(r.get('out') or 0) for r in rows)
            tot_cnt = sum(int(r.get('count') or 0) for r in rows)
            tot_net = tot_in - tot_out
            tot_net_s = pos if tot_net >= 0 else neg
            tot_sign  = '+' if tot_net >= 0 else ''
            tot_cell  = ParagraphStyle('tc', parent=cell, fontName=_f(True))
            tot_num   = ParagraphStyle('tn', parent=tot_cell, alignment=2)
            data.append([
                Paragraph('Разом', tot_cell),
                Paragraph(str(tot_cnt), tot_num),
                Paragraph(self._money(tot_in), ParagraphStyle('tp', parent=tot_num, textColor=_GREEN)),
                Paragraph(self._money(tot_out), ParagraphStyle('tn2', parent=tot_num, textColor=_RED)),
                Paragraph(f'{tot_sign}{self._money(abs(tot_net))}',
                          ParagraphStyle('tn3', parent=tot_num, textColor=_GREEN if tot_net >= 0 else _RED)),
            ])

        n = len(data)
        table = Table(data, colWidths=['28%', '10%', '22%', '20%', '20%'], repeatRows=1)
        ts = [
            ('BACKGROUND', (0, 0), (-1, 0), _NAVY),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#d6d0bf')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [_WHITE, _BG]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]
        if len(rows) > 1:
            ts.append(('BACKGROUND', (0, n - 1), (-1, n - 1), colors.HexColor('#e8eef8')))
            ts.append(('LINEABOVE', (0, n - 1), (-1, n - 1), 0.7, _NAVY))
        table.setStyle(TableStyle(ts))
        return table

    def _tx_table(self, txs: list, opening_balance: float):
        styles = getSampleStyleSheet()
        hdr = ParagraphStyle('hdr', parent=styles['Normal'], fontName=_f(True), fontSize=7.8, textColor=_WHITE, alignment=1)
        cell = ParagraphStyle('cell', parent=styles['Normal'], fontName=_f(), fontSize=7.6, textColor=colors.HexColor('#1e293b'))
        money = ParagraphStyle('money', parent=cell, fontName=_f(True), alignment=2)
        muted = ParagraphStyle('muted', parent=styles['Normal'], fontName=_f(), fontSize=7.0, textColor=_MUTED)

        data = [[
            Paragraph('#', hdr),
            Paragraph('Дата', hdr),
            Paragraph('Опис / Контрагент', hdr),
            Paragraph('Тип', hdr),
            Paragraph('Сума', hdr),
            Paragraph('Баланс після', hdr),
        ]]

        # Рахуємо running balance у хронологічному порядку, відображаємо у зворотному
        asc_rows = sorted(
            [dict(t) for t in txs],
            key=lambda t: (str(t.get('created_at') or ''), int(t.get('id') or 0)),
        )
        running = float(opening_balance or 0)
        balance_by_id: dict[int, float] = {}
        for tx in asc_rows:
            amount = float(tx.get('amount') or 0)
            if str(tx.get('direction') or '').lower() == 'in':
                running += amount
            else:
                running -= amount
            balance_by_id[int(tx.get('id') or 0)] = running

        for idx, tx in enumerate(txs, 1):
            tx_id = int(tx.get('id') or 0)
            amount = float(tx.get('amount') or 0)
            direction = str(tx.get('direction') or '').lower()
            sign = '+' if direction == 'in' else '−'
            sum_color = _GREEN if direction == 'in' else _RED
            amount_text = f'{sign}{self._money(amount)}'

            raw_dt = str(tx.get('created_at') or '')
            try:
                dt = datetime.fromisoformat(raw_dt.replace('Z', '+00:00'))
                date_str = dt.strftime('%d.%m.%Y\n%H:%M')
            except Exception:
                date_str = raw_dt[:16]

            desc = str(tx.get('description') or '—')
            if len(desc) > 70:
                desc = desc[:67] + '…'
            related = tx.get('related_account')
            desc_cells = [Paragraph(desc, cell)]
            if related:
                desc_cells.append(Paragraph(str(related), muted))

            tx_type = _TX_TYPE_LABELS.get(tx.get('tx_type'), tx.get('tx_type') or '—')
            balance_after = balance_by_id.get(tx_id, 0.0)

            data.append([
                Paragraph(str(idx), ParagraphStyle('idx', parent=cell, fontSize=7.0, alignment=1, textColor=_MUTED)),
                Paragraph(date_str, ParagraphStyle('date', parent=cell, fontSize=7.0, textColor=colors.HexColor('#334155'))),
                desc_cells,
                Paragraph(str(tx_type), ParagraphStyle('tp', parent=cell, fontSize=7.3, textColor=_MUTED)),
                Paragraph(
                    f'<font color="#{"16a34a" if direction == "in" else "dc2626"}"><b>{amount_text}</b></font>',
                    ParagraphStyle('amt', parent=money),
                ),
                Paragraph(self._money(balance_after), money),
            ])

        # ── Closing balance summary row ──────────────────────────────────────
        tot_in  = sum(float(t.get('amount') or 0) for t in txs if str(t.get('direction') or '').lower() == 'in')
        tot_out = sum(float(t.get('amount') or 0) for t in txs if str(t.get('direction') or '').lower() != 'in')
        closing = running  # final running value after all txs
        cl_cell = ParagraphStyle('cl', parent=cell, fontName=_f(True), fontSize=7.5)
        cl_num  = ParagraphStyle('cn', parent=cl_cell, alignment=2)
        data.append([
            Paragraph('', cl_cell),
            Paragraph('', cl_cell),
            Paragraph(f'Оборот: +{self._money(tot_in)} / −{self._money(tot_out)}',
                      ParagraphStyle('cld', parent=cl_cell, fontSize=7.2, textColor=_MUTED)),
            Paragraph('', cl_cell),
            Paragraph('', cl_cell),
            Paragraph(self._money(closing),
                      ParagraphStyle('clb', parent=cl_num, textColor=_NAVY, fontSize=8.5)),
        ])

        n = len(data)
        table = Table(data, colWidths=[7 * mm, 20 * mm, None, 22 * mm, 26 * mm, 30 * mm], repeatRows=1)
        ts = [
            ('BACKGROUND', (0, 0), (-1, 0), _NAVY),
            ('GRID', (0, 0), (-1, -2), 0.25, colors.HexColor('#dde7f5')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [_WHITE, _BG]),
            ('TOPPADDING', (0, 0), (-1, -1), 3.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            # Totals row
            ('BACKGROUND', (0, n - 1), (-1, n - 1), _LIGHT),
            ('LINEABOVE', (0, n - 1), (-1, n - 1), 0.6, _NAVY),
            ('GRID', (0, n - 1), (-1, n - 1), 0, colors.white),
        ]
        table.setStyle(TableStyle(ts))
        return table
