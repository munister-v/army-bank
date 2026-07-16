"""Тести чистих функцій prospecting_service.py, зокрема мультикатегорійного
пошуку (кілька OSM-категорій за один Overpass-запит) — без мережевих
викликів."""
from __future__ import annotations

import pytest

from backend.services import prospecting_service as ps
from backend.services.prospecting_service import ProspectingError


# ── _build_overpass_query ────────────────────────────────────────────────────

def test_overpass_query_unions_multiple_categories():
    q = ps._build_overpass_query(123, ['beauty', 'gym'], 30)
    assert 'shop=hairdresser' in q  # beauty
    assert 'leisure=fitness_centre' in q  # gym
    assert 'area(123)' in q


def test_overpass_query_single_category_unchanged():
    q = ps._build_overpass_query(123, ['bakery'], 30)
    assert 'shop=bakery' in q
    assert 'shop=hairdresser' not in q


def test_overpass_query_rejects_unknown_categories():
    with pytest.raises(ProspectingError):
        ps._build_overpass_query(123, ['not-a-real-category'], 30)


# ── _match_category ──────────────────────────────────────────────────────────

def test_match_category_picks_the_tag_that_actually_matched():
    tags = {'leisure': 'fitness_centre', 'name': 'Gym X'}
    key, label = ps._match_category(tags, ['beauty', 'gym'])
    assert key == 'gym'
    assert label == ps.CATEGORIES['gym']['label']


def test_match_category_falls_back_to_first_when_no_tag_matches():
    tags = {'name': 'Mystery Business'}
    key, label = ps._match_category(tags, ['beauty', 'gym'])
    assert key == 'beauty'


# ── search_businesses: multi-category plumbing (geocode/Overpass stubbed) ──

def test_search_businesses_accepts_single_string_or_list(monkeypatch):
    monkeypatch.setattr(ps, 'geocode_area', lambda country, city='': {
        'area_id': 999, 'display_name': 'Kraków, Polska',
    })
    monkeypatch.setattr(ps, '_run_overpass', lambda query: [
        {'type': 'node', 'id': 1, 'tags': {'name': 'Gym X', 'leisure': 'fitness_centre'}},
        {'type': 'node', 'id': 2, 'tags': {'name': 'Salon Y', 'shop': 'hairdresser'}},
    ])
    ps._search_cache.clear()

    result = ps.search_businesses(['beauty', 'gym'], 'Poland', 'Krakow')
    names_to_cat = {c['business_name']: c['category_key'] for c in result['candidates']}
    assert names_to_cat == {'Gym X': 'gym', 'Salon Y': 'beauty'}

    # backward-compatible single-string call still works
    ps._search_cache.clear()
    result2 = ps.search_businesses('gym', 'Poland', 'Krakow')
    assert all(c['category_key'] == 'gym' for c in result2['candidates'])


def test_search_businesses_rejects_empty_category_list():
    with pytest.raises(ProspectingError):
        ps.search_businesses([], 'Poland', 'Krakow')
