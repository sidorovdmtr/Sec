# -*- coding: utf-8 -*-
"""
Утилиты сопоставления позиций между сайтом поставщика и нашей таблицей.

Ключ сопоставления = Производитель + Код декора + Толщина.
Пример: "EGGER|U104|16"

Важный нюанс, обнаруженный в реальных прайс-листах: в артикулах вперемешку
встречаются похожие по начертанию русские и латинские буквы
(например "АU325" — где "А" русская, а "U325" латиница; или "Н1145" —
где "Н" русская, а не латинская "H"). Если это не нормализовать, одинаковые
по смыслу коды не совпадут при сравнении. Поэтому все коды декоров сначала
приводятся к "чистой" латинице.
"""

import re

# Похожие по начертанию кириллические буквы -> латинские эквиваленты
_CYRILLIC_TO_LATIN = str.maketrans({
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
})

# Регулярка для кода декора: 0-2 буквы (иногда через пробел) + 2-4 цифры
# (W908, U104, H1277, F186, "F 685" и т.п.)
_DECOR_CODE_RE = re.compile(r"\b[A-ZА-Я]{1,2}\s?\d{2,4}\b|\b\d{3,4}\b")

# Регулярка для толщины: число перед "мм"
_THICKNESS_RE = re.compile(r"(\d{1,2}(?:[.,]\d)?)\s*мм", re.IGNORECASE)


def normalize_code(raw: str) -> str:
    """Приводит код декора к единому виду: латиница, верхний регистр, без пробелов."""
    if not raw:
        return ""
    cleaned = raw.strip().translate(_CYRILLIC_TO_LATIN).upper()
    cleaned = re.sub(r"\s+", "", cleaned)
    return cleaned


def extract_decor_code(text: str) -> str:
    """Пытается вытащить код декора из произвольного текста названия товара."""
    if not text:
        return ""
    text_norm = text.translate(_CYRILLIC_TO_LATIN)
    match = _DECOR_CODE_RE.search(text_norm)
    return normalize_code(match.group(0)) if match else ""


def extract_thickness(text: str) -> str:
    """Пытается вытащить толщину в мм из произвольного текста."""
    if not text:
        return ""
    match = _THICKNESS_RE.search(text)
    if not match:
        return ""
    value = match.group(1).replace(",", ".")
    # убираем ".0" на конце, если толщина целая
    if value.endswith(".0"):
        value = value[:-2]
    return value


def build_key(manufacturer: str, decor_code: str, thickness: str) -> str:
    """Собирает единый ключ сопоставления."""
    manufacturer_norm = (manufacturer or "").strip().upper()
    decor_norm = normalize_code(decor_code)
    thickness_norm = (thickness or "").strip()
    return f"{manufacturer_norm}|{decor_norm}|{thickness_norm}"
