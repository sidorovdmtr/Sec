// CRM: канбан проектов (доска, карточка со стадиями, обязательные поля, перетаскивание мышью, телефон). Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }

async function seed(page) {
  await page.evaluate(() => {
    const mk = (project, amount, kind) => KC.newRecord({ kind: kind || 'income', wallet: 'alfa', amount, date: '2026-10-05', project, article: 'Оказание услуг' });
    KCApp.commit({ newRecords: [mk('Кухня Альфа', 1000000), mk('Кухня Альфа', -300000, 'expense'), mk('Шкаф Бета', 500000)] }, 'create', 'CRM seed');
  });
}
const stageOf = (page, name) => page.evaluate((n) => KC.crmStage(KCApp.S.meta.projects[n]), name);
const inStage = (page, stage, name) => page.locator('.kst[data-stage="' + stage + '"] .kcard[data-key="' + name + '"]').count();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // ================= компьютер: мышь =================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/^https?:/, r => r.abort());
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(FILE); await page.waitForFunction(() => window.KCApp);
  await seed(page);
  await page.click('.nav button[data-v="projects"]');

  ok('board is the default view', (await page.locator('#kb').count()) === 1 && (await page.locator('button[data-act="projmode"][data-v="board"].on').count()) === 1);
  ok('four group columns', (await page.locator('#kb .kcol').count()) === 4);
  ok('fifteen stage zones', (await page.locator('#kb .kst').count()) === 15);
  ok('existing projects start on the first stage', (await inStage(page, 5, 'Кухня Альфа')) === 1 && (await inStage(page, 5, 'Шкаф Бета')) === 1);
  const tile = (await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()).replace(/ /g, ' ');
  ok('tile shows money from operations', /приход/.test(tile) && /10 000/.test(tile) && /расход/.test(tile), tile);
  ok('tile says dates are not set', /Сроки не указаны/.test(tile));
  ok('no-project is not a card', (await page.locator('.kcard[data-key=""]').count()) === 0);
  ok('cards are draggable with a mouse', (await page.locator('.kcard[draggable="true"]').count()) === 2);

  // поиск
  await page.fill('#pq', 'шкаф');
  ok('search filters board', (await page.locator('.kcard').count()) === 1 && (await inStage(page, 5, 'Шкаф Бета')) === 1);
  await page.fill('#pq', '');
  ok('search cleared', (await page.locator('.kcard').count()) === 2);

  // карточка и проверка обязательных полей
  await page.locator('.kcard[data-key="Кухня Альфа"]').click();
  ok('card opens with stage block', (await page.locator('#pcard >> text=Стадия: Договор и предоплата').count()) === 1);
  ok('next button names the next stage', (await page.locator('#pcard button[data-act="pc-crm-next"]').innerText()).trim() === 'Замер →');
  ok('no back button on the first stage', (await page.locator('#pcard button[data-act="pc-crm-prev"]').count()) === 0);
  ok('required fields are marked', (await page.locator('#pcard >> text=нужно для перехода').count()) === 3);
  ok('card still has the finance blocks', (await page.locator('#pcard >> text=Финансовый результат без постоянных расходов').count()) === 1);
  await page.click('#pcard button[data-act="pc-crm-next"]');
  ok('blocked: stage unchanged', (await stageOf(page, 'Кухня Альфа')) === 5);
  const warn = (await page.locator('#pcard .banner[role="alert"]').innerText()).replace(/ /g, ' ');
  ok('blocked: message names missing fields', /Номер договора/.test(warn) && /Сумма договора/.test(warn) && /Дата предоплаты/.test(warn), warn);
  ok('blocked: fields highlighted', (await page.locator('#pcard input.bad').count()) === 3);
  await page.fill('#cf-contractNo', 'ДГ-0311');
  ok('highlight clears when a field is filled', (await page.locator('#pcard input.bad').count()) === 2);
  await page.fill('#cf-sum', '438000'); await page.fill('#cf-prepay', '2026-10-12');
  await page.fill('#cf-start', '2026-10-12'); await page.fill('#cf-due', '2026-12-04'); await page.fill('#cf-next', '2026-10-30');
  await page.click('#pcard button[data-act="pc-crm-next"]');
  ok('moves forward when fields are filled', (await stageOf(page, 'Кухня Альфа')) === 6);
  ok('card now shows the new stage', (await page.locator('#pcard >> text=Стадия: Замер').count()) === 1);
  ok('history records the move', (await page.locator('#pcard >> text=Стадия: Договор и предоплата → Замер').count()) === 1);
  ok('back button appears', (await page.locator('#pcard button[data-act="pc-crm-prev"]').innerText()).includes('Договор и предоплата'));
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(KCApp.S.meta.projects['Кухня Альфа'])));
  ok('fields stored in project meta', saved.f.contractNo === 'ДГ-0311' && saved.f.sum === '438000' && saved.stage === 6 && saved.status === 'work' && !!saved.updatedAt, saved);
  ok('log has the stage change', await page.evaluate(() => KCApp.S.log.some(l => l.action === 'project' && /Договор и предоплата.*Замер/.test(l.summary))));
  await page.click('#pcard button[data-act="pc-close"]');
  ok('board shows the card on the new stage', (await inStage(page, 6, 'Кухня Альфа')) === 1 && (await inStage(page, 5, 'Кухня Альфа')) === 0);
  const tile2 = (await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()).replace(/ /g, ' ');
  ok('tile shows dates, contract and contact', /раб\. дн\./.test(tile2) && /договор 438 000/.test(tile2) && /Контакт/.test(tile2) && /просрочен/.test(tile2), tile2);

  // перетаскивание мышью
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="7"]'));
  ok('drag forward blocked without measure date', (await stageOf(page, 'Кухня Альфа')) === 6 && (await page.locator('#pcard >> text=Дата замера').count()) >= 1);
  ok('drag blocked opens card with highlight', (await page.locator('#pcard input.bad#cf-measure').count()) === 1);
  await page.fill('#cf-measure', '2026-10-20');
  await page.click('#pcard button[data-act="pc-close"]');
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="7"]'));
  ok('drag forward works when filled', (await stageOf(page, 'Кухня Альфа')) === 7 && (await inStage(page, 7, 'Кухня Альфа')) === 1);
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="5"]'));
  ok('drag back is allowed without checks', (await stageOf(page, 'Кухня Альфа')) === 5 && (await inStage(page, 5, 'Кухня Альфа')) === 1);
  // через несколько стадий вперёд: проверяются поля всех пройденных
  await page.locator('.kcard[data-key="Шкаф Бета"]').dragTo(page.locator('.kst[data-stage="10"]'));
  ok('multi-stage jump is blocked by missing fields', (await stageOf(page, 'Шкаф Бета')) === 5);
  const warn2 = (await page.locator('#pcard .banner[role="alert"]').innerText()).replace(/ /g, ' ');
  ok('multi-stage jump lists all missing fields', /Номер договора/.test(warn2) && /Дата замера/.test(warn2) && /Техзадание/.test(warn2) && /Смета/.test(warn2), warn2);
  // перенос без проверки (для прежних проектов)
  await page.click('#pcard button[data-act="pc-crm-force"]');
  ok('force moves one stage without checks', (await stageOf(page, 'Шкаф Бета')) === 6);
  ok('force is written in history', (await page.locator('#pcard >> text=без проверки полей').count()) >= 1);
  await page.click('#pcard button[data-act="pc-close"]');

  // закрытие и возврат в работу не теряют поля CRM
  await page.locator('.kcard[data-key="Кухня Альфа"]').click();
  await page.click('#pcard button[data-act="pc-done"]'); await page.click('#pcard button[data-act="pc-useperiod"]');
  await page.click('#pcard button[data-act="pc-calc2"]'); await page.click('#pcard button[data-act="pc-save"]');
  const closed = await page.evaluate(() => JSON.parse(JSON.stringify(KCApp.S.meta.projects['Кухня Альфа'])));
  ok('closing keeps CRM fields and sets last stage', closed.status === 'done' && closed.stage === 18 && closed.f.contractNo === 'ДГ-0311' && closed.hist.length >= 2 && !!closed.result, closed);
  await page.click('#pcard button[data-act="pc-close"]');
  ok('closed project stays on the board in the Сдано column', (await inStage(page, 18, 'Кухня Альфа')) === 1 && /закрыт/.test(await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()) && /чистая прибыль/.test(await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()));
  ok('board counts closed projects', /Закрытые проекты \(1\)/.test(await page.locator('#projlist').innerText()));
  await page.click('button[data-act="projmode"][data-v="list"]');
  ok('list view still shows closed project', (await page.locator('#projlist .op[data-p="Кухня Альфа"] .pill:has-text("завершён")').count()) === 1);
  await page.locator('#projlist .op[data-p="Кухня Альфа"]').click();
  await page.click('#pcard button[data-act="pc-reopen"]');
  const reopened = await page.evaluate(() => JSON.parse(JSON.stringify(KCApp.S.meta.projects['Кухня Альфа'])));
  ok('reopen keeps CRM fields, drops result', reopened.status === 'work' && reopened.f.sum === '438000' && reopened.stage === 18 && !reopened.result && !reopened.doneAt, reopened);
  await page.click('#pcard button[data-act="pc-close"]');
  await page.click('button[data-act="projmode"][data-v="board"]');
  ok('reopened project shows in the Сдано column', (await inStage(page, 18, 'Кухня Альфа')) === 1);

  // копия и восстановление
  const bk = await page.evaluate(() => KC.backupObject({ records: KCApp.S.records, log: KCApp.S.log, decisions: KCApp.S.decisions, meta: { ignoredKeys: [], statements: [], projects: KCApp.S.meta.projects, articles: [] }, namespace: 'test' }));
  const bkProj = JSON.parse(JSON.stringify(bk)).meta.projects;
  ok('backup contains CRM fields for both projects', bkProj['Кухня Альфа'].f.contractNo === 'ДГ-0311' && bkProj['Шкаф Бета'].stage === 6 && bkProj['Кухня Альфа'].hist.length >= 2);

  // сохраняется после перезапуска
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.KCApp);
  await page.click('.nav button[data-v="projects"]');
  ok('stages survive reload', (await inStage(page, 6, 'Шкаф Бета')) === 1 && (await inStage(page, 18, 'Кухня Альфа')) === 1);

  // быстрый ввод без перерисовки: набор текста не теряет фокус и сохраняется
  await page.locator('.kcard[data-key="Шкаф Бета"]').click();
  await page.click('#cf-phone'); await page.keyboard.type('+7 900 111-22-33');
  ok('typing keeps focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'cf-phone'));
  await page.click('#pcard button[data-act="pc-close"]');
  ok('typed value is saved on close', await page.evaluate(() => KCApp.S.meta.projects['Шкаф Бета'].f.phone === '+7 900 111-22-33'));
  await ctx.close();

  // ================= телефон: без перетаскивания =================
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.route(/^https?:/, r => r.abort());
  mp.on('pageerror', e => errors.push(String(e)));
  await mp.goto(FILE); await mp.waitForFunction(() => window.KCApp);
  await seed(mp);
  await mp.click('.nav button[data-v="projects"]');
  ok('phone: board is shown', (await mp.locator('#kb .kcol').count()) === 4);
  ok('phone: cards are not draggable', (await mp.locator('.kcard[draggable]').count()) === 0);
  ok('phone: board scrolls sideways', await mp.evaluate(() => { const k = document.getElementById('kb'); return k.scrollWidth > k.clientWidth && getComputedStyle(k).overflowX === 'auto'; }));
  ok('phone: no page overflow', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('phone: hint says stages change in the card', /кнопками в карточке/.test(await mp.locator('#projlist').innerText()));
  await mp.locator('.kcard[data-key="Шкаф Бета"]').click();
  await mp.click('#pcard button[data-act="pc-crm-next"]');
  ok('phone: next is blocked and highlights fields', (await mp.locator('#pcard input.bad').count()) === 3 && (await stageOf(mp, 'Шкаф Бета')) === 5);
  await mp.click('#pcard button[data-act="pc-crm-force"]');
  ok('phone: force works', (await stageOf(mp, 'Шкаф Бета')) === 6);
  await mctx.close();

  ok('no js errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
