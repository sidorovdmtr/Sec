// Разовый перенос из дашборда заказов: кнопка в режиме «Админ», окно сверки с цифрами, внесение только после подтверждения, повтор без дублей. Названия выдуманные.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
const dash = [
  { _id: 'd1', name: 'Кухня Тестова', stage: 5, startDate: '2026-10-05', workDays: 10, dueDate: '2026-10-19', order: 0, color: '#ccc', tasks: [{ id: 't1', text: 'Замер', done: true, zone: 'office', zoneOrder: 0 }, { id: 't2', text: 'Заказ плиты', done: false }] },
  { _id: 'd2', name: 'кухня тестова', stage: 1, startDate: '2026-11-01', dueDate: '2026-12-01', tasks: [] },
  { _id: 'd3', name: 'Шкаф Образцов', stage: 12, startDate: '2026-08-03', workDays: 5, dueDate: '2026-08-10', tasks: [{ id: 't1', text: 'Монтаж', done: true, zone: 'contractors' }] },
  { _id: 'd4', name: 'Прихожая Пустая', stage: 1, startDate: '', dueDate: '', tasks: [{ id: 't1', text: 'Позвонить', done: false, zone: 'workshop' }] }
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dimp-')), jf = path.join(tmp, 'dashboard.json'), bad = path.join(tmp, 'bad.json');
fs.writeFileSync(jf, JSON.stringify(dash)); fs.writeFileSync(bad, '{"x":1}');

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
    const L = (s) => label + ': ' + s;
    await page.evaluate(() => {
      KCApp.setAdmin(true);
      KCApp.S.meta.projects['Шкафы Образцов'] = { status: 'work', stage: 5, f: {}, hist: [], updatedAt: KC.nowISO() };
      KCApp.S.records.push(KC.newRecord({ wallet: 'alfa', amount: -50000, date: '2026-10-10', project: 'КУХНЯ ТЕСТОВА' }));
      KCApp.render();
    });
    await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="data"]');
    ok(L('import block is in admin mode'), await has('#dashfile'));
    await page.evaluate(() => KCApp.setAdmin(false));
    ok(L('hidden without admin'), !(await has('#dashfile')));
    await page.evaluate(() => KCApp.setAdmin(true));

    await page.setInputFiles('#dashfile', bad);
    ok(L('file without projects is refused'), !(await has('#dimp')));
    await page.setInputFiles('#dashfile', jf);
    await page.waitForSelector('#dimp .sheet');
    const sheet = await page.locator('#dimp').innerText();
    ok(L('preview shows totals, nothing is written yet'), /Проектов в файле\s*4/.test(sheet) && /Склеено с вашими названиями\s*1/.test(sheet) && /Новых карточек\s*3/.test(sheet) && /Задач новых \(выполнено \/ открыто\)\s*4 \(2 \/ 2\)/.test(sheet) && /Проектов без дат\s*1/.test(sheet), sheet.slice(0, 400));
    ok(L('nothing written before confirmation'), await page.evaluate(() => Object.keys(KCApp.S.meta.tasks).length === 0 && !KCApp.S.meta.projects['Прихожая Пустая']));
    ok(L('duplicate name in the file is reported'), /повторяется в дашборде/.test(sheet));
    ok(L('similar existing card is offered'), (await page.locator('#dimp-sel-2 option').allInnerTexts()).join('|').indexOf('Склеить с «Шкафы Образцов»') >= 0);
    ok(L('preview fits the screen'), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('#dimp .sheet').scrollWidth <= window.innerWidth + 1));

    // отмена ничего не меняет
    await page.click('#dimp button[data-act="dimp-cancel"]');
    ok(L('cancel closes and changes nothing'), !(await has('#dimp')) && await page.evaluate(() => Object.keys(KCApp.S.meta.tasks).length === 0));

    // решение: склеить Образцова, остальное по умолчанию; внести
    await page.setInputFiles('#dashfile', jf); await page.waitForSelector('#dimp .sheet');
    await page.selectOption('#dimp-sel-2', 'Шкафы Образцов');
    ok(L('choice merges the card and the preview updates'), /Склеено с вашими названиями\s*2/.test(await page.locator('#dimp').innerText()) && /Новых карточек\s*2/.test(await page.locator('#dimp').innerText()));
    await page.click('#dimp button[data-act="dimp-do"]');
    ok(L('sheet closed after the import'), !(await has('#dimp')));
    const st = await page.evaluate(() => ({ p: JSON.parse(JSON.stringify(KCApp.S.meta.projects)), t: Object.values(KCApp.S.meta.tasks).map(x => ({ title: x.title, zone: x.zone, status: x.status, doneAt: x.doneAt, ownerKey: x.ownerKey })), log: KCApp.S.log.some(l => l.action === 'import') }));
    ok(L('card from operations got stage 9 and dates'), st.p['КУХНЯ ТЕСТОВА'] && st.p['КУХНЯ ТЕСТОВА'].stage === 9 && st.p['КУХНЯ ТЕСТОВА'].f.start === '2026-10-05' && st.p['КУХНЯ ТЕСТОВА'].f.due === '2026-10-19', st.p['КУХНЯ ТЕСТОВА']);
    ok(L('second copy of the name made a separate card'), !!st.p['кухня тестова (2)'] && st.p['кухня тестова (2)'].stage === 5);
    ok(L('existing card merged: «Сдано» without closing'), st.p['Шкафы Образцов'].stage === 18 && st.p['Шкафы Образцов'].status === 'work' && st.p['Шкафы Образцов'].f.workDays === '5');
    ok(L('new card without dates'), st.p['Прихожая Пустая'].stage === 5 && !st.p['Прихожая Пустая'].f.start);
    ok(L('tasks transferred with zones and owners'), st.t.length === 4 && st.t.find(x => x.title === 'Монтаж').zone === 'contractors' && st.t.find(x => x.title === 'Монтаж').ownerKey === 'Шкафы Образцов' && st.t.find(x => x.title === 'Позвонить').zone === 'shop' && st.t.find(x => x.title === 'Заказ плиты').zone === 'none', st.t);
    ok(L('done tasks are done without invented date'), st.t.filter(x => x.status === 'done').length === 2 && st.t.filter(x => x.status === 'done').every(x => x.doneAt === ''));
    ok(L('import is in the change log'), st.log);

    // результат виден на досках
    await page.click('.nav button[data-v="tasks"]');
    ok(L('board: open tasks in their zones, contractors column exists'), (await page.locator('.kst[data-tzone="shop"] .kcard:has-text("Позвонить")').count()) === 1 && (await page.locator('.kst[data-tzone="none"] .kcard:has-text("Заказ плиты")').count()) === 1 && (await page.locator('.kst[data-tzone="contractors"]').count()) === 1);
    ok(L('board: done tasks are off the board'), (await page.locator('.kcard[data-task]').count()) === 2);
    await page.click('.nav button[data-v="projects"]');
    ok(L('projects board: cards on their stages'), (await page.locator('.kst[data-stage="9"] .kcard[data-key="КУХНЯ ТЕСТОВА"]').count()) === 1 && (await page.locator('.kst[data-stage="18"] .kcard[data-key="Шкафы Образцов"]').count()) === 1);
    await page.locator('.kcard[data-key="Шкафы Образцов"]').click();
    ok(L('project card shows the done task with the mark'), await has('#pcard #tkblock .tkrow.tkdone:has-text("Монтаж"):has-text("выполнена")'));
    await page.click('#pcard button[data-act="pc-close"]');

    // повтор: дублей нет
    await page.click('.nav button[data-v="settings"]'); await page.click('button[data-act="stab"][data-v="data"]');
    await page.setInputFiles('#dashfile', jf); await page.waitForSelector('#dimp .sheet');
    const sheet2 = await page.locator('#dimp').innerText();
    ok(L('repeat: tasks already transferred are counted, not added'), /Задач уже было внесено ранее\s*4/.test(sheet2) && /Задач новых \(выполнено \/ открыто\)\s*0 \(0 \/ 0\)/.test(sheet2), sheet2.slice(0, 500));
    await page.click('#dimp button[data-act="dimp-do"]');
    ok(L('repeat adds no duplicate tasks or cards'), await page.evaluate(() => Object.keys(KCApp.S.meta.tasks).length === 4 && Object.keys(KCApp.S.meta.projects).length === 4), await page.evaluate(() => Object.keys(KCApp.S.meta.projects)));

    // сохраняется после перезагрузки, копия JSON включает всё
    await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.KCApp);
    ok(L('survives reload'), await page.evaluate(() => Object.keys(KCApp.S.meta.tasks).length === 4 && !!KCApp.S.meta.projects['Прихожая Пустая']));
    await ctx.close();
  }
  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
