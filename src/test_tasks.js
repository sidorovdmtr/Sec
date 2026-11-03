// CRM: вкладка «Задачи» (4 зоны, будильник, срок, комментарий) и привязка задач к карточкам проектов и лидов. Сеть заблокирована, облако не используется.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/deploy/index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra)); } }
const taskBy = (page, title) => page.evaluate((n) => { const t = Object.values(KCApp.S.meta.tasks).find(x => x.title === n); return t ? JSON.parse(JSON.stringify(t)) : null; }, title);
const pad = (n) => (n < 10 ? '0' : '') + n;
const localStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
async function newTask(page, o) {
  await page.click('button[data-act="tk-new"][data-ot=""]');
  if (o.owner !== undefined) await page.selectOption('#tf-owner', o.owner);
  await page.fill('#tf-title', o.title);
  if (o.desc) await page.fill('#tf-desc', o.desc);
  if (o.zone) await page.selectOption('#tf-zone', o.zone);
  if (o.due) await page.fill('#tf-due', o.due);
  if (o.remind) await page.fill('#tf-remind', o.remind);
  if (o.comment) await page.fill('#tf-comment', o.comment);
  await page.click('button[data-act="tk-save"]');
}

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

    // меню и пустое состояние
    const navs = (await page.locator('.nav button').allInnerTexts()).map(x => x.trim());
    ok(L('new tab «Задачи» sits between Лиды and Настройки'), navs.join('|') === 'Операции|Проекты|Лиды|Задачи|Настройки', navs);
    ok(L('five nav buttons fit the screen'), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.nav button')].every(b => b.getBoundingClientRect().width >= 56)));
    await page.click('.nav button[data-v="tasks"]');
    ok(L('tab opens with title and empty board'), (await page.locator('.h2').first().innerText()).trim() === 'Задачи' && (await page.locator('.kst[data-tzone] .kempty').count()) === 4);
    const cols0 = (await page.locator('.kcol .kch b').allInnerTexts()).map(x => x.trim());
    ok(L('board has four zone columns'), cols0.join('|') === 'Не распределены|Цех|Офис|Директор', cols0);
    ok(L('board is the default view, zone chips only in the list'), (await page.locator('button[data-act="tk-zone"]').count()) === 0 && (await has('button[data-act="tk-mode"][data-v="board"].on')));
    await page.click('button[data-act="tk-mode"][data-v="list"]');
    const zchips = (await page.locator('button[data-act="tk-zone"]').allInnerTexts()).map(x => x.trim());
    ok(L('zone filter has all + four zones'), zchips.join('|') === 'Все · 0|Не распределены · 0|Цех · 0|Офис · 0|Директор · 0', zchips);
    ok(L('one theme button'), (await page.locator('button[data-act="theme"]').count()) === 1);

    // карточки для привязки
    await page.evaluate(() => {
      KCApp.S.meta.projects['Кухня Иванова'] = { status: 'work', stage: 5, f: {}, hist: [], updatedAt: KC.nowISO() };
      const lead = KC.newLead('Заявка Петрова', { phone: '+7 900 000-00-00' }, KC.nowISO()); KCApp.S.meta.leads[lead.id] = lead;
      KCApp.render();
    });

    // задача без зоны и без карточки: падает в «Не распределены»
    await newTask(page, { title: 'Позвонить в банк', owner: '' });
    let t = await taskBy(page, 'Позвонить в банк');
    ok(L('task without zone lands in «Не распределены»'), t && t.zone === 'none' && t.status === 'open' && t.ownerType === '', t);
    ok(L('sheet stays open on the new task and shows it open'), (await has('#tcard .sheet')) && (await has('#tcard button[data-act="tk-done"]')));
    await page.click('#tcard button[data-act="tk-close"]');
    ok(L('sheet closed, task in the list'), !(await has('#tcard')) && (await has('#tasklist .tkrow:has-text("Позвонить в банк")')));
    const zc = (await page.locator('button[data-act="tk-zone"]').allInnerTexts()).map(x => x.trim());
    ok(L('counter of «Не распределены» is 1'), zc[0] === 'Все · 1' && zc[1] === 'Не распределены · 1', zc);

    // пустое название не создаёт задачу
    await page.click('button[data-act="tk-new"][data-ot=""]'); await page.click('button[data-act="tk-save"]');
    ok(L('empty title is refused'), (await has('#tcard .sheet')) && Object.keys(await page.evaluate(() => KCApp.S.meta.tasks)).length === 1);
    await page.click('#tcard button[data-act="tk-close"]');

    // все поля: описание, зона, срок, будильник, комментарий; привязка к проекту
    const past = new Date(Date.now() - 3600 * 1000), future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    await newTask(page, { title: 'Заказать фурнитуру', owner: 'p:Кухня Иванова', desc: 'Петли и направляющие', zone: 'office', due: '2030-01-10', remind: localStr(past), comment: 'Уточнить у поставщика' });
    t = await taskBy(page, 'Заказать фурнитуру');
    ok(L('all fields saved'), t && t.desc === 'Петли и направляющие' && t.zone === 'office' && t.due === '2030-01-10' && t.remind === localStr(past) && t.comment === 'Уточнить у поставщика' && t.ownerType === 'project' && t.ownerKey === 'Кухня Иванова', t);
    ok(L('alarm icon on the task face (reminder time passed)'), (await page.locator('#tcard .tkalarm').count()) === 1);
    await page.click('#tcard button[data-act="tk-close"]');
    ok(L('list row shows alarm, zone and owner'), (await has('#tasklist .tkrow:has-text("Заказать фурнитуру") .tkalarm')) && (await has('#tasklist .tkrow:has-text("Офис")')) && (await has('#tasklist .tkrow:has-text("Кухня Иванова")')));

    await newTask(page, { title: 'Проверить смету', owner: 'p:Кухня Иванова', zone: 'director', due: '2020-01-01', remind: localStr(future) });
    await page.click('#tcard button[data-act="tk-close"]');
    ok(L('future reminder shows no alarm'), !(await has('#tasklist .tkrow:has-text("Проверить смету") .tkalarm')));
    ok(L('overdue due date is marked'), (await has('#tasklist .tkrow:has-text("Проверить смету"):has-text("просрочена")')));
    const order = (await page.locator('#tasklist .tkrow .t').allInnerTexts()).map(x => x.trim());
    ok(L('sorted by due date, no due last'), order.join('|') === 'Проверить смету|Заказать фурнитуру|Позвонить в банк', order);

    // фильтр по зоне и поиск
    await page.click('button[data-act="tk-zone"][data-v="shop"]');
    ok(L('empty zone in the list shows empty state'), (await has('text=Открытых задач нет')));
    await page.click('button[data-act="tk-zone"][data-v="director"]');
    ok(L('zone filter «Директор»'), (await page.locator('#tasklist .tkrow').count()) === 1 && (await has('#tasklist .tkrow:has-text("Проверить смету")')));
    await page.click('button[data-act="tk-zone"][data-v="all"]');
    await page.fill('#tq', 'иванова');
    ok(L('search by card name'), (await page.locator('#tasklist .tkrow').count()) === 2);
    ok(L('search keeps focus while typing'), await page.evaluate(() => document.activeElement && document.activeElement.id === 'tq'));
    await page.fill('#tq', '');

    // доска: четыре зоны, карточки по зонам, выполненные не показываются
    await page.click('button[data-act="tk-mode"][data-v="board"]');
    const inCol = (zone, title) => page.locator('.kst[data-tzone="' + zone + '"] .kcard:has-text("' + title + '")').count();
    ok(L('board puts tasks in their zones'), (await inCol('office', 'Заказать фурнитуру')) === 1 && (await inCol('director', 'Проверить смету')) === 1 && (await inCol('none', 'Позвонить в банк')) === 1 && (await inCol('director', 'Позвонить в банк')) === 0, 'board');
    ok(L('board tile shows the card name and the alarm'), (await has('.kst[data-tzone="office"] .kcard:has-text("Кухня Иванова") .tkalarm')) && !(await has('.kst[data-tzone="director"] .kcard:has-text("Проверить смету") .tkalarm')));
    ok(L('board tile marks overdue'), await has('.kst[data-tzone="director"] .kcard:has-text("Проверить смету"):has-text("просрочена")'));
    ok(L('column counters'), (await page.locator('.kcol:has(.kst[data-tzone="director"]) .kch .pill').innerText()).trim() === '1');
    ok(L('board does not push the page sideways'), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (label === 'desktop') {
      ok(L('tiles are draggable on desktop'), (await page.locator('.kcard[data-task][draggable="true"]').count()) >= 3);
      await page.locator('.kcard[data-task]:has-text("Заказать фурнитуру")').dragTo(page.locator('.kst[data-tzone="shop"]'));
      t = await taskBy(page, 'Заказать фурнитуру');
      ok(L('drag moves the task to another zone'), t.zone === 'shop' && (await inCol('shop', 'Заказать фурнитуру')) === 1 && (await inCol('office', 'Заказать фурнитуру')) === 0, t.zone);
      ok(L('zone move is written to the task history'), t.hist[0].t === 'Зона: Офис → Цех', t.hist[0]);
      await page.locator('.kcard[data-task]:has-text("Заказать фурнитуру")').dragTo(page.locator('.kst[data-tzone="office"]'));
      ok(L('drag back to the office'), (await taskBy(page, 'Заказать фурнитуру')).zone === 'office');
    } else {
      ok(L('no dragging on the phone'), (await page.locator('.kcard[data-task][draggable="true"]').count()) === 0);
      await page.click('.kcard[data-task]:has-text("Заказать фурнитуру")'); await page.selectOption('#tf-zone', 'shop'); await page.click('#tcard button[data-act="tk-close"]');
      ok(L('zone changed in the task moves the tile'), (await inCol('shop', 'Заказать фурнитуру')) === 1 && (await inCol('office', 'Заказать фурнитуру')) === 0);
      await page.click('.kcard[data-task]:has-text("Заказать фурнитуру")'); await page.selectOption('#tf-zone', 'office'); await page.click('#tcard button[data-act="tk-close"]');
    }
    await page.click('.kcard[data-task]:has-text("Проверить смету")');
    ok(L('tile click opens the task'), (await has('#tcard #tf-title')) && (await page.inputValue('#tf-title')) === 'Проверить смету');
    await page.click('#tcard button[data-act="tk-close"]');
    await page.click('button[data-act="tk-mode"][data-v="list"]');

    // блок «Задачи» в карточке проекта
    await page.click('.nav button[data-v="projects"]');
    await page.locator('.kcard[data-key="Кухня Иванова"]').click();
    ok(L('project card has tasks block with 2 open tasks'), (await has('#pcard #tkblock')) && (await page.locator('#pcard #tkblock .tkrow').count()) === 2 && (await has('#pcard #tkblock:has-text("Задачи · 2 открытых")')));
    ok(L('alarm icon on the task in the project card'), (await page.locator('#pcard #tkblock .tkrow:has-text("Заказать фурнитуру") .tkalarm').count()) === 1 && (await page.locator('#pcard #tkblock .tkrow:has-text("Проверить смету") .tkalarm').count()) === 0);
    ok(L('block does not push the card sideways'), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    // создание задачи прямо из карточки: карточка уже выбрана
    await page.click('#pcard button[data-act="tk-new"]');
    ok(L('new task from the card is preset to this card'), (await page.inputValue('#tf-owner')) === 'p:Кухня Иванова');
    await page.fill('#tf-title', 'Согласовать замер'); await page.click('button[data-act="tk-save"]'); await page.click('#tcard button[data-act="tk-close"]');
    t = await taskBy(page, 'Согласовать замер');
    ok(L('task made in project card is linked and unassigned'), t && t.ownerType === 'project' && t.ownerKey === 'Кухня Иванова' && t.zone === 'none', t);
    ok(L('project card list updated after closing the sheet'), (await page.locator('#pcard #tkblock .tkrow').count()) === 3 && (await has('#pcard #tkblock:has-text("Задачи · 3 открытых")')));
    await page.click('#pcard button[data-act="pc-close"]');

    // блок «Задачи» в карточке лида
    await page.click('.nav button[data-v="leads"]'); await page.click('.kcard:has-text("Заявка Петрова")');
    ok(L('lead card has tasks block, empty'), (await has('#lcard #tkblock:has-text("Задач нет")')));
    await page.click('#lcard button[data-act="tk-new"]'); await page.fill('#tf-title', 'Назначить встречу'); await page.selectOption('#tf-zone', 'director'); await page.click('button[data-act="tk-save"]'); await page.click('#tcard button[data-act="tk-close"]');
    t = await taskBy(page, 'Назначить встречу');
    ok(L('task linked to the lead'), t && t.ownerType === 'lead' && (await page.evaluate((id) => KCApp.S.meta.leads[id].name, t.ownerKey)) === 'Заявка Петрова');
    ok(L('lead card lists the task'), (await has('#lcard #tkblock .tkrow:has-text("Назначить встречу")')));
    await page.click('#lcard button[data-act="ld-close"]');

    // редактирование существующей задачи: сохраняется, фокус не теряется
    await page.click('.nav button[data-v="tasks"]'); await page.click('#tasklist .tkrow:has-text("Позвонить в банк")');
    await page.click('#tf-comment'); await page.keyboard.type('Номер в договоре');
    ok(L('typing keeps focus'), await page.evaluate(() => document.activeElement && document.activeElement.id === 'tf-comment'));
    await page.selectOption('#tf-zone', 'director'); await page.fill('#tf-due', '2030-02-02');
    await page.selectOption('#tf-owner', 'p:Кухня Иванова');
    t = await taskBy(page, 'Позвонить в банк');
    ok(L('edits saved: comment, zone, due, card'), t.comment === 'Номер в договоре' && t.zone === 'director' && t.due === '2030-02-02' && t.ownerKey === 'Кухня Иванова', t);
    await page.click('#tcard button[data-act="tk-close"]');

    // выполнение: фактическая дата записывается сама, обратно в работу
    await page.click('#tasklist .tkrow:has-text("Позвонить в банк")'); await page.click('button[data-act="tk-done"]');
    t = await taskBy(page, 'Позвонить в банк');
    ok(L('done writes the fact date itself (now)'), t.status === 'done' && Math.abs(Date.now() - new Date(t.doneAt).getTime()) < 60000, t);
    ok(L('done task shows «Выполнена» in the sheet'), (await has('#tcard :text("Выполнена")')) && (await has('#tcard button[data-act="tk-reopen"]')));
    await page.click('#tcard button[data-act="tk-close"]');
    ok(L('done task left the open list'), !(await has('#tasklist .tkrow:has-text("Позвонить в банк")')));
    await page.click('button[data-act="tk-mode"][data-v="done"]');
    ok(L('done tab shows it with fact date'), (await has('#tasklist .tkrow.tkdone:has-text("Позвонить в банк"):has-text("выполнена")')));
    await page.click('#tasklist .tkrow:has-text("Позвонить в банк")'); await page.click('button[data-act="tk-reopen"]');
    t = await taskBy(page, 'Позвонить в банк');
    ok(L('reopen clears fact date'), t.status === 'open' && t.doneAt === '', t);
    await page.click('#tcard button[data-act="tk-close"]'); await page.click('button[data-act="tk-mode"][data-v="list"]');
    // закрытая задача не звенит
    await page.click('#tasklist .tkrow:has-text("Заказать фурнитуру")'); await page.click('button[data-act="tk-done"]');
    ok(L('done task has no alarm'), (await page.locator('#tcard .tkalarm').count()) === 0);
    await page.click('#tcard button[data-act="tk-close"]');

    // выполненные уходят с доски, но остаются в карточке проекта с пометой «выполнена»
    await page.click('button[data-act="tk-mode"][data-v="board"]');
    ok(L('done task left the board'), (await page.locator('.kcard[data-task]:has-text("Заказать фурнитуру")').count()) === 0 && (await page.locator('.kcard[data-task]').count()) === 4);
    await page.click('.nav button[data-v="projects"]'); await page.locator('.kcard[data-key="Кухня Иванова"]').click();
    ok(L('done task stays in the project card with the «выполнена» mark'), (await has('#pcard #tkblock .tkrow.tkdone:has-text("Заказать фурнитуру"):has-text("выполнена")')) && (await has('#pcard #tkblock:has-text("открытых")')));
    ok(L('open tasks come first, done last in the card'), (await page.locator('#pcard #tkblock .tkrow').last().innerText()).indexOf('Заказать фурнитуру') >= 0);
    await page.click('#pcard button[data-act="pc-close"]');

    // копия и сохранение после перезагрузки
    const bk = await page.evaluate(() => JSON.parse(JSON.stringify(KC.backupObject({ records: KCApp.S.records, log: KCApp.S.log, decisions: KCApp.S.decisions, meta: { ignoredKeys: [], statements: [], projects: KCApp.S.meta.projects, leads: KCApp.S.meta.leads, tasks: KCApp.S.meta.tasks, articles: [] }, namespace: 'test' }))));
    ok(L('backup v3 carries all tasks with fields'), bk.version === 3 && Object.keys(bk.meta.tasks).length === 5 && Object.values(bk.meta.tasks).some(x => x.title === 'Заказать фурнитуру' && x.status === 'done' && x.doneAt && x.desc === 'Петли и направляющие'));
    await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.KCApp);
    ok(L('tasks survive reload'), (await page.evaluate(() => Object.keys(KCApp.S.meta.tasks).length)) === 5);
    ok(L('log records task actions'), await page.evaluate(() => KCApp.S.log.some(x => x.action === 'task')));
    await ctx.close();
  }
  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
