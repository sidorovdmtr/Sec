const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/artifact.html');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info)); } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/^https?:/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(FILE);
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\u00A0/g, ' ');
  const rows = () => page.locator('#list .op').count();

  // 1. пустая оболочка
  ok('empty state visible', (await page.locator('text=Пока пусто').count()) > 0);
  ok('test banner', (await page.locator('text=ТЕСТОВАЯ БАЗА').count()) > 0);
  ok('total zero', (await txt('#total')) === '0 ₽', await txt('#total'));

  // 2. тестовые данные
  await page.click('button[data-act="seed"]');
  ok('rows after seed', (await rows()) > 3, await rows());
  const total1 = await txt('#total');
  ok('total non-zero', total1 !== '0 ₽', total1);

  // 3. поиск по сумме и по тексту
  await page.fill('#q', '48200');
  ok('search by amount', (await rows()) === 1, await rows());
  await page.fill('#q', 'плита');
  ok('search by text', (await rows()) >= 1);
  await page.fill('#q', 'ничего-нет');
  ok('search none', (await page.locator('#list >> text=Ничего не найдено').count()) === 1);
  await page.fill('#q', '');
  ok('search cleared', (await rows()) > 3);

  // 4. тема
  await page.click('button[data-act="theme"]');
  ok('theme light', (await page.getAttribute('html', 'data-theme')) === 'light');
  await page.reload();
  ok('theme persists', (await page.getAttribute('html', 'data-theme')) === 'light');
  await page.click('button[data-act="theme"]');
  ok('theme dark again', (await page.getAttribute('html', 'data-theme')) === 'dark');
  ok('data persists after reload', (await rows()) > 3);

  // 5. форма: Enter-переходы, подсказки, подстановка статьи
  const before = await rows();
  await page.click('button[data-act="newrec"]');
  ok('form opened with amount focus', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'f-amount');
  await page.keyboard.type('1500');
  await page.keyboard.press('Enter');
  ok('enter -> counterparty', (await page.evaluate(() => document.activeElement.id)) === 'f-cp');
  await page.keyboard.type('Образец-Ф');
  ok('suggestions open', (await page.locator('#sug-f-cp.open button').count()) >= 1);
  await page.keyboard.press('Enter');
  ok('counterparty picked', (await page.inputValue('#f-cp')) === 'Образец-Фурнитура, ИП', await page.inputValue('#f-cp'));
  ok('enter -> article', (await page.evaluate(() => document.activeElement.id)) === 'f-art');
  ok('article suggested', (await page.inputValue('#f-art')) === 'Закупка материала', await page.inputValue('#f-art'));
  ok('article marked suggested', await page.locator('#f-art.suggested').count() === 1);
  await page.keyboard.press('Enter');
  ok('enter -> project', (await page.evaluate(() => document.activeElement.id)) === 'f-proj');
  await page.keyboard.type('Образец 1');
  await page.keyboard.press('Enter');
  ok('project value', (await page.inputValue('#f-proj')) === 'Образец 1', await page.inputValue('#f-proj'));
  await page.keyboard.type('Тестовая запись');
  await page.keyboard.press('Enter'); // «Далее» в описании: сохранить и закрыть
  ok('form closed after description Enter', (await page.locator('#sheet').count()) === 0);
  ok('row added', (await rows()) === before + 1, [before, await rows()]);
  const rec = await page.evaluate(() => KCApp.S.records[KCApp.S.records.length - 1]);
  ok('record fields', rec.amount === -150000 && rec.wallet === 'cash' && rec.counterparty === 'Образец-Фурнитура, ИП' && rec.article === 'Закупка материала' && rec.project === 'Образец 1' && rec.description === 'Тестовая запись' && rec.autofill === 'suggested', rec);
  ok('record bankState none (cash)', rec.bankState === 'none');
  ok('defaults: date today, not planned', rec.date === (await page.evaluate(() => KC.today())) && rec.planned === false, [rec.date, rec.planned]);

  // 6. минимальное сохранение: только сумма и кошелёк
  await page.click('button[data-act="newrec"]');
  await page.keyboard.type('777');
  await page.click('button[data-act="saveform"]');
  const rec2 = await page.evaluate(() => KCApp.S.records[KCApp.S.records.length - 1]);
  ok('minimal save', rec2.amount === -77700 && rec2.wallet === 'cash' && !rec2.article, rec2);
  // ошибка без суммы
  await page.click('button[data-act="newrec"]');
  await page.click('button[data-act="saveform"]');
  ok('validation error shown', (await txt('#errs')).indexOf('Введите сумму') >= 0);
  await page.click('button[data-act="closeform"]');

  // 7. перевод одним действием
  const nBefore = await page.evaluate(() => KCApp.S.records.length);
  await page.click('button[data-act="newrec"]');
  await page.click('button[data-act="ftype"][data-v="transfer"]');
  await page.fill('#f-amount', '1000');
  await page.click('button[data-act="wallet"][data-k="from"][data-v="alfa"]');
  await page.click('button[data-act="wallet"][data-k="to"][data-v="cash"]');
  await page.click('button[data-act="saveform"]');
  const nAfter = await page.evaluate(() => KCApp.S.records.length);
  ok('transfer = two records', nAfter === nBefore + 2, [nBefore, nAfter]);
  const pair = await page.evaluate(() => KCApp.S.records.slice(-2));
  ok('transfer pair ids', pair[0].pairId && pair[0].pairId === pair[1].pairId && pair[0].amount === -pair[1].amount && pair[0].bankState === 'pending' && pair[1].bankState === 'none', pair);

  // 8. выписка Альфы (тест)
  await page.click('.nav button[data-v="statements"]');
  await page.click('button[data-act="teststm"][data-w="alfa"]');
  const decCount = await page.locator('.dec').count();
  ok('alfa decisions created', decCount >= 1, decCount);
  const stmToast = await txt('#toast');
  ok('statement toast', /Выписка Альфа-банк/.test(stmToast), stmToast);
  await page.click('button[data-act="teststm"][data-w="alfa"]');
  ok('re-upload before resolving adds no decisions', (await page.locator('.dec').count()) === decCount, [decCount, await page.locator('.dec').count()]);
  // решаем: первую - привязать, остальные - как новая
  let guard = 0;
  while ((await page.locator('.dec').count()) > 0 && guard++ < 10) {
    const btn = page.locator('.dec button[data-act="resolve"]').first();
    await btn.click();
  }
  ok('decisions resolved', (await page.locator('.dec').count()) === 0);
  ok('resolved decisions kept with time', await page.evaluate(() => KCApp.S.decisions.length > 0 && KCApp.S.decisions.every(d => d.resolvedAt)));
  // повторная загрузка той же выписки: дублей нет, решений нет
  const alfaCount = await page.evaluate(() => KCApp.S.records.filter(r => r.wallet === 'alfa' && r.bankKey).length);
  await page.click('button[data-act="teststm"][data-w="alfa"]');
  const alfaCount2 = await page.evaluate(() => KCApp.S.records.filter(r => r.wallet === 'alfa' && r.bankKey).length);
  ok('re-upload no duplicates', alfaCount2 === alfaCount, [alfaCount, alfaCount2]);
  ok('re-upload no new decisions', (await page.locator('.dec').count()) === 0, await page.locator('.dec').count());

  // 9. Промос (тест)
  await page.click('button[data-act="teststm"][data-w="promos"]');
  ok('promos decisions', (await page.locator('.dec').count()) >= 1);
  const absent = await page.locator('.dec >> text=Нет в выписке').count();
  ok('promos absent card', absent >= 1, absent);
  await page.locator('.dec button[data-c="add"]').first().click();
  const promosBank = await page.evaluate(() => KCApp.S.records.filter(r => r.wallet === 'promos' && r.source === 'bank').length);
  ok('promos record added from bank on request', promosBank === 1, promosBank);

  // 10. карточка проекта и завершение проекта
  await page.click('.nav button[data-v="projects"]');
  ok('projects listed', (await page.locator('#projlist .op').count()) >= 3);
  const firstProj = page.locator('#projlist .op[data-p]:not([data-p="__none__"])').first();
  const projName = await firstProj.getAttribute('data-p');
  await firstProj.click();
  ok('project card opens as own window', (await page.locator('#pcard .sheet').count()) === 1 && (await page.evaluate(() => KCApp.S.view)) === 'projects');
  ok('card shows variable costs block', (await page.locator('#pcard >> text=Переменные расходы (себестоимость)').count()) >= 1);
  ok('card shows ops list', (await page.locator('#pcard .op').count()) >= 1);
  await page.click('#pcard button[data-act="pc-done"]');
  ok('asks about period', (await page.locator('#pcard button:has-text("Использовать эти сроки")').count()) === 1 && (await page.locator('#pcard button:has-text("Указать другие")').count()) === 1);
  ok('no word calculator on completion', !/алькулятор/.test(await page.locator('#pcard').innerText()));
  ok('title is project completion', (await page.locator('#pcard >> text=Завершение проекта').count()) >= 1);
  await page.click('#pcard button[data-act="pc-useperiod"]');
  // шаг выбора состава: поступления с галочками и статьи расходов с отмеченными постоянными
  const nInc = await page.locator('#pcard button[data-act="pc-inc"]').count();
  ok('incomes listed with checkboxes', nInc >= 2, nInc);
  ok('fixed article is checked', (await page.locator('#pcard .row:has-text("Аренда офиса") .cb.on').count()) >= 1);
  ok('variable article is not checked', (await page.locator('#pcard .row:has-text("Закупка материала") .cb:not(.on)').count()) >= 1);
  ok('all expense articles listed', (await page.locator('#pcard .row:has-text("Налоги")').count()) >= 1);
  ok('articles read-only here', (await page.locator('#pcard button[data-act="pc-art"]').count()) === 0);
  const calcNet = (expectIds) => page.evaluate(([n]) => { const p = KCApp.S.pcard; const ids = Object.keys(p.inc).filter(k => p.inc[k]); const r = KC.projectResult(KCApp.S.records, n, { from: p.from, to: p.to, mode: 'articles', fixedArticles: KC.fixedArticleNames(KCApp.S.meta.articles), incomeIds: ids }); return { net: r.net, alloc: r.alloc.fixedAllocated, share: r.alloc.share, n: ids.length }; }, [projName]);
  const beforeSel = await calcNet();
  // ручное исключение: снимаем галочку у поступления другого проекта
  const other = page.locator('#pcard button[data-act="pc-inc"]:not(:has-text("этот проект")):has-text("Образец")').first();
  if (await other.count()) {
    await other.click();
    const after = await calcNet();
    ok('manual exclusion changes selection', after.n === beforeSel.n - 1, [beforeSel.n, after.n]);
  }
  const expect = await calcNet();
  await page.click('#pcard button[data-act="pc-calc2"]');
  const calcText = (await page.locator('#pcard').innerText()).replace(/\u00A0/g, ' ');
  ok('result shows steps', /Доля этого заказа/.test(calcText) && /Постоянные расходы на этот заказ/.test(calcText) && /Чистая прибыль/.test(calcText));
  const netStr = await page.evaluate((v) => KC.formatMoney(v).replace(/\u00A0/g, ' '), expect.net);
  ok('result net equals core', calcText.indexOf(netStr) >= 0, [netStr]);
  await page.click('#pcard button[data-act="pc-save"]');
  const saved = await page.evaluate((n) => KCApp.S.meta.projects[n], projName);
  ok('project marked done with result', saved && saved.status === 'done' && saved.result.net === expect.net, saved);
  ok('card shows saved result', (await page.locator('#pcard >> text=Итог завершённого проекта').count()) === 1);
  // свой период без поступлений: рассчитать нельзя
  await page.click('#pcard button[data-act="pc-done"]');
  await page.click('#pcard button[data-act="pc-custom"]');
  await page.fill('#pc-from', '2000-01-01'); await page.fill('#pc-to', '2000-01-31');
  await page.click('#pcard button[data-act="pc-calc"]');
  ok('empty period blocks calculation', (await page.locator('#pcard button[data-act="pc-calc2"][disabled]').count()) === 1);
  // переход в настройки статей
  await page.click('#pcard button[data-act="pc-settings"]');
  ok('settings opened from completion', (await page.locator('#pcard .sheet').count()) === 0 && (await page.locator('text=Справочник статей').count()) >= 1);
  await page.click('.nav button[data-v="projects"]');
  ok('done pill in list', (await page.locator('#projlist .pill:has-text("завершён")').count()) === 1);
  await firstProj.click();
  await page.click('#pcard button[data-act="pc-reopen"]');
  ok('reopen', await page.evaluate((n) => KCApp.S.meta.projects[n].status === 'work', projName));
  await page.click('#pcard button[data-act="pc-close"]');
  const noProj = page.locator('#projlist .op[data-p="__none__"]');
  if (await noProj.count()) { await noProj.click(); ok('no done button for no-project', (await page.locator('#pcard button[data-act="pc-done"]').count()) === 0); await page.click('#pcard button[data-act="pc-close"]'); }
  await firstProj.click();
  await page.locator('#pcard .op').first().click();
  ok('edit over card', (await page.locator('#sheet').count()) === 1 && (await page.locator('#pcard .sheet').count()) === 1);
  await page.click('button[data-act="closeform"]');
  await page.click('#pcard button[data-act="pc-ops"]');
  ok('show in operations works', (await page.locator('text=Проект:').count()) === 1 && (await page.locator('#pcard .sheet').count()) === 0);
  await page.click('button[data-act="clearproject"]');

  // 10b. справочник статей: форма принимает только статьи из справочника
  await page.click('.nav button[data-v="ops"]');
  await page.click('button[data-act="newrec"]');
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // контрагент пустой -> статья
  ok('focus on article', (await page.evaluate(() => document.activeElement.id)) === 'f-art');
  await page.keyboard.type('выдуманная статья');
  await page.keyboard.press('Enter');
  ok('free text rejected', (await page.evaluate(() => document.activeElement.id)) === 'f-art' && (await page.locator('#toast >> text=нет в списке').count()) === 1);
  await page.fill('#f-art', '');
  await page.keyboard.type('Аренд');
  await page.keyboard.press('Enter');
  ok('typed prefix picks catalog article', /^Аренда/.test(await page.inputValue('#f-art')), await page.inputValue('#f-art'));
  await page.fill('#f-art', 'ABC'); // обход: значение в поле не из справочника
  await page.click('button[data-act="saveform"]');
  ok('free text blocked on save', (await txt('#errs')).indexOf('Выберите статью из списка') >= 0 && (await page.locator('#sheet').count()) === 1);
  await page.click('button[data-act="ftype"][data-v="income"]');
  await page.focus('#f-art');
  const incSug = (await page.locator('#sug-f-art button').allInnerTexts());
  ok('income form offers only income articles', incSug.length >= 1 && incSug.indexOf('Продажа мебели') >= 0 && incSug.indexOf('Аренда офиса') < 0, incSug);
  await page.click('button[data-act="closeform"]');

  // 10c. настройки: справочник статей
  await page.click('.nav button[data-v="settings"]');
  ok('settings opens on articles tab', (await page.locator('text=Справочник статей').count()) >= 1 && (await page.locator('button[data-act="art-open"]').count()) > 10);
  ok('articles grouped by activity', (await page.locator('.dayh:has-text("Операционная")').count()) === 1 && (await page.locator('.dayh:has-text("Инвестиционная")').count()) === 1 && (await page.locator('.dayh:has-text("Финансовая")').count()) === 1);
  await page.click('button[data-act="art-open"][data-id=""]');
  await page.fill('#a-name', 'Тестовая статья');
  await page.click('button[data-act="art-act"][data-v="investing"]');
  await page.click('button[data-act="art-save"]');
  ok('article added', await page.evaluate(() => KCApp.S.meta.articles.some(a => a.name === 'Тестовая статья' && a.activity === 'investing' && !a.fixed)));
  await page.click('button[data-act="art-open"][data-id=""]');
  await page.fill('#a-name', 'тестовая СТАТЬЯ');
  await page.click('button[data-act="art-save"]');
  ok('duplicate name blocked', (await txt('#aerrs')).indexOf('Такая статья уже есть') >= 0);
  await page.click('button[data-act="art-close"]');
  // переименование меняет операции
  const usedBefore = await page.evaluate(() => KCApp.S.records.filter(r => r.article === 'Закупка материала').length);
  await page.locator('button[data-act="art-open"]:has-text("Закупка материала")').first().click();
  ok('kind locked for used article', (await page.locator('button[data-act="art-kind"][disabled]').count()) === 2);
  await page.fill('#a-name', 'Закупка материалов');
  await page.click('button[data-act="art-act"][data-v="operating"]');
  await page.click('button[data-act="art-save"]');
  const renamed = await page.evaluate(() => ({ old: KCApp.S.records.filter(r => r.article === 'Закупка материала').length, nw: KCApp.S.records.filter(r => r.article === 'Закупка материалов').length }));
  ok('rename updates all operations', renamed.old === 0 && renamed.nw === usedBefore, [usedBefore, renamed]);
  // постоянная статья: переключатель
  await page.locator('button[data-act="art-open"]:has-text("Налоги")').first().click();
  await page.click('button[data-act="art-fixed"]');
  await page.click('button[data-act="art-save"]');
  ok('fixed flag saved', await page.evaluate(() => KCApp.S.meta.articles.find(a => a.name === 'Налоги').fixed === true));
  // архив используемой и удаление неиспользуемой
  await page.locator('button[data-act="art-open"]:has-text("Услуги подрядчиков")').first().click();
  await page.click('button[data-act="art-archive"]');
  ok('archived hidden from picker', await page.evaluate(() => KC.suggestCatalog(KCApp.S.meta.articles, KCApp.S.records, '', -1, 50).indexOf('Услуги подрядчиков') < 0 && KCApp.S.records.some(r => r.article === 'Услуги подрядчиков')));
  await page.locator('button[data-act="art-open"]:has-text("Тестовая статья")').first().click();
  await page.click('button[data-act="art-delete"]');
  ok('unused article deleted with tombstone', await page.evaluate(() => !KCApp.S.meta.articles.some(a => a.name === 'Тестовая статья') && KCApp.S.meta.deletedArticles.length === 1));
  ok('catalog edits stamped', await page.evaluate(() => KCApp.S.meta.articles.filter(a => a.name === 'Закупка материалов')[0].updatedAt > '2026'));
  // системные статьи не редактируются
  await page.locator('button[data-act="art-open"]:has-text("Нераспределённые расходы")').first().click();
  ok('system article locked', (await page.locator('button[data-act="art-save"]').count()) === 0);
  await page.click('button[data-act="art-close"]');
  // статьи из записей попадают в справочник сами (как при загрузке сводной таблицы)
  await page.evaluate(() => { const r = KC.newRecord({ wallet: 'cash', amount: -500, article: 'Статья из таблицы' }); KCApp.commit({ newRecords: [r] }); });
  await page.reload();
  const fromTable = await page.evaluate(() => KCApp.S.meta.articles.find(a => a.name === 'Статья из таблицы'));
  ok('unknown article added to catalog with undefined activity', fromTable && fromTable.activity === 'none' && fromTable.kind === 'expense', fromTable);
  await page.click('.nav button[data-v="settings"]');
  ok('warning about undefined activity', (await page.locator('.banner:has-text("Не указан вид деятельности")').count()) === 1);

  // 11. редактирование, удаление и отмена
  await page.click('.nav button[data-v="ops"]');
  const first = page.locator('#list .op').first();
  await first.click();
  ok('edit form opened', (await page.locator('#sheet button[data-act="deleterec"]').count()) === 1);
  const live0 = await page.evaluate(() => KCApp.S.records.filter(r => !r.deleted).length);
  await page.click('button[data-act="deleterec"]');
  const live1 = await page.evaluate(() => KCApp.S.records.filter(r => !r.deleted).length);
  ok('soft delete', live1 < live0, [live0, live1]);
  ok('record still stored', await page.evaluate(() => KCApp.S.records.some(r => r.deleted)));
  await page.click('#toast button');
  const live2 = await page.evaluate(() => KCApp.S.records.filter(r => !r.deleted).length);
  ok('undo restores', live2 === live0, [live0, live2]);

  // 12. копия
  await page.click('.nav button[data-v="settings"]');
  await page.click('button[data-act="stab"][data-v="data"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="backup"]')]);
  const p = await dl.path(); const fs = require('fs'); const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  ok('backup json', json.app === 'kubcrafter-money' && json.records.length === (await page.evaluate(() => KCApp.S.records.length)), json.records.length);
  ok('backup filename', /kubcrafter-dengi-test-\d{4}-\d{2}-\d{2}\.json/.test(dl.suggestedFilename()), dl.suggestedFilename());
  // восстановление
  await page.evaluate(() => { KCApp.S.records.length = 2; KCApp.commit({}); });
  await page.setInputFiles('#restorefile', p);
  await page.waitForTimeout(300);
  ok('restore', (await page.evaluate(() => KCApp.S.records.length)) === json.records.length);

  // 13. журнал и сброс тестовой базы
  ok('log has entries', (await page.locator('table.tb tr').count()) >= 3);
  await page.click('button[data-act="resetTest"]');
  ok('reset empties', (await page.evaluate(() => KCApp.S.records.length)) === 0);

  // 14. широкий экран: панель и боковая навигация
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.reload();
  await page.click('button[data-act="seed"]');
  ok('desktop panel visible', await page.locator('.desk').isVisible());
  ok('desktop nav left', (await page.evaluate(() => document.querySelector('.nav').getBoundingClientRect().left)) === 0 && (await page.evaluate(() => document.querySelector('.nav').getBoundingClientRect().width)) < 100);
  ok('no horizontal overflow desktop', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 390, height: 844 });
  ok('no horizontal overflow phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth));
  ok('no js errors', errors.length === 0, errors);
  await page.screenshot({ path: 'shot_phone.png' });
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(2); });
