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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
