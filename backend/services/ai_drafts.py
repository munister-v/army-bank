"""Побудова промптів і розбір відповідей LLM для AI-чернеток лідів
(cold-outreach драфти + підказки відповідей у чаті). Чисті функції, без
мережевих викликів — сам виклик OpenRouter робить openrouter_service.py.
"""
from __future__ import annotations

import re

_SECTION_RE = re.compile(r'(?m)^###([A-Z0-9]+)(?::(.*))?$')

_BASE_SYSTEM = (
    'You output ONLY the requested content in the exact tagged format given. '
    'No preamble, no explanations, no meta-commentary, no reasoning steps, no markdown.'
)


def parse_tagged_sections(text: str) -> list[tuple[str, str, str]]:
    """Розбирає відповідь LLM у форматі '###TAG:meta\\n<body>' на список
    (tag, meta, body). Якщо жодного тега не знайдено — повертає весь текст
    як один розділ ('RAW', '', text), щоб фіча ніколи не лишала користувача
    без нічого, навіть якщо слабка безкоштовна модель проігнорувала формат."""
    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        stripped = text.strip()
        return [('RAW', '', stripped)] if stripped else []
    sections = []
    for i, m in enumerate(matches):
        tag = m.group(1)
        meta = (m.group(2) or '').strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append((tag, meta, body))
    return sections


def build_draft_prompt(lead: dict) -> list[dict]:
    """Cold-outreach: чернетка першого контакту на основі вже наявних
    полів ліда (category/country/need_type/suggested_first_offer/why_help_fits)."""
    facts = []

    def add(label: str, key: str) -> None:
        val = str(lead.get(key) or '').strip()
        if val:
            facts.append(f'{label}: {val}')

    add('Business name', 'business_name')
    add('Category', 'category')
    add('Country', 'country')
    add('City/area', 'city_area')
    add('What they need', 'need_type')
    add('Suggested first offer', 'suggested_first_offer')
    add('Why we can help', 'why_help_fits')
    facts_block = '\n'.join(facts) if facts else 'No further details available.'

    user = f"""Write a short, friendly, professional first-contact outreach message \
(2-4 sentences) from a small local-services agency reaching out to this business lead:

{facts_block}

Output EXACTLY in this tagged format, nothing else:
###EN1
<first English variant>
###EN2
<second English variant, different angle/hook>
###LOCAL:<name of the primary business language of the lead's country, e.g. Ukrainian, Polish, German>
<one variant written in that local language, adapted for local tone, not a literal translation>"""
    return [{'role': 'system', 'content': _BASE_SYSTEM}, {'role': 'user', 'content': user}]


def build_nudge_prompt(lead: dict, days_overdue: int) -> list[dict]:
    """Follow-up nudge: ліда, на якого чекав контакт до `next_followup_date`
    і термін минув. Використовує ту саму EN1/EN2/LOCAL-розмітку й parse_draft_response,
    що й cold-outreach чернетка — формат ідентичний, різниться лише сам промпт."""
    facts = []

    def add(label: str, key: str) -> None:
        val = str(lead.get(key) or '').strip()
        if val:
            facts.append(f'{label}: {val}')

    add('Business name', 'business_name')
    add('Category', 'category')
    add('Our first message to them', 'first_message_en')
    add('Suggested offer', 'suggested_first_offer')
    add('Current outreach status', 'outreach_status')
    facts_block = '\n'.join(facts) if facts else 'No further details available.'

    user = f"""We reached out to this business lead earlier and haven't heard back. \
It has now been {days_overdue} day(s) past the planned follow-up date. Write a short, \
warm, low-pressure follow-up nudge (1-3 sentences) — NOT pushy or salesy, just a gentle \
"still thinking of you, happy to help whenever you're ready" check-in. Reference the \
earlier contact briefly if useful context is available below, but don't repeat the full \
pitch.

{facts_block}

Output EXACTLY in this tagged format, nothing else:
###EN1
<first English variant>
###EN2
<second English variant, different tone/angle>
###LOCAL:<name of the primary business language of the lead's country, e.g. Ukrainian, Polish, German>
<one variant written in that local language, adapted for local tone, not a literal translation>"""
    return [{'role': 'system', 'content': _BASE_SYSTEM}, {'role': 'user', 'content': user}]


def parse_draft_response(text: str) -> dict:
    sections = parse_tagged_sections(text)
    variants_en: list[str] = []
    local: dict | None = None
    for tag, meta, body in sections:
        if tag.startswith('EN'):
            variants_en.append(body)
        elif tag == 'LOCAL':
            local = {'lang': meta or 'Local', 'text': body}
        elif tag == 'RAW':
            variants_en.append(body)
    return {'variants_en': variants_en, 'local': local}


def build_reply_prompt(lead: dict, history: list[dict], variant_count: int = 2) -> list[dict]:
    """Live-chat: підказки відповіді мовою клієнта + англійський глос для
    менеджера, який може не знати цієї мови. `history` — [{'role': 'user'|'assistant', 'text': ...}],
    найстаріше повідомлення першим."""
    convo_lines = [
        f"{'Agent' if m['role'] == 'assistant' else 'Customer'}: {m['text']}"
        for m in history
    ]
    convo_block = '\n'.join(convo_lines) if convo_lines else '(no prior messages)'

    lead_name = str(lead.get('business_name') or '').strip()
    intro = 'You are replying on behalf of a small agency to a lead'
    intro += f' ({lead_name}).' if lead_name else '.'

    tag_blocks = '\n'.join(
        f"###REPLY{i}:<customer's language>\n<reply variant {i}, ready to send as-is>\n"
        f"###GLOSS{i}\n<short English paraphrase of REPLY{i}, for a manager who may not read that language>"
        for i in range(1, variant_count + 1)
    )
    user = f"""{intro} Detect the customer's language from the conversation below and \
write your reply IN THAT SAME LANGUAGE (not English, unless the customer wrote in English).

Conversation so far (oldest first):
{convo_block}

Suggest {variant_count} different reply variants to the customer's LAST message.
Output EXACTLY in this tagged format, nothing else:
{tag_blocks}"""
    return [{'role': 'system', 'content': _BASE_SYSTEM}, {'role': 'user', 'content': user}]


def parse_reply_response(text: str) -> list[dict]:
    sections = parse_tagged_sections(text)
    by_index: dict[int, dict] = {}
    for tag, meta, body in sections:
        m = re.match(r'REPLY(\d+)$', tag)
        if m:
            idx = int(m.group(1))
            by_index.setdefault(idx, {})['lang'] = meta or 'Local'
            by_index[idx]['text'] = body
            continue
        m = re.match(r'GLOSS(\d+)$', tag)
        if m:
            idx = int(m.group(1))
            by_index.setdefault(idx, {})['gloss'] = body
            continue
        if tag == 'RAW':
            by_index.setdefault(1, {}).setdefault('lang', 'Local')
            by_index[1]['text'] = body

    result = []
    for idx in sorted(by_index.keys()):
        item = by_index[idx]
        if item.get('text'):
            result.append({'lang': item.get('lang', 'Local'), 'text': item['text'], 'gloss': item.get('gloss', '')})
    return result
