const KC = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL', name, '\n  got ', g, '\n  want', w); }
}
const T = '2026-11-12';
const R = (f) => KC.newRecord(f);

// деньги
eq('parse 1', KC.parseMoney('48 200,50'), 4820050);
eq('parse 2', KC.parseMoney('−1 000'), -100000);
eq('parse 3', KC.parseMoney('abc'), NaN === NaN ? 0 : KC.parseMoney('abc')); // NaN check below
eq('parse nan', Number.isNaN(KC.parseMoney('abc')), true);
eq('parse num', KC.parseMoney(12.34), 1234);
eq('fmt', KC.formatMoney(-4820000), '\u2212' + '48\u00A0200\u00A0₽');
eq('fmt sign', KC.formatMoney(26000000, { sign: true }), '+260\u00A0000\u00A0₽');
eq('fmt kop', KC.formatMoney(1250), '12,50\u00A0₽');

// даты
eq('dayLabel today', KC.dayLabel('2026-11-12', T), 'Сегодня, 12 ноября');
eq('dayLabel yest', KC.dayLabel('2026-11-11', T), 'Вчера, 11 ноября');
eq('dayLabel other', KC.dayLabel('2026-11-10', T), '10 ноября, вторник');
eq('shiftMonth', KC.shiftMonth('2026-01', -1), '2025-12');
eq('shiftMonth2', KC.shiftMonth('2026-12', 1), '2027-01');
eq('parseDate ru', KC.parseDateInput('03.10.2026'), '2026-10-03');
eq('parseDate serial', KC.parseDateInput(46023), '2026-01-01');
eq('diffDays', KC.diffDays('2026-11-12', '2026-11-08'), 4);

// перевод: две парные записи, остатки
const [o, i] = KC.makeTransfer({ from: 'alfa', to: 'cash', amount: 5000000, date: T });
eq('transfer pair', [o.pairId === i.pairId && !!o.pairId, o.amount, i.amount], [true, -5000000, 5000000]);
eq('transfer states', [o.bankState, i.bankState], ['unconfirmed', 'none']);
const bal = KC.balances([R({ wallet: 'alfa', amount: 10000000, source: 'bank' }), o, i]);
eq('alfa balance includes unconfirmed transfer', bal.wallets[0].balance, 5000000);
eq('alfa unconfirmed shown', bal.wallets[0].unconfirmed, -5000000);
eq('no in-transit field', bal.inTransit, undefined);
eq('cash', bal.wallets[1].balance, 5000000);
eq('total not distorted', bal.total, 10000000);
// старый перевод в состоянии pending тоже входит в остаток и показан как неподтверждённый
{
  const old = Object.assign({}, o, { bankState: 'pending' });
  const b2 = KC.balances([R({ wallet: 'alfa', amount: 10000000, source: 'bank' }), old, i]);
  eq('legacy pending transfer in balance', [b2.wallets[0].balance, KC.bankStateOf(old)], [5000000, 'unconfirmed']);
  const manual = R({ wallet: 'alfa', amount: -250000, date: T });
  const legacy = Object.assign({}, manual, { bankState: 'pending' });
  eq('manual alfa record is unconfirmed and in balance', [manual.bankState, KC.balances([manual]).wallets[0].balance, KC.balances([legacy]).wallets[0].balance, KC.balances([manual]).wallets[0].unconfirmed], ['unconfirmed', -250000, -250000, -250000]);
}
// «пары не найдено» из импорта — не номер пары
{
  const a = R({ wallet: 'alfa', amount: -100, kind: 'transfer_out', pairId: 'пары не найдено', source: 'import' });
  const b = R({ wallet: 'cash', amount: 100, kind: 'transfer_in', pairId: 'пары не найдено', source: 'import' });
  eq('fake pair id is not a pair', [KC.hasPair(a), KC.hasPair(o), KC.unpairedTransfers([a, b, o, i]).length], [false, true, 2]);
}
// переводы и корректировки не входят в отчёты и оборот, остатки сохраняют
{
  const adj = R({ wallet: 'alfa', amount: 123400, article: 'Корректировка остатка', project: 'Икс', date: T, source: 'import' });
  const inc = R({ wallet: 'alfa', amount: 1000000, article: 'Продажа мебели', project: 'Икс', date: T, source: 'import' });
  const all = [adj, inc, o, i];
  eq('projectStats off-report', KC.projectStats(all).list.map(x => [x.project, x.income, x.expense]), [['Икс', 1000000, 0]]);
  eq('projectFinance off-report', KC.projectFinance(all, 'Икс', []).income, 1000000);
  eq('periodIncomes off-report', KC.periodIncomes(all, T, T).map(x => x.id), [inc.id]);
  eq('expenseSums off-report', KC.expenseSumsByArticle(all, T, T), {});
  eq('balance keeps adjustment', KC.balances([adj]).wallets[0].balance, 123400);
}
// Промос: неподтверждённое входит в остаток
const p = R({ wallet: 'promos', amount: -4820000, date: T });
eq('promos state', p.bankState, 'unconfirmed');
const bal2 = KC.balances([p]);
eq('promos balance incl unconfirmed', [bal2.wallets[2].balance, bal2.wallets[2].unconfirmed], [-4820000, -4820000]);
// плановые и удалённые не считаются
const pl = R({ wallet: 'cash', amount: 100000, planned: true }), del = R({ wallet: 'cash', amount: 200000 }); del.deleted = true;
eq('planned/deleted ignored', KC.balances([pl, del]).wallets[1].balance, 0);
// скрытый кошелёк не входит в итог
eq('credit hidden', KC.balances([R({ wallet: 'credit', amount: -163098633 })]).total, 0);

// валидация
eq('validate', KC.validate({ wallet: 'cash', amount: 0, date: T }), ['Введите сумму']);
eq('validate wallet', KC.validate({ wallet: 'x', amount: 100, date: T }), ['Не выбран кошелёк']);
eq('validate transfer same', KC.validateTransfer({ from: 'cash', to: 'cash', amount: 1, date: T }), ['Кошельки должны отличаться']);
eq('missing', KC.missingFields(R({ wallet: 'cash', amount: -1, counterparty: 'A' })), ['статья', 'проект']);
eq('transfer no missing', KC.missingFields(o), []);

// поиск: текст и сумма
const rs = [
  R({ wallet: 'cash', amount: -4820000, counterparty: 'ООО «Образец-Плита»', description: 'ЛДСП, 6 листов', project: 'Образец 1', article: 'Закупка материала' }),
  R({ wallet: 'cash', amount: -730000, description: 'Фурнитура на объект' }),
  R({ wallet: 'alfa', amount: 26000000, counterparty: 'Заказчик «Образец-2»', article: 'Продажа мебели', project: 'Образец 2' })
];
eq('search text', KC.filterRecords(rs, { query: 'плита' }).length, 1);
eq('search two tokens', KC.filterRecords(rs, { query: 'образец лдсп' }).length, 1);
eq('search amount', KC.filterRecords(rs, { query: '48200' }).length, 1);
eq('search amount with space', KC.filterRecords(rs, { query: '48 200' }).length, 1);
eq('search amount partial', KC.filterRecords(rs, { query: '260' }).length, 1);
eq('search amount kop', KC.filterRecords(rs, { query: '48200,00' }).length, 1);
eq('search none', KC.filterRecords(rs, { query: 'нет такого' }).length, 0);
eq('filter type', KC.filterRecords(rs, { type: 'income' }).length, 1);
eq('filter unfilled', KC.filterRecords(rs, { unfilled: true }).length, 1);

// подсказки
const hist = [
  R({ wallet: 'cash', amount: -100, counterparty: 'Образец-Плита', article: 'Закупка материала', date: '2026-11-01' }),
  R({ wallet: 'cash', amount: -100, counterparty: 'Образец-Плита', article: 'Закупка материала', date: '2026-11-02' }),
  R({ wallet: 'cash', amount: -100, counterparty: 'Образец-Плита', article: 'Услуги подрядчиков', date: '2026-11-03' }),
  R({ wallet: 'cash', amount: -100, counterparty: 'Образец-Монтаж', article: 'Услуги подрядчиков', date: '2026-11-03' }),
  R({ wallet: 'cash', amount: 100, counterparty: 'Образец-Плита', article: 'Возвраты от поставщиков', date: '2026-11-04' })
];
eq('suggest cp', KC.suggestCounterparties(hist, 'обр'), ['Образец-Плита', 'Образец-Монтаж']);
eq('suggest cp substr', KC.suggestCounterparties(hist, 'монт'), ['Образец-Монтаж']);
eq('suggest article for (expense)', KC.suggestArticleFor(hist, 'образец-плита', -1), 'Закупка материала');
eq('suggest article for (income)', KC.suggestArticleFor(hist, 'образец-плита', 1), 'Возвраты от поставщиков');
eq('suggest article none', KC.suggestArticleFor(hist, 'Новый', -1), null);

// проекты
const ps = KC.projectStats([
  R({ wallet: 'alfa', amount: 62000000, project: 'А' }), R({ wallet: 'alfa', amount: -31000000, project: 'А' }),
  R({ wallet: 'cash', amount: -7800000, project: 'Б' }), R({ wallet: 'cash', amount: -100, project: '' }), o, i
]);
eq('project A', [ps.list[0].project, ps.list[0].profit, ps.list[0].margin], ['А', 31000000, 0.5]);
eq('project no income', ps.list.find(x => x.project === 'Б').margin, null);
eq('transfers excluded', ps.total.income, 62000000);

// ---- сверка выписки Альфы ----
function alfaScenario() {
  const [o1, i1] = KC.makeTransfer({ from: 'alfa', to: 'cash', amount: 5000000, date: '2026-11-12' });
  const sale = R({ wallet: 'alfa', amount: 26000000, date: '2026-11-11', counterparty: 'Заказчик' });
  return { recs: [o1, i1, sale], out: o1, sale };
}
{
  const s = alfaScenario();
  const rows = KC.sampleStatement('alfa', '2026-11-12');
  const res = KC.reconcile({ records: s.recs, wallet: 'alfa', rows });
  // продажа 260 000: один кандидат -> авто; снятие 50 000 (2 строки, 1 запись) -> решение по обеим; новая 12 400 -> добавлена
  eq('alfa matched', res.stats.matched, 1);
  eq('alfa ambiguous decisions', res.decisions.filter(d => d.type === 'choose').length, 2);
  eq('alfa auto-added', res.stats.added, 1);
  eq('alfa added article', res.newRecords[0].article, 'Нераспределённые расходы');
  eq('alfa period', res.period, { from: '2026-11-10', to: '2026-11-12' });
  // повторная загрузка той же выписки: дублей нет
  const applied = s.recs.map(r => { const p = res.patches.find(x => x.id === r.id); return p ? Object.assign({}, r, p.patch) : r; }).concat(res.newRecords);
  const again = KC.reconcile({ records: applied, wallet: 'alfa', rows });
  eq('re-upload duplicates', [again.stats.duplicates, again.stats.matched, again.stats.added], [4 - 2, 0, 0]);
  // решения: привязать ближайшую строку к записи, вторую добавить как новую
  const d1 = res.decisions.find(d => d.type === 'choose' && d.row.date === '2026-11-12');
  const d2 = res.decisions.find(d => d.type === 'choose' && d.row.date === '2026-11-10');
  const r1 = KC.resolveDecision(d1, { recId: s.out.id }, s.recs);
  eq('resolve link', r1.patches[0].patch.bankState, 'confirmed');
  const r2 = KC.resolveDecision(d2, 'new', s.recs);
  eq('resolve new', [r2.newRecords.length, r2.newRecords[0].bankState], [1, 'confirmed']);
  // порядок кандидатов: ближайшая дата первой
  eq('candidate is the pending record', d1.candidates, [s.out.id]);
}
// Альфа: перевод без пары из выписки
{
  const res = KC.reconcile({ records: [], wallet: 'alfa', rows: [{ date: '2026-11-05', amount: -5000000, counterparty: 'Альфа-Банк', purpose: 'Снятие наличных', docNo: '1' }] });
  eq('unpaired transfer', [res.newRecords[0].kind, KC.unpairedTransfers(res.newRecords).length], ['transfer_out', 1]);
}
// допуск 4 дня
{
  const rec = R({ wallet: 'alfa', amount: -100000, date: '2026-11-01' });
  const inTol = KC.reconcile({ records: [rec], wallet: 'alfa', rows: [{ date: '2026-11-05', amount: -100000, docNo: 'a' }] });
  const outTol = KC.reconcile({ records: [rec], wallet: 'alfa', rows: [{ date: '2026-11-06', amount: -100000, docNo: 'a' }] });
  eq('tolerance 4 days in', inTol.stats.matched, 1);
  eq('tolerance 5 days out', [outTol.stats.matched, outTol.stats.added], [0, 1]);
}
// ---- Промос: наш учёт главный ----
{
  const t = '2026-11-12';
  const buy = R({ wallet: 'promos', amount: -4820000, date: '2026-11-12', source: 'agent' });
  const old = R({ wallet: 'promos', amount: -999000, date: '2026-11-08', source: 'agent' }); // в периоде, но в выписке нет
  const later = R({ wallet: 'promos', amount: -111000, date: '2026-11-20', source: 'agent' }); // после периода
  const rows = KC.sampleStatement('promos', t);
  const res = KC.reconcile({ records: [buy, old, later], wallet: 'promos', rows });
  eq('promos matched', res.stats.matched, 1);
  eq('promos only in bank', res.decisions.filter(d => d.type === 'only_in_bank').length, 2);
  eq('promos absent', res.decisions.filter(d => d.type === 'absent').map(d => d.recId), [old.id]);
  eq('promos later untouched', res.patches.some(p => p.id === later.id), false);
  eq('promos nothing auto-added', res.newRecords.length, 0);
  const rr = KC.resolveDecision(res.decisions.find(d => d.type === 'only_in_bank'), 'add', []);
  eq('promos add from bank', [rr.newRecords[0].wallet, rr.newRecords[0].bankState], ['promos', 'confirmed']);
  const ig = KC.resolveDecision(res.decisions.find(d => d.type === 'only_in_bank'), 'ignore', []);
  const res2 = KC.reconcile({ records: [buy], wallet: 'promos', rows: rows, ignored: ig.ignoredKeys });
  eq('ignored row stays ignored', res2.decisions.filter(d => d.type === 'only_in_bank').length, 1);
  const del = KC.resolveDecision({ type: 'absent', recId: old.id }, 'delete', [old]);
  eq('absent delete', del.patches[0].patch.deleted, true);
}

// ---- чтение таблицы выписки ----
{
  const table = [['Выписка по счёту'], [], ['Дата проводки', 'Номер документа', 'Контрагент', 'Назначение платежа', 'Дебет', 'Кредит'],
    ['03.10.2026', '77', 'ООО Рога', 'Оплата по счёту', '12 400,00', ''], ['04.10.2026', '78', 'Заказчик', 'Оплата', '', '260 000,00'], ['Итого', '', '', '', '', '']];
  const h = KC.findHeaderRow(table); const m = KC.detectColumns(table[h]);
  const out = KC.rowsFromTable(table, h, m);
  eq('header row', h, 2);
  eq('rows parsed', out.rows.map(r => [r.date, r.amount, r.docNo]), [['2026-10-03', -1240000, '77'], ['2026-10-04', 26000000, '78']]);
}
// ---- импорт сводной таблицы ----
{
  const objs = [
    { 'ID': 'f1', 'Дата операции': '2026-10-01', 'Промос': '', 'Наличные': -1450000 / 100, 'Альфа-банк': '', 'Факт': 'Да', 'Описание': 'Ручки', 'Статья': 'Закупка материала', 'Проекты': 'Образец 1', 'Контрагент': 'Образец-Фурнитура' },
    { 'ID': 'f2', 'Дата операции': '05.10.2026', 'Промос': '', 'Наличные': '', 'Альфа-банк': -500000, 'Факт': 'Да', 'Статья': 'Вывод в наличные со счёта' },
    { 'ID': 'f3', 'Дата операции': '2026-10-02', 'Промос': 1000, 'Факт': 'Нет', 'Статья': 'Продажа мебели без НДС' },
    { 'ID': 'f4', 'Дата операции': '', 'Наличные': 1 },
    { 'ID': 'f1', 'Дата операции': '2026-10-01', 'Наличные': -14500 }
  ];
  const res = KC.importSummary(objs, []);
  eq('import count', [res.records.length, res.skipped, res.duplicates], [3, 1, 1]);
  eq('import cash', [res.records[0].wallet, res.records[0].amount, res.records[0].planned], ['cash', -1450000, false]);
  eq('import transfer by article', res.records[1].kind, 'transfer_out');
  eq('import planned', res.records[2].planned, true);
  const again = KC.importSummary(objs, res.records);
  eq('import twice no dups', again.records.length, 0);
}
// колонка «Альфа-банк (₽)» и виды деятельности по умолчанию
{
  const objs = [{ 'ID': 'a1', 'Дата операции': '2026-10-01', 'Альфа-банк (₽)': -1000, 'Кредит личных средств Сидорова Д.В.': '', 'Статья': 'Закупка материала' },
    { 'ID': 'a2', 'Дата операции': '2026-10-02', 'Альфа-банк (₽)': 500, 'Статья': 'Получение кредитов и займов' },
    { 'ID': 'a3', 'Дата операции': '2026-10-03', 'Альфа-банк (₽)': 7, 'Статья': 'Выдуманная статья' }];
  const res = KC.importSummary(objs, []);
  eq('alfa with currency suffix', [res.records.length, res.skipped, res.records[0].wallet], [3, 0, 'alfa']);
  const cat = KC.ensureCatalog([], res.records).filter(a => !a.system);
  eq('default activities', cat.map(a => a.activity), ['operating', 'financing', 'none']);
}
// ---- копии ----
{
  const samples = KC.sampleRecords('2026-11-12');
  const b = KC.backupObject({ records: samples, namespace: 'test' });
  const restored = JSON.parse(JSON.stringify(b));
  eq('backup valid', KC.validateBackup(restored), '');
  eq('backup roundtrip balances', KC.balances(restored.records), KC.balances(samples));
  eq('backup invalid', KC.validateBackup({ app: 'x' }), 'Это не файл копии Kubcrafter');
  const table = KC.recordsToTable(samples);
  eq('table width', table[0].length, table[1].length);
  eq('table rows', table.length, samples.length + 1);
}
// ---- тестовые данные ведут себя как задумано ----
{
  const samples = KC.sampleRecords(T);
  const b = KC.balances(samples);
  eq('sample has unconfirmed alfa in balance', b.wallets[0].unconfirmed !== 0, true);
  eq('sample unfilled', KC.unfilledCount(samples) >= 2, true);
  const g = KC.groupByDay(KC.filterRecords(samples, { month: '2026-11' }));
  eq('grouped days sorted desc', g.every((x, i) => i === 0 || g[i - 1].date > x.date), true);
}
// защита: запись, уже привязанную к строке выписки, нельзя привязать второй раз
{
  const rec = R({ wallet: 'alfa', amount: -5000000, date: '2026-11-12' });
  const rows = [{ date: '2026-11-12', amount: -5000000, docNo: 'a' }, { date: '2026-11-10', amount: -5000000, docNo: 'b' }];
  const res = KC.reconcile({ records: [rec], wallet: 'alfa', rows });
  const ds = res.decisions.filter(d => d.type === 'choose');
  const first = KC.resolveDecision(ds[0], { recId: rec.id }, [rec]);
  const linked = Object.assign({}, rec, first.patches[0].patch);
  const second = KC.resolveDecision(ds[1], { recId: rec.id }, [linked]);
  eq('double link guard', [first.patches.length, second.patches.length, second.newRecords.length], [1, 0, 1]);
}
// ---- калькулятор постоянных расходов (правило Дмитрия) ----
{
  const Rr = (w, a, d, p, art) => R({ wallet: w, amount: a, date: d, project: p, article: art || '' });
  const recs = [
    Rr('alfa', 10000, '2026-01-10', 'A'), Rr('alfa', 10000, '2026-01-20', 'A'),     // заказ A: поступления 20000, период 10-20 января
    Rr('alfa', 60000, '2026-01-15', 'B'),                                            // заказ B внутри периода
    Rr('alfa', 90000, '2026-02-05', 'B'),                                            // вне периода
    Rr('cash', -6000, '2026-01-12', 'A', 'Закупка материала'),                       // переменный расход A
    Rr('cash', -8000, '2026-01-12', '', 'Аренда офиса'),                             // постоянный (без проекта) в периоде
    Rr('cash', -5000, '2026-02-05', '', 'Аренда офиса'),                             // вне периода
    Rr('cash', -1000, '2026-01-13', 'B', 'Закупка материала')                        // переменный расход B
  ];
  const pf = KC.projectFinance(recs, 'A');
  eq('project finance', [pf.income, pf.variable, pf.gross, pf.firstPay, pf.lastPay], [20000, 6000, 14000, '2026-01-10', '2026-01-20']);
  eq('project finance margin', pf.margin, 0.7);
  eq('project by article', pf.byArticle, [{ article: 'Закупка материала', sum: 6000 }]);
  const res = KC.projectResult(recs, 'A', { from: pf.firstPay, to: pf.lastPay, mode: 'noproject' });
  eq('alloc share', [res.alloc.ownIncome, res.alloc.allIncome, res.alloc.ordersCount, res.alloc.share], [20000, 80000, 2, 0.25]);
  eq('alloc fixed pool', [res.alloc.fixedTotal, res.alloc.fixedCount, res.alloc.fixedAllocated], [8000, 1, 2000]);
  eq('net result', [res.net, res.netMargin], [20000 - 6000 - 2000, 12000 / 20000]);
  // свой период: захватывает весь феврали -> доля меняется
  const wide = KC.fixedAllocation(recs, 'A', { from: '2026-01-01', to: '2026-02-28', mode: 'noproject' });
  eq('custom period', [wide.allIncome, wide.fixedTotal, wide.share], [170000, 13000, 20000 / 170000]);
  // режим «по статьям»: постоянной отмечена только «Аренда офиса»
  const art = KC.projectResult(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Аренда офиса'] });
  eq('articles mode', [art.alloc.fixedTotal, art.alloc.fixedAllocated, art.variable], [8000, 2000, 6000]);
  // статья проекта, отмеченная постоянной, уходит из переменных в общий пул
  const art2 = KC.projectResult(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Закупка материала'] });
  eq('fixed article of project leaves variable', [art2.variable, art2.alloc.fixedTotal], [0, 7000]);
  // нет поступлений в периоде: доли нет, постоянные не распределяются
  const none = KC.fixedAllocation(recs, 'Z', { from: '2026-03-01', to: '2026-03-31', mode: 'noproject' });
  eq('no income -> no share', [none.share, none.fixedAllocated], [null, 0]);
  // переводы и плановые не участвуют
  const [to1, ti1] = KC.makeTransfer({ from: 'alfa', to: 'cash', amount: 99999, date: '2026-01-14' });
  const plan = R({ wallet: 'alfa', amount: 5000000, date: '2026-01-14', project: 'A', planned: true });
  const res2 = KC.projectResult(recs.concat([to1, ti1, plan]), 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'noproject' });
  eq('transfers/planned ignored', [res2.income, res2.alloc.allIncome], [20000, 80000]);
  eq('project ops list', KC.projectOps(recs, 'B').length, 3);
  eq('expense articles', KC.expenseArticles(recs), ['Аренда офиса', 'Закупка материала']);
}

// фильтр «без проекта»
{
  const a = R({ wallet: 'cash', amount: -100, project: 'X' }), b = R({ wallet: 'cash', amount: -100, project: '' });
  eq('filter no project', KC.filterRecords([a, b], { project: '__none__' }).map(r => r.project), ['']);
}

// предложение постоянных статей и нераспределённые расходы
{
  eq('suggest fixed articles', KC.suggestFixedArticles(['Аренда офиса', 'Зарплата производственного персонала', 'Закупка материала', 'Содержание цеха', 'Услуги подрядчиков', 'Оплата сервисов', 'СММ специалист', 'Интернет']),
    ['Аренда офиса', 'Зарплата производственного персонала', 'Содержание цеха', 'Оплата сервисов', 'СММ специалист', 'Интернет']);
  const recs = [
    R({ wallet: 'alfa', amount: 10000, date: '2026-01-10', project: 'A' }),
    R({ wallet: 'cash', amount: -3000, date: '2026-01-11', project: '', article: 'Аренда офиса' }),
    R({ wallet: 'cash', amount: -700, date: '2026-01-11', project: '', article: 'Прочее' })
  ];
  const a = KC.fixedAllocation(recs, 'A', { from: '2026-01-10', to: '2026-01-12', mode: 'articles', fixedArticles: ['Аренда офиса'] });
  eq('unassigned shown', [a.fixedTotal, a.fixedAllocated, a.unassignedTotal, a.unassignedCount], [3000, 3000, 700, 1]);
}

// ---- справочник статей ----
{
  const cat = KC.sampleCatalog();
  eq('catalog has fixed', KC.fixedArticleNames(cat).sort(), ['Аренда офиса', 'Аренда цеха', 'Зарплата административного персонала', 'Зарплата производственного персонала', 'Интернет и связь', 'Оплата сервисов', 'СММ специалист', 'Содержание офиса', 'Содержание цеха']);
  eq('income article never fixed', KC.newArticle({ name: 'X', kind: 'income', fixed: true }).fixed, false);
  eq('find case-insensitive', KC.findArticle(cat, 'закупка  материала') === null, true); // лишние пробелы не равны
  eq('find exact ci', KC.findArticle(cat, 'закупка материала').name, 'Закупка материала');
  eq('draft empty', KC.validateArticleDraft(cat, { name: '  ' }), ['Введите название статьи']);
  eq('draft duplicate', KC.validateArticleDraft(cat, { name: 'АРЕНДА ОФИСА' }), ['Такая статья уже есть']);
  eq('draft duplicate ignore self', KC.validateArticleDraft(cat, { name: 'Аренда офиса' }, KC.findArticle(cat, 'Аренда офиса').id), []);
  // из записей добавляются недостающие статьи, вид деятельности не определён; системные есть всегда
  const rs = [R({ wallet: 'cash', amount: -100, article: 'Новая расходная' }), R({ wallet: 'cash', amount: 100, article: 'Новая приходная' }), R({ wallet: 'cash', amount: -5, article: 'новая расходная' })];
  const added = KC.ensureCatalog([], rs);
  eq('ensure added', added.map(a => [a.name, a.kind, a.activity, a.system]), [['Нераспределённые расходы', 'expense', 'none', true], ['Нераспределённые приходы', 'income', 'none', true], ['Новая расходная', 'expense', 'none', false], ['Новая приходная', 'income', 'none', false]]);
  eq('ensure idempotent', KC.ensureCatalog(added, rs).length, 0);
  // подсказки только из справочника, по виду операции
  const hist = [R({ wallet: 'cash', amount: -1, article: 'Закупка материала' }), R({ wallet: 'cash', amount: -1, article: 'Закупка материала' }), R({ wallet: 'cash', amount: -1, article: 'Услуги подрядчиков' })];
  eq('suggest expense by usage', KC.suggestCatalog(cat, hist, '', -1, 3), ['Закупка материала', 'Услуги подрядчиков', 'Аренда офиса']);
  eq('suggest income only', KC.suggestCatalog(cat, hist, 'продаж', 1), ['Продажа мебели']);
  eq('suggest text', KC.suggestCatalog(cat, hist, 'содерж', -1), ['Содержание офиса', 'Содержание цеха']);
  eq('suggest excludes system', KC.suggestCatalog(KC.ensureCatalog([], rs), [], 'нераспр', -1), []);
  eq('rename patches', KC.renameArticlePatches(hist, 'закупка материала', 'Закупка материалов').length, 2);
  eq('activity name', KC.activityName('investing'), 'Инвестиционная');
  eq('activity unknown', KC.activityName('zzz'), 'Не определена');
}
// ---- завершение проекта: ручной отбор поступлений ----
{
  const mk = (a, d, p, id) => Object.assign(R({ wallet: 'alfa', amount: a, date: d, project: p }), { id });
  const recs = [mk(10000, '2026-01-10', 'A', 'a1'), mk(10000, '2026-01-20', 'A', 'a2'), mk(60000, '2026-01-15', 'B', 'b1'), mk(5000, '2026-01-16', '', 'n1'),
    R({ wallet: 'cash', amount: -8000, date: '2026-01-12', project: '', article: 'Аренда офиса' })];
  const list = KC.periodIncomes(recs, '2026-01-10', '2026-01-20');
  eq('period incomes sorted', list.map(r => r.id), ['a1', 'b1', 'n1', 'a2']);
  // по умолчанию: поступления с проектом
  const def = KC.fixedAllocation(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Аренда офиса'] });
  eq('default incomes', [def.allIncome, def.share], [80000, 0.25]);
  // ручной отбор: исключили заказ B -> доля 100%
  const only = KC.fixedAllocation(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Аренда офиса'], incomeIds: ['a1', 'a2'] });
  eq('manual exclusion', [only.allIncome, only.share, only.fixedAllocated], [20000, 1, 8000]);
  // поступление без проекта включили вручную
  const withNo = KC.fixedAllocation(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Аренда офиса'], incomeIds: ['a1', 'a2', 'b1', 'n1'] });
  eq('include no-project income', [withNo.allIncome, withNo.ordersCount], [85000, 2]);
  // исключили своё поступление: в результат оно не входит
  const res = KC.projectResult(recs, 'A', { from: '2026-01-10', to: '2026-01-20', mode: 'articles', fixedArticles: ['Аренда офиса'], incomeIds: ['a1', 'b1'] });
  eq('own income excluded from result', [res.income, res.alloc.ownIncome], [10000, 10000]);
  const sums = KC.expenseSumsByArticle(recs, '2026-01-10', '2026-01-20');
  eq('expense sums', sums, { 'Аренда офиса': 8000 });
}

// ---- слияние справочника и статусов проектов с облаком ----
{
  const A = (id, name, upd, extra) => Object.assign({ id, name, kind: 'expense', activity: 'operating', fixed: false, archived: false, system: false, updatedAt: upd }, extra || {});
  // новая правка побеждает, новые статьи с обеих сторон сохраняются
  const m1 = KC.mergeArticles([A('a1', 'Аренда', '2026-01-01', { fixed: false }), A('a2', 'Только тут', '2026-01-01')], [], [A('a1', 'Аренда', '2026-02-01', { fixed: true }), A('a3', 'Только там', '2026-01-01')], []);
  eq('merge newer wins', m1.articles.find(a => a.id === 'a1').fixed, true);
  eq('merge union', m1.articles.map(a => a.id), ['a1', 'a2', 'a3']);
  // удаление с одной стороны не воскресает
  const m2 = KC.mergeArticles([A('a1', 'X', '2026-01-01')], [], [], [{ id: 'a1', at: '2026-03-01' }]);
  eq('tombstone removes', [m2.articles.length, m2.deleted.length], [0, 1]);
  const m3 = KC.mergeArticles([], [{ id: 'a1', at: '2026-03-01' }], [A('a1', 'X', '2026-01-01')], []);
  eq('tombstone beats remote copy', m3.articles.length, 0);
  // две статьи с одним названием из разных устройств схлопываются
  const m4 = KC.mergeArticles([A('b2', 'Интернет', '2026-01-02')], [], [A('b1', 'интернет', '2026-01-03')], []);
  eq('same name collapses', [m4.articles.length, m4.articles[0].id, m4.deleted.map(d => d.id)], [1, 'b1', ['b2']]);
  eq('merge idempotent', KC.mergeArticles(m1.articles, m1.deleted, m1.articles, m1.deleted).articles.length, 3);
  // проекты
  const p = KC.mergeProjects({ A: { status: 'done', doneAt: '2026-01-05', updatedAt: '2026-01-05' } }, { A: { status: 'work', updatedAt: '2026-02-01' }, B: { status: 'done', doneAt: '2026-01-09' } });
  eq('projects newer wins', [p.A.status, p.B.status], ['work', 'done']);
  const back = KC.projectsFromList(KC.projectsToList(p));
  eq('projects list roundtrip', back, p);
  eq('new article has updatedAt', typeof KC.newArticle({ name: 'Z' }).updatedAt, 'string');
}

// ---- слияние решений, журнала, истории выписок ----
{
  const d1 = { id: 'd1', type: 'choose' }, d1r = { id: 'd1', type: 'choose', resolvedAt: '2026-03-01' }, d2 = { id: 'd2', type: 'absent' };
  eq('decision resolved wins', KC.mergeDecisions([d1], [d1r, d2]).map(d => [d.id, !!d.resolvedAt]), [['d1', true], ['d2', false]]);
  eq('decision resolved wins (reverse)', KC.mergeDecisions([d1r], [d1]).map(d => !!d.resolvedAt), [true]);
  const L = (id, at) => ({ id, at, action: 'x', summary: id });
  eq('log union sorted', KC.mergeLog([L('b', '2026-02'), L('a', '2026-01')], [L('c', '2026-03'), L('a', '2026-01')]).map(l => l.id), ['a', 'b', 'c']);
  eq('log cap keeps latest', KC.mergeLog([L('a', '1'), L('b', '2'), L('c', '3')], [], 2).map(l => l.id), ['b', 'c']);
  eq('statements union', KC.mergeStatements([{ wallet: 'alfa', at: '1' }], [{ wallet: 'alfa', at: '1' }, { wallet: 'promos', at: '2' }]).length, 2);
  eq('keys union', KC.mergeKeys(['b', 'a'], ['a', 'c']), ['a', 'b', 'c']);
  eq('hash stable', KC.hashStr('abc') === KC.hashStr('abc') && KC.hashStr('abc') !== KC.hashStr('abd'), true);
  // повторная загрузка выписки не плодит решения, пока прежние не закрыты
  const [o1] = KC.makeTransfer({ from: 'alfa', to: 'cash', amount: 5000000, date: '2026-11-12' });
  const rows = KC.sampleStatement('alfa', '2026-11-12');
  const first = KC.reconcile({ records: [o1], wallet: 'alfa', rows });
  const pending = first.decisions.map(d => d.row.key);
  const again = KC.reconcile({ records: [o1], wallet: 'alfa', rows, skipKeys: pending });
  eq('no duplicate decisions on re-upload', again.decisions.filter(d => d.type === 'choose').length, 0);
}

// ---- суммы в выписках: запятая как разделитель тысяч (Альфа) и десятичная запятая ----
eq('parseMoney alfa style', ['46,061.00', '1,215.00', '156.00'].map(KC.parseMoney), [4606100, 121500, 15600]);
eq('parseMoney ru style', ['1 215,50', '1.215,00', '12,5', '\u22125,00', '1215,5'].map(KC.parseMoney), [121550, 121500, 1250, -500, 121550]);
// ---- выписка Альфы: шапка в две строки, даты текстом, суммы текстом ----
{
  const table = [['Выписка по счёту'], ['За период', 'c 30.10.2026 по 30.10.2026'],
    ['Дата', 'Номер документа', 'Дебет', 'Кредит', 'Контрагент', '', '', '', '', '', 'Назначение платежа', 'Код дебитора', 'Тип документа'],
    ['', '', '', '', 'Наименование', 'ИНН', 'КПП', 'Счёт', 'БИК', 'Наименование банка'],
    ['30.10.2026', '0', '156.00', '', 'АО «Альфа-Банк»', '', '', '', '', '', 'Комиссия', '', 'Банковский ордер'],
    ['30.10.2026', '324', '1,215.00', '', 'АО «Х»', '', '', '', '', '', 'Оплата по счету', '', 'Платежное поручение'],
    ['30.10.2026', '325', '', '10,000.50', 'ООО «Заказчик»', '', '', '', '', '', 'Оплата заказа', '', 'Платежное поручение']];
  const hi = KC.findHeaderRow(table), map = KC.detectColumns(table[hi]), r = KC.rowsFromTable(table, hi, map);
  eq('alfa-like table rows', [r.rows.map(x => x.amount), r.skipped], [[-15600, -121500, 1000050], 0]);
}
// ---- уже подтверждённые записи без ключа выписки (из сводной таблицы) не дублируются ----
{
  const mk = (amount, date) => R({ wallet: 'alfa', amount, date, source: 'import', bankState: 'confirmed', article: 'Закупка материала' });
  const recs = [mk(-15600, '2026-10-30'), mk(-121500, '2026-10-30'), mk(-121500, '2026-10-30')];
  const rows = [{ date: '2026-10-30', amount: -15600, counterparty: 'Банк', purpose: 'Комиссия', docNo: '0' },
    { date: '2026-10-30', amount: -121500, counterparty: 'Х', purpose: 'Оплата', docNo: '324' },
    { date: '2026-10-30', amount: -121500, counterparty: 'Y', purpose: 'Оплата', docNo: '325' },
    { date: '2026-10-30', amount: -50000, counterparty: 'Z', purpose: 'Новая', docNo: '326' }];
  const res = KC.reconcile({ records: recs, wallet: 'alfa', rows });
  eq('linked to confirmed, one new', [res.stats.matched, res.stats.added, res.patches.length, res.newRecords.length], [3, 1, 3, 1]);
  const linked = recs.map(r => Object.assign({}, r, (res.patches.find(p => p.id === r.id) || {}).patch));
  const again = KC.reconcile({ records: linked.concat(res.newRecords), wallet: 'alfa', rows });
  eq('re-upload after link: no duplicates', [again.stats.duplicates, again.stats.matched, again.stats.added], [4, 0, 0]);
  eq('linked keeps confirmed state', linked.every(r => r.bankState === 'confirmed' && r.bankKey), true);
}

// ---- выписка Альфы за 30.10.2026: все строки уже учтены, комиссия за день одной строкой = 4 комиссии по платежам ----
{
  const mk = (amount, desc) => R({ wallet: 'alfa', amount, date: '2026-10-30', source: 'import', bankState: 'confirmed', description: desc || '', article: desc ? 'РКО' : 'Закупка материала' });
  const recs = [mk(-121500), mk(-1541900), mk(-840000), mk(-165500), mk(-1417300), mk(-504300),
    mk(-3900, 'Комиссия за перевод в рублях по Системе N 324 от 30.10.2026 Согл.тариф'), mk(-3900, 'Комиссия за перевод в рублях по Системе N 321 от 30.10.2026 Согл.тариф'),
    mk(-3900, 'Комиссия за перевод в рублях по Системе N 322 от 30.10.2026 Согл.тариф'), mk(-3900, 'Комиссия за перевод в рублях по Системе N 319 от 30.10.2026 Согл.тариф')];
  const row = (amount, purpose, docNo) => ({ date: '2026-10-30', amount, counterparty: 'АО «Альфа-Банк»', purpose, docNo });
  const rows = [row(-15600, 'Комиссия за переводы в валюте РФ за 2026-10-30. Согласно тарифам Банка.', '0'), row(-121500, 'Оплата по счету 1', '324'), row(-1541900, 'Оплата по счету 2', '321'),
    row(-840000, 'Оплата по счету 3', '323'), row(-165500, 'Оплата по счету 4', '322'), row(-1417300, 'Оплата по счету 5', '320'), row(-504300, 'Оплата по счету 6', '319')];
  const res = KC.reconcile({ records: recs, wallet: 'alfa', rows });
  eq('alfa 30.10: nothing new, all linked', [res.stats.matched, res.stats.added, res.stats.decisions, res.newRecords.length, res.patches.length], [7, 0, 0, 0, 10]);
  eq('alfa 30.10: commission group linked once', res.stats.commissionGroups, 1);
  // сумма группы не сходится: ничего не склеиваем, комиссия приходит новой записью и не считается переводом
  const broken = recs.slice(0, 9);
  const r2 = KC.reconcile({ records: broken, wallet: 'alfa', rows: [rows[0]] });
  eq('commission mismatch: new record, not a transfer', [r2.stats.added, r2.newRecords[0] && r2.newRecords[0].kind], [1, 'expense']);
  // повторная загрузка после привязки
  const linked = recs.map(r => Object.assign({}, r, (res.patches.find(p => p.id === r.id) || {}).patch));
  const again = KC.reconcile({ records: linked, wallet: 'alfa', rows });
  eq('alfa 30.10 re-upload: only duplicates', [again.stats.duplicates, again.stats.added, again.stats.matched], [7, 0, 0]);
  // баланс не меняется
  eq('balance unchanged by linking', KC.balances(linked).wallets[0].balance, KC.balances(recs).wallets[0].balance);
}

// ---- даты из xlsx: полночь минус 17 секунд (Москва) не должна уходить на предыдущие сутки ----
eq('Date midnight-17s -> next day', KC.parseDateInput(new Date(2026, 9, 29, 23, 59, 43)), '2026-10-30');
eq('Date exact midnight', KC.parseDateInput(new Date(2026, 9, 30, 0, 0, 0)), '2026-10-30');
eq('Date midday unchanged', KC.parseDateInput(new Date(2026, 9, 30, 15, 0, 0)), '2026-10-30');
// ---- исправление дат ранее загруженного импорта ----
{
  const a = KC.newRecord({ wallet: 'alfa', amount: -100, date: '2026-10-29', accrualDate: '2026-10-29', source: 'import', extId: '91' });
  const b = KC.newRecord({ wallet: 'alfa', amount: -100, date: '2026-10-31', source: 'import' }); // без номера импорта
  const c = KC.newRecord({ wallet: 'cash', amount: -100, date: '2026-11-01', source: 'phone' });
  const d = KC.newRecord({ wallet: 'alfa', amount: -100, date: '2026-10-30', source: 'import', extId: '92' }); d.dateFixed = true;
  const e = KC.newRecord({ wallet: 'alfa', amount: -100, date: '2026-09-30', source: 'import', extId: '93' });
  const ps = KC.importDateFixPatches([a, b, c, d, e]);
  eq('date fix targets only unfixed import', ps.map(p => p.id).sort(), [a.id, e.id].sort());
  eq('date fix shifts +1 day incl. month end', [ps.find(p => p.id === a.id).patch.date, ps.find(p => p.id === a.id).patch.accrualDate, ps.find(p => p.id === e.id).patch.date], ['2026-10-30', '2026-10-30', '2026-10-01']);
  const done = [a, e].map(r => Object.assign({}, r, ps.find(p => p.id === r.id).patch));
  eq('date fix is idempotent', KC.importDateFixPatches(done).length, 0);
  eq('date fix keeps balances', KC.balances(done).total, KC.balances([a, e]).total);
}

// ---- CRM: стадии проектов (канбан) ----
{
  const C = KC.CRM, NOW = '2026-11-02T10:00:00.000Z';
  eq('crm: 15 stages 5..19 (last is Рекламации)', [C.STAGES.length, C.STAGES[0].n, C.STAGES[14].n, C.DONE], [15, 5, 19, 18]);
  eq('crm: every stage belongs to a group', C.STAGES.every(s => s.g >= 0 && s.g < C.GROUPS.length), true);
  eq('crm: no meta -> first stage', KC.crmStage(undefined), 5);
  eq('crm: work without stage -> first', KC.crmStage({ status: 'work' }), 5);
  eq('crm: done -> last', KC.crmStage({ status: 'done', stage: 7 }), 18);
  eq('crm: out of range -> first', KC.crmStage({ status: 'work', stage: 2 }), 5);
  eq('crm: missing fields from 5 to 6', KC.crmMissing({}, 5, 6), ['contractNo', 'sum', 'prepay']);
  eq('crm: filled fields pass', KC.crmMissing({ f: { contractNo: '1', sum: '100', prepay: '2026-10-01' } }, 5, 6), []);
  eq('crm: whitespace is not filled', KC.crmMissing({ f: { contractNo: '  ', sum: '1', prepay: 'x' } }, 5, 6), ['contractNo']);
  eq('crm: missing accumulates over several stages', KC.crmMissing({ f: { contractNo: '1', sum: '1', prepay: 'x' } }, 5, 8), ['measure', 'tz']);
  eq('crm: no check going back', KC.crmMissing({}, 8, 6), []);
  eq('crm: stage without required fields', KC.crmMissing({}, 10, 13), []);
  const m1 = KC.crmMove(undefined, 6, NOW);
  eq('crm: move creates meta', [m1.status, m1.stage, m1.updatedAt, m1.hist.length], ['work', 6, NOW, 1]);
  eq('crm: move writes history', m1.hist[0].t, 'Стадия: Договор и предоплата → Замер');
  const m2 = KC.crmMove(m1, 8, NOW, 'без проверки полей');
  eq('crm: history newest first with note', [m2.hist.length, m2.hist[0].t], [2, 'Стадия: Замер → Проектирование (без проверки полей)']);
  eq('crm: move does not mutate input', m1.stage, 6);
  const f1 = KC.crmSetField({ status: 'done', doneAt: 'x', result: { net: 1 } }, 'phone', '+7', NOW);
  eq('crm: setField keeps result and status', [f1.status, f1.result.net, f1.f.phone, f1.updatedAt], ['done', 1, '+7', NOW]);
  eq('crm: setField on empty', KC.crmSetField(undefined, 'sum', '5', NOW).f.sum, '5');
  eq('crm: workdays Mon->Fri next week', KC.workDaysBetween('2026-11-02', '2026-11-09'), 5);
  eq('crm: workdays skip weekend', KC.workDaysBetween('2026-11-06', '2026-11-09'), 1);
  eq('crm: workdays negative', KC.workDaysBetween('2026-11-09', '2026-11-02'), -5);
  eq('crm: workdays bad date', KC.workDaysBetween('', '2026-11-02'), null);
  eq('crm: timing none', KC.crmTiming({ f: { start: '2026-10-01' } }, '2026-11-02').mode, 'none');
  eq('crm: timing overdue', KC.crmTiming({ f: { start: '2026-10-01', due: '2026-10-30' } }, '2026-11-02'), { mode: 'overdue', pct: 100, days: 1 });
  const tm = KC.crmTiming({ f: { start: '2026-10-26', due: '2026-11-13' } }, '2026-11-02');
  eq('crm: timing ok', [tm.mode, tm.days, tm.pct], ['ok', 9, 36]);
  eq('crm: timing due today', KC.crmTiming({ f: { due: '2026-11-02' } }, '2026-11-02').days, 0);
  // доска
  const rec = (project, amount, kind) => R({ kind: kind || 'income', wallet: 'alfa', amount, date: '2026-10-05', project, article: 'Оказание услуг' });
  const recs = [rec('Кухня А', 1000000), rec('Кухня А', -300000, 'expense'), rec('Шкаф Б', 500000), rec('Закрытый', 100000), rec('', 777)];
  const meta = { 'Шкаф Б': { status: 'work', stage: 11, f: { due: '2026-11-10', start: '2026-10-01', sum: '500000', next: '2026-11-03' } }, 'Закрытый': { status: 'done', result: {} }, 'Только в CRM': { status: 'work', stage: 5 } };
  const b = KC.crmBoard(recs, meta, { today: '2026-11-02' });
  const at = (n) => b.groups.flatMap(g => g.stages).find(s => s.n === n).cards.map(c => c.key);
  eq('board: project from operations without meta -> first stage', at(5), ['Кухня А', 'Только в CRM']);
  eq('board: project with stage', at(11), ['Шкаф Б']);
  eq('board: done project is not on the board', [b.done, b.total], [1, 3]);
  eq('board: no-project operations are not a card', b.groups.flatMap(g => g.stages).flatMap(s => s.cards).some(c => c.key === ''), false);
  eq('board: group counts', b.groups.map(g => g.count), [2, 1, 0, 0]);
  const ka = b.groups[0].stages[0].cards.find(c => c.key === 'Кухня А');
  eq('board: money from operations', [ka.income, ka.expense, ka.profit], [1000000, 300000, 700000]);
  const kb = b.groups[1].stages[1].cards[0];
  eq('board: contract sum and contact', [kb.sum, kb.next, kb.mode], [500000, '2026-11-03', 'ok']);
  eq('board: search', KC.crmBoard(recs, meta, { today: '2026-11-02', query: 'шкаф' }).total, 1);
  eq('board: empty', KC.crmBoard([], {}, { today: '2026-11-02' }).total, 0);
  // отсортированы: сначала со сроком, по возрастанию
  const b2 = KC.crmBoard([], { 'Б': { status: 'work', f: { due: '2026-12-01' } }, 'А': { status: 'work' }, 'В': { status: 'work', f: { due: '2026-11-20' } } }, { today: '2026-11-02' });
  eq('board: order by due date, no date last', b2.groups[0].stages[0].cards.map(c => c.key), ['В', 'Б', 'А']);
  // слияние: правка с полями побеждает по времени
  const mg = KC.mergeProjects({ 'X': KC.crmMove({ status: 'work' }, 7, '2026-11-02T09:00:00.000Z') }, { 'X': KC.crmMove({ status: 'work' }, 9, '2026-11-02T11:00:00.000Z') });
  eq('merge: later CRM edit wins whole object', [mg.X.stage, mg.X.hist.length], [9, 1]);
  // выгрузка в список для облака и обратно сохраняет поля
  const rt = KC.projectsFromList(KC.projectsToList({ 'Кухня': { status: 'work', stage: 7, f: { sum: '10', due: '2026-12-01' }, hist: [{ at: NOW, t: 'x' }], updatedAt: NOW } }));
  eq('cloud list round trip keeps CRM fields', rt['Кухня'], { status: 'work', stage: 7, f: { sum: '10', due: '2026-12-01' }, hist: [{ at: NOW, t: 'x' }], updatedAt: NOW });
  // копия JSON: поля карточек сохраняются и читаются обратно
  const bk = KC.backupObject({ records: [], log: [], decisions: [], meta: { ignoredKeys: [], statements: [], projects: { 'Кухня': { status: 'work', stage: 7, f: { sum: '10' }, updatedAt: NOW } }, articles: [] }, namespace: 'test' });
  const back = JSON.parse(JSON.stringify(bk));
  eq('backup keeps CRM fields', back.meta.projects['Кухня'], { status: 'work', stage: 7, f: { sum: '10' }, updatedAt: NOW });
  eq('backup passes validation', KC.validateBackup(back).ok !== false, true);
}

// ---- CRM: лиды ----
{
  const L = KC.LEADS, NOW = '2026-11-02T10:00:00.000Z', N2 = '2026-11-02T12:00:00.000Z';
  eq('leads: 4 funnel stages', L.STAGES.map(s => s.n), [1, 2, 3, 4]);
  eq('leads: later stages as in Bitrix', L.LATER, ['Перезвонить позже', '1й перезвон', '2й перезвон', '3й перезвон']);
  eq('leads: 7 loss reasons', L.REASONS.length, 7);
  eq('leads: bitrix talk fields present', ['urgency', 'features', 'important', 'size', 'materials', 'priceFrom', 'priceTo', 'budget', 'ready'].every(k => L.FIELDS[1].fields.some(f => f[0] === k)), true);
  let l = KC.newLead('Кухня Соколова', { client: 'Соколов' }, NOW);
  eq('lead: new defaults', [l.status, l.stage, l.name, l.f.client, l.hist.length, typeof l.id], ['lead', 1, 'Кухня Соколова', 'Соколов', 1, 'string']);
  eq('lead: ids are unique', KC.newLead('a', {}, NOW).id !== KC.newLead('a', {}, NOW).id, true);
  eq('lead: stage clamps', [KC.leadStage({}), KC.leadStage({ stage: 9 }), KC.leadStage({ stage: 3 })], [1, 1, 3]);
  eq('lead: missing to leave stage 1', KC.leadMissing(l, 1, 2), ['phone', 'source']);
  eq('lead: missing accumulates', KC.leadMissing(l, 1, 4), ['phone', 'source', 'next', 'address']);
  eq('lead: missing for project creation', KC.leadMissing(l, 1, 5), ['phone', 'source', 'next', 'address', 'result', 'priceFrom']);
  eq('lead: no check going back', KC.leadMissing(l, 3, 1), []);
  const l1 = KC.leadSetField(l, 'phone', '+7', N2), l2 = KC.leadSetField(l1, 'name', 'Новое имя', N2);
  eq('lead: setField keeps others and stamps time', [l1.f.phone, l1.f.client, l1.updatedAt, l.f.phone], ['+7', 'Соколов', N2, undefined]);
  eq('lead: name is a top-level field', [l2.name, KC.leadField(l2, 'name'), l2.f.name], ['Новое имя', 'Новое имя', undefined]);
  const m1 = KC.leadMove(l, 2, N2);
  eq('lead: move writes history', [m1.stage, m1.hist[0].t, m1.hist.length, l.stage], [2, 'Стадия: Новая заявка → Прогрев на встречу', 2, 1]);
  const lt = KC.leadToLater(m1, 1, '2026-12-01', N2);
  eq('lead: later', [lt.status, lt.later, lt.f.next, lt.hist[0].t], ['later', 1, '2026-12-01', 'Долгострой: 1й перезвон, связаться 2026-12-01']);
  const ls = KC.leadToLost(m1, 'Цена', N2);
  eq('lead: lost', [ls.status, ls.reason, ls.hist[0].t], ['lost', 'Цена', 'Не прошёл: Цена']);
  const bk = KC.leadBack(ls, N2);
  eq('lead: back to funnel keeps the stage', [bk.status, bk.reason, bk.later, bk.stage, bk.hist[0].t], ['lead', undefined, undefined, 2, 'Возвращён в воронку']);
  // превращение в проект
  const full = ['phone:+7 900', 'source:Сайт', 'next:2026-11-10', 'address:Краснодар', 'result:ок', 'priceFrom:300000', 'client:Соколов'].reduce((a, x) => { const i = x.indexOf(':'); return KC.leadSetField(a, x.slice(0, i), x.slice(i + 1), NOW); }, l);
  eq('convert: empty name', KC.leadConvert(full, '  ', {}, N2).error, 'Укажите название проекта');
  eq('convert: name taken', /уже есть/.test(KC.leadConvert(full, 'Кухня', { 'Кухня': { status: 'work' } }, N2).error), true);
  const bad = KC.leadConvert(l, 'Кухня Соколова', {}, N2);
  eq('convert: missing fields blocks', [/заполните/.test(bad.error), bad.missing.length], [true, 6]);
  const ok1 = KC.leadConvert(full, ' Кухня Соколова ', {}, N2);
  eq('convert: project on first project stage', [ok1.project.status, ok1.project.stage, ok1.project.f.client, ok1.project.f.phone, ok1.project.f.address, ok1.project.f.next], ['work', 5, 'Соколов', '+7 900', 'Краснодар', '2026-11-10']);
  eq('convert: lead snapshot and history carried over', [ok1.project.lead.id === full.id, ok1.project.lead.f.priceFrom, ok1.project.hist[0].t, ok1.project.hist.length >= 2], [true, '300000', 'Создан из лида «Кухня Соколова»', true]);
  eq('convert: lead marked won with project name', [ok1.lead.status, ok1.lead.projectKey, ok1.lead.hist[0].t], ['won', 'Кухня Соколова', 'Создан проект «Кухня Соколова»']);
  eq('convert: twice is refused', /уже стал проектом/.test(KC.leadConvert(ok1.lead, 'Другое', {}, N2).error), true);
  eq('convert: project passes into the kanban first stage', KC.crmStage(ok1.project), 5);
  // слияние и облако
  eq('merge leads: later edit wins per lead', KC.mergeLeads({ a: { id: 'a', updatedAt: NOW, name: 'старое' } }, { a: { id: 'a', updatedAt: N2, name: 'новое' }, b: { id: 'b', updatedAt: NOW } }).a.name, 'новое');
  eq('merge leads: keeps local only', Object.keys(KC.mergeLeads({ x: { id: 'x', updatedAt: NOW } }, {})), ['x']);
  eq('leads cloud list round trip', KC.leadsFromList(KC.leadsToList({ x: ok1.lead }))[ok1.lead.id], ok1.lead);
  // доска
  const mk = (name, extra) => Object.assign(KC.newLead(name, { phone: '1' }, NOW), extra);
  const leads = {};
  [mk('Б', { stage: 2 }), mk('А', { stage: 2 }), mk('В', { stage: 1 }), mk('Г', { status: 'later', later: 2 }), mk('Д', { status: 'lost', reason: 'Срок', updatedAt: N2 }), mk('Е', { status: 'won' })].forEach(x => { leads[x.id] = x; });
  const wd = Object.values(leads).find(x => x.name === 'А'); wd.f = Object.assign({}, wd.f, { next: '2026-11-01', priceFrom: '100000' });
  const bd = KC.leadsBoard(leads, { today: '2026-11-02' });
  eq('board: counts', [bd.total, bd.later.length, bd.lost.length, bd.won], [3, 1, 1, 1]);
  eq('board: stages hold names, dated first', bd.stages.map(s => s.cards.map(c => c.name)), [['В'], ['А', 'Б'], [], []]);
  eq('board: late contact and price', [bd.stages[1].cards[0].late, bd.stages[1].cards[0].priceFrom], [true, 100000]);
  eq('board: later and lost cards', [bd.later[0].later, bd.lost[0].reason], [2, 'Срок']);
  eq('board: search by name', KC.leadsBoard(leads, { today: '2026-11-02', query: 'в' }).total, 1);
  eq('board: empty', KC.leadsBoard({}, {}).total, 0);
  // копия
  const back = JSON.parse(JSON.stringify(KC.backupObject({ records: [], meta: { projects: {}, leads: leads }, namespace: 't' })));
  eq('backup version is 2', back.version, 2);
  eq('backup keeps leads', Object.keys(back.meta.leads).length, 6);
  eq('backup validates', KC.validateBackup(back), '');
  eq('old backup version 1 still validates', KC.validateBackup(Object.assign({}, back, { version: 1, meta: {} })), '');
  eq('newer backup is refused', KC.validateBackup(Object.assign({}, back, { version: 3 })), 'Копия сделана более новой версией');
}

// ---- CRM: доделки (рабочие дни, единая карточка проекта, закрытые в «Сдано») ----
{
  const NOW = '2026-11-02T10:00:00.000Z';
  eq('workdays: Monday + 5 -> next Monday', KC.addWorkDays('2026-11-02', 5), '2026-11-09');
  eq('workdays: Friday + 1 -> Monday', KC.addWorkDays('2026-11-06', 1), '2026-11-09');
  eq('workdays: Saturday + 1 -> Monday', KC.addWorkDays('2026-11-07', 1), '2026-11-09');
  eq('workdays: Sunday + 1 -> Monday', KC.addWorkDays('2026-11-08', 1), '2026-11-09');
  eq('workdays: 35 from Monday -> Monday 7 weeks later', KC.addWorkDays('2026-11-02', 35), '2026-12-21');
  eq('workdays: 10 spans two weekends', KC.addWorkDays('2026-11-04', 10), '2026-11-18');
  eq('workdays: 0, negative, junk -> null', [KC.addWorkDays('2026-11-02', 0), KC.addWorkDays('2026-11-02', -3), KC.addWorkDays('', 5), KC.addWorkDays('2026-13-45', 5)], [null, null, null, null]);
  let a = KC.crmSetField({ status: 'work' }, 'start', '2026-11-02', NOW);
  eq('due: start alone does not compute it', [a.f.due, KC.crmDueAuto(a)], [undefined, false]);
  a = KC.crmSetField(a, 'workDays', '5', NOW);
  eq('due: start + work days computes it', [a.f.due, KC.crmDueAuto(a)], ['2026-11-09', true]);
  a = KC.crmSetField(a, 'workDays', '10', NOW);
  eq('due: changing work days recomputes', a.f.due, '2026-11-16');
  a = KC.crmSetField(a, 'start', '2026-11-09', NOW);
  eq('due: changing start recomputes', a.f.due, '2026-11-23');
  eq('due: junk work days keep the last due and turn auto off', (() => { const b = KC.crmSetField(a, 'workDays', 'abc', NOW); return [b.f.due, KC.crmDueAuto(b)]; })(), ['2026-11-23', false]);
  eq('due: 3.5 is not a whole number of days', KC.crmDueAuto(KC.crmSetField({ f: { start: '2026-11-02' } }, 'workDays', '3.5', NOW)), false);
  eq('due: old project with only due stays manual', [KC.crmDueAuto({ f: { due: '2026-12-01' } }), KC.crmSetField({ f: { due: '2026-12-01' } }, 'phone', '1', NOW).f.due], [false, '2026-12-01']);
  eq('due: manual due can be set by the field setter', KC.crmSetField({ f: {} }, 'due', '2026-12-31', NOW).f.due, '2026-12-31');
  eq('stages: 15, last is Рекламации in the last group', [KC.CRM.STAGES.length, KC.CRM.STAGES[14].name, KC.CRM.STAGES[14].g, KC.CRM.GROUPS.length - 1], [15, 'Рекламации', 3, 3]);
  eq('stages: no required fields after Сдано or for the undefined ones', [10, 11, 12, 14, 16, 17, 18, 19].map(n => (KC.CRM.REQUIRED[n] || []).length), [0, 0, 0, 0, 0, 0, 0, 0]);
  eq('stages: closed project is always on Сдано, a reopened one keeps its stage', [KC.crmStage({ status: 'done', stage: 19 }), KC.crmStage({ status: 'work', stage: 19 })], [18, 19]);
  eq('stages: Сдано -> Рекламации needs nothing', KC.crmMissing({}, 18, 19), []);
  eq('fields: contract date exists and is not required', [KC.CRM.FIELDS[1].fields.some(f => f[0] === 'contractDate'), KC.CRM.REQUIRED[5].indexOf('contractDate')], [true, -1]);
  // единая карточка
  const card = KC.crmNewCard(NOW, 'Карточка создана из операции');
  eq('card: new card is on the first stage with history', [card.status, card.stage, card.hist[0].t, KC.crmStage(card)], ['work', 5, 'Карточка создана из операции', 5]);
  const recs = [{ project: 'Кухня Москва' }, { project: 'Кухня Москва' }, { project: 'кухня москва ' }, { project: 'Шкаф' }];
  eq('match: same project, other spelling -> existing name', KC.findProjectName(recs, {}, '  КУХНЯ   москва'), 'Кухня Москва');
  eq('match: punctuation and ё are ignored', KC.findProjectName([{ project: 'Шкаф-купе, Орлов' }], {}, 'шкаф купе орлов'), 'Шкаф-купе, Орлов');
  eq('match: ё equals е', KC.findProjectName([{ project: 'Все сам' }], {}, 'всё сам'), 'Все сам');
  eq('match: exact name returns itself', KC.findProjectName(recs, {}, 'Шкаф'), 'Шкаф');
  eq('match: card name wins over operations spelling', KC.findProjectName(recs, { 'КУХНЯ МОСКВА': {} }, 'кухня москва'), 'КУХНЯ МОСКВА');
  eq('match: a new name is not matched', KC.findProjectName(recs, { 'Другой': {} }, 'Совсем новый'), null);
  eq('match: empty and symbols only', [KC.findProjectName(recs, {}, ''), KC.findProjectName(recs, {}, ' -- ')], [null, null]);
  eq('match: deleted operations do not count', KC.findProjectName([{ project: 'Удалён', deleted: true }], {}, 'удалён'), null);
  eq('suggest: cards without operations are offered', KC.suggestProjectNames([], { 'Мозговой штурм': {}, 'Кухня': {} }, 'моз'), ['Мозговой штурм']);
  eq('suggest: operations and cards are merged without duplicates', KC.suggestProjectNames([{ project: 'Кухня', date: '2026-10-01', amount: 1 }], { 'Кухня': {}, 'Кладовая': {} }, 'к', 8).sort(), ['Кладовая', 'Кухня']);
  eq('suggest: no query returns names', KC.suggestProjectNames([], { 'А': {}, 'Б': {} }, '', 8).sort(), ['А', 'Б']);
  // закрытые проекты на доске
  const rec = (project, amount) => R({ kind: amount > 0 ? 'income' : 'expense', wallet: 'alfa', amount, date: '2026-10-05', project, article: 'Оказание услуг' });
  const meta = { 'Закрыт 1': { status: 'done', stage: 18, doneAt: '2026-10-10T00:00:00.000Z', result: { net: 12300 } }, 'Закрыт 2': { status: 'done', stage: 18, doneAt: '2026-10-20T00:00:00.000Z', result: { net: -500 } }, 'В работе': { status: 'work', stage: 18 }, 'Рекл': { status: 'work', stage: 19 } };
  const bd = KC.crmBoard([rec('Закрыт 1', 100000), rec('В работе', 100000)], meta, { today: '2026-11-02' });
  const z = (n) => bd.groups.flatMap(g => g.stages).find(s => s.n === n).cards;
  eq('board: closed projects are cards in Сдано, newest first, then work cards', z(18).map(c => [c.key, c.closed]), [['В работе', false], ['Закрыт 2', true], ['Закрыт 1', true]].sort((x, y) => (x[1] === y[1] ? 0 : x[1] ? 1 : -1)));
  eq('board: closed cards carry the date and the profit', z(18).filter(c => c.closed).map(c => [c.doneAt.slice(0, 10), c.net]), [['2026-10-20', -500], ['2026-10-10', 12300]]);
  eq('board: Рекламации zone holds the reopened project', z(19).map(c => c.key), ['Рекл']);
  eq('board: counters count only open projects, done is counted apart', [bd.total, bd.done, bd.groups[3].count], [2, 2, 2]);
  eq('board: search finds closed too', KC.crmBoard([], meta, { today: '2026-11-02', query: 'закрыт' }).done, 2);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
