// Хранилище: перенос из localStorage в IndexedDB, большой объём данных, сброс метки облака при пустом устройстве
const { chromium } = require('playwright');
const FILE = 'file://' + require('path').resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route(/^https?:/, r => r.abort());
  const ready = () => page.waitForFunction(() => window.KCApp);
  // 1. старые данные лежат в localStorage (как до обновления)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    const recs = []; for (let i = 0; i < 50; i++) recs.push({ id: 'old' + i, kind: 'expense', wallet: 'cash', amount: -100 * (i + 1), date: '2026-11-01', planned: false, counterparty: '', article: '', project: '', description: '', bankState: 'none', deleted: false, updatedAt: '2026-11-01T10:00:00.000Z' });
    localStorage.setItem('kc.test.records', JSON.stringify(recs));
    localStorage.setItem('kc.test.meta', JSON.stringify({ lastPull: '2026-11-01T10:00:00.000Z' }));
  });
  await page.goto(FILE); await ready();
  ok('old data loaded', (await page.evaluate(() => KCApp.S.records.length)) === 50);
  await page.waitForTimeout(150);
  ok('moved out of localStorage', (await page.evaluate(() => localStorage.getItem('kc.test.records'))) === null);
  // 2. большой объём: вдвое больше, чем помещается в localStorage iPhone
  await page.evaluate(() => {
    const list = []; for (let i = 0; i < 6000; i++) list.push(KC.newRecord({ wallet: 'alfa', amount: -1000 - i, date: '2026-10-15', counterparty: 'Контрагент ' + i, article: 'Закупка материала', project: 'Проект ' + (i % 40), description: 'Оплата по счёту ' + i + ' за материалы по договору', source: 'import', bankPurpose: 'Оплата по счёту ' + i + ' за ЛДСП, в том числе НДС 20 процентов', note: 'Финолог (без банковской выписки)' }));
    KCApp.commit({ newRecords: list });
  });
  await page.waitForTimeout(500);
  await page.reload(); await ready();
  ok('6050 records survive reload', (await page.evaluate(() => KCApp.S.records.length)) === 6050);
  ok('no memory warning', (await page.locator('text=Память браузера').count()) === 0);
  ok('storage flag ok', (await page.evaluate(() => document.body.innerText.indexOf('Память браузера') < 0)));
  await browser.close();
  // 3. пустое устройство с меткой облака: метка сбрасывается, чтобы всё подтянулось из облака
  const b2 = await chromium.launch(); const p2 = await (await b2.newContext()).newPage();
  await p2.route(/^https?:/, r => r.abort());
  await p2.addInitScript(() => { localStorage.setItem('kc.test.meta', JSON.stringify({ lastPull: '2026-11-01T10:00:00.000Z' })); });
  await p2.goto(FILE); await p2.waitForFunction(() => window.KCApp);
  ok('empty device resets lastPull', (await p2.evaluate(() => KCApp.S.meta.lastPull)) === '');
  await b2.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
