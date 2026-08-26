"""Offline geography for the ARM CRM United States lead map.

The map never sends CRM locations to a third-party geocoder.  It only matches
the city text already stored in a lead against this deliberately small local
index, then the browser receives the resulting coordinates for Leaflet.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date
from typing import Any


def _key(value: Any) -> str:
    text = unicodedata.normalize('NFKD', str(value or ''))
    text = ''.join(char for char in text if not unicodedata.combining(char))
    # Keep Unicode letters too: CRM data can contain country names such as
    # "США" or "Сполучені Штати", alongside English city names.
    return re.sub(r'[^\w]+', '', text.lower(), flags=re.UNICODE)


# The cities cover the operating markets in the current US lead batches.  New
# cities are intentionally reported as unmapped instead of guessed.
_CITIES = (
    ('Albuquerque', 'NM', 35.0844, -106.6504), ('Anaheim', 'CA', 33.8366, -117.9143),
    ('Anchorage', 'AK', 61.2181, -149.9003), ('Arlington', 'TX', 32.7357, -97.1081),
    ('Atlanta', 'GA', 33.7490, -84.3880), ('Aurora', 'CO', 39.7294, -104.8319),
    ('Austin', 'TX', 30.2672, -97.7431), ('Bakersfield', 'CA', 35.3733, -119.0187),
    ('Baltimore', 'MD', 39.2904, -76.6122), ('Baton Rouge', 'LA', 30.4515, -91.1871),
    ('Birmingham', 'AL', 33.5186, -86.8104), ('Boise', 'ID', 43.6150, -116.2023),
    ('Boston', 'MA', 42.3601, -71.0589), ('Buffalo', 'NY', 42.8864, -78.8784),
    ('Charlotte', 'NC', 35.2271, -80.8431), ('Chandler', 'AZ', 33.3062, -111.8413),
    ('Chesapeake', 'VA', 36.7682, -76.2875), ('Chicago', 'IL', 41.8781, -87.6298),
    ('Chula Vista', 'CA', 32.6401, -117.0842), ('Cincinnati', 'OH', 39.1031, -84.5120),
    ('Cleveland', 'OH', 41.4993, -81.6944), ('Colorado Springs', 'CO', 38.8339, -104.8214),
    ('Columbus', 'OH', 39.9612, -82.9988), ('Corpus Christi', 'TX', 27.8006, -97.3964),
    ('Dallas', 'TX', 32.7767, -96.7970), ('Denver', 'CO', 39.7392, -104.9903),
    ('Des Moines', 'IA', 41.5868, -93.6250), ('Detroit', 'MI', 42.3314, -83.0458),
    ('Durham', 'NC', 35.9940, -78.8986), ('El Paso', 'TX', 31.7619, -106.4850),
    ('Fontana', 'CA', 34.0922, -117.4350), ('Fort Wayne', 'IN', 41.0793, -85.1394),
    ('Fort Worth', 'TX', 32.7555, -97.3308), ('Fremont', 'CA', 37.5485, -121.9886),
    ('Fresno', 'CA', 36.7378, -119.7871), ('Garland', 'TX', 32.9126, -96.6389),
    ('Gilbert', 'AZ', 33.3528, -111.7890), ('Glendale', 'AZ', 33.5387, -112.1860),
    ('Grand Rapids', 'MI', 42.9634, -85.6681), ('Greensboro', 'NC', 36.0726, -79.7920),
    ('Henderson', 'NV', 36.0395, -114.9817), ('Hialeah', 'FL', 25.8576, -80.2781),
    ('Honolulu', 'HI', 21.3069, -157.8583), ('Houston', 'TX', 29.7604, -95.3698),
    ('Indianapolis', 'IN', 39.7684, -86.1581), ('Irvine', 'CA', 33.6846, -117.8265),
    ('Irving', 'TX', 32.8140, -96.9489), ('Jacksonville', 'FL', 30.3322, -81.6557),
    ('Jersey City', 'NJ', 40.7178, -74.0431), ('Kansas City', 'MO', 39.0997, -94.5786),
    ('Las Vegas', 'NV', 36.1699, -115.1398), ('Lexington', 'KY', 38.0406, -84.5037),
    ('Lincoln', 'NE', 40.8136, -96.7026), ('Little Rock', 'AR', 34.7465, -92.2896),
    ('Long Beach', 'CA', 33.7701, -118.1937), ('Los Angeles', 'CA', 34.0522, -118.2437),
    ('Louisville', 'KY', 38.2527, -85.7585), ('Lubbock', 'TX', 33.5779, -101.8552),
    ('Madison', 'WI', 43.0731, -89.4012), ('Memphis', 'TN', 35.1495, -90.0490),
    ('Mesa', 'AZ', 33.4152, -111.8315), ('Miami', 'FL', 25.7617, -80.1918),
    ('Milwaukee', 'WI', 43.0389, -87.9065), ('Minneapolis', 'MN', 44.9778, -93.2650),
    ('Modesto', 'CA', 37.6391, -120.9969), ('Nashville', 'TN', 36.1627, -86.7816),
    ('New Orleans', 'LA', 29.9511, -90.0715), ('New York', 'NY', 40.7128, -74.0060),
    ('Newark', 'NJ', 40.7357, -74.1724), ('Norfolk', 'VA', 36.8508, -76.2859),
    ('North Las Vegas', 'NV', 36.1989, -115.1175), ('Oakland', 'CA', 37.8044, -122.2712),
    ('Oklahoma City', 'OK', 35.4676, -97.5164), ('Omaha', 'NE', 41.2565, -95.9345),
    ('Orlando', 'FL', 28.5383, -81.3792), ('Philadelphia', 'PA', 39.9526, -75.1652),
    ('Phoenix', 'AZ', 33.4484, -112.0740), ('Pittsburgh', 'PA', 40.4406, -79.9959),
    ('Plano', 'TX', 33.0198, -96.6989), ('Portland', 'OR', 45.5152, -122.6784),
    ('Raleigh', 'NC', 35.7796, -78.6382), ('Reno', 'NV', 39.5296, -119.8138),
    ('Richmond', 'VA', 37.5407, -77.4360), ('Riverside', 'CA', 33.9806, -117.3755),
    ('Rochester', 'NY', 43.1566, -77.6088), ('Sacramento', 'CA', 38.5816, -121.4944),
    ('Salt Lake City', 'UT', 40.7608, -111.8910), ('San Antonio', 'TX', 29.4241, -98.4936),
    ('San Bernardino', 'CA', 34.1083, -117.2898), ('San Diego', 'CA', 32.7157, -117.1611),
    ('San Francisco', 'CA', 37.7749, -122.4194), ('San Jose', 'CA', 37.3382, -121.8863),
    ('Santa Ana', 'CA', 33.7455, -117.8677), ('Scottsdale', 'AZ', 33.4942, -111.9261),
    ('Seattle', 'WA', 47.6062, -122.3321), ('Spokane', 'WA', 47.6588, -117.4260),
    ('St Louis', 'MO', 38.6270, -90.1994), ('St Paul', 'MN', 44.9537, -93.0900),
    ('St Petersburg', 'FL', 27.7676, -82.6403), ('Stockton', 'CA', 37.9577, -121.2908),
    ('Tampa', 'FL', 27.9506, -82.4572), ('Tacoma', 'WA', 47.2529, -122.4443),
    ('Toledo', 'OH', 41.6528, -83.5379), ('Tucson', 'AZ', 32.2226, -110.9747),
    ('Tulsa', 'OK', 36.1540, -95.9928), ('Virginia Beach', 'VA', 36.8529, -75.9780),
    ('Washington', 'DC', 38.9072, -77.0369), ('Wichita', 'KS', 37.6872, -97.3301),
    ('Winston Salem', 'NC', 36.0999, -80.2442),
)

_CITY_INDEX = {_key(city): (city, state, lat, lon) for city, state, lat, lon in _CITIES}
_CITY_INDEX.update({
    'newyorkcity': _CITY_INDEX['newyork'],
    'stlouis': _CITY_INDEX['stlouis'],
    'saintlouis': _CITY_INDEX['stlouis'],
    'stpaul': _CITY_INDEX['stpaul'],
    'saintpaul': _CITY_INDEX['stpaul'],
    'stpetersburg': _CITY_INDEX['stpetersburg'],
    'washingtondc': _CITY_INDEX['washington'],
    'dc': _CITY_INDEX['washington'],
})
_US_COUNTRIES = {'us', 'usa', 'unitedstates', 'unitedstatesofamerica', 'america', 'сша', 'сполученіштати'}
_PRIORITY_RANK = {'Hot': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Watch': 4}


def _is_us(country: Any) -> bool:
    return _key(country) in _US_COUNTRIES


def _lookup_city(value: Any):
    raw = str(value or '').strip()
    if not raw:
        return None
    chunks = [chunk.strip() for chunk in re.split(r'[,;/|]', raw) if chunk.strip()]
    for chunk in chunks + [raw]:
        cleaned = re.sub(r'\b[A-Z]{2}\b|\b\d{5}(?:-\d{4})?\b', '', chunk).strip(' -')
        match = _CITY_INDEX.get(_key(cleaned))
        if match:
            return match
    return None


def build_us_lead_map(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Return small, map-ready city clusters from CRM rows.

    Only data already visible in CRM is returned.  Contact details and exact
    addresses are excluded from the map response.
    """
    clusters: dict[str, dict[str, Any]] = {}
    unmapped: dict[str, int] = defaultdict(int)
    us_total = 0
    today = date.today().isoformat()

    for row in rows:
        if not _is_us(row.get('country')):
            continue
        us_total += 1
        point = _lookup_city(row.get('city_area'))
        if not point:
            label = str(row.get('city_area') or 'Місто не вказано').strip()[:120]
            unmapped[label or 'Місто не вказано'] += 1
            continue
        city, state, lat, lon = point
        cluster = clusters.setdefault(city, {
            'id': f'{state}-{_key(city)}', 'city': city, 'state': state,
            'latitude': lat, 'longitude': lon, 'total': 0, 'hot': 0,
            'due': 0, 'leads': [],
        })
        priority = str(row.get('priority') or '')
        due_date = str(row.get('next_followup_date') or '')[:10]
        stage = str(row.get('stage') or '')
        is_due = bool(due_date and due_date <= today and stage not in {'Won', 'Lost'})
        cluster['total'] += 1
        cluster['hot'] += int(priority in {'Hot', 'High'})
        cluster['due'] += int(is_due)
        cluster['leads'].append({
            'id': int(row.get('id') or 0),
            'name': str(row.get('business_name') or 'Без назви'),
            'category': str(row.get('category') or ''),
            'priority': priority,
            'score': int(row.get('lead_score') or 0),
            'stage': stage,
            'next_followup_date': due_date,
            'due': is_due,
        })

    points = list(clusters.values())
    for point in points:
        point['leads'].sort(key=lambda item: (
            not item['due'], _PRIORITY_RANK.get(item['priority'], 9), -item['score'], item['name'].lower(),
        ))
    points.sort(key=lambda point: (-point['due'], -point['hot'], -point['total'], point['city']))
    states: dict[str, dict[str, int]] = defaultdict(lambda: {'total': 0, 'hot': 0, 'due': 0, 'cities': 0})
    for point in points:
        state = states[point['state']]
        state['total'] += point['total']
        state['hot'] += point['hot']
        state['due'] += point['due']
        state['cities'] += 1

    return {
        'summary': {
            'total': us_total,
            'mapped': sum(point['total'] for point in points),
            'cities': len(points),
            'hot': sum(point['hot'] for point in points),
            'due': sum(point['due'] for point in points),
            'unmapped': sum(unmapped.values()),
        },
        'states': [dict(state=code, **metrics) for code, metrics in sorted(states.items())],
        'points': points,
        'unmapped': [dict(city=city, total=total) for city, total in sorted(unmapped.items(), key=lambda item: (-item[1], item[0]))[:25]],
    }
