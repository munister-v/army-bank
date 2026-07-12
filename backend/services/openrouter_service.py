"""Тонкий клієнт до OpenRouter (openrouter.ai) — тільки безкоштовні LLM-моделі,
для AI-чернеток лідів: cold-outreach драфти та підказки відповідей у чаті.

Безкоштовні моделі на OpenRouter спільно обмежені рейт-лімітом на всіх
користувачів одразу — 429/5xx тут звична, штатна ситуація, а не збій. Тому
замість однієї фіксованої моделі використовується fallback-ланцюжок: список
живих безкоштовних моделей тягнеться з /models (кешується), і при відмові
однієї модель пробуємо наступну.
"""
from __future__ import annotations

import time

import requests

from ..config import OPENROUTER_API_KEY

API_BASE = 'https://openrouter.ai/api/v1'
# Free models can legitimately take 10-20s to generate a few hundred tokens —
# _TIMEOUT needs to comfortably cover that, not just network/HTTP failures.
# Gunicorn's worker timeout in production is 60s (deploy/gunicorn.conf.py);
# at 18s * _MAX_ATTEMPTS(2) = 36s worst case, this stays safely under that.
# (Callers do NOT retry a whole generate() call again — see leads_routes.py
# comment on why that got dropped: it doubled worst-case latency past the
# gunicorn timeout for a marginal quality gain.)
_TIMEOUT = 18
_MAX_ATTEMPTS = 2
_MODELS_CACHE_TTL_SECONDS = 6 * 3600

# Моделі, чия назва натякає, що це не розмовний чат-асистент (класифікатори,
# ембединги, аудіо/музика) — пропускаємо, щоб не витрачати спробу з fallback-
# ланцюжка на модель, яка апріорі не поверне текст листа.
_NON_CHAT_HINTS = ('safety', 'moderation', 'embed', 'clip', 'guard', 'rerank')

_models_cache: dict = {'models': [], 'fetched_at': 0.0}


class OpenRouterError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def is_configured() -> bool:
    return bool(OPENROUTER_API_KEY)


def _headers() -> dict:
    return {
        'Authorization': f'Bearer {OPENROUTER_API_KEY}',
        'Content-Type': 'application/json',
        # OpenRouter просить ці два заголовки для атрибуції застосунку.
        'HTTP-Referer': 'https://bank.munister.com.ua',
        'X-Title': 'ARM CRM',
    }


def get_free_models(force_refresh: bool = False) -> list[str]:
    """Список id безкоштовних чат-моделей, кешований на _MODELS_CACHE_TTL_SECONDS.

    Список навмисно НЕ хардкодиться — OpenRouter регулярно додає/прибирає
    безкоштовні моделі, і хардкод швидко протухає.
    """
    now = time.time()
    if not force_refresh and _models_cache['models'] and (now - _models_cache['fetched_at']) < _MODELS_CACHE_TTL_SECONDS:
        return _models_cache['models']

    if not OPENROUTER_API_KEY:
        raise OpenRouterError('OPENROUTER_API_KEY не налаштований.')

    try:
        resp = requests.get(f'{API_BASE}/models', headers=_headers(), timeout=_TIMEOUT)
    except requests.RequestException as exc:
        raise OpenRouterError(f"Не вдалося звʼязатися з OpenRouter: {exc}") from exc
    if resp.status_code >= 400:
        raise OpenRouterError(f'OpenRouter /models повернув HTTP {resp.status_code}.')

    data = resp.json().get('data', [])
    ids = []
    for m in data:
        model_id = m.get('id') or ''
        pricing = m.get('pricing') or {}
        arch = m.get('architecture') or {}
        if pricing.get('prompt') != '0':
            continue
        if arch.get('output_modalities') != ['text']:
            continue
        if any(hint in model_id.lower() for hint in _NON_CHAT_HINTS):
            continue
        ids.append(model_id)

    if not ids:
        raise OpenRouterError('Жодної безкоштовної чат-моделі зараз не доступно на OpenRouter.')

    _models_cache['models'] = ids
    _models_cache['fetched_at'] = now
    return ids


def generate(messages: list[dict], *, temperature: float = 0.7, max_tokens: int = 700,
             exclude: set[str] | None = None) -> tuple[str, str]:
    """Викликає чат-completion, пробуючи безкоштовні моделі по черзі.

    Повертає (текст_відповіді, id_моделі_яка_відповіла). Кидає OpenRouterError
    лише якщо ВСІ спроби (до _MAX_ATTEMPTS моделей) провалились.

    `exclude` — моделі, які свідомо пропускаємо (наприклад, викликач уже
    отримав від конкретної моделі відповідь, що не влізла у потрібний формат,
    і хоче спробувати ЩЕ РАЗ, але вже іншою моделлю, а не тією самою).
    """
    if not OPENROUTER_API_KEY:
        raise OpenRouterError('OPENROUTER_API_KEY не налаштований.')

    models = [m for m in get_free_models() if m not in (exclude or set())]
    last_error = ''
    for model_id in models[:_MAX_ATTEMPTS]:
        try:
            resp = requests.post(
                f'{API_BASE}/chat/completions',
                headers=_headers(),
                json={
                    'model': model_id,
                    'messages': messages,
                    'temperature': temperature,
                    'max_tokens': max_tokens,
                },
                timeout=_TIMEOUT,
            )
        except requests.RequestException as exc:
            last_error = str(exc)
            continue

        if resp.status_code >= 400:
            last_error = f'{model_id}: HTTP {resp.status_code}'
            continue

        try:
            body = resp.json()
            text = (body['choices'][0]['message']['content'] or '').strip()
        except (KeyError, IndexError, ValueError):
            last_error = f'{model_id}: неочікуваний формат відповіді'
            continue

        if not text:
            last_error = f'{model_id}: порожня відповідь'
            continue

        return text, model_id

    raise OpenRouterError(f'Жодна з безкоштовних моделей не відповіла. Остання помилка: {last_error}')
