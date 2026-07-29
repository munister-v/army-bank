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

import re

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
    'coworking': {'label': 'Коворкінги та гнучкі офіси', 'filters': ['office=coworking', 'amenity=coworking_space']},
    'childcare': {'label': 'Дитячі центри та садочки', 'filters': ['amenity=kindergarten', 'amenity=childcare']},
    'wellness': {'label': 'Wellness, масаж і реабілітація', 'filters': ['shop=massage', 'healthcare=physiotherapist', 'healthcare=rehabilitation']},
    'pet_services': {'label': 'Зоомагазини та грумінг', 'filters': ['shop=pet', 'shop=pet_grooming', 'craft=pet_grooming']},
    'specialty_food': {'label': 'Фермерські та specialty-магазини', 'filters': ['shop=deli', 'shop=organic', 'shop=greengrocer', 'shop=cheese']},
    'events': {'label': 'Івент-простори та конференц-зали', 'filters': ['amenity=events_venue', 'amenity=conference_centre']},
    'cleaning': {'label': 'Клінінг та побутові послуги', 'filters': ['craft=cleaning', 'office=cleaning']},
    'electronics': {'label': 'Електроніка та ремонт техніки', 'filters': ['shop=electronics', 'shop=mobile_phone', 'craft=electronics_repair']},
    'brewery': {'label': 'Броварні та виноробні', 'filters': ['craft=brewery', 'craft=winery', 'shop=wine']},
    'interior': {'label': 'Дизайн інтерʼєру та декор', 'filters': ['office=interior_design', 'shop=interior_decoration', 'craft=interior_decorator']},
    'wedding': {'label': 'Весільні локації та сервіси', 'filters': ['amenity=events_venue', 'shop=wedding', 'craft=caterer']},
    'gallery': {'label': 'Галереї та культурні простори', 'filters': ['tourism=gallery', 'amenity=arts_centre', 'amenity=theatre']},
    'architecture': {'label': 'Архітектурні бюро', 'filters': ['office=architect']},
    'recruitment': {'label': 'Рекрутинг та HR-агентства', 'filters': ['office=employment_agency']},
    'logistics': {'label': 'Логістика та доставка', 'filters': ['office=logistics', 'office=transport', 'amenity=parcel_locker']},
    'yoga': {'label': 'Йога та пілатес-студії', 'filters': ['leisure=fitness_centre', 'sport=yoga', 'sport=pilates']},
    'tattoo': {'label': 'Тату та пірсинг-студії', 'filters': ['shop=tattoo', 'shop=piercing']},
    'laundry': {'label': 'Пральні та хімчистки', 'filters': ['shop=laundry', 'shop=dry_cleaning']},
    'printing': {'label': 'Поліграфія та рекламне виробництво', 'filters': ['shop=copyshop', 'craft=printer', 'office=advertising_agency']},
    'camping': {'label': 'Кемпінги та заміські локації', 'filters': ['tourism=camp_site', 'tourism=chalet', 'tourism=caravan_site']},
    'coffee_roastery': {'label': 'Кавʼярні та обсмажувальні', 'filters': ['amenity=cafe', 'craft=coffee_roaster', 'shop=coffee']},
    'ice_cream': {'label': 'Морозиво та десертні', 'filters': ['amenity=ice_cream', 'shop=ice_cream', 'shop=confectionery']},
    'dance': {'label': 'Танцювальні студії', 'filters': ['leisure=dance', 'sport=dance']},
    'martial_arts': {'label': 'Єдиноборства та бойові клуби', 'filters': ['sport=martial_arts', 'sport=boxing', 'sport=kickboxing']},
    'escape_room': {'label': 'Квест-кімнати та розваги', 'filters': ['leisure=escape_game', 'leisure=amusement_arcade']},
    'music': {'label': 'Музичні школи та студії', 'filters': ['amenity=music_school', 'studio=audio', 'shop=musical_instrument']},
    'bicycle': {'label': 'Веломагазини та майстерні', 'filters': ['shop=bicycle', 'service:bicycle:repair=yes']},
    'bookstore': {'label': 'Книгарні та комікс-шопи', 'filters': ['shop=books', 'shop=comics']},
    'toys': {'label': 'Дитячі та іграшкові магазини', 'filters': ['shop=toys', 'shop=baby_goods']},
    'garden': {'label': 'Садові центри та розсадники', 'filters': ['shop=garden_centre', 'shop=agrarian']},
    'self_storage': {'label': 'Склади індивідуального зберігання', 'filters': ['shop=storage_rental', 'amenity=storage']},
    'solar': {'label': 'Сонячна енергетика та інсталяції', 'filters': ['craft=solar_panel_installer', 'office=energy_supplier']},
    'senior_care': {'label': 'Догляд за літніми людьми', 'filters': ['amenity=nursing_home', 'social_facility=assisted_living']},
    'funeral': {'label': 'Ритуальні та меморіальні послуги', 'filters': ['shop=funeral_directors', 'amenity=funeral_hall']},
    'marina': {'label': 'Марини та водний відпочинок', 'filters': ['leisure=marina', 'sport=sailing', 'shop=boat']},
}

# Local search terms are used by web providers. OSM itself searches by tags,
# but Google/other providers perform materially better when the category is
# expressed in the language people use in the target market.
CATEGORY_SEARCH_TERMS: dict[str, dict[str, str]] = {
    'restaurant': {'uk': 'ресторани та кафе', 'en': 'restaurants and cafes', 'de': 'Restaurants und Cafes', 'pl': 'restauracje i kawiarnie', 'fr': 'restaurants et cafes', 'es': 'restaurantes y cafeterias', 'it': 'ristoranti e caffe', 'ru': 'рестораны и кафе'},
    'hotel': {'uk': 'готелі та хостели', 'en': 'hotels and hostels', 'de': 'Hotels und Hostels', 'pl': 'hotele i hostele', 'fr': 'hotels et auberges', 'es': 'hoteles y hostales', 'it': 'hotel e ostelli', 'ru': 'отели и хостелы'},
    'beauty': {'uk': 'салони краси та перукарні', 'en': 'beauty salons and hairdressers', 'de': 'Kosmetikstudios und Friseure', 'pl': 'salony kosmetyczne i fryzjerzy', 'fr': 'instituts de beaute et coiffeurs', 'es': 'salones de belleza y peluquerias', 'it': 'centri estetici e parrucchieri', 'ru': 'салоны красоты и парикмахерские'},
    'gym': {'uk': 'спортзали та фітнес', 'en': 'gyms and fitness centers', 'de': 'Fitnessstudios', 'pl': 'silownie i kluby fitness', 'fr': 'salles de sport', 'es': 'gimnasios y centros fitness', 'it': 'palestre e centri fitness', 'ru': 'спортзалы и фитнес'},
    'dental': {'uk': 'стоматології', 'en': 'dental clinics', 'de': 'Zahnarztpraxen', 'pl': 'gabinety stomatologiczne', 'fr': 'cabinets dentaires', 'es': 'clinicas dentales', 'it': 'studi dentistici', 'ru': 'стоматологии'},
    'clinic': {'uk': 'клініки та медцентри', 'en': 'clinics and medical centers', 'de': 'Kliniken und Arztpraxen', 'pl': 'kliniki i centra medyczne', 'fr': 'cliniques et centres medicaux', 'es': 'clinicas y centros medicos', 'it': 'cliniche e centri medici', 'ru': 'клиники и медцентры'},
    'realestate': {'uk': 'агентства нерухомості', 'en': 'real estate agencies', 'de': 'Immobilienmakler', 'pl': 'agencje nieruchomosci', 'fr': 'agences immobilieres', 'es': 'agencias inmobiliarias', 'it': 'agenzie immobiliari', 'ru': 'агентства недвижимости'},
    'lawyer': {'uk': 'юридичні контори', 'en': 'law firms', 'de': 'Anwaltskanzleien', 'pl': 'kancelarie prawne', 'fr': 'cabinets avocats', 'es': 'bufetes de abogados', 'it': 'studi legali', 'ru': 'юридические фирмы'},
    'accountant': {'uk': 'бухгалтерія та аудит', 'en': 'accounting and audit firms', 'de': 'Steuerberater und Buchhaltung', 'pl': 'biura rachunkowe', 'fr': 'cabinets comptables', 'es': 'asesorias contables', 'it': 'studi commercialisti', 'ru': 'бухгалтерия и аудит'},
    'education': {'uk': 'школи та освітні центри', 'en': 'schools and education centers', 'de': 'Schulen und Bildungszentren', 'pl': 'szkoly i centra edukacyjne', 'fr': 'ecoles et centres de formation', 'es': 'escuelas y centros educativos', 'it': 'scuole e centri educativi', 'ru': 'школы и образовательные центры'},
    'coworking': {'uk': 'коворкінги та гнучкі офіси', 'en': 'coworking spaces and flexible offices', 'de': 'Coworking Spaces und flexible Büros', 'pl': 'coworkingi i biura elastyczne', 'fr': 'espaces coworking et bureaux flexibles', 'es': 'coworking y oficinas flexibles', 'it': 'coworking e uffici flessibili', 'ru': 'коворкинги и гибкие офисы'},
    'childcare': {'uk': 'дитячі центри та садочки', 'en': 'childcare centers and nurseries', 'de': 'Kindertagesstätten und Kinderzentren', 'pl': 'żłobki i centra dziecięce', 'fr': 'crèches et centres pour enfants', 'es': 'guarderías y centros infantiles', 'it': 'asili e centri per bambini', 'ru': 'детские центры и сады'},
    'wellness': {'uk': 'wellness масаж і реабілітація', 'en': 'wellness massage and rehabilitation', 'de': 'Wellness Massage und Rehabilitation', 'pl': 'wellness masaż i rehabilitacja', 'fr': 'bien-être massage et rééducation', 'es': 'bienestar masaje y rehabilitación', 'it': 'benessere massaggi e riabilitazione', 'ru': 'wellness массаж и реабилитация'},
    'pet_services': {'uk': 'зоомагазини та грумінг', 'en': 'pet shops and pet grooming', 'de': 'Tierhandlungen und Hundefriseure', 'pl': 'sklepy zoologiczne i grooming', 'fr': 'animaleries et toilettage', 'es': 'tiendas de mascotas y peluquería canina', 'it': 'negozi per animali e toelettatura', 'ru': 'зоомагазины и груминг'},
    'specialty_food': {'uk': 'фермерські та specialty магазини', 'en': 'specialty and organic food shops', 'de': 'Feinkost- und Bioläden', 'pl': 'delikatesy i sklepy ekologiczne', 'fr': 'épiceries fines et magasins bio', 'es': 'tiendas gourmet y ecológicas', 'it': 'gastronomie e negozi biologici', 'ru': 'фермерские и specialty магазины'},
    'events': {'uk': 'івент простори та конференц зали', 'en': 'event venues and conference centers', 'de': 'Veranstaltungsorte und Konferenzzentren', 'pl': 'sale eventowe i centra konferencyjne', 'fr': 'lieux événementiels et centres de conférence', 'es': 'espacios para eventos y conferencias', 'it': 'spazi eventi e centri congressi', 'ru': 'ивент пространства и конференц-залы'},
    'electronics': {'uk': 'електроніка та ремонт техніки', 'en': 'electronics stores and device repair', 'de': 'Elektronikgeschäfte und Reparatur', 'pl': 'elektronika i serwis urządzeń', 'fr': 'électronique et réparation appareils', 'es': 'electrónica y reparación', 'it': 'elettronica e riparazione dispositivi', 'ru': 'электроника и ремонт техники'},
    'brewery': {'uk': 'броварні та виноробні', 'en': 'breweries and wineries', 'de': 'Brauereien und Weingüter', 'pl': 'browary i winnice', 'fr': 'brasseries et domaines viticoles', 'es': 'cervecerías y bodegas', 'it': 'birrifici e cantine', 'ru': 'пивоварни и винодельни'},
    'interior': {'uk': 'дизайн інтерʼєру та декор', 'en': 'interior design studios and decor shops', 'de': 'Innenarchitektur und Dekoration', 'pl': 'projektowanie wnętrz i dekoracje', 'fr': 'design intérieur et décoration', 'es': 'diseño de interiores y decoración', 'it': 'interior design e decorazione', 'ru': 'дизайн интерьера и декор'},
    'wedding': {'uk': 'весільні локації та сервіси', 'en': 'wedding venues and services', 'de': 'Hochzeitslocations und Services', 'pl': 'sale weselne i usługi ślubne', 'ru': 'свадебные площадки и услуги'},
    'gallery': {'uk': 'галереї та культурні простори', 'en': 'galleries and cultural venues', 'de': 'Galerien und Kulturzentren', 'pl': 'galerie i centra kultury', 'ru': 'галереи и культурные пространства'},
    'architecture': {'uk': 'архітектурні бюро', 'en': 'architecture studios', 'de': 'Architekturbüros', 'pl': 'pracownie architektoniczne', 'ru': 'архитектурные бюро'},
    'recruitment': {'uk': 'рекрутинг та HR агентства', 'en': 'recruitment and HR agencies', 'de': 'Personalvermittlungen', 'pl': 'agencje rekrutacyjne', 'ru': 'рекрутинговые агентства'},
    'logistics': {'uk': 'логістика та доставка', 'en': 'logistics and delivery companies', 'de': 'Logistik- und Lieferunternehmen', 'pl': 'logistyka i dostawy', 'ru': 'логистика и доставка'},
    'yoga': {'uk': 'йога та пілатес студії', 'en': 'yoga and pilates studios', 'de': 'Yoga- und Pilatesstudios', 'pl': 'studia jogi i pilatesu', 'ru': 'студии йоги и пилатеса'},
    'tattoo': {'uk': 'тату та пірсинг студії', 'en': 'tattoo and piercing studios', 'de': 'Tattoo- und Piercingstudios', 'pl': 'studia tatuażu i piercingu', 'ru': 'тату и пирсинг студии'},
    'laundry': {'uk': 'пральні та хімчистки', 'en': 'laundries and dry cleaners', 'de': 'Wäschereien und Reinigungen', 'pl': 'pralnie i pralnie chemiczne', 'ru': 'прачечные и химчистки'},
    'printing': {'uk': 'поліграфія та рекламне виробництво', 'en': 'printing and signage companies', 'de': 'Druckereien und Werbetechnik', 'pl': 'drukarnie i produkcja reklamowa', 'ru': 'полиграфия и рекламное производство'},
    'camping': {'uk': 'кемпінги та заміські локації', 'en': 'campgrounds and countryside stays', 'de': 'Campingplätze und Landunterkünfte', 'pl': 'kempingi i obiekty podmiejskie', 'ru': 'кемпинги и загородные локации'},
    'coffee_roastery': {'uk': 'кавʼярні та обсмажувальні', 'en': 'coffee shops and coffee roasters', 'de': 'Cafés und Kaffeeröstereien', 'pl': 'kawiarnie i palarnie kawy', 'ru': 'кофейни и обжарщики кофе'},
    'ice_cream': {'uk': 'морозиво та десертні', 'en': 'ice cream and dessert shops', 'de': 'Eisdielen und Dessertläden', 'pl': 'lodziarnie i desery', 'ru': 'мороженое и десертные'},
    'dance': {'uk': 'танцювальні студії', 'en': 'dance studios', 'de': 'Tanzstudios', 'pl': 'studia tańca', 'ru': 'танцевальные студии'},
    'martial_arts': {'uk': 'єдиноборства та бойові клуби', 'en': 'martial arts and boxing clubs', 'de': 'Kampfsport- und Boxclubs', 'pl': 'kluby sztuk walki', 'ru': 'клубы единоборств'},
    'escape_room': {'uk': 'квест кімнати та розваги', 'en': 'escape rooms and entertainment venues', 'de': 'Escape Rooms und Freizeitangebote', 'pl': 'escape roomy i rozrywka', 'ru': 'квест-комнаты и развлечения'},
    'music': {'uk': 'музичні школи та студії', 'en': 'music schools and recording studios', 'de': 'Musikschulen und Tonstudios', 'pl': 'szkoły muzyczne i studia', 'ru': 'музыкальные школы и студии'},
    'bicycle': {'uk': 'веломагазини та майстерні', 'en': 'bicycle shops and repair workshops', 'de': 'Fahrradläden und Werkstätten', 'pl': 'sklepy i serwisy rowerowe', 'ru': 'веломагазины и мастерские'},
    'bookstore': {'uk': 'книгарні та комікс шопи', 'en': 'bookstores and comic shops', 'de': 'Buchhandlungen und Comicläden', 'pl': 'księgarnie i sklepy komiksowe', 'ru': 'книжные и комикс-магазины'},
    'toys': {'uk': 'дитячі та іграшкові магазини', 'en': 'toy and baby stores', 'de': 'Spielzeug- und Babygeschäfte', 'pl': 'sklepy z zabawkami', 'ru': 'детские магазины и игрушки'},
    'garden': {'uk': 'садові центри та розсадники', 'en': 'garden centers and plant nurseries', 'de': 'Gartencenter und Baumschulen', 'pl': 'centra ogrodnicze', 'ru': 'садовые центры и питомники'},
    'self_storage': {'uk': 'склади індивідуального зберігання', 'en': 'self storage facilities', 'de': 'Selfstorage-Anlagen', 'pl': 'magazyny samoobsługowe', 'ru': 'склады индивидуального хранения'},
    'solar': {'uk': 'сонячна енергетика та інсталяції', 'en': 'solar energy installers', 'de': 'Solartechnik-Installateure', 'pl': 'instalatorzy fotowoltaiki', 'ru': 'солнечная энергетика и монтаж'},
    'senior_care': {'uk': 'догляд за літніми людьми', 'en': 'senior care and assisted living', 'de': 'Seniorenpflege und betreutes Wohnen', 'pl': 'opieka senioralna', 'ru': 'уход за пожилыми'},
    'funeral': {'uk': 'ритуальні та меморіальні послуги', 'en': 'funeral and memorial services', 'de': 'Bestattungs- und Gedenkdienste', 'pl': 'usługi pogrzebowe', 'ru': 'ритуальные и мемориальные услуги'},
    'marina': {'uk': 'марини та водний відпочинок', 'en': 'marinas and water recreation', 'de': 'Marinas und Wassersport', 'pl': 'mariny i rekreacja wodna', 'ru': 'марины и водный отдых'},
}


def category_search_term(key: str, lang: str = '') -> str:
    """Return a market-language search phrase with a safe Ukrainian fallback."""
    lang = (lang or '').lower().split('-')[0]
    localized = CATEGORY_SEARCH_TERMS.get(key, {})
    return localized.get(lang) or localized.get('en') or CATEGORIES.get(key, {}).get('label', '')


def category_search_variants(key: str, lang: str = '') -> list[str]:
    """Return distinct market phrases for multi-pass web discovery.

    One literal translation is too brittle for prospecting: a local business
    can describe itself in the market language, English, or with the broader
    CRM label. Keep the expansion deliberately small so each extra phrase has
    a clear purpose and does not burn search quota on cosmetic rewrites.
    """
    localized = CATEGORY_SEARCH_TERMS.get(key, {})
    requested = (lang or '').lower().split('-')[0]
    values = (
        localized.get(requested),
        localized.get('en'),
        CATEGORIES.get(key, {}).get('label'),
    )
    variants: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = str(value or '').strip()
        normalized = re.sub(r'\W+', ' ', value.lower(), flags=re.UNICODE).strip()
        if value and normalized and normalized not in seen:
            seen.add(normalized)
            variants.append(value)
    return variants

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
