"""Тести чистих функцій ai_drafts.py — побудова промптів і розбір тегованих
відповідей LLM. Без мережі: реальний виклик OpenRouter вже перевірено вручну
(cold-outreach драфт + reply-suggestions, обидва повернули коректні дані)."""
from __future__ import annotations

from backend.services import ai_drafts


# ── parse_tagged_sections ────────────────────────────────────────────────────

def test_parse_tagged_sections_basic():
    text = "###EN1\nHello there.\n###EN2\nHi again.\n###LOCAL:Polish\nCzesc!"
    sections = ai_drafts.parse_tagged_sections(text)
    assert sections == [
        ('EN1', '', 'Hello there.'),
        ('EN2', '', 'Hi again.'),
        ('LOCAL', 'Polish', 'Czesc!'),
    ]


def test_parse_tagged_sections_no_tags_falls_back_to_raw():
    text = "Just a plain reply with no tags at all."
    sections = ai_drafts.parse_tagged_sections(text)
    assert sections == [('RAW', '', text)]


def test_parse_tagged_sections_empty_text_returns_nothing():
    assert ai_drafts.parse_tagged_sections('   ') == []


def test_parse_tagged_sections_skips_empty_bodies():
    text = "###EN1\nReal content.\n###EN2\n\n###LOCAL:French\nBonjour!"
    sections = ai_drafts.parse_tagged_sections(text)
    tags = [s[0] for s in sections]
    assert 'EN2' not in tags  # empty body dropped
    assert tags == ['EN1', 'LOCAL']


# ── build_draft_prompt / parse_draft_response ───────────────────────────────

def test_build_draft_prompt_includes_lead_facts():
    lead = {
        'business_name': 'Second Biz', 'category': 'Restaurant', 'country': 'Poland',
        'city_area': 'Warsaw', 'need_type': 'Website redesign',
        'suggested_first_offer': 'Free consult', 'why_help_fits': 'We know restaurants',
    }
    messages = ai_drafts.build_draft_prompt(lead)
    assert messages[0]['role'] == 'system'
    user_content = messages[1]['content']
    for expected in ('Second Biz', 'Restaurant', 'Poland', 'Warsaw', 'Website redesign',
                      'Free consult', 'We know restaurants', '###EN1', '###EN2', '###LOCAL'):
        assert expected in user_content


def test_build_draft_prompt_handles_sparse_lead():
    lead = {'business_name': 'Mystery Biz'}
    messages = ai_drafts.build_draft_prompt(lead)
    assert 'Mystery Biz' in messages[1]['content']


def test_build_draft_prompt_handles_completely_empty_lead():
    messages = ai_drafts.build_draft_prompt({})
    assert 'No further details available.' in messages[1]['content']


def test_parse_draft_response_full():
    text = "###EN1\nFirst variant.\n###EN2\nSecond variant.\n###LOCAL:Ukrainian\nПривіт!"
    data = ai_drafts.parse_draft_response(text)
    assert data['variants_en'] == ['First variant.', 'Second variant.']
    assert data['local'] == {'lang': 'Ukrainian', 'text': 'Привіт!'}


def test_parse_draft_response_missing_local_section():
    text = "###EN1\nOnly one variant.\n###EN2\nAnother one."
    data = ai_drafts.parse_draft_response(text)
    assert len(data['variants_en']) == 2
    assert data['local'] is None


def test_parse_draft_response_untagged_falls_back_to_single_en_variant():
    text = "Hi there, would you like a free website consult?"
    data = ai_drafts.parse_draft_response(text)
    assert data['variants_en'] == [text]
    assert data['local'] is None


# ── build_reply_prompt / parse_reply_response ───────────────────────────────

def test_build_reply_prompt_includes_conversation_history():
    lead = {'business_name': 'Bakery Krakow'}
    history = [
        {'role': 'user', 'text': 'Ile kosztuje strona?'},
        {'role': 'assistant', 'text': 'Za chwile odpowiemy.'},
    ]
    messages = ai_drafts.build_reply_prompt(lead, history, variant_count=2)
    content = messages[1]['content']
    assert 'Bakery Krakow' in content
    assert 'Customer: Ile kosztuje strona?' in content
    assert 'Agent: Za chwile odpowiemy.' in content
    assert '###REPLY1' in content and '###GLOSS1' in content
    assert '###REPLY2' in content and '###GLOSS2' in content
    assert '###REPLY3' not in content


def test_build_reply_prompt_empty_history():
    messages = ai_drafts.build_reply_prompt({}, [], variant_count=1)
    assert '(no prior messages)' in messages[1]['content']


def test_parse_reply_response_pairs_reply_and_gloss():
    text = (
        "###REPLY1:Polish\nDzien dobry, dziekuje za pytanie.\n"
        "###GLOSS1\nGood morning, thanks for asking.\n"
        "###REPLY2:Polish\nOczywiscie, chetnie pomozemy.\n"
        "###GLOSS2\nOf course, happy to help."
    )
    variants = ai_drafts.parse_reply_response(text)
    assert len(variants) == 2
    assert variants[0] == {
        'lang': 'Polish', 'text': 'Dzien dobry, dziekuje za pytanie.',
        'gloss': 'Good morning, thanks for asking.',
    }
    assert variants[1]['text'] == 'Oczywiscie, chetnie pomozemy.'


def test_parse_reply_response_missing_gloss_still_returns_reply():
    text = "###REPLY1:German\nHallo, danke fuer Ihre Nachricht."
    variants = ai_drafts.parse_reply_response(text)
    assert len(variants) == 1
    assert variants[0]['gloss'] == ''
    assert variants[0]['lang'] == 'German'


def test_parse_reply_response_untagged_falls_back_to_one_variant():
    text = "Sure, I can help with that right away."
    variants = ai_drafts.parse_reply_response(text)
    assert len(variants) == 1
    assert variants[0]['text'] == text
    assert variants[0]['lang'] == 'Local'
