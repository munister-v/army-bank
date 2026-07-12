"""Курований словник категорій бізнесів та квaліфікаторів для конструктора
пошуку клієнтів (prospecting_service.py).

Категорії → OSM-теги (Overpass): кожна категорія — це список Overpass-фільтрів,
які об'єднуються в union. Список навмисно курований під холодний B2B-outreach
веб/діджитал-агенції, а не «всі можливі теги OSM».

Квaліфікатори → сигнали, чому лід «гарячий» + що йому пропонувати. Кожен
сигнал перевіряється по відсутності відповідного OSM-тега (weak signal:
відсутність тега в OSM НЕ гарантує відсутність, напр., сайту в реальності —
це community-дані; тому в UI це подається як «схоже, немає», не як факт).
"""
from __future__ import annotations

# category_key -> {'label': укр. назва, 'filters': [Overpass tag-фільтри без node[...] обгортки]}
CATEGORIES: dict[str, dict] = {
    'restaurant': {'label': 'Ресторани та кафе', 'filters': ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food']},
    'hotel': {'label': 'Готелі та хостели', 'filters': ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house']},
    'beauty': {'label': "Салони краси та перукарні", 'filters': ['shop=hairdresser', 'shop=beauty', 'leisure=spa']},
    'gym': {'label': 'Спортзали та фітнес', 'filters': ['leisure=fitness_centre', 'leisure=sports_centre']},
    'dental': {'label': 'Стоматології', 'filters': ['amenity=dentist', 'healthcare=dentist']},
    'clinic': {'label': 'Клініки та медцентри', 'filters': ['amenity=clinic', 'healthcare=clinic', 'amenity=doctors']},
    'realestate': {'label': 'Агентства нерухомості', 'filters': ['office=estate_agent']},
    'lawyer': {'label': 'Юридичні контори', 'filters': ['office=lawyer']},
    'accountant': {'label': 'Бухгалтерія та аудит', 'filters': ['office=accountant', 'office=tax_advisor']},
    'it': {'label': 'IT та діджитал-компанії', 'filters': ['office=it', 'office=telecommunication']},
    'clothing': {'label': 'Магазини одягу', 'filters': ['shop=clothes', 'shop=boutique', 'shop=shoes']},
    'car_repair': {'label': 'СТО та автосервіс', 'filters': ['shop=car_repair', 'shop=car', 'shop=tyres']},
    'construction': {'label': 'Будівництво та ремонт', 'filters': ['craft=builder', 'office=construction_company', 'shop=doityourself']},
    'education': {'label': 'Школи та освітні центри', 'filters': ['amenity=language_school', 'amenity=driving_school', 'office=educational_institution']},
    'veterinary': {'label': 'Ветклініки', 'filters': ['amenity=veterinary']},
    'florist': {'label': 'Квіткові магазини', 'filters': ['shop=florist']},
    'bakery': {'label': 'Пекарні та кондитерські', 'filters': ['shop=bakery', 'shop=confectionery', 'shop=pastry']},
    'jewelry': {'label': 'Ювелірні магазини', 'filters': ['shop=jewelry']},
    'photographer': {'label': 'Фотографи та фотостудії', 'filters': ['craft=photographer', 'shop=photo']},
    'travel': {'label': 'Турагентства', 'filters': ['shop=travel_agency', 'office=travel_agent']},
    'furniture': {'label': 'Меблеві магазини', 'filters': ['shop=furniture', 'shop=interior_decoration']},
    'pharmacy': {'label': 'Аптеки', 'filters': ['amenity=pharmacy']},
    'optician': {'label': 'Оптики', 'filters': ['shop=optician']},
    'bar': {'label': 'Бари та паби', 'filters': ['amenity=bar', 'amenity=pub']},
    'car_rental': {'label': 'Оренда авто', 'filters': ['amenity=car_rental', 'shop=car_rental']},
}

# qualifier_key -> {'label', 'absent_tags': перевіряємо відсутність будь-якого з цих OSM-тегів,
#                    'offer': готовий текст suggested_first_offer}
QUALIFIERS: dict[str, dict] = {
    'no_website': {
        'label': 'Немає сайту',
        'absent_tags': ('website', 'contact:website', 'url'),
        'offer': 'Розробка сайту / лендінгу',
    },
    'no_instagram': {
        'label': 'Немає Instagram',
        'absent_tags': ('contact:instagram',),
        'offer': 'Ведення та оформлення Instagram',
    },
    'no_facebook': {
        'label': 'Немає Facebook',
        'absent_tags': ('contact:facebook',),
        'offer': 'Створення та ведення Facebook-сторінки',
    },
}


def qualifier_signals(tags: dict) -> dict[str, bool]:
    """Для кожного квaліфікатора: True якщо ВСІ його absent_tags відсутні
    в OSM-тегах елемента (тобто сигнал спрацював — «схоже, цього немає»)."""
    signals = {}
    for key, cfg in QUALIFIERS.items():
        signals[key] = all(not tags.get(t) for t in cfg['absent_tags'])
    return signals


def suggested_offer_for(signals: dict[str, bool]) -> str:
    """Найдоречніша пропозиція на основі спрацьованих сигналів: пріоритет —
    сайт > instagram > facebook (веб найцінніший для веб-агенції)."""
    for key in ('no_website', 'no_instagram', 'no_facebook'):
        if signals.get(key):
            return QUALIFIERS[key]['offer']
    return ''
