/* Kubcrafter Деньги: ядро логики (без интерфейса). Работает в браузере и в Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- кошельки ---------- */
  // bank: есть выписка банка; ledger: главный учёт наш, выписка только сверяет (Промос)
  var WALLETS = [
    { id: 'alfa', name: 'Альфа-банк', bank: true, ledger: false },
    { id: 'cash', name: 'Наличные', bank: false, ledger: false },
    { id: 'promos', name: 'Промос', bank: true, ledger: true, note: 'по нашему учёту' },
    { id: 'credit', name: 'Кредитный счёт личных средств', bank: false, ledger: false, hidden: true }
  ];
  function wallet(id) { for (var i = 0; i < WALLETS.length; i++) if (WALLETS[i].id === id) return WALLETS[i]; return null; }

  /* ---------- деньги: храним в копейках (целое число) ---------- */
  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : NaN;
    if (v == null) return NaN;
    var s = String(v).replace(/[\s\u00A0\u202F]/g, '').replace(/[₽рР]|руб\.?/g, '').replace('\u2212', '-').replace(',', '.');
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0'); }
  function formatMoney(k, o) {
    o = o || {};
    var neg = k < 0, abs = Math.abs(k), rub = Math.floor(abs / 100), kop = abs % 100;
    var s = group(rub) + (kop ? ',' + (kop < 10 ? '0' + kop : kop) : '') + '\u00A0₽';
    if (o.sign) return (neg ? '\u2212' : (k > 0 ? '+' : '')) + s;
    return (neg ? '\u2212' : '') + s;
  }

  /* ---------- даты (строки ГГГГ-ММ-ДД) ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return isoDate(new Date()); }
  function parseISO(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
  function addDays(s, n) { var t = new Date(parseISO(s) + n * 86400000); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  function monthKey(s) { return s.slice(0, 7); }
  function monthLabel(key) { var p = key.split('-'); return MONTHS_NOM[+p[1] - 1] + ' ' + p[0]; }
  function shiftMonth(key, n) { var p = key.split('-'); var m = (+p[0]) * 12 + (+p[1] - 1) + n; return Math.floor(m / 12) + '-' + pad((m % 12) + 1); }
  function dayLabel(s, t) {
    var p = s.split('-'), base = (+p[2]) + ' ' + MONTHS_GEN[+p[1] - 1];
    var d = diffDays(s, t);
    if (d === 0) return 'Сегодня, ' + base;
    if (d === -1) return 'Вчера, ' + base;
    return base + ', ' + WEEKDAYS[new Date(parseISO(s)).getUTCDay()];
  }
  function shortDate(s) { var p = s.split('-'); return (+p[2]) + ' ' + MONTHS_GEN[+p[1] - 1]; }
  function parseDateInput(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return isoDate(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) { // серийный номер Excel
      var t = new Date(Math.round((v - 25569) * 86400000));
      return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
    }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return '';
  }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseISO(s)); }

  /* ---------- записи ---------- */
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }
  function isTransfer(r) { return r.kind === 'transfer_out' || r.kind === 'transfer_in'; }
  function typeOf(r) { return isTransfer(r) ? 'transfer' : (r.amount < 0 ? 'expense' : 'income'); }

  // статус банка: none (наличные), pending (ждёт выписку, в остаток не входит), unconfirmed (Промос, в остатке),
  // confirmed (подтверждено выпиской), absent (в периоде выписки, но в ней нет)
  function defaultBankState(walletId, source) {
    var w = wallet(walletId);
    if (!w || !w.bank) return 'none';
    if (source === 'bank' || source === 'import') return 'confirmed';
    return w.ledger ? 'unconfirmed' : 'pending';
  }
  function newRecord(f) {
    var amt = Math.round(f.amount || 0), now = nowISO();
    return {
      id: f.id || uid(),
      kind: f.kind || (amt < 0 ? 'expense' : 'income'),
      wallet: f.wallet, amount: amt, date: f.date || today(), planned: !!f.planned,
      counterparty: (f.counterparty || '').trim(), article: (f.article || '').trim(), project: (f.project || '').trim(),
      description: (f.description || '').trim(), accrualDate: f.accrualDate || '', docNo: f.docNo || '', order: f.order || '',
      source: f.source || 'phone', bankState: f.bankState || defaultBankState(f.wallet, f.source),
      bankKey: f.bankKey || '', bankDate: f.bankDate || '', bankPurpose: f.bankPurpose || '', pairId: f.pairId || '',
      autofill: f.autofill || '', extId: f.extId || '', note: f.note || '', absentAck: false,
      deleted: false, createdAt: now, updatedAt: now
    };
  }
  function validate(f) {
    var e = [];
    if (!wallet(f.wallet)) e.push('Не выбран кошелёк');
    if (!f.amount || !isFinite(f.amount) || Math.round(f.amount) === 0) e.push('Введите сумму');
    if (!validDate(f.date)) e.push('Неверная дата');
    return e;
  }
  function makeTransfer(f) {
    var abs = Math.abs(Math.round(f.amount)), pairId = uid(), d = f.date || today();
    var common = { date: d, planned: !!f.planned, description: f.description || '', source: f.source || 'phone', pairId: pairId };
    var out = newRecord(Object.assign({ kind: 'transfer_out', wallet: f.from, amount: -abs }, common));
    var inn = newRecord(Object.assign({ kind: 'transfer_in', wallet: f.to, amount: abs }, common));
    return [out, inn];
  }
  function validateTransfer(f) {
    var e = [];
    if (!wallet(f.from) || !wallet(f.to)) e.push('Выберите оба кошелька');
    else if (f.from === f.to) e.push('Кошельки должны отличаться');
    if (!f.amount || f.amount <= 0) e.push('Введите сумму');
    if (!validDate(f.date)) e.push('Неверная дата');
    return e;
  }
  function missingFields(r) {
    if (r.deleted || isTransfer(r)) return [];
    var m = [];
    if (!r.counterparty) m.push('контрагент');
    if (!r.article) m.push('статья');
    if (!r.project) m.push('проект');
    return m;
  }
  function unfilledCount(records) { var n = 0; records.forEach(function (r) { if (!r.deleted && missingFields(r).length) n++; }); return n; }
  function unpairedTransfers(records) { return records.filter(function (r) { return !r.deleted && isTransfer(r) && !r.pairId; }); }

  /* ---------- остатки ---------- */
  function balances(records) {
    var by = {}; WALLETS.forEach(function (w) { by[w.id] = { id: w.id, name: w.name, hidden: !!w.hidden, note: w.note || '', balance: 0, inTransit: 0, unconfirmed: 0 }; });
    records.forEach(function (r) {
      if (r.deleted || r.planned) return;
      var w = wallet(r.wallet), a = by[r.wallet]; if (!w || !a) return;
      if (w.bank && !w.ledger && r.bankState === 'pending') { a.inTransit += r.amount; return; }
      a.balance += r.amount;
      if (w.ledger && (r.bankState === 'unconfirmed' || r.bankState === 'absent')) a.unconfirmed += r.amount;
    });
    var list = WALLETS.map(function (w) { return by[w.id]; });
    var total = 0, transit = 0;
    list.forEach(function (a) { if (!a.hidden) { total += a.balance + a.inTransit; transit += a.inTransit; } });
    return { wallets: list, total: total, inTransit: transit };
  }

  /* ---------- поиск и фильтры ---------- */
  function matchToken(r, tok) {
    var t = tok.toLowerCase(), fields = [r.counterparty, r.description, r.article, r.project, r.docNo, r.order];
    for (var i = 0; i < fields.length; i++) if (fields[i] && String(fields[i]).toLowerCase().indexOf(t) >= 0) return true;
    var digits = tok.replace(/[\s\u00A0]/g, '').replace(',', '.');
    if (/^\d+(\.\d{1,2})?$/.test(digits)) {
      var abs = Math.abs(r.amount);
      if (digits.indexOf('.') >= 0) return (abs / 100).toFixed(2).indexOf(digits) >= 0;
      return String(Math.floor(abs / 100)).indexOf(digits) >= 0;
    }
    return false;
  }
  function matchQuery(r, q) {
    var toks = (q || '').trim().split(/\s+/).filter(Boolean);
    for (var i = 0; i < toks.length; i++) if (!matchToken(r, toks[i])) return false;
    return true;
  }
  function filterRecords(records, o) {
    o = o || {};
    return records.filter(function (r) {
      if (r.deleted && !o.includeDeleted) return false;
      if (o.month && monthKey(r.date) !== o.month) return false;
      if (o.type && o.type !== 'all' && typeOf(r) !== o.type) return false;
      if (o.project != null && o.project !== '' && (r.project || '') !== (o.project === '__none__' ? '' : o.project)) return false;
      if (o.wallet && r.wallet !== o.wallet) return false;
      if (o.unfilled && !missingFields(r).length) return false;
      if (o.query && !matchQuery(r, o.query)) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0); });
  }
  function groupByDay(records) {
    var out = [], idx = {};
    records.forEach(function (r) { if (!(r.date in idx)) { idx[r.date] = out.length; out.push({ date: r.date, items: [] }); } out[idx[r.date]].items.push(r); });
    return out;
  }

  /* ---------- подсказки по истории ---------- */
  function lc(s) { return (s || '').toLowerCase(); }
  function suggestFrom(records, getter, q, limit, filter) {
    var map = {}, ql = lc(q);
    records.forEach(function (r) {
      if (r.deleted || isTransfer(r) || (filter && !filter(r))) return;
      var v = getter(r); if (!v) return;
      var k = lc(v), m = map[k] || (map[k] = { name: v, count: 0, last: '' });
      m.count++; if (r.date > m.last) m.last = r.date;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    if (ql) arr = arr.filter(function (m) { return lc(m.name).indexOf(ql) >= 0; });
    arr.sort(function (a, b) {
      var sa = ql && lc(a.name).indexOf(ql) === 0 ? 0 : 1, sb = ql && lc(b.name).indexOf(ql) === 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.count !== b.count) return b.count - a.count;
      if (a.last !== b.last) return a.last < b.last ? 1 : -1;
      return a.name < b.name ? -1 : 1;
    });
    return arr.slice(0, limit || 6).map(function (m) { return m.name; });
  }
  function suggestCounterparties(records, q, limit) { return suggestFrom(records, function (r) { return r.counterparty; }, q, limit); }
  function suggestArticles(records, q, sign, limit) { return suggestFrom(records, function (r) { return r.article; }, q, limit, function (r) { return !sign || (r.amount < 0) === (sign < 0); }); }
  function suggestProjects(records, q, limit) { return suggestFrom(records, function (r) { return r.project; }, q, limit || 8); }
  // статья, которую чаще всего ставили этому контрагенту
  function suggestArticleFor(records, counterparty, sign) {
    var c = lc(counterparty); if (!c) return null;
    var map = {};
    records.forEach(function (r) {
      if (r.deleted || isTransfer(r) || !r.article || lc(r.counterparty) !== c) return;
      if (sign && (r.amount < 0) !== (sign < 0)) return;
      var m = map[r.article] || (map[r.article] = { article: r.article, count: 0, last: '' });
      m.count++; if (r.date > m.last) m.last = r.date;
    });
    var best = null;
    Object.keys(map).forEach(function (k) { var m = map[k]; if (!best || m.count > best.count || (m.count === best.count && m.last > best.last)) best = m; });
    return best ? best.article : null;
  }

  /* ---------- проекты (срезы) ---------- */
  function projectStats(records) {
    var map = {};
    records.forEach(function (r) {
      if (r.deleted || r.planned || isTransfer(r)) return;
      var key = r.project || '', m = map[key] || (map[key] = { project: key, income: 0, expense: 0 });
      if (r.amount > 0) m.income += r.amount; else m.expense += -r.amount;
    });
    var arr = Object.keys(map).map(function (k) {
      var m = map[k]; m.profit = m.income - m.expense; m.margin = m.income > 0 ? m.profit / m.income : null; return m;
    });
    arr.sort(function (a, b) { if (!a.project !== !b.project) return a.project ? -1 : 1; return b.profit - a.profit; });
    var tot = { income: 0, expense: 0 };
    arr.forEach(function (m) { tot.income += m.income; tot.expense += m.expense; });
    tot.profit = tot.income - tot.expense;
    return { list: arr, total: tot };
  }


  /* ---------- справочник статей (номенклатура): виды деятельности, постоянные расходы ---------- */
  var ACTIVITIES = [
    { id: 'operating', name: 'Операционная' }, { id: 'investing', name: 'Инвестиционная' },
    { id: 'financing', name: 'Финансовая' }, { id: 'none', name: 'Не определена' }
  ];
  function activityName(id) { for (var i = 0; i < ACTIVITIES.length; i++) if (ACTIVITIES[i].id === id) return ACTIVITIES[i].name; return ACTIVITIES[3].name; }
  function validActivity(id) { for (var i = 0; i < ACTIVITIES.length; i++) if (ACTIVITIES[i].id === id) return id; return 'none'; }
  // виды деятельности по статьям из файла «Статьи и виды деятельности» (утверждено 31.10.2026); применяются только к новым статьям
  var DEFAULT_ACTIVITY = {
    'административные подрядчики': 'operating', 'аренда офиса': 'operating', 'возвраты от поставщиков': 'operating', 'закупка материала': 'operating',
    'зарплата административного персонала': 'operating', 'зарплата коммерческого персонала': 'operating', 'зарплата производственного персонала': 'operating',
    'маркетинговые подрядчики': 'operating', 'налоги': 'operating', 'нераспределенные расходы': 'operating', 'нераспределённые расходы': 'operating', 'обучение персонала': 'operating',
    'оплата рекламных систем': 'operating', 'поиск и найм персонала': 'operating', 'представительские расходы': 'operating', 'продажа мебель без ндс': 'operating',
    'продажа мебель с ндс': 'operating', 'продажи маркетплейс': 'operating', 'продажи мебель': 'operating', 'рко': 'operating', 'расходы на персонал': 'operating',
    'содержание офиса': 'operating', 'содержание цеха': 'operating', 'транспортные услуги': 'operating', 'услуги подрядчиков': 'operating',
    'покупка ос': 'investing', 'возврат кредитов и займов': 'investing', 'выдача кредитов и займов': 'investing',
    'лизинг': 'financing', 'оплаты по кредитам и займам': 'financing', 'получение кредитов и займов': 'financing', 'прочие поступл. от фин. операций': 'financing'
  };
  function defaultActivity(name) { return DEFAULT_ACTIVITY[lc(name).trim()] || 'none'; }
  var SYSTEM_ARTICLES = [{ name: 'Нераспределённые расходы', kind: 'expense' }, { name: 'Нераспределённые приходы', kind: 'income' }];
  function newArticle(f) {
    var kind = f.kind === 'income' ? 'income' : 'expense';
    return { id: f.id || uid(), name: (f.name || '').trim().replace(/\s+/g, ' '), kind: kind, activity: validActivity(f.activity), fixed: kind === 'expense' && !!f.fixed, archived: !!f.archived, system: !!f.system, updatedAt: f.updatedAt || nowISO() };
  }
  function findArticle(catalog, name) {
    var n = lc(name).trim(); if (!n) return null;
    for (var i = 0; i < catalog.length; i++) if (lc(catalog[i].name) === n) return catalog[i];
    return null;
  }
  function validateArticleDraft(catalog, d, ignoreId) {
    var e = [], name = (d.name || '').trim().replace(/\s+/g, ' ');
    if (!name) e.push('Введите название статьи');
    else { var f = findArticle(catalog, name); if (f && f.id !== ignoreId) e.push('Такая статья уже есть'); }
    return e;
  }
  // добавляет недостающие статьи: системные и встреченные в записях (вид деятельности не определён)
  function ensureCatalog(catalog, records) {
    var have = {}, added = []; catalog.forEach(function (a) { have[lc(a.name)] = 1; });
    SYSTEM_ARTICLES.forEach(function (s) { if (!have[lc(s.name)]) { have[lc(s.name)] = 1; added.push(newArticle({ name: s.name, kind: s.kind, activity: 'none', system: true })); } });
    records.forEach(function (r) {
      if (r.deleted || !r.article || isTransfer(r)) return;
      var k = lc(r.article); if (have[k]) return; have[k] = 1;
      added.push(newArticle({ name: r.article, kind: r.amount < 0 ? 'expense' : 'income', activity: defaultActivity(r.article) }));
    });
    return added;
  }
  function fixedArticleNames(catalog) { return catalog.filter(function (a) { return a.kind === 'expense' && a.fixed && !a.archived; }).map(function (a) { return a.name; }); }
  function articleUsage(records) {
    var m = {}; records.forEach(function (r) { if (!r.deleted && r.article && !isTransfer(r)) { var k = lc(r.article); m[k] = (m[k] || 0) + 1; } });
    return m;
  }
  // подсказки только из справочника: нужного вида (приход или расход), без архивных и системных
  function suggestCatalog(catalog, records, q, sign, limit) {
    var use = articleUsage(records), ql = lc(q).trim();
    var list = catalog.filter(function (a) { return !a.archived && !a.system && (!sign || (sign < 0) === (a.kind === 'expense')) && (!ql || lc(a.name).indexOf(ql) >= 0); });
    list.sort(function (a, b) {
      var sa = ql && lc(a.name).indexOf(ql) === 0 ? 0 : 1, sb = ql && lc(b.name).indexOf(ql) === 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      var ua = use[lc(a.name)] || 0, ub = use[lc(b.name)] || 0; if (ua !== ub) return ub - ua;
      return a.name < b.name ? -1 : 1;
    });
    return list.slice(0, limit || 8).map(function (a) { return a.name; });
  }
  // слияние справочника с облаком: по id побеждает более поздняя правка; удалённые статьи хранятся метками; две статьи с одним названием схлопываются
  function mergeArticles(localArts, localDel, remoteArts, remoteDel) {
    var del = {}, now = nowISO();
    (localDel || []).concat(remoteDel || []).forEach(function (d) { del[d.id] = d.at || ''; });
    var map = {};
    (localArts || []).concat(remoteArts || []).forEach(function (a) {
      if (del[a.id] !== undefined) return;
      var cur = map[a.id]; if (!cur || (a.updatedAt || '') > (cur.updatedAt || '')) map[a.id] = a;
    });
    var list = Object.keys(map).sort().map(function (k) { return map[k]; }), seen = {}, out = [];
    list.forEach(function (a) {
      var k = lc(a.name);
      if (seen[k]) { del[a.id] = now; return; }
      seen[k] = 1; out.push(a);
    });
    var deleted = Object.keys(del).sort().map(function (id) { return { id: id, at: del[id] }; });
    return { articles: out, deleted: deleted };
  }
  // статусы проектов: объект по названию проекта; побеждает более поздняя правка
  function mergeProjects(local, remote) {
    var out = {}, k;
    function at(p) { return (p && (p.updatedAt || p.doneAt)) || ''; }
    for (k in (local || {})) out[k] = local[k];
    for (k in (remote || {})) if (!out[k] || at(remote[k]) > at(out[k])) out[k] = remote[k];
    return out;
  }
  function projectsToList(map) { return Object.keys(map || {}).sort().map(function (k) { return Object.assign({ key: k }, map[k]); }); }
  function projectsFromList(list) { var m = {}; (list || []).forEach(function (p) { var o = Object.assign({}, p); delete o.key; m[p.key] = o; }); return m; }
  function renameArticlePatches(records, oldName, newName) {
    var o = lc(oldName), out = [];
    records.forEach(function (r) { if (r.article && lc(r.article) === o && r.article !== newName) out.push({ id: r.id, patch: { article: newName } }); });
    return out;
  }
  function sampleCatalog() {
    var A = function (n, k, act, fixed) { return newArticle({ name: n, kind: k, activity: act, fixed: fixed }); };
    return [
      A('Продажа мебели', 'income', 'operating'), A('Возвраты от поставщиков', 'income', 'operating'), A('Проценты по вкладам', 'income', 'investing'), A('Кредиты и займы полученные', 'income', 'financing'),
      A('Закупка материала', 'expense', 'operating'), A('Услуги подрядчиков', 'expense', 'operating'), A('Аренда офиса', 'expense', 'operating', true), A('Аренда цеха', 'expense', 'operating', true),
      A('Зарплата производственного персонала', 'expense', 'operating', true), A('Зарплата административного персонала', 'expense', 'operating', true), A('Интернет и связь', 'expense', 'operating', true),
      A('СММ специалист', 'expense', 'operating', true), A('Содержание офиса', 'expense', 'operating', true), A('Содержание цеха', 'expense', 'operating', true), A('Оплата сервисов', 'expense', 'operating', true),
      A('Налоги', 'expense', 'operating'), A('Покупка оборудования', 'expense', 'investing'), A('Погашение кредитов', 'expense', 'financing')
    ];
  }

  /* ---------- карточка проекта и завершение проекта ---------- */
  function projectOps(records, project) {
    return records.filter(function (r) { return !r.deleted && (r.project || '') === project; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  // финансы проекта без постоянных расходов: фактические поступления, переменные (прямые) расходы по статьям
  function projectFinance(records, project, fixedArticles) {
    var fa = fixedArticles || [], inc = 0, exp = 0, own = 0, by = {}, first = '', last = '';
    records.forEach(function (r) {
      if (r.deleted || r.planned || isTransfer(r) || (r.project || '') !== project) return;
      if (r.amount > 0) { inc += r.amount; if (!first || r.date < first) first = r.date; if (!last || r.date > last) last = r.date; }
      else if (fa.indexOf(r.article) >= 0) own += -r.amount;
      else { exp += -r.amount; var k = r.article || 'Статья не указана'; by[k] = (by[k] || 0) + (-r.amount); }
    });
    var list = Object.keys(by).map(function (k) { return { article: k, sum: by[k] }; }).sort(function (a, b) { return b.sum - a.sum; });
    return { income: inc, variable: exp, byArticle: list, gross: inc - exp, margin: inc > 0 ? (inc - exp) / inc : null, firstPay: first, lastPay: last, fixedOwn: own };
  }
  // доля постоянных расходов: поступления заказа / поступления всех заказов за период, умножить на все постоянные расходы периода
  function fixedAllocation(records, project, o) {
    var from = o.from, to = o.to, mode = o.mode === 'articles' ? 'articles' : 'noproject', fa = o.fixedArticles || [];
    var own = 0, all = 0, pool = 0, poolCount = 0, orders = {}, unas = 0, unasCount = 0, sel = null;
    if (o.incomeIds) { sel = {}; o.incomeIds.forEach(function (id) { sel[id] = 1; }); }
    records.forEach(function (r) {
      if (r.deleted || r.planned || isTransfer(r) || r.date < from || r.date > to) return;
      if (r.amount > 0) {
        if (sel) { if (sel[r.id]) { all += r.amount; if (r.project) orders[r.project] = 1; if (r.project === project) own += r.amount; } }
        else if (r.project) { all += r.amount; orders[r.project] = 1; if (r.project === project) own += r.amount; }
      }
      else {
        var fixed = mode === 'articles' ? fa.indexOf(r.article) >= 0 : !r.project;
        if (fixed) { pool += -r.amount; poolCount++; }
        else if (!r.project) { unas += -r.amount; unasCount++; }
      }
    });
    var share = all > 0 ? own / all : null;
    return { from: from, to: to, mode: mode, ownIncome: own, allIncome: all, ordersCount: Object.keys(orders).length, share: share,
      fixedTotal: pool, fixedCount: poolCount, unassignedTotal: unas, unassignedCount: unasCount, fixedAllocated: share == null ? 0 : Math.round(pool * share) };
  }
  function projectResult(records, project, o) {
    var fa = o.mode === 'articles' ? (o.fixedArticles || []) : [];
    var f = projectFinance(records, project, fa), a = fixedAllocation(records, project, o);
    var inc = o.incomeIds ? a.ownIncome : f.income;
    var net = inc - f.variable - a.fixedAllocated;
    return { project: project, income: inc, variable: f.variable, byArticle: f.byArticle, gross: inc - f.variable, margin: inc > 0 ? (inc - f.variable) / inc : null,
      alloc: a, net: net, netMargin: inc > 0 ? net / inc : null };
  }
  // поступления периода для ручного отбора: по умолчанию отмечены те, у которых есть проект
  function periodIncomes(records, from, to) {
    return records.filter(function (r) { return !r.deleted && !r.planned && !isTransfer(r) && r.amount > 0 && r.date >= from && r.date <= to; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function expenseSumsByArticle(records, from, to) {
    var m = {}; records.forEach(function (r) { if (r.deleted || r.planned || isTransfer(r) || r.amount >= 0 || r.date < from || r.date > to) return; var k = r.article || ''; m[k] = (m[k] || 0) + (-r.amount); });
    return m;
  }
  // статьи, похожие по названию на постоянные: аренда, зарплата, интернет, СММ, содержание, сервисы
  var FIXED_NAME_RE = /аренд|зарплат|заработн|оклад|интернет|смм|smm|содержани|сервис/i;
  function suggestFixedArticles(names) { return names.filter(function (n) { return FIXED_NAME_RE.test(n); }); }
  function expenseArticles(records) {
    var map = {}; records.forEach(function (r) { if (!r.deleted && !isTransfer(r) && r.amount < 0 && r.article) map[r.article] = (map[r.article] || 0) + 1; });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); });
  }

  /* ---------- выписки и сверка ---------- */
  var TRANSFER_RE = /перевод|внесени|снят|пополнени|выдач[аи]\s+налич/i;
  function normText(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40); }
  function rowBaseKey(r) { return [r.date, r.amount, r.docNo || '', normText(r.counterparty)].join('|'); }
  function stampKeys(rows) { // ключ строки: дата|сумма|номер|контрагент, повторы внутри файла нумеруются
    var seen = {};
    rows.forEach(function (r) { var b = rowBaseKey(r); seen[b] = (seen[b] || 0) + 1; r.key = b + '#' + seen[b]; });
    return rows;
  }
  function recordFromBankRow(walletId, row) {
    var like = TRANSFER_RE.test(row.purpose || '') || TRANSFER_RE.test(row.counterparty || '');
    return newRecord({
      source: 'bank', wallet: walletId, amount: row.amount, date: row.date, counterparty: row.counterparty, description: row.purpose,
      docNo: row.docNo, bankKey: row.key, bankState: 'confirmed', bankDate: row.date, bankPurpose: row.purpose,
      kind: like ? (row.amount < 0 ? 'transfer_out' : 'transfer_in') : undefined,
      article: like ? '' : (row.amount < 0 ? 'Нераспределённые расходы' : 'Нераспределённые приходы'),
      note: like ? 'нет пары' : ''
    });
  }
  function confirmPatch(rec, row) {
    return { id: rec.id, patch: { bankState: 'confirmed', bankKey: row.key, bankDate: row.date, bankPurpose: row.purpose || '', docNo: rec.docNo || row.docNo || '' } };
  }
  function reconcile(o) {
    var records = o.records, walletId = o.wallet, tol = o.tolerance == null ? 4 : o.tolerance, w = wallet(walletId);
    var rows = stampKeys(o.rows.map(function (r) { return { date: r.date, amount: r.amount, counterparty: r.counterparty || '', purpose: r.purpose || '', docNo: r.docNo || '' }; }));
    var ignored = {}; (o.ignored || []).concat(o.skipKeys || []).forEach(function (k) { ignored[k] = 1; });
    var res = { patches: [], newRecords: [], decisions: [], period: null, stats: { rows: rows.length, duplicates: 0, matched: 0, added: 0, decisions: 0, absent: 0, onlyInBank: 0 } };
    if (!rows.length) return res;
    var known = {}; records.forEach(function (r) { if (r.bankKey) known[r.bankKey] = 1; });
    var pmin = rows[0].date, pmax = rows[0].date;
    rows.forEach(function (r) { if (r.date < pmin) pmin = r.date; if (r.date > pmax) pmax = r.date; });
    res.period = { from: pmin, to: pmax };
    var fresh = rows.filter(function (r) { if (known[r.key] || ignored[r.key]) { res.stats.duplicates++; return false; } return true; });
    var pool = records.filter(function (r) { return !r.deleted && !r.planned && r.wallet === walletId && (r.bankState === 'pending' || r.bankState === 'unconfirmed' || r.bankState === 'absent'); });
    var cands = fresh.map(function (row) {
      return pool.filter(function (r) { return r.amount === row.amount && Math.abs(diffDays(row.date, r.date)) <= tol; })
        .sort(function (a, b) { return Math.abs(diffDays(row.date, a.date)) - Math.abs(diffDays(row.date, b.date)); });
    });
    var recDeg = {}; cands.forEach(function (list) { list.forEach(function (r) { recDeg[r.id] = (recDeg[r.id] || 0) + 1; }); });
    var touched = {};
    fresh.forEach(function (row, i) {
      var list = cands[i];
      if (list.length === 1 && recDeg[list[0].id] === 1) {
        res.patches.push(confirmPatch(list[0], row)); touched[list[0].id] = 1; res.stats.matched++;
      } else if (list.length >= 1) {
        list.forEach(function (r) { touched[r.id] = 1; });
        res.decisions.push({ id: uid(), type: 'choose', wallet: walletId, row: row, candidates: list.map(function (r) { return r.id; }), createdAt: nowISO() });
        res.stats.decisions++;
      } else if (w && w.ledger) {
        res.decisions.push({ id: uid(), type: 'only_in_bank', wallet: walletId, row: row, createdAt: nowISO() });
        res.stats.onlyInBank++; res.stats.decisions++;
      } else {
        res.newRecords.push(recordFromBankRow(walletId, row)); res.stats.added++;
      }
    });
    if (w && w.ledger) {
      pool.forEach(function (r) {
        if (r.bankState !== 'unconfirmed' || touched[r.id]) return;
        if (r.date >= pmin && r.date <= pmax) {
          res.patches.push({ id: r.id, patch: { bankState: 'absent' } });
          res.decisions.push({ id: uid(), type: 'absent', wallet: walletId, recId: r.id, createdAt: nowISO() });
          res.stats.absent++; res.stats.decisions++;
        }
      });
    }
    return res;
  }
  // choice: {recId} | 'new' | 'add' | 'ignore' | 'keep' | 'delete'
  function resolveDecision(d, choice, records) {
    var out = { patches: [], newRecords: [], ignoredKeys: [] };
    function rec(id) { for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i]; return null; }
    if (d.type === 'choose') {
      if (choice && choice.recId) {
        var r = rec(choice.recId);
        // запись уже привязана к другой строке выписки: вторую строку добавляем как новую, чтобы не потерять первую привязку
        if (r && r.bankKey) out.newRecords.push(recordFromBankRow(d.wallet, d.row));
        else if (r) out.patches.push(confirmPatch(r, d.row));
      }
      else if (choice === 'new') out.newRecords.push(recordFromBankRow(d.wallet, d.row));
    } else if (d.type === 'only_in_bank') {
      if (choice === 'add') out.newRecords.push(recordFromBankRow(d.wallet, d.row));
      else if (choice === 'ignore') out.ignoredKeys.push(d.row.key);
    } else if (d.type === 'absent') {
      if (choice === 'keep') out.patches.push({ id: d.recId, patch: { absentAck: true } });
      else if (choice === 'delete') out.patches.push({ id: d.recId, patch: { deleted: true } });
    }
    return out;
  }

  /* ---------- слияние с облаком: решения по выпискам, журнал, история загрузок ---------- */
  function mergeDecisions(local, remote) {
    var m = {};
    (local || []).concat(remote || []).forEach(function (d) { var c = m[d.id]; if (!c || (!c.resolvedAt && d.resolvedAt)) m[d.id] = d; });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  }
  function mergeLog(local, remote, cap) {
    var m = {};
    (local || []).concat(remote || []).forEach(function (l) { m[l.id] = l; });
    var arr = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });
    return arr.slice(-(cap || 1000));
  }
  function mergeStatements(local, remote) {
    var m = {};
    (local || []).concat(remote || []).forEach(function (s) { m[s.wallet + '|' + s.at] = s; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  }
  function mergeKeys(a, b) { var m = {}; (a || []).concat(b || []).forEach(function (k) { m[k] = 1; }); return Object.keys(m).sort(); }
  function hashStr(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h) + ':' + str.length; }

  /* ---------- чтение таблиц (строки уже получены из xlsx) ---------- */
  var COLS = {
    date: ['дата проводки', 'дата операции', 'дата', 'date'],
    debit: ['дебет', 'списание', 'расход', 'debit'],
    credit: ['кредит', 'поступление', 'приход', 'credit'],
    amount: ['сумма', 'amount'],
    counterparty: ['контрагент', 'получатель', 'плательщик', 'наименование контрагента', 'корреспондент', 'наименование'],
    purpose: ['назначение платежа', 'назначение', 'описание', 'комментарий'],
    docNo: ['№ документа', 'номер документа', '№ п.п.', 'номер', '№']
  };
  function detectColumns(header) {
    var map = {}, h = header.map(function (x) { return lc(String(x == null ? '' : x)).trim(); });
    Object.keys(COLS).forEach(function (k) {
      for (var j = 0; j < COLS[k].length && map[k] == null; j++) {
        for (var i = 0; i < h.length; i++) if (h[i] === COLS[k][j] || (COLS[k][j].length > 4 && h[i].indexOf(COLS[k][j]) >= 0)) { map[k] = i; break; }
      }
    });
    return map;
  }
  function findHeaderRow(table) {
    for (var i = 0; i < Math.min(table.length, 40); i++) { var m = detectColumns(table[i] || []); if (m.date != null && (m.amount != null || m.debit != null || m.credit != null)) return i; }
    return -1;
  }
  // колонки: {date, amount | debit+credit, counterparty, purpose, docNo} (индексы)
  function rowsFromTable(table, headerIdx, map) {
    var rows = [], errors = 0;
    for (var i = headerIdx + 1; i < table.length; i++) {
      var r = table[i]; if (!r) continue;
      var date = parseDateInput(r[map.date]); if (!date) continue;
      var amt;
      if (map.amount != null && map.debit == null && map.credit == null) amt = parseMoney(r[map.amount]);
      else {
        var d = map.debit != null ? parseMoney(r[map.debit]) : NaN, c = map.credit != null ? parseMoney(r[map.credit]) : NaN;
        amt = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
      }
      if (!amt || isNaN(amt)) { errors++; continue; }
      rows.push({ date: date, amount: amt, counterparty: map.counterparty != null ? String(r[map.counterparty] || '').trim() : '', purpose: map.purpose != null ? String(r[map.purpose] || '').trim() : '', docNo: map.docNo != null ? String(r[map.docNo] || '').trim() : '' });
    }
    return { rows: rows, skipped: errors };
  }

  /* ---------- импорт сводной таблицы (колонки Финолога) ---------- */
  var TRANSFER_ARTICLE_RE = /перевод между счетами|вывод в наличные|перевод с наличных|покупка наличности|внесени[ея] налич/i;
  function importSummary(objs, existing) {
    var have = {}; (existing || []).forEach(function (r) { if (r.extId) have[r.extId] = 1; });
    var out = { records: [], skipped: 0, duplicates: 0 };
    function pick(o, names) { for (var i = 0; i < names.length; i++) for (var k in o) if (lc(k).trim() === names[i]) return o[k]; return ''; }
    // колонки кошельков ищем по началу названия: в таблице «Альфа-банк (₽)», а не просто «Альфа-банк»
    function pickWallet(o, name) { for (var k in o) { var l = lc(k).trim(); if (l === name || l.indexOf(name + ' ') === 0 || l.indexOf(name + '(') === 0) return o[k]; } return ''; }
    objs.forEach(function (o) {
      var date = parseDateInput(pick(o, ['дата операции', 'дата']));
      var wid = null, amt = 0;
      var cols = [['alfa', 'альфа-банк'], ['cash', 'наличные'], ['promos', 'промос']];
      cols.forEach(function (c) { var v = parseMoney(pickWallet(o, c[1])); if (v && !isNaN(v)) { wid = c[0]; amt = v; } });
      for (var k in o) if (lc(k).indexOf('кредит') >= 0 && lc(k).indexOf('лич') >= 0) { var v2 = parseMoney(o[k]); if (v2 && !isNaN(v2)) { wid = 'credit'; amt = v2; } }
      if (!date || !wid || !amt) { out.skipped++; return; }
      var ext = String(pick(o, ['id']) || '');
      if (ext && have[ext]) { out.duplicates++; return; }
      var fact = lc(String(pick(o, ['факт']))).trim();
      var article = String(pick(o, ['статья']) || '').trim();
      var like = TRANSFER_ARTICLE_RE.test(article);
      var note = [pick(o, ['комментарий']), pick(o, ['статус сверки']), pick(o, ['автозаполнение'])].filter(Boolean).join('; ');
      var rec = newRecord({
        source: 'import', extId: ext, wallet: wid, amount: amt, date: date, planned: fact === 'нет',
        kind: like ? (amt < 0 ? 'transfer_out' : 'transfer_in') : undefined,
        counterparty: String(pick(o, ['контрагент']) || ''), article: article, project: String(pick(o, ['проекты', 'проект']) || ''),
        description: String(pick(o, ['описание']) || ''), accrualDate: parseDateInput(pick(o, ['дата начисления'])),
        docNo: String(pick(o, ['№ п.п.']) || ''), order: String(pick(o, ['заказ']) || ''), note: note,
        pairId: like ? String(pick(o, ['пара перевода']) || '') : ''
      });
      if (ext) have[ext] = 1;
      out.records.push(rec);
    });
    return out;
  }

  /* ---------- копии ---------- */
  var BACKUP_VERSION = 1;
  function backupObject(state) {
    return { app: 'kubcrafter-money', version: BACKUP_VERSION, createdAt: nowISO(), namespace: state.namespace || '',
      records: state.records, log: state.log || [], decisions: state.decisions || [], meta: state.meta || {} };
  }
  function validateBackup(o) {
    if (!o || o.app !== 'kubcrafter-money') return 'Это не файл копии Kubcrafter';
    if (o.version > BACKUP_VERSION) return 'Копия сделана более новой версией';
    if (!Array.isArray(o.records)) return 'В копии нет записей';
    return '';
  }
  var XLSX_COLUMNS = [
    ['ID', function (r) { return r.id; }], ['Дата операции', function (r) { return r.date; }], ['Кошелёк', function (r) { var w = wallet(r.wallet); return w ? w.name : r.wallet; }],
    ['Сумма', function (r) { return r.amount / 100; }], ['Факт', function (r) { return r.planned ? 'Нет' : 'Да'; }], ['Описание', function (r) { return r.description; }],
    ['Статья', function (r) { return r.article; }], ['Проект', function (r) { return r.project; }], ['Контрагент', function (r) { return r.counterparty; }],
    ['Дата начисления', function (r) { return r.accrualDate; }], ['№ п.п.', function (r) { return r.docNo; }], ['Заказ', function (r) { return r.order; }],
    ['Вид', function (r) { return r.kind; }], ['Пара перевода', function (r) { return r.pairId; }], ['Статус банка', function (r) { return r.bankState; }],
    ['Источник', function (r) { return r.source; }], ['Назначение платежа (банк)', function (r) { return r.bankPurpose; }], ['Комментарий', function (r) { return r.note; }],
    ['Удалена', function (r) { return r.deleted ? 'Да' : ''; }]
  ];
  function recordsToTable(records) {
    var rows = [XLSX_COLUMNS.map(function (c) { return c[0]; })];
    records.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (r) { rows.push(XLSX_COLUMNS.map(function (c) { return c[1](r); })); });
    return rows;
  }

  /* ---------- тестовые данные (выдуманные, даты от сегодняшней) ---------- */
  function sampleRecords(t) {
    t = t || today();
    var d = function (n) { return addDays(t, -n); };
    var R = function (f) { return newRecord(f); };
    var list = [];
    list.push(R({ wallet: 'alfa', amount: 52000000, date: d(40), counterparty: 'Заказчик «Образец-2»', article: 'Продажа мебели', project: 'Образец 2', description: 'Предоплата', source: 'import' }));
    list.push(R({ wallet: 'alfa', amount: -9800000, date: d(30), counterparty: 'ООО «Образец-Плита»', article: 'Закупка материала', project: 'Образец 2', description: 'ЛДСП', source: 'import' }));
    list.push(R({ wallet: 'alfa', amount: -4500000, date: d(24), counterparty: 'Арендодатель «Образец»', article: 'Аренда офиса', description: 'Аренда', source: 'import' }));
    list.push(R({ wallet: 'alfa', amount: 62000000, date: d(21), counterparty: 'Заказчик «Образец-1»', article: 'Продажа мебели', project: 'Образец 1', description: 'Предоплата', source: 'import' }));
    list.push(R({ wallet: 'alfa', amount: -3500000, date: d(14), counterparty: 'Бригада монтажа', article: 'Услуги подрядчиков', project: 'Образец 2', description: 'Монтаж', source: 'import' }));
    list.push(R({ wallet: 'cash', amount: -730000, date: d(13), counterparty: '', article: '', project: '', description: 'Фурнитура на объект' }));
    list.push(R({ wallet: 'cash', amount: -1450000, date: d(11), counterparty: 'Образец-Фурнитура, ИП', article: 'Закупка материала', project: 'Образец 1', description: 'Петли, направляющие' }));
    list.push(R({ wallet: 'cash', amount: -1200000, date: d(9), counterparty: 'Образец-Фурнитура, ИП', article: 'Закупка материала', project: 'Образец 3', description: 'Ручки' }));
    makeTransfer({ from: 'alfa', to: 'cash', amount: 15000000, date: d(8), description: 'Снятие наличных', source: 'import' }).forEach(function (r) { r.bankState = r.wallet === 'alfa' ? 'confirmed' : 'none'; list.push(r); });
    list.push(R({ wallet: 'promos', amount: -4820000, date: d(0), counterparty: 'ООО «Образец-Плита»', article: 'Закупка материала', project: 'Образец 1', description: 'ЛДСП, 6 листов', source: 'agent' }));
    list.push(R({ wallet: 'promos', amount: -3100000, date: d(6), counterparty: 'Образец-Монтаж', article: 'Услуги подрядчиков', project: 'Образец 3', description: 'Доставка', source: 'agent' }));
    list.push(R({ wallet: 'promos', amount: 27000000, date: d(5), counterparty: 'Заказчик «Образец-3»', article: 'Продажа мебели', project: 'Образец 3', description: 'Оплата через Промос' }));
    list.push(R({ wallet: 'alfa', amount: 26000000, date: d(1), counterparty: 'Заказчик «Образец-2»', article: 'Продажа мебели', project: 'Образец 2', description: 'Доплата' }));
    makeTransfer({ from: 'alfa', to: 'cash', amount: 5000000, date: d(0), description: 'Наличные на объект' }).forEach(function (r) { list.push(r); });
    list.push(R({ wallet: 'cash', amount: -3500000, date: d(1), counterparty: 'Бригада монтажа', article: 'Услуги подрядчиков', project: 'Образец 2', description: 'Монтаж, аванс' }));
    list.push(R({ wallet: 'promos', amount: -7800000, date: d(2), counterparty: 'Образец-Плита', article: '', project: 'Образец 4', description: 'Счёт на материал' }));
    return list;
  }
  function sampleStatement(walletId, t) {
    t = t || today();
    var d = function (n) { return addDays(t, -n); };
    if (walletId === 'alfa') return [
      { date: d(1), amount: 26000000, counterparty: 'Заказчик «Образец-2»', purpose: 'Оплата по договору, доплата', docNo: '3101' },
      { date: d(0), amount: -5000000, counterparty: 'Альфа-Банк', purpose: 'Снятие наличных', docNo: '3115' },
      { date: d(2), amount: -5000000, counterparty: 'Альфа-Банк', purpose: 'Снятие наличных', docNo: '3098' },
      { date: d(1), amount: -1240000, counterparty: 'ООО «Образец-Сервис»', purpose: 'Оплата услуг по счёту', docNo: '3102' }
    ];
    return [
      { date: d(0), amount: -4820000, counterparty: 'ООО «Образец-Плита»', purpose: 'Оплата по счёту за ЛДСП', docNo: 'П-77' },
      { date: d(3), amount: -1240000, counterparty: 'ООО «Образец-Сервис»', purpose: 'Оплата услуг', docNo: 'П-71' },
      { date: d(5), amount: 27000000, counterparty: 'Заказчик «Образец-3»', purpose: 'Оплата по договору', docNo: 'П-70' }
    ];
  }

  return {
    WALLETS: WALLETS, wallet: wallet, parseMoney: parseMoney, formatMoney: formatMoney,
    isoDate: isoDate, today: today, diffDays: diffDays, addDays: addDays, monthKey: monthKey, monthLabel: monthLabel, shiftMonth: shiftMonth,
    dayLabel: dayLabel, shortDate: shortDate, parseDateInput: parseDateInput, validDate: validDate,
    uid: uid, nowISO: nowISO, isTransfer: isTransfer, typeOf: typeOf, newRecord: newRecord, validate: validate, makeTransfer: makeTransfer, validateTransfer: validateTransfer,
    missingFields: missingFields, unfilledCount: unfilledCount, unpairedTransfers: unpairedTransfers, defaultBankState: defaultBankState,
    balances: balances, matchQuery: matchQuery, filterRecords: filterRecords, groupByDay: groupByDay,
    suggestCounterparties: suggestCounterparties, suggestArticles: suggestArticles, suggestProjects: suggestProjects, suggestArticleFor: suggestArticleFor,
    projectStats: projectStats, projectOps: projectOps, projectFinance: projectFinance, fixedAllocation: fixedAllocation, projectResult: projectResult, expenseArticles: expenseArticles, suggestFixedArticles: suggestFixedArticles, periodIncomes: periodIncomes, expenseSumsByArticle: expenseSumsByArticle,
    ACTIVITIES: ACTIVITIES, defaultActivity: defaultActivity, activityName: activityName, newArticle: newArticle, findArticle: findArticle, validateArticleDraft: validateArticleDraft, ensureCatalog: ensureCatalog, fixedArticleNames: fixedArticleNames, articleUsage: articleUsage, suggestCatalog: suggestCatalog, renameArticlePatches: renameArticlePatches, sampleCatalog: sampleCatalog, mergeDecisions: mergeDecisions, mergeLog: mergeLog, mergeStatements: mergeStatements, mergeKeys: mergeKeys, hashStr: hashStr, mergeArticles: mergeArticles, mergeProjects: mergeProjects, projectsToList: projectsToList, projectsFromList: projectsFromList, reconcile: reconcile, resolveDecision: resolveDecision, stampKeys: stampKeys,
    detectColumns: detectColumns, findHeaderRow: findHeaderRow, rowsFromTable: rowsFromTable, importSummary: importSummary,
    backupObject: backupObject, validateBackup: validateBackup, recordsToTable: recordsToTable, sampleRecords: sampleRecords, sampleStatement: sampleStatement
  };
});
