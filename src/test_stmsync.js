// Кнопка «Синхронизировать выписки»: имитация скрипта Apps Script и библиотеки xlsx.
// Запуск: NODE_PATH=<playwright> node test_stmsync.js dist/deploy/index.html <путь к xlsx.full.min.js>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
const XLSX_JS = path.resolve(process.argv[3] || '');
const XLSX = require(path.join(path.dirname(XLSX_JS), '..', 'xlsx.js'));
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }

function book(aoa) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1'); return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }); }
const H = ['Дата', 'Номер документа', 'Дебет', 'Кредит', 'Контрагент', '', '', '', '', '', 'Назначение платежа', 'Код дебитора', 'Тип документа'];
const ALFA = book([['Выписка по счёту'], ['За период', 'c 30.10.2026 по 30.10.2026'], H, ['', '', '', '', 'Наименование', 'ИНН', 'КПП', 'Счёт', 'БИК', 'Наименование банка'],
  ['30.10.2026', '0', '156.00', '', 'АО «Альфа-Банк»', '', '', '', '', '', 'Комиссия за переводы в валюте РФ за 2026-10-30. Согласно тарифам Банка.', '', 'Банковский ордер'],
  ['30.10.2026', '324', '1,215.00', '', 'АО «Х»', '', '', '', '', '', 'Оплата по счету 1', '', 'Платежное поручение'],
  ['30.10.2026', '321', '15,419.00', '', 'АО «Y»', '', '', '', '', '', 'Оплата по счету 2', '', 'Платежное поручение']]);
const PROMOS = book([['Дата', 'Сумма', 'Статья', 'Назначение платежа', 'Контрагент'], ['2026-10-29', -50000, 'Материалы', 'Оплата поставщику', 'ООО «Поставщик»'], ['2026-10-29', 65000, 'Услуги', 'внес', 'ООО «3Д АВИА»']]);
const BROKEN = book([['что-то'], ['не выписка']]);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const KEY = 'secretkey123';
  const folder = [{ id: 'f1', name: 'Выписка_40702810626180001762_30.10.2026.xlsx', size: 7270, modified: '2026-11-01T18:30:39.000Z', buf: ALFA }];
  let fileCalls = 0, listCalls = 0, blockFetch = false;
  await page.route(/^https?:/, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com') return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(XLSX_JS) });
    if (u.hostname === 'script.google.com') {
      const cb = u.searchParams.get('callback');
      if (blockFetch && route.request().resourceType() === 'fetch') return route.abort(); // как Safari: запрос между сайтами блокируется
      const h = { 'access-control-allow-origin': '*' };
      if (cb) {
        const send = (o) => route.fulfill({ contentType: 'application/javascript', body: cb + '(' + JSON.stringify(o) + ');' });
        if (u.searchParams.get('key') !== KEY) return send({ error: 'forbidden' });
        if (u.searchParams.get('action') === 'list') { listCalls++; return send({ ok: true, files: folder.map(f => ({ id: f.id, name: f.name, size: f.size, modified: f.modified })) }); }
        if (u.searchParams.get('action') === 'file') { fileCalls++; const f = folder.find(x => x.id === u.searchParams.get('id')); return send({ ok: true, name: f.name, base64: f.buf.toString('base64') }); }
      }
      if (u.searchParams.get('key') !== KEY) return route.fulfill({ contentType: 'application/json', headers: h, body: JSON.stringify({ error: 'forbidden' }) });
      if (u.searchParams.get('action') === 'list') { listCalls++; return route.fulfill({ contentType: 'application/json', headers: h, body: JSON.stringify({ ok: true, files: folder.map(f => ({ id: f.id, name: f.name, size: f.size, modified: f.modified })) }) }); }
      if (u.searchParams.get('action') === 'file') { fileCalls++; const f = folder.find(x => x.id === u.searchParams.get('id')); return route.fulfill({ contentType: 'application/json', headers: h, body: JSON.stringify({ ok: true, name: f.name, base64: f.buf.toString('base64') }) }); }
    }
    return route.abort();
  });
  const ready = () => page.waitForFunction(() => window.KCApp);
  const toastTxt = async () => (await page.locator('#toast').innerText().catch(() => '')) || '';
  await page.goto(FILE); await ready();
  // учёт, как после импорта v9: 2 платежа и 1 комиссия 156 ₽ тремя записями по 52 ₽ (в сумме равны строке выписки)
  await page.evaluate(() => {
    const mk = (amount, desc, article) => KC.newRecord({ wallet: 'alfa', amount, date: '2026-10-30', source: 'import', bankState: 'confirmed', description: desc, article });
    KCApp.commit({ newRecords: [mk(-121500, 'Оплата 1', 'Закупка'), mk(-1541900, 'Оплата 2', 'Закупка'),
      mk(-5200, 'Комиссия за перевод в рублях по Системе N 324', 'РКО'), mk(-5200, 'Комиссия за перевод в рублях по Системе N 321', 'РКО'), mk(-5200, 'Комиссия за перевод в рублях по Системе N 322', 'РКО')] });
  });
  const bal0 = await page.evaluate(() => KC.balances(KCApp.S.records).total), n0 = await page.evaluate(() => KCApp.S.records.length);
  await page.click('.nav button[data-v="statements"]');
  // 1. без ссылки: подсказка; неверная ссылка отклоняется
  await page.click('button[data-act="stmsync"]');
  ok('no url: hint', (await toastTxt()).indexOf('вставьте ссылку') >= 0, await toastTxt());
  await page.fill('#stm-url', 'https://example.com/x'); await page.click('button[data-act="stmurlsave"]');
  ok('bad url rejected', (await page.evaluate(() => KCApp.S.meta.stmUrl)) === '');
  ok('bad host explained', (await toastTxt()).indexOf('script.google.com') >= 0, await toastTxt());
  await page.fill('#stm-url', 'https://script.google.com/macros/s/TEST/dev?key=abc'); await page.click('button[data-act="stmurlsave"]');
  ok('dev url converted to exec', (await page.evaluate(() => KCApp.S.meta.stmUrl)) === 'https://script.google.com/macros/s/TEST/exec?key=abc', await page.evaluate(() => KCApp.S.meta.stmUrl));
  await page.click('button[data-act="stmurlclear"]');
  await page.fill('#stm-url', 'https://script.google.com/macros/s/TEST/exec'); await page.click('button[data-act="stmurlsave"]');
  ok('missing key explained', (await toastTxt()).indexOf('key=') >= 0 && (await page.evaluate(() => KCApp.S.meta.stmUrl)) === '', await toastTxt());
  // вставка из журнала выполнения: время, слово «Информация», кавычки и неразрывный пробел вокруг ссылки
  await page.fill('#stm-url', '22:30:11\u00A0Информация\n\u00AB https://script.google.com/macros/s/TEST/exec?key=wrong \u00BB'); await page.click('button[data-act="stmurlsave"]');
  ok('url extracted from log paste', (await page.evaluate(() => KCApp.S.meta.stmUrl)) === 'https://script.google.com/macros/s/TEST/exec?key=wrong', await page.evaluate(() => KCApp.S.meta.stmUrl));
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(400);
  ok('wrong key message', (await toastTxt()).indexOf('неверный ключ') >= 0, await toastTxt());
  await page.evaluate((k) => { KCApp.S.meta.stmUrl = 'https://script.google.com/macros/s/TEST/exec?key=' + k; KCApp.render(); }, KEY);
  // 2. первая синхронизация: Альфа читается, всё привязывается, новых записей нет, остаток не меняется
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(600);
  const t1 = await toastTxt();
  ok('first sync loads 1 file, 3 rows linked, none added', /Загружено выписок: 1 \(строк 3, привязано 3, добавлено 0/.test(t1), t1);
  ok('records and balance unchanged', (await page.evaluate(() => KCApp.S.records.length)) === n0 && (await page.evaluate(() => KC.balances(KCApp.S.records).total)) === bal0);
  ok('file remembered', (await page.evaluate(() => Object.keys(KCApp.S.meta.stmFiles).length)) === 1);
  // 3. повторная синхронизация: файл не берётся
  const fc = fileCalls;
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(400);
  ok('second sync: no new statements', (await toastTxt()).indexOf('Новых выписок не найдено') >= 0, await toastTxt());
  ok('second sync: file not downloaded again', fileCalls === fc);
  // 4. приходит файл Промоса и файл неясного назначения
  folder.push({ id: 'f2', name: 'Export-2026-10-29_Кубкрафтер_Промос.xlsx', size: 3948, modified: '2026-11-02T08:00:00.000Z', buf: PROMOS });
  folder.push({ id: 'f3', name: 'Заметки.xlsx', size: 100, modified: '2026-11-02T08:01:00.000Z', buf: BROKEN });
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(600);
  const t2 = await toastTxt();
  ok('promos loaded, unknown file reported', /Загружено выписок: 1/.test(t2) && t2.indexOf('Заметки.xlsx') >= 0, t2);
  ok('promos rows produce decisions', (await page.evaluate(() => KCApp.S.decisions.filter(d => d.wallet === 'promos' && !d.resolvedAt).length)) === 2);
  ok('unknown file not remembered', (await page.evaluate(() => Object.values(KCApp.S.meta.stmFiles).map(f => f.name))).indexOf('Заметки.xlsx') < 0);
  // 5. изменённый файл (другая дата изменения) читается снова, дублей не создаёт
  folder[0].modified = '2026-11-03T09:00:00.000Z';
  const nBefore = await page.evaluate(() => KCApp.S.records.length);
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(600);
  ok('changed file re-read without duplicates', (await page.evaluate(() => KCApp.S.records.length)) === nBefore && /дублей|Загружено выписок: 1/.test(await toastTxt()), await toastTxt());
  // 6. состояние переживает перезагрузку
  await page.waitForTimeout(150); await page.reload(); await ready();
  ok('url and files persist', await page.evaluate(() => !!KCApp.S.meta.stmUrl && Object.keys(KCApp.S.meta.stmFiles).length >= 2));
  // 7. Safari блокирует обычный запрос: инструмент переходит на загрузку скриптом-вставкой и всё равно читает выписку
  blockFetch = true;
  folder.push({ id: 'f4', name: 'Выписка_40702810626180001762_01.11.2026.xlsx', size: 7300, modified: '2026-11-04T09:00:00.000Z', buf: ALFA });
  await page.click('.nav button[data-v="statements"]');
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(800);
  const t3 = await toastTxt();
  ok('fallback loads file when fetch is blocked', /Загружено выписок: 1/.test(t3), t3);
  await page.click('button[data-act="stmsync"]'); await page.waitForTimeout(500);
  ok('fallback: second run no new statements', (await toastTxt()).indexOf('Новых выписок не найдено') >= 0, await toastTxt());
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
