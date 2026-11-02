// Нижнее меню (4 раздела) и вкладки настроек: «Выписки» теперь третья вкладка настроек. Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.route(/^https?:/, r => r.abort());
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(FILE); await page.waitForFunction(() => window.KCApp);
    const has = async (sel) => (await page.locator(sel).count()) > 0;

    const navs = (await page.locator('.nav button').allInnerTexts()).map(x => x.trim());
    ok(label + ': bottom nav has four sections', navs.join('|') === 'Операции|Проекты|Лиды|Настройки', navs);
    ok(label + ': no statements button in nav', !(await has('.nav button[data-v="statements"]')));
    ok(label + ': nav fits the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.nav button')].every(b => b.getBoundingClientRect().width >= 56)));

    await page.click('.nav button[data-v="settings"]');
    ok(label + ': settings title stays', (await page.locator('.h2').first().innerText()).trim() === 'Настройки');
    const tabs = (await page.locator('button[data-act="stab"]').allInnerTexts()).map(x => x.trim());
    ok(label + ': settings has three tabs', tabs.join('|') === 'Статьи|Данные и копии|Выписки', tabs);
    ok(label + ': articles tab is default', (await page.locator('button[data-act="stab"][data-v="articles"].on').count()) === 1 && (await has('text=Справочник статей')));

    await page.click('button[data-act="stab"][data-v="statements"]');
    ok(label + ': statements tab marked active', (await page.locator('button[data-act="stab"][data-v="statements"].on').count()) === 1);
    ok(label + ': sync button is there', await has('button[data-act="stmsync"]'));
    ok(label + ': both wallet cards are there', (await has('text=Альфа')) && (await has('text=Промос')));
    ok(label + ': decisions block says all clear', (await has('text=Нужно ваше решение: 0')) && (await has('text=Всё сверено, решений нет')));
    ok(label + ': only one theme button on the page', (await page.locator('button[data-act="theme"]').count()) === 1);
    ok(label + ': admin card still at the bottom', await has('button[data-act="adminToggle"]'));
    ok(label + ': no badge without open decisions', !(await has('.nav .badge')) && (await page.locator('button[data-act="stab"][data-v="statements"]').innerText()).trim() === 'Выписки');

    await page.click('button[data-act="stab"][data-v="data"]');
    ok(label + ': data tab still works', (await has('button[data-act="backup"]')) && (await has('button[data-act="backupxlsx"]')));
    await page.click('button[data-act="stab"][data-v="statements"]');

    // нерешённые вопросы по выпискам видны и под капотом настроек
    await page.evaluate(() => KCApp.setAdmin(true));
    await page.evaluate(() => { KCApp.commit({ newRecords: KC.sampleRecords() }, 'create', 'пример'); KCApp.render(); });
    await page.click('button[data-act="teststm"][data-w="alfa"]');
    const open = await page.evaluate(() => KCApp.S.decisions.filter(d => !d.resolvedAt).length);
    ok(label + ': test statement leaves open decisions', open >= 1, open);
    ok(label + ': badge on Settings shows the count', (await page.locator('.nav button[data-v="settings"] .badge').innerText()).trim() === String(open));
    ok(label + ': badge is readable for assistive tech', /Нужно решение по выпискам/.test(await page.locator('.nav button[data-v="settings"] .badge').getAttribute('aria-label')));
    ok(label + ': statements tab shows the count', (await page.locator('button[data-act="stab"][data-v="statements"]').innerText()).trim() === 'Выписки · ' + open);
    ok(label + ': decision cards are inside the tab', (await page.locator('.dec').count()) === open);
    await page.click('.nav button[data-v="ops"]');
    ok(label + ': badge stays on other screens', (await page.locator('.nav button[data-v="settings"] .badge').count()) === 1);
    await page.click('.nav button[data-v="settings"]');
    ok(label + ': settings reopens on the last tab', (await page.locator('button[data-act="stab"][data-v="statements"].on').count()) === 1);
    while ((await page.locator('.dec button[data-act="resolve"]').count()) > 0) { await page.locator('.dec button[data-act="resolve"]').first().click(); }
    ok(label + ': badge disappears when all resolved', (await page.evaluate(() => KCApp.S.decisions.filter(d => !d.resolvedAt).length)) === 0 && (await page.locator('.nav .badge').count()) === 0);
    await ctx.close();
  }
  ok('no js errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
