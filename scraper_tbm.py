# -*- coding: utf-8 -*-
"""
Парсер розничных цен tbm.ru, город Краснодар.

ВАЖНЫЕ ОГОВОРКИ (прочитайте перед первым запуском):

1. tbm.ru явно запрещает автоматический доступ в robots.txt. Мы сознательно
   идём против этого правила по вашему запросу — скрипт представляется
   обычным браузером (User-Agent) и делает паузы между запросами, чтобы
   не создавать нагрузку. Полной гарантии, что сайт не заблокирует IP
   GitHub Actions, нет.

2. Как переключить сайт на город Краснодар — НЕ проверено вживую (в среде,
   где писался этот код, нет доступа в интернет). Ниже — рабочая гипотеза:
   сайт на Nuxt, город обычно хранится в cookie. Функция `_make_session`
   пытается сначала найти endpoint смены города и, если не получилось,
   просто выставляет вероятные имена cookie напрямую.
   Если после первого прогона в логах будут видны московские цены или
   пустой результат — нужно будет открыть sайт в браузере, в Network
   посмотреть, какой запрос/cookie реально отвечает за город, и прислать
   мне — поправлю за одну правку.

3. Структура карточки товара на сайте современная (Nuxt/Vue), поэтому вместо
   хрупкого парсинга CSS-классов скрипт в первую очередь пробует найти
   встроенный JSON с данными страницы (обычно это тег
   <script id="__NUXT_DATA__"> или переменная window.__NUXT__) — это гораздо
   надёжнее статичных классов. Если такого блока нет, используется резервный
   разбор по видимым признакам цены в HTML.
"""

import json
import re
import time

import requests
from bs4 import BeautifulSoup

import config
from match_utils import extract_decor_code, extract_thickness, build_key

BASE_URL = "https://www.tbm.ru"

# Категории мебельных комплектующих, которые собираем.
# Список можно расширять — добавляйте ссылки на страницы категорий.
CATEGORY_URLS = [
    f"{BASE_URL}/komplektuyuschie-dlya-mebeli/opory-mebelnye",
    f"{BASE_URL}/komplektuyuschie-dlya-mebeli",
]

# Вероятные имена cookie для выбора города — пробуем по очереди
CITY_COOKIE_CANDIDATES = ["city", "selected_city", "tbm_city", "region"]
TBM_CITY_CODE_KRASNODAR = "krasnodar"  # предположительно; см. оговорку №2 выше


def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": config.USER_AGENT,
        "Accept-Language": "ru-RU,ru;q=0.9",
    })

    # Шаг 1: заходим на главную, чтобы получить базовые cookie сессии
    try:
        session.get(BASE_URL, timeout=20)
    except requests.RequestException:
        pass

    # Шаг 2: пробуем явно выставить город через вероятные cookie-имена.
    # Это "на всякий случай" — не факт, что сработает без реального запроса
    # к API смены города, см. оговорку в шапке файла.
    for name in CITY_COOKIE_CANDIDATES:
        session.cookies.set(name, TBM_CITY_CODE_KRASNODAR, domain="www.tbm.ru")
        session.cookies.set(name, config.TBM_CITY_NAME, domain="www.tbm.ru")

    return session


def _parse_price(text: str):
    if not text:
        return None
    match = re.search(r"\d[\d\s\xa0]*(?:[.,]\d{1,2})?", text)
    if not match:
        return None
    raw = match.group(0).replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def _extract_nuxt_json(html: str):
    """Пытается найти встроенный JSON с данными страницы (Nuxt)."""
    patterns = [
        r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',
        r"window\.__NUXT__\s*=\s*(\{.*?\});?\s*</script>",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if not match:
            continue
        try:
            return json.loads(match.group(1))
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def _walk_json_for_products(node, found: list):
    """Рекурсивно ищет в JSON объекты, похожие на карточку товара
    (есть название и цена)."""
    if isinstance(node, dict):
        title = node.get("name") or node.get("title")
        price = node.get("price") or node.get("retailPrice") or node.get("priceRetail")
        article = node.get("article") or node.get("sku") or node.get("code")
        if title and price:
            found.append({"title": title, "price": price, "article": article,
                           "url": node.get("url") or node.get("slug") or ""})
        for value in node.values():
            _walk_json_for_products(value, found)
    elif isinstance(node, list):
        for item in node:
            _walk_json_for_products(item, found)


def _parse_html_fallback(soup: BeautifulSoup) -> list:
    """Резервный разбор, если не нашли JSON: ищем карточки по видимым признакам."""
    found = []
    # Ищем блоки, где рядом есть текст с "руб" / "₽" и что-то похожее на артикул
    for card in soup.select("[class*='product'], [class*='card']"):
        text = card.get_text(" ", strip=True)
        price_match = re.search(r"[\d\s]{3,}[.,]\d{2}\s*₽", text)
        if not price_match:
            continue
        title_el = card.find(["h2", "h3", "a"])
        title = title_el.get_text(strip=True) if title_el else text[:80]
        price = _parse_price(price_match.group(0))
        link_el = card.find("a", href=True)
        url = link_el["href"] if link_el else ""
        if price:
            found.append({"title": title, "price": price, "article": "", "url": url})
    return found


def scrape_category(session: requests.Session, url: str) -> list:
    try:
        resp = session.get(url, timeout=20)
    except requests.RequestException:
        return []
    if resp.status_code != 200:
        return []

    html = resp.text
    nuxt_data = _extract_nuxt_json(html)
    products = []
    if nuxt_data is not None:
        _walk_json_for_products(nuxt_data, products)
    if not products:
        soup = BeautifulSoup(html, "html.parser")
        products = _parse_html_fallback(soup)
    return products


def scrape_all() -> list:
    session = _make_session()
    all_products = []
    for url in CATEGORY_URLS:
        items = scrape_category(session, url)
        all_products.extend(items)
        time.sleep(config.REQUEST_DELAY_SECONDS)
    return all_products


def products_to_rows(products: list, coefficients_resolver) -> list:
    from sheets_client import now_str

    rows = []
    seen_keys = set()
    for item in products:
        title = str(item.get("title") or "")
        price = item.get("price")
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue

        decor_code = str(item.get("article") or "") or extract_decor_code(title)
        thickness = extract_thickness(title)
        manufacturer = "ТБМ"
        key = build_key(manufacturer, decor_code, thickness or "-")
        if key in seen_keys:
            continue
        seen_keys.add(key)

        our_price = coefficients_resolver("ТБМ", "ПО УМОЛЧАНИЮ", price)
        rows.append([
            manufacturer,
            "ПО УМОЛЧАНИЮ",
            decor_code,
            thickness,
            title,
            price,
            our_price if our_price is not None else "",
            key,
            item.get("url") or "",
            "есть на сайте",
            now_str(),
        ])
    return rows
