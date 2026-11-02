// Режим администратора и блок «Финансовый анализ проектов». Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route(/^https?:/, r => r.abort());
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const ready = () => page.waitForFunction(() => window.KCApp);
  const has = async (sel) => (await page.locator(sel).count()) > 0;
  await page.goto(FILE); await ready();

  // ---- 1. режим администратора: по умолчанию служебное скрыто ----
  await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="data"]');
  ok('admin off by default: switch is off', (await page.locator('button[data-act="adminToggle"]').getAttribute('aria-checked')) === 'false');
  for (const sel of ['button[data-act="datefix"]', '#restorefile', '#summaryfile', 'button[data-act="resetTest"]', 'button[data-act="switchmode"]'])
    ok('hidden without admin: ' + sel, !(await has(sel)));
  ok('backup buttons stay visible', (await has('button[data-act="backup"]')) && (await has('button[data-act="backupxlsx"]')));
  await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="statements"]');
  for (const sel of ['#stm-url', 'button[data-act="stmdiag"]', 'button[data-act="teststm"]', 'button[data-act="stmurlclear"]'])
    ok('statements hidden without admin: ' + sel, !(await has(sel)));
  ok('sync button visible without admin', await has('button[data-act="stmsync"]'));
  ok('hint about admin mode when no script url', (await page.locator('text=режиме администратора').count()) > 0);
  // ---- включаем ----
  await page.click('.nav button[data-v="settings"]');
  await page.click('button[data-act="adminToggle"]');
  await page.click('button[data-act="stab"][data-v="data"]');
  ok('admin on: switch is on', (await page.locator('button[data-act="adminToggle"]').getAttribute('aria-checked')) === 'true');
  for (const sel of ['button[data-act="datefix"]', '#restorefile', '#summaryfile', 'button[data-act="resetTest"]'])
    ok('visible with admin: ' + sel, await has(sel));
  await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="statements"]');
  ok('statements admin: url field visible', await has('#stm-url'));
  // ---- сбрасывается при перезапуске ----
  await page.waitForTimeout(150); await page.reload(); await ready();
  await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="data"]');
  ok('admin resets after restart', (await page.locator('button[data-act="adminToggle"]').getAttribute('aria-checked')) === 'false' && !(await has('button[data-act="datefix"]')));

  // ---- список статей и журнал свёрнуты, раскрываются по нажатию ----
  await page.evaluate(() => { KCApp.commit({}, 'create', 'Проверка журнала'); });
  await page.click('.nav button[data-v="settings"]');
  await page.click('button[data-act="stab"][data-v="articles"]');
  ok('articles list collapsed by default', (await has('button[data-act="artListToggle"]')) && (await page.locator('.list button[data-act="art-open"]').count()) === 0);
  ok('articles header and add button stay visible', (await page.locator('text=Справочник статей').count()) > 0);
  await page.click('button[data-act="artListToggle"]');
  ok('articles list expands on demand', (await page.locator('.list button[data-act="art-open"]').count()) > 0 && (await page.locator('button[data-act="artListToggle"]').innerText()).trim() === 'Свернуть');
  await page.click('button[data-act="artListToggle"]');
  ok('articles list collapses again', (await page.locator('.list button[data-act="art-open"]').count()) === 0);
  await page.click('button[data-act="stab"][data-v="data"]');
  ok('journal collapsed by default', (await has('button[data-act="logToggle"]')) && (await page.locator('table.tb').count()) === 0);
  await page.click('button[data-act="logToggle"]');
  ok('journal expands on demand', (await page.locator('table.tb tr').count()) >= 1);
  await page.click('button[data-act="logToggle"]');
  ok('journal collapses again', (await page.locator('table.tb').count()) === 0);
  await page.click('button[data-act="logToggle"]'); await page.click('.nav button[data-v="ops"]'); await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="data"]');
  ok('collapsed again after re-entering settings', (await page.locator('table.tb').count()) === 0);

  // ---- 2. финансовый анализ закрытых проектов ----
  const t = await page.evaluate(() => KC.today());
  const ranges = await page.evaluate(() => ({ m: KC.periodRange('month'), pm: KC.periodRange('prevmonth'), y: KC.periodRange('year'), py: KC.periodRange('prevyear') }));
  const isoAt = (d) => d + 'T12:00:00.000Z';
  await page.evaluate(({ ranges, t, isoAtStr }) => {
    const at = (d) => d + 'T12:00:00.000Z';
    const res = (income, variable, fixed) => ({ income, variable, fixedAllocated: fixed, net: income - variable - fixed });
    const P = KCApp.S.meta.projects;
    P['Закрыт в этом месяце'] = { status: 'done', doneAt: at(ranges.m.from.slice(0, 8) + '10'), updatedAt: at(t), result: res(10000000, 4000000, 1000000) };
    P['Закрыт в прошлом месяце'] = { status: 'done', doneAt: at(ranges.pm.from.slice(0, 8) + '15'), updatedAt: at(t), result: res(5000000, 3000000, 500000) };
    P['Закрыт в прошлом году'] = { status: 'done', doneAt: at(ranges.py.from.slice(0, 4) + '-06-20'), updatedAt: at(t), result: res(2000000, 2500000, 100000) };
    P['Возвращён в работу'] = { status: 'work', updatedAt: at(t) };
    const mk = (project, amount) => KC.newRecord({ wallet: 'alfa', amount, date: t, project, article: 'Продажа мебели', source: 'import', extId: 'e' + project + amount });
    KCApp.commit({ newRecords: [mk('Вечный проект', 99900000000), mk('Возвращён в работу', 100), mk('Закрыт в этом месяце', 100)] });
  }, { ranges, t, isoAtStr: '' });
  await page.click('.nav button[data-v="projects"]');
  ok('analysis collapsed by default', (await page.locator('button[data-act="anToggle"]').innerText()).trim() === 'Развернуть' && !(await has('button[data-act="anper"]')));
  ok('no old three-box totals visible', (await page.locator('text=Доля постоянных расходов не учтена').count()) === 0);
  await page.click('button[data-act="anToggle"]');
  ok('expanded shows period chips', (await page.locator('button[data-act="anper"]').count()) === 6);
  const block = async () => (await page.locator('.glass', { hasText: 'Финансовый анализ проектов' }).first().innerText()).replace(/ /g, ' ');
  // год по умолчанию: закрыты в этом году: «в этом месяце» (+ «в прошлом месяце», если он в том же году)
  const sameYear = ranges.pm.from.slice(0, 4) === ranges.y.from.slice(0, 4);
  let b = await block();
  ok('default period is this year, counts closed in year', new RegExp('Закрытых проектов за период: ' + (sameYear ? 2 : 1)).test(b), b);
  ok('open projects not counted', /В работе \(в расчёт не входят\): 2/.test(b) && b.indexOf('Вечный проект') < 0, b);
  await page.click('button[data-act="anper"][data-v="month"]'); b = await block();
  ok('this month: one project, sums', /Закрытых проектов за период: 1/.test(b) && /Приход\s*100 000 ₽/.test(b) && /Прибыль\s*50 000 ₽/.test(b) && /прямые 40 000 ₽, доля постоянных 10 000 ₽/.test(b), b);
  await page.click('button[data-act="anper"][data-v="prevmonth"]'); b = await block();
  ok('previous month: other project only', /Закрытых проектов за период: 1/.test(b) && b.indexOf('Закрыт в прошлом месяце') >= 0 && b.indexOf('Закрыт в этом месяце') < 0, b);
  await page.click('button[data-act="anper"][data-v="prevyear"]'); b = await block();
  ok('previous year: loss project', /Закрытых проектов за период: 1/.test(b) && b.indexOf('Закрыт в прошлом году') >= 0 && /Прибыль\s*[−-]6 000 ₽/.test(b), b);
  await page.click('button[data-act="anper"][data-v="all"]'); b = await block();
  ok('all time: three closed, reopened one excluded', /Закрытых проектов за период: 3/.test(b) && b.indexOf('Возвращён в работу') < 0, b);
  await page.click('button[data-act="anper"][data-v="custom"]');
  await page.fill('#an-from', ranges.m.from); await page.fill('#an-to', ranges.m.to); await page.waitForTimeout(200);
  b = await block();
  ok('custom period works', /Закрытых проектов за период: 1/.test(b) && b.indexOf('Закрыт в этом месяце') >= 0, b);
  ok('no horizontal overflow with huge numbers', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // сворачивается и снова свёрнут при входе на экран
  await page.click('button[data-act="anToggle"]');
  ok('collapse works', (await page.locator('button[data-act="anToggle"]').innerText()).trim() === 'Развернуть' && !(await has('button[data-act="anper"]')));
  await page.click('button[data-act="anToggle"]');
  await page.click('.nav button[data-v="ops"]'); await page.click('.nav button[data-v="projects"]');
  ok('collapsed again after re-entering projects', (await page.locator('button[data-act="anToggle"]').innerText()).trim() === 'Развернуть');
  ok('project list still shows all projects incl. open', (await page.locator('#projlist', { hasText: 'Вечный проект' }).count()) === 1);
  ok('no js errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
