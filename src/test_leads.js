// CRM: вкладка «Лиды» (воронка, долгострой, не прошли, создание проекта из лида). Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
const leadBy = (page, name) => page.evaluate((n) => { const l = Object.values(KCApp.S.meta.leads).find(x => x.name === n); return l ? JSON.parse(JSON.stringify(l)) : null; }, name);
const inZone = (page, stage, name) => page.locator('.kst[data-lstage="' + stage + '"] .kcard:has-text("' + name + '")').count();
async function createLead(page, name, phone, source) {
  await page.click('button[data-act="ld-new"]');
  if (name !== null) await page.fill('#lp-name', name);
  if (phone) await page.fill('#lp-phone', phone);
  if (source) await page.fill('#lp-source', source);
  await page.click('button[data-act="ld-new-save"]');
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/^https?:/, r => r.abort());
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(FILE); await page.waitForFunction(() => window.KCApp);

  // меню и пустое состояние
  ok('nav has five tabs including Лиды', (await page.locator('.nav button').count()) === 5 && (await page.locator('.nav button[data-v="leads"]').innerText()).trim() === 'Лиды');
  await page.click('.nav button[data-v="leads"]');
  ok('funnel has four stage zones', (await page.locator('#kb .kst[data-lstage]').count()) === 4);
  ok('funnel stage names', (await page.locator('#kb .kcol .kch b').allInnerTexts()).join('|') === 'Новая заявка|Прогрев на встречу|Встреча назначена|После встречи');
  ok('three view chips with counters', (await page.locator('button[data-act="ld-mode"]').allInnerTexts()).map(x => x.trim()).join('|') === 'Воронка · 0|Долгострой · 0|Не прошли · 0');

  // создание заявки
  await page.click('button[data-act="ld-new"]');
  ok('new form opens', (await page.locator('#lcard #lp-name').count()) === 1);
  await page.click('button[data-act="ld-new-save"]');
  ok('empty name is refused', (await page.locator('#lcard #lp-name').count()) === 1 && Object.keys(await page.evaluate(() => KCApp.S.meta.leads)).length === 0);
  await page.fill('#lp-name', 'Кухня Соколова'); await page.fill('#lp-phone', '+7 900 111-22-33'); await page.fill('#lp-source', 'Сайт');
  await page.click('button[data-act="ld-new-save"]');
  ok('lead created and its card opens', (await page.locator('#lcard >> text=Стадия: Новая заявка').count()) === 1 && (await page.locator('#lcard .pill:has-text("лид")').count()) === 1);
  const l0 = await leadBy(page, 'Кухня Соколова');
  ok('lead stored with fields and history', l0 && l0.status === 'lead' && l0.stage === 1 && l0.f.phone === '+7 900 111-22-33' && l0.f.source === 'Сайт' && l0.hist.length === 1, l0);
  ok('card has all bitrix talk fields', (await page.locator('#lcard #lf-urgency, #lcard #lf-features, #lcard #lf-important, #lcard #lf-size, #lcard #lf-materials, #lcard #lf-priceFrom, #lcard #lf-priceTo, #lcard #lf-budget, #lcard #lf-ready').count()) === 9);
  ok('log has the creation', await page.evaluate(() => KCApp.S.log.some(l => l.action === 'lead' && /Новая заявка «Кухня Соколова»/.test(l.summary))));

  // стадии и обязательные поля
  await page.click('#lcard button[data-act="ld-next"]');
  ok('stage 1 -> 2 passes (phone and source filled)', (await leadBy(page, 'Кухня Соколова')).stage === 2);
  await page.click('#lcard button[data-act="ld-next"]');
  ok('stage 2 -> 3 blocked without next contact date', (await leadBy(page, 'Кухня Соколова')).stage === 2 && (await page.locator('#lcard input.bad#lf-next').count()) === 1 && /Дата следующего контакта/.test(await page.locator('#lcard .banner[role="alert"]').innerText()));
  await page.fill('#lf-next', '2026-10-30');
  ok('highlight clears when filled', (await page.locator('#lcard input.bad').count()) === 0);
  await page.click('#lcard button[data-act="ld-next"]');
  ok('stage 2 -> 3 passes', (await leadBy(page, 'Кухня Соколова')).stage === 3);
  await page.click('#lcard button[data-act="ld-close"]');
  ok('board shows the card in the right zone', (await inZone(page, 3, 'Кухня Соколова')) === 1 && (await inZone(page, 1, 'Кухня Соколова')) === 0);
  const tile = (await page.locator('.kcard:has-text("Кухня Соколова")').innerText()).replace(/ /g, ' ');
  ok('tile shows phone, source and late contact', /\+7 900 111-22-33/.test(tile) && /Источник: Сайт/.test(tile) && /просрочен/.test(tile), tile);
  ok('counter in chip', /Воронка · 1/.test(await page.locator('button[data-act="ld-mode"][data-v="funnel"]').innerText()));

  // перетаскивание мышью
  ok('lead cards are draggable with a mouse', (await page.locator('.kcard[data-lead][draggable="true"]').count()) === 1);
  await page.locator('.kcard[data-lead]').dragTo(page.locator('.kst[data-lstage="4"]'));
  ok('drag forward blocked without address', (await leadBy(page, 'Кухня Соколова')).stage === 3 && (await page.locator('#lcard input.bad#lf-address').count()) === 1);
  await page.fill('#lf-address', 'Краснодар, ул. Красная, 1'); await page.click('#lcard button[data-act="ld-close"]');
  await page.locator('.kcard[data-lead]').dragTo(page.locator('.kst[data-lstage="4"]'));
  ok('drag forward works when filled', (await leadBy(page, 'Кухня Соколова')).stage === 4 && (await inZone(page, 4, 'Кухня Соколова')) === 1);
  await page.locator('.kcard[data-lead]').dragTo(page.locator('.kst[data-lstage="2"]'));
  ok('drag back is allowed', (await leadBy(page, 'Кухня Соколова')).stage === 2);
  await page.locator('.kcard[data-lead]').dragTo(page.locator('.kst[data-lstage="4"]'));
  ok('drag over several stages works when all filled', (await leadBy(page, 'Кухня Соколова')).stage === 4);

  // нельзя бросить лид в зону проектов и наоборот — зоны разные
  ok('lead zones differ from project zones', (await page.locator('.kst[data-stage]').count()) === 0);

  // создание проекта: сначала без обязательных полей
  await page.locator('.kcard[data-lead]').click();
  await page.click('#lcard button[data-act="ld-panel"][data-v="win"]');
  ok('win panel proposes the lead name', (await page.inputValue('#lp-pname')) === 'Кухня Соколова');
  await page.click('#lcard button[data-act="ld-win-do"]');
  const e1 = (await page.locator('#lcard .banner[role="alert"]').innerText());
  ok('win blocked: result and price from are required', /Итог встречи/.test(e1) && /Наша цена от/.test(e1) && (await page.locator('#lcard input.bad').count()) === 2, e1);
  await page.click('#lcard button[data-act="ld-panel-cancel"]');
  await page.fill('#lf-result', 'Договор на этой неделе'); await page.fill('#lf-priceFrom', '420000'); await page.fill('#lf-priceTo', '480000'); await page.fill('#lf-budget', '500000');
  // занятое имя
  await page.evaluate(() => { KCApp.S.meta.projects['Занятое имя'] = { status: 'work', updatedAt: new Date().toISOString() }; });
  await page.click('#lcard button[data-act="ld-panel"][data-v="win"]');
  await page.fill('#lp-pname', 'Занятое имя'); await page.click('#lcard button[data-act="ld-win-do"]');
  ok('win blocked: project name is taken', /уже есть/.test(await page.locator('#lcard .banner[role="alert"]').innerText()) && (await leadBy(page, 'Кухня Соколова')).status === 'lead');
  await page.fill('#lp-pname', 'Кухня Соколова'); await page.click('#lcard button[data-act="ld-win-do"]');
  const won = await leadBy(page, 'Кухня Соколова');
  const proj = await page.evaluate(() => JSON.parse(JSON.stringify(KCApp.S.meta.projects['Кухня Соколова'] || null)));
  ok('lead marked won and linked to the project', won.status === 'won' && won.projectKey === 'Кухня Соколова', won);
  ok('project created on the first stage with data from the lead', proj && proj.status === 'work' && proj.stage === 5 && proj.f.phone === '+7 900 111-22-33' && proj.f.address === 'Краснодар, ул. Красная, 1' && proj.lead.f.budget === '500000' && proj.hist.length >= 3, proj);
  ok('card now shows the project link', (await page.locator('#lcard >> text=Стала проектом «Кухня Соколова»').count()) === 1 && (await page.locator('#lcard .pill:has-text("проект")').count()) === 1);
  await page.click('#lcard button[data-act="ld-close"]');
  ok('won lead leaves the funnel', (await page.locator('.kcard[data-lead]').count()) === 0 && /Заявок, ставших проектами: 1/.test(await page.locator('#main').innerText()));
  await page.locator('button[data-act="ld-mode"][data-v="later"]').click();
  ok('won lead is not in later list either', (await page.locator('#leadlist .op').count()) === 0);
  await page.click('button[data-act="ld-mode"][data-v="funnel"]');
  // проект виден на доске проектов
  await page.click('.nav button[data-v="projects"]');
  ok('project appears on the projects board, first stage', (await page.locator('.kst[data-stage="5"] .kcard[data-key="Кухня Соколова"]').count()) === 1);
  await page.click('.nav button[data-v="leads"]');
  // открыть проект из карточки лида
  await page.click('button[data-act="ld-mode"][data-v="funnel"]');
  // долгострой
  await createLead(page, 'Шкаф Белова', '+7 900 000-00-02', 'Авито');
  await page.click('#lcard button[data-act="ld-panel"][data-v="later"]');
  ok('later panel lists the four Bitrix stages', (await page.locator('#lp-later option').allInnerTexts()).join('|') === 'Перезвонить позже|1й перезвон|2й перезвон|3й перезвон');
  await page.selectOption('#lp-later', '2'); await page.fill('#lp-ndate', '2026-12-15');
  await page.click('#lcard button[data-act="ld-later-do"]');
  const lt = await leadBy(page, 'Шкаф Белова');
  ok('moved to later with stage and date', lt.status === 'later' && lt.later === 2 && lt.f.next === '2026-12-15', lt);
  ok('card shows later info and return button', (await page.locator('#lcard .bold:has-text("Долгострой: 2й перезвон")').count()) === 1 && (await page.locator('#lcard button[data-act="ld-back"]').count()) === 1);
  await page.click('#lcard button[data-act="ld-close"]');
  ok('later chip counts it', /Долгострой · 1/.test(await page.locator('button[data-act="ld-mode"][data-v="later"]').innerText()));
  await page.click('button[data-act="ld-mode"][data-v="later"]');
  ok('later list shows the lead with stage and date', /2й перезвон/.test(await page.locator('#leadlist .op').innerText()) && /15\.12|15 дек/.test(await page.locator('#leadlist .op').innerText()));
  await page.locator('#leadlist .op').click(); await page.click('#lcard button[data-act="ld-back"]');
  ok('return to funnel', (await leadBy(page, 'Шкаф Белова')).status === 'lead' && (await leadBy(page, 'Шкаф Белова')).stage === 1);
  await page.click('#lcard button[data-act="ld-close"]');
  // не прошли
  await page.click('button[data-act="ld-mode"][data-v="funnel"]');
  await page.locator('.kcard[data-lead]').click();
  await page.click('#lcard button[data-act="ld-panel"][data-v="lost"]');
  ok('lost panel lists the seven reasons', (await page.locator('#lp-reason option').count()) === 7);
  await page.selectOption('#lp-reason', 'Цена'); await page.click('#lcard button[data-act="ld-lost-do"]');
  const lost = await leadBy(page, 'Шкаф Белова');
  ok('lead lost with reason', lost.status === 'lost' && lost.reason === 'Цена' && lost.hist[0].t === 'Не прошёл: Цена', lost);
  await page.click('#lcard button[data-act="ld-close"]');
  await page.click('button[data-act="ld-mode"][data-v="lost"]');
  ok('lost list shows the reason', (await page.locator('#leadlist .op .pill:has-text("Цена")').count()) === 1);
  ok('lost chip counts it', /Не прошли · 1/.test(await page.locator('button[data-act="ld-mode"][data-v="lost"]').innerText()));

  // поиск
  await page.click('button[data-act="ld-mode"][data-v="funnel"]');
  await createLead(page, 'Гардероб Зайцева', '+7 911 555-66-77', 'Звонок'); await page.click('#lcard button[data-act="ld-close"]');
  await createLead(page, 'Тумба Крылова', '', ''); await page.click('#lcard button[data-act="ld-close"]');
  ok('two cards in funnel', (await page.locator('.kcard[data-lead]').count()) === 2);
  await page.fill('#lq', 'зайц');
  ok('search by name', (await page.locator('.kcard[data-lead]').count()) === 1);
  await page.fill('#lq', '555-66');
  ok('search by phone', (await page.locator('.kcard[data-lead]').count()) === 1);
  await page.fill('#lq', '');
  ok('search cleared', (await page.locator('.kcard[data-lead]').count()) === 2);
  const noContact = (await page.locator('.kcard:has-text("Тумба Крылова")').innerText());
  ok('card without contact date is flagged', /Нет даты контакта/.test(noContact));

  // сохранение и копия
  await page.click('.kcard:has-text("Гардероб Зайцева")'); await page.click('#lf-phone'); await page.keyboard.type('0');
  ok('typing keeps focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'lf-phone'));
  await page.click('#lcard button[data-act="ld-close"]');
  ok('typed value saved on close', (await leadBy(page, 'Гардероб Зайцева')).f.phone === '+7 911 555-66-770');
  const bk = await page.evaluate(() => JSON.parse(JSON.stringify(KC.backupObject({ records: KCApp.S.records, log: KCApp.S.log, decisions: KCApp.S.decisions, meta: { ignoredKeys: [], statements: [], projects: KCApp.S.meta.projects, leads: KCApp.S.meta.leads, articles: [] }, namespace: 'test' }))));
  ok('backup contains all leads with statuses', Object.keys(bk.meta.leads).length === 4 && Object.values(bk.meta.leads).map(l => l.status).sort().join() === 'lead,lead,lost,won' && bk.version === 2);
  ok('backup contains the project made from a lead', bk.meta.projects['Кухня Соколова'].lead.name === 'Кухня Соколова');
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.KCApp);
  await page.click('.nav button[data-v="leads"]');
  ok('leads survive reload', (await page.locator('.kcard[data-lead]').count()) === 2 && /Не прошли · 1/.test(await page.locator('button[data-act="ld-mode"][data-v="lost"]').innerText()));

  // открыть проект из выигранного лида
  await page.evaluate(() => { const l = Object.values(KCApp.S.meta.leads).find(x => x.status === 'won'); KCApp.S.lcard = { id: l.id, missing: [], panel: '' }; KCApp.render(); });
  await page.click('#lcard button[data-act="ld-openproject"]');
  ok('open project from won lead', (await page.locator('#pcard .sheet').count()) === 1 && (await page.locator('#pcard >> text=Создан из лида').count()) >= 1 && (await page.evaluate(() => KCApp.S.view)) === 'projects');
  await ctx.close();

  // ================= телефон =================
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.route(/^https?:/, r => r.abort());
  mp.on('pageerror', e => errors.push(String(e)));
  await mp.goto(FILE); await mp.waitForFunction(() => window.KCApp);
  ok('phone: five nav buttons fit', await mp.evaluate(() => { const n = [...document.querySelectorAll('.nav button')]; return n.length === 5 && n.every(b => b.getBoundingClientRect().width >= 56) && document.documentElement.scrollWidth <= window.innerWidth + 1; }));
  await mp.click('.nav button[data-v="leads"]');
  await createLead(mp, 'Кухня Попова', '+7 900 000-00-09', 'Сайт');
  await mp.click('#lcard button[data-act="ld-close"]');
  ok('phone: card is not draggable', (await mp.locator('.kcard[data-lead]').count()) === 1 && (await mp.locator('.kcard[draggable]').count()) === 0);
  ok('phone: funnel scrolls sideways', await mp.evaluate(() => { const k = document.getElementById('kb'); return k.scrollWidth > k.clientWidth && getComputedStyle(k).overflowX === 'auto'; }));
  ok('phone: hint says stages change in the card', /кнопками в карточке/.test(await mp.locator('#leadlist').innerText()));
  await mp.locator('.kcard[data-lead]').click(); await mp.click('#lcard button[data-act="ld-next"]');
  ok('phone: next works', (await leadBy(mp, 'Кухня Попова')).stage === 2);
  await mctx.close();

  ok('no js errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
