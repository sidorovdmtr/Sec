# -*- coding: utf-8 -*-
"""
Парсер розничных цен planetadsp.ru (ООО "Планета Сервис").

Сайт сделан на WooCommerce — цены отдаются прямо в HTML без логина
(проверено вручную), так что тут используется обычный requests + BeautifulSoup.

ВАЖНО: этот файл не тестировался вживую (в песочнице, где он написан, нет
доступа в интернет) — структура категорий и разбор карточки товара собраны
по образцам страниц сайта. Если после первого запуска в GitHub Actions
логи покажут 0 товаров или явно неверные цены — пришлите мне лог, поправим
селекторы за один заход.
"""

import re
import time
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup

import config
from match_utils import extract_decor_code, extract_thickness, build_key

BASE_URL = "https://planetadsp.ru"

# Категории плитной продукции, которые собираем. Можно дополнять по мере надобности —
# просто добавьте ссылку на страницу категории (без /page/N/, это скрипт добавит сам).
CATEGORY_URLS = [
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/odnotonnye/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/drevesnye/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/eurodekor-lmdf/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/mdf-egger/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/filvud/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/reprodukczii-materialov/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/stenovye-paneli-dstp-egger/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/stoleshniczy-egger/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-egger/kompakt-plity/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/dstp-kronoshpan-rossiya/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/ldsp-sviss-krono/",
    f"{BASE_URL}/catalog/plitnaya-produkcziya/mdf-kastamonu/",
]

# Ключевые слова в названии товара -> линейка (как в листе "Настройки")
LINE_KEYWORDS = [
    ("ЭГГЕР", ["эггер", "egger"]),
    ("УЛЬТРАДЕКОР", ["ультрадекор"]),
    ("ЛАМАРТИ", ["ламарти"]),
    ("EVOGLOSS/ACM/ACRYLIC", ["evogloss", "acrylic", "acrymatt", "evosoft", "kastamonu", "кастамону"]),
]


@dataclass
class Product:
    title: str
    price: float
    url: str
    line: str = ""
    manufacturer: str = ""
    decor_code: str = field(default="")
    thickness: str = field(default="")


def detect_line(title: str) -> str:
    title_lower = title.lower()
    for line_name, keywords in LINE_KEYWORDS:
        if any(kw in title_lower for kw in keywords):
            return line_name
    return "ПО УМОЛЧАНИЮ"


_PRICE_RE = re.compile(r"\d[\d\s\xa0]*(?:[.,]\d{1,2})?")


def _parse_price(text: str):
    """'6 700.00 руб.' / '6 700,00 ₽' / '58,49₽' -> 6700.0 / 6700.0 / 58.49"""
    if not text:
        return None
    match = _PRICE_RE.search(text)
    if not match:
        return None
    raw = match.group(0)
    # убираем пробелы (обычные и неразрывные) — это разделитель тысяч
    raw = raw.replace("\xa0", "").replace(" ", "")
    # если последний разделитель — запятая перед 1-2 цифрами, это десятичная часть
    raw = raw.replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def _fetch(session: requests.Session, url: str):
    resp = session.get(url, timeout=20)
    if resp.status_code != 200:
        return None
    return BeautifulSoup(resp.text, "html.parser")


def _parse_category_page(soup: BeautifulSoup) -> list:
    """Разбирает один лист карточек товаров стандартной WooCommerce-вёрстки."""
    products = []
    # стандартная WooCommerce разметка: <li class="product"> ... </li>
    cards = soup.select("li.product, div.product")
    for card in cards:
        title_el = card.select_one(".woocommerce-loop-product__title") or card.select_one("h2, h3")
        link_el = card.select_one("a.woocommerce-LoopProduct-link, a")
        price_el = card.select_one(".price ins .amount") or card.select_one(".price .amount") or card.select_one(".price")

        if not title_el or not price_el:
            continue

        title = title_el.get_text(strip=True)
        price = _parse_price(price_el.get_text(strip=True))
        url = link_el["href"] if link_el and link_el.has_attr("href") else ""

        if price is None:
            continue  # товары "цену уточняйте" пропускаем

        products.append(Product(title=title, price=price, url=url))
    return products


def _has_next_page(soup: BeautifulSoup) -> bool:
    return soup.select_one("a.next, .pagination a[rel='next']") is not None


def scrape_category(session: requests.Session, category_url: str) -> list:
    all_products = []
    page = 1
    while True:
        url = category_url if page == 1 else f"{category_url.rstrip('/')}/page/{page}/"
        soup = _fetch(session, url)
        if soup is None:
            break
        products = _parse_category_page(soup)
        if not products:
            break
        all_products.extend(products)
        if not _has_next_page(soup):
            break
        page += 1
        time.sleep(config.REQUEST_DELAY_SECONDS)
    return all_products


def scrape_all() -> list:
    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})

    all_products = []
    for category_url in CATEGORY_URLS:
        products = scrape_category(session, category_url)
        for p in products:
            p.line = detect_line(p.title)
            p.manufacturer = p.line
            p.decor_code = extract_decor_code(p.title)
            p.thickness = extract_thickness(p.title)
        all_products.extend(products)
        time.sleep(config.REQUEST_DELAY_SECONDS)

    return all_products


def products_to_rows(products: list, coefficients_resolver) -> list:
    """Готовит список строк для записи в Google Таблицу."""
    from sheets_client import now_str

    rows = []
    seen_keys = set()
    for p in products:
        key = build_key(p.manufacturer, p.decor_code, p.thickness)
        if key in seen_keys:
            continue  # на некоторых страницах один и тот же товар может попасться дважды
        seen_keys.add(key)

        our_price = coefficients_resolver("Планета Сервис", p.line, p.price)
        rows.append([
            p.manufacturer,
            p.line,
            p.decor_code,
            p.thickness,
            p.title,
            p.price,
            our_price if our_price is not None else "",
            key,
            p.url,
            "есть на сайте",
            now_str(),
        ])
    return rows
