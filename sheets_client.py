# -*- coding: utf-8 -*-
"""
Обёртка над gspread: подключение по служебному аккаунту, создание листов
при первом запуске, запись данных.
"""

import datetime
import json
import os

import gspread
from google.oauth2.service_account import Credentials

import config

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_client() -> gspread.Client:
    """
    Авторизуется по служебному аккаунту.
    Ключ берётся из переменной окружения GOOGLE_SERVICE_ACCOUNT_KEY
    (весь JSON-файл одной строкой — именно так он лежит в GitHub Secret),
    либо, для локального запуска, из файла service_account.json рядом со скриптом.
    """
    raw_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if raw_key:
        info = json.loads(raw_key)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        creds = Credentials.from_service_account_file(
            "service_account.json", scopes=SCOPES
        )
    return gspread.authorize(creds)


def _ensure_sheet(spreadsheet: gspread.Spreadsheet, title: str, headers: list) -> gspread.Worksheet:
    """Возвращает лист с нужным названием, создавая его и вписывая заголовки при отсутствии."""
    try:
        ws = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=title, rows=100, cols=max(10, len(headers)))
        ws.update("A1", [headers])
        ws.freeze(rows=1)
        return ws

    # лист уже есть — убедимся, что заголовки на месте (не трогаем остальное содержимое)
    first_row = ws.row_values(1)
    if first_row != headers:
        ws.update("A1", [headers])
        ws.freeze(rows=1)
    return ws


def ensure_structure(spreadsheet: gspread.Spreadsheet) -> None:
    """Создаёт все нужные листы/заголовки, если их ещё нет. Ничего не удаляет и не перетирает данные."""
    settings_ws = _ensure_sheet(spreadsheet, config.SHEET_SETTINGS, config.SETTINGS_HEADERS)

    # Настройки заполняем значениями по умолчанию только если лист пустой (только заголовок)
    existing_rows = settings_ws.get_all_values()
    if len(existing_rows) <= 1:
        settings_ws.update(
            f"A2",
            config.DEFAULT_SETTINGS_ROWS,
        )

    _ensure_sheet(spreadsheet, config.SHEET_PLANETA, config.PRICE_HEADERS)
    _ensure_sheet(spreadsheet, config.SHEET_TBM, config.PRICE_HEADERS)


def load_coefficients(spreadsheet: gspread.Spreadsheet) -> dict:
    """
    Читает лист "Настройки" и возвращает словарь:
        {(Поставщик, Линейка): (тип_формулы, значение)}
    Плюс запись с ключом (Поставщик, "ПО УМОЛЧАНИЮ") как fallback.
    """
    ws = spreadsheet.worksheet(config.SHEET_SETTINGS)
    rows = ws.get_all_records()  # список словарей по заголовкам
    result = {}
    for row in rows:
        supplier = (row.get("Поставщик") or "").strip()
        line = (row.get("Линейка") or "").strip()
        formula_type = (row.get("Тип формулы") or "").strip().lower()
        value = row.get("Значение")
        if not supplier or not line:
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            continue
        result[(supplier, line)] = (formula_type, value)
    return result


def resolve_our_price(coefficients: dict, supplier: str, line: str, site_price: float):
    """
    Считает нашу цену по правилам из листа "Настройки".
    Если для конкретной линейки правила нет — берётся строка "ПО УМОЛЧАНИЮ" для этого поставщика.
    Возвращает None, если правил вообще нет (чтобы не подставлять цену наугад).
    """
    rule = coefficients.get((supplier, line)) or coefficients.get((supplier, "ПО УМОЛЧАНИЮ"))
    if not rule or site_price is None:
        return None
    formula_type, value = rule
    if formula_type == "delta":
        return round(site_price - value, 2)
    if formula_type == "percent":
        return round(site_price * value, 2)
    return None


def write_rows(worksheet: gspread.Worksheet, rows: list) -> None:
    """
    Полностью перезаписывает содержимое листа (кроме заголовка) свежими данными.
    Так проще всего корректно отражать позиции, которые пропали с сайта
    (их просто не будет в новой выгрузке) и новые позиции (появятся сами).
    """
    worksheet.batch_clear(["A2:Z100000"])
    if rows:
        worksheet.update("A2", rows, value_input_option="USER_ENTERED")


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
