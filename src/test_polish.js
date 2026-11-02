// CRM: доделки (дата сдачи считается, автозакрытие в «Сдано», «Рекламации», единая карточка проекта). Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
const stageOf = (page, name) => page.evaluate((n) => KC.crmStage(KCApp.S.meta.projects[n]), name);
const pmOf = (page, name) => page.evaluate((n) => JSON.parse(JSON.stringify(KCApp.S.meta.projects[n] || null)), name);
const inStage = (page, stage, name) => page.locator('.kst[data-stage="' + stage + '"] .kcard[data-key="' + name + '"]').count();
const toastText = async (page) => ((await page.locator('#toast').innerText().catch(() => '')) || '').replace(/ /g, ' ');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/^https?:/, r => r.abort());
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(FILE); await page.waitForFunction(() => window.KCApp);
  await page.evaluate(() => {
    KCApp.S.meta.articles = KC.sampleCatalog();
    const mk = (project, amount, kind, article) => KC.newRecord({ kind: kind || 'income', wallet: 'alfa', amount, date: '2026-10-05', project, article: article || 'Оказание услуг' });
    KCApp.commit({ newRecords: [mk('Кухня Альфа', 1000000), mk('Кухня Альфа', -300000, 'expense', 'Закупка материала'), mk('Шкаф Бета', 500000), mk('Только расход', -50000, 'expense', 'Закупка материала')] }, 'create', 'seed');
  });
  await page.click('.nav button[data-v="projects"]');

  // ---------- рабочие дни: дата сдачи считается ----------
  await page.locator('.kcard[data-key="Шкаф Бета"]').click();
  const labels = (await page.locator('#pcard .cflabel > span').allInnerTexts()).join('|');
  ok('field labels: start of production, computed due, contract date', /Начало изготовления/.test(labels) && /Дата сдачи \(считается сама\)/.test(labels) && /Дата заключения договора/.test(labels), labels);
  ok('due is editable while no work days are given', (await page.locator('#cf-due:not([disabled])').count()) === 1);
  await page.fill('#cf-due', '2026-12-31');
  ok('manual due works without work days', (await pmOf(page, 'Шкаф Бета')).f.due === '2026-12-31' || (await page.inputValue('#cf-due')) === '2026-12-31');
  await page.fill('#cf-start', '2026-11-02'); await page.fill('#cf-workDays', '5');
  ok('due = start + 5 work days (09.11)', (await page.inputValue('#cf-due')) === '2026-11-09', await page.inputValue('#cf-due'));
  ok('due becomes read-only when computed', (await page.locator('#cf-due[disabled]').count()) === 1);
  await page.fill('#cf-workDays', '35');
  ok('35 work days from 02.11 -> 21.12 (weekends skipped)', (await page.inputValue('#cf-due')) === '2026-12-21', await page.inputValue('#cf-due'));
  await page.fill('#cf-start', '2026-11-06'); await page.fill('#cf-workDays', '1');
  ok('Friday + 1 work day -> Monday', (await page.inputValue('#cf-due')) === '2026-11-09', await page.inputValue('#cf-due'));
  await page.fill('#cf-start', '2026-11-07'); await page.fill('#cf-workDays', '1');
  ok('Saturday start + 1 work day -> Monday', (await page.inputValue('#cf-due')) === '2026-11-09', await page.inputValue('#cf-due'));
  await page.fill('#cf-workDays', '35');
  await page.click('#pcard button[data-act="pc-close"]');
  const pb = await pmOf(page, 'Шкаф Бета');
  ok('computed due is stored in the card (Saturday start, 35 work days -> Fri 25.12)', pb.f.due === '2026-12-25' && pb.f.start === '2026-11-07' && pb.f.workDays === '35', pb.f);
  ok('board tile uses the computed due', /раб\. дн\./.test(await page.locator('.kcard[data-key="Шкаф Бета"]').innerText()));
  await page.locator('.kcard[data-key="Шкаф Бета"]').click();
  await page.fill('#cf-workDays', 'abc');
  ok('garbage work days do not break the due date', (await page.inputValue('#cf-due')) === '2026-12-25' && (await page.locator('#cf-due:not([disabled])').count()) === 1);
  await page.fill('#cf-workDays', '35'); await page.click('#pcard button[data-act="pc-close"]');

  // ---------- «Рекламации» ----------
  ok('stage Рекламации is the last zone of the last group', (await page.locator('#kb .kcol').last().locator('.kst').last().locator('.ksh span').first().innerText()).trim() === 'Рекламации');
  ok('three stages in the last group', (await page.locator('#kb .kcol').last().locator('.kst').count()) === 3);

  // ---------- автозакрытие при переходе в «Сдано» ----------
  await page.evaluate(() => { const m = KCApp.S.meta.projects; m['Кухня Альфа'] = Object.assign({}, m['Кухня Альфа'] || { status: 'work' }, { stage: 17, updatedAt: new Date().toISOString() }); KCApp.render(); });
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="18"]'));
  const closed = await pmOf(page, 'Кухня Альфа');
  ok('moving to Сдано closes the project in Деньги', closed.status === 'done' && closed.stage === 18 && closed.result && typeof closed.result.net === 'number' && !!closed.doneAt, closed);
  ok('history records the closing', closed.hist[0].t.startsWith('Проект закрыт: чистая прибыль'), closed.hist.slice(0, 2));
  const t1 = await toastText(page);
  ok('toast says closed with the profit and offers undo', /проект закрыт, чистая прибыль/.test(t1) && (await page.locator('#toast button').count()) === 1, t1);
  ok('closed card sits in Сдано with profit', (await inStage(page, 18, 'Кухня Альфа')) === 1 && /чистая прибыль/.test(await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()));
  ok('closed project is in the financial analysis', await page.evaluate(() => { const r = KC.closedProjectsAnalysis(KCApp.S.meta.projects, '2000-01-01', '2100-01-01'); return r.list.some(x => x.project === 'Кухня Альфа'); }));
  await page.click('#toast button');
  const undone = await pmOf(page, 'Кухня Альфа');
  ok('undo reopens the project at the previous stage', undone.status === 'work' && undone.stage === 17 && !undone.result, undone);
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="18"]'));
  ok('closed again after undo', (await pmOf(page, 'Кухня Альфа')).status === 'done');
  // из «Сдано» в «Рекламации»: проект возвращается в работу
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="19"]'));
  const rec = await pmOf(page, 'Кухня Альфа');
  ok('Сдано -> Рекламации reopens the project at stage 19', rec.status === 'work' && rec.stage === 19 && !rec.result && !rec.doneAt, rec);
  ok('card is in Рекламации and in the work counters', (await inStage(page, 19, 'Кухня Альфа')) === 1 && !/чистая прибыль/.test(await page.locator('.kcard[data-key="Кухня Альфа"]').innerText()));
  const t2 = await toastText(page);
  ok('toast says returned to work', /возвращён в работу: Рекламации/.test(t2), t2);
  ok('history says returned to work', /проект возвращён в работу/.test(JSON.stringify((await pmOf(page, 'Кухня Альфа')).hist)));
  ok('closed analysis no longer includes it', await page.evaluate(() => !KC.closedProjectsAnalysis(KCApp.S.meta.projects, '2000-01-01', '2100-01-01').list.some(x => x.project === 'Кухня Альфа')));
  // из Рекламаций обратно в «Сдано»: закрывается заново
  await page.locator('.kcard[data-key="Кухня Альфа"]').dragTo(page.locator('.kst[data-stage="18"]'));
  ok('Рекламации -> Сдано closes it again', (await pmOf(page, 'Кухня Альфа')).status === 'done');
  // карточка закрытого проекта: кнопки есть, подсказка про возврат
  await page.locator('.kcard[data-key="Кухня Альфа"]').click();
  ok('closed card shows the return-to-work note and stage buttons', (await page.locator('#pcard >> text=вернёт его в работу').count()) === 1 && (await page.locator('#pcard button[data-act="pc-crm-next"]').innerText()).includes('Рекламации') && (await page.locator('#pcard button[data-act="pc-crm-prev"]').count()) === 1);
  await page.click('#pcard button[data-act="pc-crm-next"]');
  ok('next button on a closed card moves it to Рекламации', (await stageOf(page, 'Кухня Альфа')) === 19 && (await pmOf(page, 'Кухня Альфа')).status === 'work');
  await page.click('#pcard button[data-act="pc-close"]');

  // ---------- нельзя посчитать итог ----------
  await page.evaluate(() => { const m = KCApp.S.meta.projects; m['Только расход'] = Object.assign({}, m['Только расход'] || { status: 'work' }, { stage: 17, updatedAt: new Date().toISOString() }); KCApp.render(); });
  await page.locator('.kcard[data-key="Только расход"]').dragTo(page.locator('.kst[data-stage="18"]'));
  const noInc = await pmOf(page, 'Только расход');
  ok('no income: moves to Сдано but stays open', noInc.status === 'work' && noInc.stage === 18, noInc);
  const t3 = await toastText(page);
  ok('toast explains why it was not closed', /итог не посчитан: по проекту нет поступлений/.test(t3), t3);

  // ---------- «Сдано»: свёрнутый список ----------
  await page.evaluate(() => {
    const m = KCApp.S.meta.projects;
    for (let i = 1; i <= 10; i++) m['Старый ' + i] = { status: 'done', stage: 18, doneAt: '2026-0' + (i < 10 ? i : 9) + '-1' + (i % 9) + 'T10:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', result: { net: i * 1000 * 100 }, f: {}, hist: [] };
    KCApp.render();
  });
  const closedOnBoard = () => page.locator('.kst[data-stage="18"] .kcard:has-text("закрыт")').count();
  ok('only the 8 latest closed projects are shown', (await closedOnBoard()) === 8);
  ok('show-all button names the number', /Показать все закрытые \(\d+\)/.test(await page.locator('button[data-act="doneall"]').innerText()));
  const total = await page.evaluate(() => Object.values(KCApp.S.meta.projects).filter(p => p.status === 'done').length);
  await page.click('button[data-act="doneall"]');
  ok('show-all reveals every closed project', (await closedOnBoard()) === total && total >= 10, total);
  ok('collapse button appears', (await page.locator('button[data-act="doneall"]').innerText()).includes('Свернуть'));
  await page.click('button[data-act="doneall"]');
  ok('collapse again', (await closedOnBoard()) === 8);

  // ---------- единая карточка проекта ----------
  await page.evaluate(() => { KCApp.S.meta.projects['Мозговой штурм'] = KC.crmNewCard(new Date().toISOString(), 'Карточка создана в CRM'); KCApp.commit({}, 'create', 'карточка из CRM'); });
  await page.click('.nav button[data-v="ops"]');
  await page.click('.fab');
  await page.fill('#f-amount', '5000'); await page.fill('#f-art', 'Закупка материала');
  await page.fill('#f-proj', 'Моз'); await page.focus('#f-proj');
  ok('project suggestions include a card that has no operations yet', (await page.locator('#sug-f-proj button').allInnerTexts()).some(x => x.trim() === 'Мозговой штурм'));
  await page.fill('#f-proj', 'Кухня Москва');
  await page.click('button[data-act="saveform"]');
  const km = await pmOf(page, 'Кухня Москва');
  ok('new project in an operation creates a card on the first stage', km && km.status === 'work' && km.stage === 5 && km.hist[0].t === 'Карточка создана из операции', km);
  ok('toast mentions the created card', /Создана карточка проекта «Кухня Москва»/.test(await toastText(page)), await toastText(page));
  await page.click('.nav button[data-v="projects"]');
  ok('the card is on the board in the first column', (await inStage(page, 5, 'Кухня Москва')) === 1);
  // та же карточка, другое написание
  await page.click('.nav button[data-v="ops"]'); await page.click('.fab');
  await page.fill('#f-amount', '700'); await page.fill('#f-art', 'Закупка материала'); await page.fill('#f-proj', '  кухня   москва ');
  await page.click('button[data-act="saveform"]');
  const names = await page.evaluate(() => ({ keys: Object.keys(KCApp.S.meta.projects).filter(k => /москва/i.test(k)), recs: KCApp.S.records.filter(r => /москва/i.test(r.project || '')).map(r => r.project) }));
  ok('another spelling is saved under the existing card name', names.keys.length === 1 && names.recs.length === 2 && names.recs.every(x => x === 'Кухня Москва'), names);
  ok('toast says it was recorded as in the card', /Проект записан как в карточке: «Кухня Москва»/.test(await toastText(page)), await toastText(page));
  ok('no second card was created', (await page.evaluate(() => Object.keys(KCApp.S.meta.projects).filter(k => /москва/i.test(k)).length)) === 1);
  // операция по карточке из CRM привязывается к ней
  await page.click('.fab'); await page.fill('#f-amount', '300'); await page.fill('#f-art', 'Закупка материала'); await page.fill('#f-proj', 'Мозговой штурм');
  await page.click('button[data-act="saveform"]');
  ok('operation on a CRM-created card links to it, no new card', (await page.evaluate(() => KCApp.S.records.some(r => r.project === 'Мозговой штурм') && Object.keys(KCApp.S.meta.projects).filter(k => /мозговой/i.test(k)).length === 1)));
  // правка проекта у существующей операции
  await page.evaluate(() => { const r = KCApp.S.records.find(x => x.project === 'Мозговой штурм'); KCApp.commit({ patches: [{ id: r.id, patch: { project: 'Новый через правку' } }] }, 'update', 'правка'); });
  ok('changing a project on an operation also creates a card', !!(await pmOf(page, 'Новый через правку')) && (await stageOf(page, 'Новый через правку')) === 5);
  ok('without a project no card is created', await page.evaluate(() => { const n = Object.keys(KCApp.S.meta.projects).length; KCApp.commit({ newRecords: [KC.newRecord({ kind: 'expense', wallet: 'cash', amount: -100, date: '2026-10-06', article: 'Закупка материала' })] }, 'create', 'без проекта'); return Object.keys(KCApp.S.meta.projects).length === n && !KCApp.S.meta.projects['']; }));
  ok('cards of operations survive reload', await (async () => { await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.KCApp); return await page.evaluate(() => !!KCApp.S.meta.projects['Кухня Москва'] && KCApp.S.meta.projects['Кухня Москва'].stage === 5); })());

  ok('no js errors', errors.length === 0, errors);
  await ctx.close(); await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
