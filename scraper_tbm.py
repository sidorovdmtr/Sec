# -*- coding: utf-8 -*-
"""
Парсер розничных цен tbm.ru — раздел "Мебельные комплектующие"
(https://www.tbm.ru/komplektuyuschie-dlya-mebeli).

ВЕРСИЯ 2 — переписан после первого реального прогона.

Что изменилось и почему:
1. Первая версия пыталась читать встроенный JSON (__NUXT_DATA__) — но у Nuxt 3
   это не обычный JSON с настоящими значениями, а компактный формат, где вместо
   значений часто стоят числа-ссылки на другие элементы массива. Из-за этого
   в таблицу попадали бессмысленные числа вместо названий/цен.
   Теперь вместо JSON разбирается ВИДИМЫЙ текст страницы — по меткам "Арт." и
   "Торговая марка", которые на сайте tbm.ru (и на старой, и на новой версии)
   стоят стабильно рядом с каждым товаром.
2. Категория "мебельные комплектующие" — это дерево вложенных подкатегорий
   (опоры, петли, ручки и т.д.), а не единый список товаров. Поэтому скрипт
   сначала обходит страницы внутри этого раздела (не уходя за его пределы),
   собирает все ссылки на карточки товаров (/product/...), затем разбирает
   каждую найденную страницу на товары по тексту.

ВАЖНАЯ ОГОВОРКА: обход "вширь" (сколько подкатегорий и страниц реально есть,
как устроена пагинация) — тоже не проверен вживую, ограничен разумными
запасами (MAX_PAGES_TO_VISIT) на случай неожиданно большого раздела. Если
после прогона окажется, что собралась лишь часть ассортимента — пришлите
лог (там печатается, сколько страниц раздела обошли и сколько товаров нашли),
поправим лимиты или пагинацию.
"""

import re
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

import config
from match_utils import build_key

BASE_URL = "https://www.tbm.ru"
ROOT_CATEGORY_URL = f"{BASE_URL}/komplektuyuschie-dlya-mebeli"

# Предохранители от неожиданно большого раздела / бесконечного обхода.
# "Мебельные комплектующие" — большой раздел, поэтому лимит страниц ощутимо
# выше, чем можно было бы ожидать; при 400 позициях в час (полторы секунды
# задержки на запрос) полный обход тысяч карточек уложится в несколько часов,
# что нормально для раз-в-сутки задачи. Если после прогона окажется мало —
# увеличим.
MAX_PAGES_TO_VISIT = 3000
MAX_PAGINATION_PER_PAGE = 25  # сколько страниц пагинации пробуем на одну категорию

# Метки, по которым режем текст на карточки товара
ARTICLE_LABEL_RE = re.compile(r"Арт\.\s*([A-Za-zА-Яа-я0-9._/\-]+)")
PRICE_RE = re.compile(r"(\d[\d \xa0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб)")
BRAND_LABEL_RE = re.compile(r"Торговая марка\s*\n?\s*([^\n]+)")


def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": config.USER_AGENT,
        "Accept-Language": "ru-RU,ru;q=0.9",
    })
    try:
        session.get(BASE_URL, timeout=20)
    except requests.RequestException:
        pass
    return session


def _normalize_url(url: str) -> str:
    """Убирает якоря/лишние query-параметры отслеживания, приводит к единому виду."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _fetch(session: requests.Session, url: str):
    try:
        resp = session.get(url, timeout=20)
    except Exception as exc:
        print(f"    не удалось загрузить {url}: {exc}")
        return None
    if resp.status_code != 200:
        print(f"    {url} -> статус {resp.status_code}")
        return None
    return resp.text


def _parse_price(raw: str):
    if not raw:
        return None
    cleaned = raw.replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_products_from_text(text: str) -> list:
    """
    Режет текст страницы на куски по меткам "Арт. XXX" и вытаскивает
    из каждого куска название (текст перед меткой), цену и бренд (если есть).
    """
    products = []
    matches = list(ARTICLE_LABEL_RE.finditer(text))
    for idx, match in enumerate(matches):
        article = match.group(1).strip()
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else min(len(text), match.end() + 400)
        chunk = text[start:end]

        # название — берём кусок текста непосредственно ПЕРЕД меткой "Арт."
        before_start = matches[idx - 1].end() if idx > 0 else max(0, start - 200)
        title_zone = text[before_start:start].strip()
        # заголовок обычно последняя "строка" в этой зоне
        title = title_zone.split("\n")[-1].strip(" ·-—")
        if not title:
            title = title_zone.strip(" ·-—")[-150:]

        price_match = PRICE_RE.search(chunk)
        price = _parse_price(price_match.group(1)) if price_match else None

        brand_match = BRAND_LABEL_RE.search(chunk)
        brand = brand_match.group(1).strip() if brand_match else ""

        if not title or price is None:
            continue  # без названия или без цены позиция бесполезна для прайса

        products.append({
            "title": title,
            "article": article,
            "price": price,
            "brand": brand,
        })
    return products


def _extract_links(html: str, page_url: str):
    soup = BeautifulSoup(html, "html.parser")
    product_links = set()
    category_links = set()
    for a in soup.find_all("a", href=True):
        full = _normalize_url(urljoin(page_url, a["href"]))
        if not full.startswith(BASE_URL):
            continue
        if "/product/" in full:
            product_links.add(full)
        elif full.startswith(ROOT_CATEGORY_URL) and full != page_url:
            category_links.add(full)
    return product_links, category_links


def crawl_category_tree(session: requests.Session):
    """
    Обходит раздел "Мебельные комплектующие" вширь: собирает ссылки на
    карточки товаров и заодно разбирает товары прямо со страниц листинга
    (если цена видна в списке — не тратим лишний запрос на карточку).
    """
    to_visit = [ROOT_CATEGORY_URL]
    visited = set()
    all_products = {}  # article -> dict, чтобы не дублировать

    while to_visit and len(visited) < MAX_PAGES_TO_VISIT:
        url = to_visit.pop(0)
        if url in visited:
            continue
        visited.add(url)

        html = _fetch(session, url)
        if html is None:
            continue

        text = BeautifulSoup(html, "html.parser").get_text("\n", strip=True)
        found = extract_products_from_text(text)
        for p in found:
            all_products[p["article"]] = p

        product_links, category_links = _extract_links(html, url)
        for link in product_links | category_links:
            if link not in visited and link not in to_visit:
                to_visit.append(link)

        # пробуем пагинацию для этой же страницы (?page=2, 3, ...),
        # останавливаемся, как только новая страница не добавляет новых товаров
        # пагинацию имеет смысл пробовать только для страниц-категорий
        # (у карточки товара пагинации нет — не тратим на неё лишние запросы)
        if "/product/" in url:
            time.sleep(config.REQUEST_DELAY_SECONDS)
            continue

        base_no_query = url.split("?")[0]
        seen_before = set(all_products.keys())
        for page_num in range(2, MAX_PAGINATION_PER_PAGE + 1):
            if len(visited) >= MAX_PAGES_TO_VISIT:
                break
            page_url = f"{base_no_query}?page={page_num}"
            if page_url in visited:
                continue
            visited.add(page_url)
            page_html = _fetch(session, page_url)
            if page_html is None:
                break
            page_text = BeautifulSoup(page_html, "html.parser").get_text("\n", strip=True)
            page_found = extract_products_from_text(page_text)
            new_articles = {p["article"] for p in page_found} - seen_before
            if not new_articles:
                break  # дальше пагинации, видимо, нет (или параметр не поддерживается)
            for p in page_found:
                all_products[p["article"]] = p
            seen_before |= new_articles
            time.sleep(config.REQUEST_DELAY_SECONDS)

        time.sleep(config.REQUEST_DELAY_SECONDS)

    print(f"    обошли страниц: {len(visited)}, категорий в очереди осталось: {len(to_visit)}")
    return list(all_products.values())


def scrape_all() -> list:
    session = _make_session()
    return crawl_category_tree(session)


def products_to_rows(products: list, coefficients_resolver) -> list:
    from sheets_client import now_str

    rows = []
    seen_keys = set()
    for item in products:
        title = item["title"]
        price = item["price"]
        article = item["article"]
        brand = item.get("brand", "")

        key = build_key(brand or "ТБМ", article, "-")
        if key in seen_keys:
            continue
        seen_keys.add(key)

        our_price = coefficients_resolver("ТБМ", "ПО УМОЛЧАНИЮ", price)
        rows.append([
            brand,
            "ПО УМОЛЧАНИЮ",
            article,
            "",
            title,
            price,
            our_price if our_price is not None else "",
            key,
            "",
            "есть на сайте",
            now_str(),
        ])
    return rows
