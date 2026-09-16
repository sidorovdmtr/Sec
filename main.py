# -*- coding: utf-8 -*-
"""
Точка входа: обновляет обе таблицы цен (Планета Сервис и ТБМ) в Google Таблице.
Запускается вручную (`python main.py`) или по расписанию через GitHub Actions.
"""

import functools
import sys

import config
import scraper_planeta
import scraper_tbm
import sheets_client


def main():
    print("Подключаюсь к Google Таблице...")
    client = sheets_client.get_client()
    spreadsheet = client.open_by_key(config.SPREADSHEET_ID)

    print("Проверяю структуру листов...")
    sheets_client.ensure_structure(spreadsheet)

    coefficients = sheets_client.load_coefficients(spreadsheet)
    resolver = functools.partial(sheets_client.resolve_our_price, coefficients)

    # --- Планета Сервис ---
    print("Собираю цены planetadsp.ru...")
    try:
        planeta_products = scraper_planeta.scrape_all()
        print(f"  найдено позиций: {len(planeta_products)}")
        planeta_rows = scraper_planeta.products_to_rows(planeta_products, resolver)
        ws = spreadsheet.worksheet(config.SHEET_PLANETA)
        sheets_client.write_rows(ws, planeta_rows)
        print(f"  записано строк: {len(planeta_rows)}")
    except Exception as exc:  # не роняем весь прогон, если один из сайтов упал
        print(f"  ОШИБКА при сборе Планета Сервис: {exc}", file=sys.stderr)

    # --- ТБМ ---
    print("Собираю цены tbm.ru (Краснодар)...")
    try:
        tbm_products = scraper_tbm.scrape_all()
        print(f"  найдено позиций: {len(tbm_products)}")
        tbm_rows = scraper_tbm.products_to_rows(tbm_products, resolver)
        ws = spreadsheet.worksheet(config.SHEET_TBM)
        sheets_client.write_rows(ws, tbm_rows)
        print(f"  записано строк: {len(tbm_rows)}")
    except Exception as exc:
        print(f"  ОШИБКА при сборе ТБМ: {exc}", file=sys.stderr)

    print("Готово.")


if __name__ == "__main__":
    main()
