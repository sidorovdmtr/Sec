/* Kubcrafter Деньги: интерфейс, хранилище, копии, синхронизация */
(function () {
  'use strict';
  var KC = window.KC, CFG = window.KC_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = KC.formatMoney;

  /* ---------- хранилище (локально; всегда работает без связи) ---------- */
  // Хранилище. Большие данные (записи, журнал, решения, настройки базы) лежат в IndexedDB: в localStorage на iPhone около 5 МБ на сайт,
  // а рабочая и тестовая базы вместе не помещались. Если IndexedDB недоступен, работаем через localStorage, как раньше.
  var mem = {}, storageOk = true, idbOn = false, idbDb = null, idbQueue = {}, idbTimer = null;
  function isBig(k) { return /^kc\.(test|prod)\.(records|log|decisions|meta)$/.test(k); }
  function lsGet(k) {
    if (idbOn && isBig(k)) return k in mem ? mem[k] : null;
    try { var v = localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; }
  }
  function lsSet(k, v) {
    if (idbOn && isBig(k)) { mem[k] = v; idbQueue[k] = v; idbSchedule(); return true; }
    try { localStorage.setItem(k, v); return true; } catch (e) { storageOk = false; mem[k] = v; return false; }
  }
  function lsDel(k) {
    if (idbOn && isBig(k)) { idbQueue[k] = null; idbSchedule(); }
    try { localStorage.removeItem(k); } catch (e) {} delete mem[k];
  }
  function idbSchedule() { if (!idbTimer) idbTimer = setTimeout(idbFlush, 0); }
  function idbFlush() {
    if (idbTimer) { clearTimeout(idbTimer); idbTimer = null; }
    var keys = Object.keys(idbQueue); if (!keys.length || !idbDb) return;
    var batch = idbQueue; idbQueue = {};
    try {
      var tx = idbDb.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
      keys.forEach(function (k) { if (batch[k] === null) st.delete(k); else st.put(batch[k], k); });
      tx.oncomplete = function () { if (!storageOk) { storageOk = true; render(); } };
      tx.onerror = tx.onabort = function () { storageOk = false; Object.keys(batch).forEach(function (k) { if (!(k in idbQueue) && batch[k] !== null) idbQueue[k] = batch[k]; }); render(); };
    } catch (e) { storageOk = false; }
  }
  function storageInit() {
    return new Promise(function (resolve) {
      var done = false, finish = function () { if (!done) { done = true; resolve(); } };
      try {
        if (!window.indexedDB) return finish();
        var req = indexedDB.open('kubcrafter-money', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onerror = req.onblocked = function () { finish(); };
        req.onsuccess = function () {
          var db = req.result, got = {}, tx = db.transaction('kv', 'readonly'), cur = tx.objectStore('kv').openCursor();
          cur.onsuccess = function () { var c = cur.result; if (c) { got[c.key] = c.value; c.continue(); } };
          tx.onerror = tx.onabort = function () { finish(); };
          tx.oncomplete = function () {
            idbDb = db; idbOn = true; Object.keys(got).forEach(function (k) { mem[k] = got[k]; });
            // перенос из localStorage: старые данные удаляем оттуда только после подтверждённой записи в IndexedDB
            var moved = [];
            try {
              for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isBig(k) && !(k in got)) moved.push(k); }
            } catch (e) {}
            if (!moved.length) return finish();
            var data = {}; moved.forEach(function (k) { data[k] = localStorage.getItem(k); });
            try {
              var tx2 = db.transaction('kv', 'readwrite'), st = tx2.objectStore('kv');
              moved.forEach(function (k) { st.put(data[k], k); });
              tx2.oncomplete = function () { moved.forEach(function (k) { mem[k] = data[k]; try { localStorage.removeItem(k); } catch (e) {} }); finish(); };
              tx2.onerror = tx2.onabort = function () { idbOn = false; finish(); };
            } catch (e) { idbOn = false; finish(); }
          };
        };
      } catch (e) { finish(); }
      setTimeout(finish, 4000);
    });
  }
  window.addEventListener('pagehide', idbFlush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') idbFlush(); });
  function jparse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }

  var S = {
    mode: 'test', theme: 'dark', view: 'ops', month: KC.monthKey(KC.today()),
    type: 'all', query: '', project: '', unfilled: false, walletsOpen: true, projQuery: '',
    records: [], log: [], decisions: [], pcard: null, meta: { ignoredKeys: [], dirty: {}, lastBackupAt: '', statements: [], projects: {}, articles: [], deletedArticles: [], synced: {} },
    form: null, modal: null, settingsTab: 'articles', artSheet: null, online: navigator.onLine !== false, sync: { state: 'local', text: '' }
  };
  function pref() { return 'kc.' + S.mode + '.'; }
  function load() {
    var m = lsGet('kc.mode'); S.mode = (m === 'prod' && CFG.allowProd) ? 'prod' : 'test';
    var t = lsGet('kc.theme'); S.theme = t === 'light' ? 'light' : 'dark';
    S.records = jparse(lsGet(pref() + 'records'), []);
    S.log = jparse(lsGet(pref() + 'log'), []);
    S.decisions = jparse(lsGet(pref() + 'decisions'), []);
    var meta = jparse(lsGet(pref() + 'meta'), {});
    S.meta = { ignoredKeys: meta.ignoredKeys || [], dirty: meta.dirty || {}, lastBackupAt: meta.lastBackupAt || '', statements: meta.statements || [], lastPull: meta.lastPull || '', projects: meta.projects || {}, articles: meta.articles || [], deletedArticles: meta.deletedArticles || [], synced: meta.synced || {} };
    if (!S.records.length) S.meta.lastPull = ''; // на устройстве записей нет: берём всё из облака
    ensureCatalogNow(true); persist();
  }
  // добавляет в справочник недостающие статьи (системные и встреченные в записях); возвращает число добавленных несистемных
  function ensureCatalogNow(silent) {
    var added = KC.ensureCatalog(S.meta.articles, S.records);
    // статьи без вида деятельности получают вид из утверждённого списка (Дмитрий, 31.10.2026); уже выбранные виды не трогаем
    var upgraded = 0;
    S.meta.articles.forEach(function (a) { if (a.activity === 'none' && !a.system && KC.defaultActivity(a.name) !== 'none') { a.activity = KC.defaultActivity(a.name); a.updatedAt = KC.nowISO(); upgraded++; } });
    if (upgraded) S.log.push({ id: KC.uid(), at: KC.nowISO(), action: 'catalog', summary: 'Статьям без вида деятельности проставлен вид из утверждённого списка: ' + upgraded, recId: '' });
    if (added.length) S.meta.articles = S.meta.articles.concat(added);
    if ((added.length || upgraded) && !silent) persist();
    return added.filter(function (x) { return !x.system; }).length;
  }
  function persist(noSync) {
    var ok = lsSet(pref() + 'records', JSON.stringify(S.records));
    lsSet(pref() + 'log', JSON.stringify(S.log)); lsSet(pref() + 'decisions', JSON.stringify(S.decisions));
    // записи не сохранились на устройстве: метку получения из облака сбрасываем, чтобы при следующем запуске они подтянулись заново
    lsSet(pref() + 'meta', JSON.stringify(ok ? S.meta : Object.assign({}, S.meta, { lastPull: '' })));
    idbFlush(); // запись в IndexedDB стартует сразу, без задержки
    if (!noSync) scheduleSync();
  }
  function addLog(action, summary, recId) {
    S.log.push({ id: KC.uid(), at: KC.nowISO(), action: action, summary: summary, recId: recId || '' });
    if (S.log.length > 1000) S.log = S.log.slice(-1000);
  }
  function byId(id) { for (var i = 0; i < S.records.length; i++) if (S.records[i].id === id) return S.records[i]; return null; }
  function commit(ch, action, summary, recId) {
    var now = KC.nowISO();
    (ch.newRecords || []).forEach(function (r) { S.records.push(r); S.meta.dirty[r.id] = 1; });
    (ch.patches || []).forEach(function (p) { var r = byId(p.id); if (r) { Object.assign(r, p.patch, { updatedAt: now }); S.meta.dirty[r.id] = 1; } });
    if (action) addLog(action, summary, recId);
    persist();
  }

  /* ---------- синхронизация с Firebase (по настройке; без неё работает только локально) ---------- */
  // ВНИМАНИЕ: этот блок не проверялся на живом проекте Firebase.
  var Remote = { db: null, auth: null, fs: null, user: null, ready: false, timer: null };
  function setSync(state, text) { S.sync = { state: state, text: text }; var el = $('#syncpill'); if (el) el.textContent = text; }
  function remoteInit() {
    if (!CFG.firebase || Remote.ready || Remote.starting) return;
    Remote.starting = true; setSync('connecting', 'Подключение к облаку…');
    var base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(function (m) {
      var app = m[0].initializeApp(CFG.firebase);
      Remote.authMod = m[1]; Remote.fs = m[2]; Remote.auth = m[1].getAuth(app); Remote.db = m[2].getFirestore(app);
      m[1].onAuthStateChanged(Remote.auth, function (u) {
        Remote.user = u; Remote.ready = !!u;
        if (u) { setSync('online', 'Облако: подключено'); syncNow(); } else setSync('signedout', 'Облако: нужен вход');
        render();
      });
    }).catch(function (e) { Remote.starting = false; setSync('error', 'Облако недоступно, данные хранятся на этом устройстве'); });
  }
  function remoteSignIn() {
    if (!Remote.authMod) return;
    var p = new Remote.authMod.GoogleAuthProvider();
    // всплывающее окно: вход через редирект на GitHub Pages не завершается, потому что браузеры изолируют хранилище между доменами
    Remote.authMod.signInWithPopup(Remote.auth, p).catch(function (e) {
      var c = e && e.code || '';
      if (c === 'auth/popup-blocked') return Remote.authMod.signInWithRedirect(Remote.auth, p);
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      toast('Вход не удался: ' + (c || 'неизвестная ошибка'));
    });
  }
  function col(name) { return Remote.fs.collection(Remote.db, 'money_' + S.mode + '_' + name); }
  // в облаке три документа настроек: state (справочник, статусы проектов), decisions (решения по выпискам, игнорируемые строки, история загрузок), log (журнал изменений)
  function syncDoc(name, build, apply) {
    var fs = Remote.fs, ref = fs.doc(col('meta'), name);
    return fs.getDoc(ref).then(function (snap) {
      if (snap.exists()) apply(snap.data());
      var json = JSON.stringify(build()), h = KC.hashStr(json);
      if (S.meta.synced[name] === h) return;
      return fs.setDoc(ref, JSON.parse(json)).then(function () { S.meta.synced[name] = h; });
    });
  }
  function syncMeta() {
    return syncDoc('state', function () {
      return { articles: S.meta.articles, deletedArticles: S.meta.deletedArticles, projects: KC.projectsToList(S.meta.projects) };
    }, function (r) {
      var m = KC.mergeArticles(S.meta.articles, S.meta.deletedArticles, r.articles || [], r.deletedArticles || []);
      S.meta.articles = m.articles; S.meta.deletedArticles = m.deleted; S.meta.projects = KC.mergeProjects(S.meta.projects, KC.projectsFromList(r.projects || []));
    }).then(function () {
      return syncDoc('decisions', function () {
        return { decisions: S.decisions, ignoredKeys: S.meta.ignoredKeys, statements: S.meta.statements };
      }, function (r) {
        S.decisions = KC.mergeDecisions(S.decisions, r.decisions || []); S.meta.ignoredKeys = KC.mergeKeys(S.meta.ignoredKeys, r.ignoredKeys || []); S.meta.statements = KC.mergeStatements(S.meta.statements, r.statements || []);
      });
    }).then(function () {
      return syncDoc('log', function () { return { entries: S.log }; }, function (r) { S.log = KC.mergeLog(S.log, r.entries || [], 1000); });
    });
  }
  function scheduleSync() { if (!CFG.firebase) return; clearTimeout(Remote.timer); Remote.timer = setTimeout(syncNow, 800); }
  function syncNow() {
    if (!Remote.ready || !S.online) return Promise.resolve();
    var fs = Remote.fs, ids = Object.keys(S.meta.dirty);
    setSync('syncing', 'Синхронизация…');
    var pushes = [];
    for (var i = 0; i < ids.length; i += 400) {
      (function (chunk) {
        var batch = fs.writeBatch(Remote.db);
        chunk.forEach(function (id) { var r = byId(id); if (r) batch.set(fs.doc(col('records'), id), r); });
        pushes.push(batch.commit().then(function () { chunk.forEach(function (id) { delete S.meta.dirty[id]; }); }));
      })(ids.slice(i, i + 400));
    }
    return Promise.all(pushes).then(function () {
      var q = S.meta.lastPull ? fs.query(col('records'), fs.where('updatedAt', '>', S.meta.lastPull)) : col('records');
      return fs.getDocs(q);
    }).then(function (snap) {
      var maxAt = S.meta.lastPull || '';
      snap.forEach(function (d) {
        var r = d.data(), mine = byId(r.id);
        if (!mine) S.records.push(r); else if ((mine.updatedAt || '') < (r.updatedAt || '') && !S.meta.dirty[r.id]) Object.assign(mine, r);
        if ((r.updatedAt || '') > maxAt) maxAt = r.updatedAt;
      });
      S.meta.lastPull = maxAt;
      return syncMeta().then(function () { ensureCatalogNow(true); persist(true); setSync('online', 'Облако: всё отправлено'); render(); });
    }).catch(function () { setSync('error', 'Не отправлено: ' + Object.keys(S.meta.dirty).length); });
  }

  /* ---------- вспомогательное ---------- */
  var ICON = {
    left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    ops: '<path d="M4 6h16M4 12h16M4 18h10"/>', proj: '<path d="M3 7h6l2 2h10v10H3z"/>', stm: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', cfg: '<path d="M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v6h-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>', wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>'
  };
  function svg(name, size) { size = size || 20; return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function wname(id) { var w = KC.wallet(id); return w ? w.name : id; }
  function toast(msg, undoLabel, undoFn) {
    var old = $('#toast'); if (old) old.remove();
    var el = document.createElement('div'); el.className = 'toast'; el.id = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (undoFn ? '<button type="button">' + esc(undoLabel || 'Отменить') + '</button>' : '');
    if (undoFn) el.querySelector('button').onclick = function () { el.remove(); undoFn(); };
    document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.remove(); }, 7000);
  }
  function download(filename, blob) {
    var claudeUse = window.claude && window.claude.use;
    if (claudeUse) {
      return claudeUse('downloads').then(function (d) { if (!d) throw new Error('no'); return d.save({ filename: filename, data: blob }); })
        .catch(function (e) { if (e && e.code === 'declined') return; toast('Скачивание недоступно в этом окне. В рабочей версии файл скачается как обычно.'); });
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return Promise.resolve();
  }
  function ruDate(iso) { return iso ? KC.shortDate(iso.slice(0, 10)) : ''; }

  /* ---------- экран: операции ---------- */
  function filterOpts() { return { month: S.project ? '' : S.month, type: S.type, query: S.query, project: S.project, unfilled: S.unfilled }; }
  function transferText(r) {
    var other = null;
    if (KC.hasPair(r)) for (var i = 0; i < S.records.length; i++) { var x = S.records[i]; if (x.pairId === r.pairId && x.id !== r.id && !x.deleted) { other = x; break; } }
    var out = r.kind === 'transfer_out' ? r : other, inn = r.kind === 'transfer_in' ? r : other;
    if (out && inn) return wname(out.wallet) + ' → ' + wname(inn.wallet);
    return r.kind === 'transfer_out' ? wname(r.wallet) + ' → ?' : '? → ' + wname(r.wallet);
  }
  function pills(r) {
    var p = [];
    if (r.planned) p.push('<span class="pill">план</span>');
    if (KC.isTransfer(r)) { p.push('<span class="pill">перевод</span>'); if (!KC.hasPair(r)) p.push('<span class="pill warn">нет пары</span>'); }
    var w = KC.wallet(r.wallet);
    if (w && w.bank) {
      var st = KC.bankStateOf(r);
      if (st === 'pending') p.push('<span class="pill warn">ожидает выписки</span>');
      else if (st === 'unconfirmed') p.push('<span class="pill warn">не подтверждено выпиской</span>');
      else if (r.bankState === 'absent') p.push('<span class="pill ' + (r.absentAck ? '' : 'bad') + '">нет в выписке</span>');
    }
    var miss = KC.missingFields(r);
    if (miss.length) p.push('<span class="pill bad">не заполнено: ' + esc(miss.join(', ')) + '</span>');
    if (r.autofill === 'suggested') p.push('<span class="pill warn">статья подставлена</span>');
    return p.join('');
  }
  function opRow(r) {
    var tr = KC.isTransfer(r), amt = tr ? money(Math.abs(r.amount)) : money(r.amount, { sign: r.amount > 0 });
    var title = tr ? 'Перевод между счетами' : (r.article || 'Статья не указана');
    var sub = tr ? transferText(r) + (r.description ? ' · ' + r.description : '') : [r.counterparty, r.description].filter(Boolean).join(', ');
    var meta = tr ? '' : [r.project, wname(r.wallet)].filter(Boolean).map(function (x) { return '<span class="pill">' + esc(x) + '</span>'; }).join('');
    var cls = tr ? '' : (r.amount < 0 ? 'neg' : 'pos');
    var d = (r.date || '').split('-'), dateTxt = d.length === 3 ? d[2] + '.' + d[1] + '.' + d[0] : '';
    // телефон: заголовок, строка под ним, метки и сумма справа. Компьютер: столбцы как в таблице Финолога
    var phone = '<div class="m-only" style="flex:1;min-width:0"><div class="t ' + (!tr && !r.article ? 'neg' : '') + '">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div><div class="tags">' + meta + pills(r) + '</div></div>';
    var line1 = tr ? 'Перевод между счетами' : (r.description || title), line2 = tr ? transferText(r) : [r.description ? r.article : '', r.project].filter(Boolean).join(' · ');
    var desk = '<div class="c-date d-only">' + esc(dateTxt) + '</div><div class="c-amt d-only t num ' + cls + '">' + amt + '</div>' +
      '<div class="c-main d-only"><div class="t ' + (!tr && !r.article ? 'neg' : '') + '">' + esc(line1) + '</div><div class="s">' + esc(line2) + '</div><div class="tags">' + pills(r) + '</div></div>' +
      '<div class="c-cp d-only">' + esc(tr ? '' : r.counterparty || '') + '</div><div class="c-w d-only">' + esc(tr ? '' : wname(r.wallet)) + '</div>';
    return '<button type="button" class="op row-op" data-act="edit" data-id="' + esc(r.id) + '">' + phone + '<div class="t num m-only ' + cls + '">' + amt + '</div>' + desk + '</button>';
  }
  function listHtml() {
    var list = KC.filterRecords(S.records, filterOpts()), t = KC.today();
    if (!list.length) return '<div class="glass mu" style="padding:18px;text-align:center">' + (S.records.length ? 'Ничего не найдено' : 'Пока пусто') + '</div>';
    var head = '<div class="thead d-only"><div>Дата</div><div class="r">Сумма</div><div>Детали</div><div>Контрагент</div><div>Кошелёк</div></div>';
    return '<div class="tbl">' + head + KC.groupByDay(list).map(function (g) {
      return '<div class="dayh">' + esc(KC.dayLabel(g.date, t)) + '</div>' + g.items.map(opRow).join('');
    }).join('') + '</div>';
  }
  function totalCard() {
    var b = KC.balances(S.records), vis = b.wallets.filter(function (w) { return !w.hidden; });
    var posSum = 0; vis.forEach(function (w) { if (w.balance > 0) posSum += w.balance; });
    var rows = vis.map(function (w) {
      var share = posSum > 0 && w.balance > 0 ? Math.round(w.balance / posSum * 100) : 0;
      var extra = '';
      if (w.unconfirmed) extra += '<div class="row between tiny mu" style="margin-top:4px"><span>из них не подтверждено выпиской</span><span class="num">' + money(w.unconfirmed) + '</span></div>';
      var name = esc(w.name) + (w.note ? ' <span class="tiny mu">(' + esc(w.note) + ')</span>' : '');
      return '<div class="wallet"><div class="row between"><span>' + name + '</span><span class="bold num">' + money(w.balance) + '</span></div><div class="track"><div class="fill" style="width:' + share + '%"></div></div>' + extra + '</div>';
    }).join('');
    var transit = b.inTransit ? '<div class="row between tiny mu"><span>внесено без подтверждения банка, не в остатке</span><span class="num">' + money(b.inTransit, { sign: true }) + '</span></div>' : '';
    var hidden = b.wallets.filter(function (w) { return w.hidden && (w.balance || w.inTransit); }).map(function (w) { return '<div class="row between tiny mu"><span>' + esc(w.name) + ' (вне итога)</span><span class="num">' + money(w.balance) + '</span></div>'; }).join('');
    return '<div class="glass" style="padding:14px"><div class="row between"><div><div class="small mu">Всего по кошелькам</div><div class="num b7" style="font-size:30px;letter-spacing:-.5px" id="total">' + money(b.total) + '</div></div><button type="button" class="iconbtn" data-act="walletstoggle" aria-label="' + (S.walletsOpen ? 'Свернуть кошельки' : 'Показать кошельки') + '">' + svg(S.walletsOpen ? 'up' : 'down') + '</button></div>' +
      (S.walletsOpen ? '<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px;font-size:14px">' + rows + transit + hidden + '</div>' : '') + '</div>';
  }
  function donut(b) {
    var vis = b.wallets.filter(function (w) { return !w.hidden && w.balance > 0; }), sum = 0; vis.forEach(function (w) { sum += w.balance; });
    var C = 326.7, off = 0, cols = ['var(--w1)', 'var(--w2)', 'var(--w3)'], segs = '';
    if (sum > 0) vis.forEach(function (w, i) { var len = w.balance / sum * C; segs += '<circle cx="65" cy="65" r="52" stroke="' + cols[i % 3] + '" stroke-dasharray="' + len.toFixed(1) + ' ' + C + '" stroke-dashoffset="' + (-off).toFixed(1) + '"/>'; off += len; });
    return '<svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label="Доли кошельков"><g transform="rotate(-90 65 65)" fill="none" stroke-width="14"><circle cx="65" cy="65" r="52" stroke="var(--track)"/>' + segs + '</g><text x="65" y="62" text-anchor="middle" fill="currentColor" font-size="20" font-weight="700">' + vis.length + '</text><text x="65" y="80" text-anchor="middle" fill="var(--mu)" font-size="11">кошелька</text></svg>';
  }
  function dayBars() {
    var key = S.month || KC.monthKey(KC.today()), p = key.split('-'), days = new Date(+p[0], +p[1], 0).getDate(), inc = [], exp = [], max = 1, i;
    for (i = 0; i <= days; i++) { inc.push(0); exp.push(0); }
    S.records.forEach(function (r) { if (r.deleted || r.planned || KC.isOffReport(r) || KC.monthKey(r.date) !== key) return; var d = +r.date.slice(8, 10); if (r.amount > 0) inc[d] += r.amount; else exp[d] += -r.amount; });
    for (i = 1; i <= days; i++) max = Math.max(max, inc[i], exp[i]);
    var w = 600 / days, bars = '';
    for (i = 1; i <= days; i++) { var x = (i - 1) * w, hi = inc[i] / max * 120, he = exp[i] / max * 120, bw = Math.max(2, w / 2 - 2);
      if (hi) bars += '<rect x="' + (x + 1).toFixed(1) + '" y="' + (140 - hi).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hi.toFixed(1) + '" rx="2" fill="var(--pos)"/>';
      if (he) bars += '<rect x="' + (x + 1 + w / 2).toFixed(1) + '" y="' + (140 - he).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + he.toFixed(1) + '" rx="2" fill="var(--neg)"/>'; }
    return '<svg width="100%" height="160" viewBox="0 0 600 160" role="img" aria-label="Приходы и расходы по дням"><line x1="0" y1="140" x2="600" y2="140" stroke="var(--div)"/>' + bars + '<g font-size="11" fill="var(--mu)" text-anchor="middle"><text x="10" y="156">1</text><text x="300" y="156">' + Math.round(days / 2) + '</text><text x="590" y="156">' + days + '</text></g></svg>';
  }
  function viewOps() {
    var b = KC.balances(S.records), un = KC.unfilledCount(S.records), days = S.meta.lastBackupAt ? Math.floor((Date.now() - Date.parse(S.meta.lastBackupAt)) / 86400000) : null;
    var out = '';
    if (S.mode === 'test') out += '<div class="banner info">ТЕСТОВАЯ БАЗА: данные выдуманы, базу можно сбросить в разделе «Копии»</div>';
    if (!S.online) out += '<div class="banner warn">' + svg(S.online ? 'plus' : 'wifi', 14) + ' Нет связи: записи сохраняются в телефоне и отправятся позже</div>';
    if (!storageOk) out += '<div class="banner warn">Память браузера переполнена или недоступна: изменения на этом устройстве могут пропасть при закрытии страницы</div>';
    if (S.records.length && (days === null || days >= 7)) out += '<div class="banner warn">' + (days === null ? 'Копия ещё не делалась.' : 'Копия не делалась ' + days + ' дн.') + ' <a href="#" data-act="gocopies" style="color:inherit;font-weight:600">Сделать копию</a></div>';
    var monthRow = S.project
      ? '<div class="row gap8"><span class="pill">Проект: ' + esc(S.project === '__none__' ? 'без проекта' : S.project) + '</span><button type="button" class="chip" data-act="clearproject">Сбросить</button></div>'
      : '<div class="row between"><div class="row"><button type="button" class="iconbtn" data-act="month" data-n="-1" aria-label="Предыдущий месяц">' + svg('left') + '</button><div class="bold" style="font-size:17px" id="monthlabel">' + esc(KC.monthLabel(S.month)) + '</div><button type="button" class="iconbtn" data-act="month" data-n="1" aria-label="Следующий месяц">' + svg('right') + '</button></div></div>';
    out += '<div class="row between">' + monthRow + '<div class="row gap8"><span class="tiny mu" id="syncpill">' + esc(S.sync.text) + '</span><button type="button" class="iconbtn glass" data-act="theme" aria-label="' + (S.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему') + '">' + svg(S.theme === 'dark' ? 'sun' : 'moon') + '</button></div></div>';
    out += totalCard();
    out += '<div class="desk"><div class="glass" style="padding:16px"><div class="bold" style="margin-bottom:8px">Кошельки</div><div class="row gap12 wrap">' + donut(b) + '<div class="small mu" style="flex:1;min-width:140px">Доли положительных остатков. Промос считается по нашему учёту.</div></div></div><div class="glass" style="padding:16px"><div class="row between"><div class="bold">Движение по дням</div><div class="tiny mu"><span class="pos">■</span> приход &nbsp;<span class="neg">■</span> расход</div></div>' + dayBars() + '</div></div>';
    out += '<div class="row gap8"><div class="searchbox">' + svg('search', 18) + '<input id="q" class="input" type="search" inputmode="search" enterkeyhint="search" placeholder="Поиск: контрагент, описание, сумма" value="' + esc(S.query) + '" autocomplete="off"></div></div>';
    out += '<div class="row gap8 wrap"><button type="button" class="chip ' + (S.type === 'all' ? 'on' : '') + '" data-act="type" data-v="all">Все</button><button type="button" class="chip ' + (S.type === 'expense' ? 'on' : '') + '" data-act="type" data-v="expense">Расходы</button><button type="button" class="chip ' + (S.type === 'income' ? 'on' : '') + '" data-act="type" data-v="income">Приходы</button><button type="button" class="chip ' + (S.type === 'transfer' ? 'on' : '') + '" data-act="type" data-v="transfer">Переводы</button>' +
      '<button type="button" class="chip ' + (S.unfilled ? 'on' : '') + '" data-act="unfilled" id="unfilledchip" style="margin-left:auto">Не заполнено: ' + un + '</button></div>';
    if (!S.records.length) out += '<div class="glass" style="padding:16px;display:flex;flex-direction:column;gap:10px"><div class="bold">Пока пусто</div><div class="small mu">Добавьте первую операцию кнопкой «+»' + (S.mode === 'test' ? ' или заполните тестовую базу выдуманными данными.' : '.') + '</div>' + (S.mode === 'test' ? '<button type="button" class="btn main" data-act="seed">Заполнить тестовыми данными</button>' : '') + '</div>';
    out += '<div id="list">' + listHtml() + '</div>';
    return out;
  }

  /* ---------- экран: проекты ---------- */
  function viewProjects() {
    var st = KC.projectStats(S.records), q = S.projQuery.toLowerCase();
    var list = st.list.filter(function (m) { return !q || (m.project || 'без проекта').toLowerCase().indexOf(q) >= 0; });
    var out = '<div class="row between"><div class="h2" style="margin:0">Проекты</div><button type="button" class="iconbtn glass" data-act="theme" aria-label="Сменить тему">' + svg(S.theme === 'dark' ? 'sun' : 'moon') + '</button></div>';
    out += '<div class="searchbox">' + svg('search', 18) + '<input id="pq" class="input" type="search" enterkeyhint="search" placeholder="Поиск по названию" value="' + esc(S.projQuery) + '" autocomplete="off"></div>';
    out += '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px"><div class="glass" style="padding:8px 10px"><div class="tiny mu">Приход</div><div class="bold num pos">' + money(st.total.income) + '</div></div><div class="glass" style="padding:8px 10px"><div class="tiny mu">Расход</div><div class="bold num neg">' + money(st.total.expense) + '</div></div><div class="glass" style="padding:8px 10px"><div class="tiny mu">Прибыль</div><div class="bold num">' + money(st.total.profit) + '</div></div></div>';
    out += '<div class="tiny mu">Прибыль считается по операциям, внесённым на проект. Доля постоянных расходов не учтена. Плановые операции и переводы не входят.</div>';
    out += '<div class="list" id="projlist">' + (list.length ? list.map(function (m) {
      var name = m.project || 'Без проекта', pct = m.margin == null ? null : Math.round(m.margin * 100), noIncome = m.income === 0 && m.expense > 0;
      var doneMeta = S.meta.projects[m.project || ''], isDone = doneMeta && doneMeta.status === 'done';
      return '<button type="button" class="op glass" data-act="openproject" data-p="' + esc(m.project || '__none__') + '" style="' + (noIncome ? 'border-color:var(--neg)' : '') + '"><div style="flex:1;min-width:0"><div class="t">' + esc(name) + (isDone ? ' <span class="pill">завершён</span>' : '') + '</div><div class="s num">приход ' + money(m.income) + ', расход ' + money(m.expense) + (noIncome ? ' · приход не внесён?' : '') + '</div>' + (pct != null && pct > 0 ? '<div class="track"><div class="fill" style="width:' + Math.min(100, pct) + '%"></div></div>' : '') + '</div><div style="text-align:right"><div class="t num ' + (m.profit < 0 ? 'neg' : '') + '">' + money(m.profit) + '</div><div class="s">' + (pct == null ? 'нет данных' : pct + '%') + '</div></div></button>';
    }).join('') : '<div class="glass mu" style="padding:18px;text-align:center">Проектов пока нет</div>') + '</div>';
    return out;
  }

  /* ---------- экран: выписки ---------- */
  function decisionHtml(d) {
    var row = d.row, rowTxt = row ? ruDate(row.date) + ', ' + money(row.amount, { sign: true }) + (row.counterparty ? ', ' + esc(row.counterparty) : '') : '';
    if (d.type === 'choose') {
      var btns = d.candidates.map(function (id) { var r = byId(id); if (!r || r.bankKey) return ''; return '<button type="button" class="btn" data-act="resolve" data-id="' + d.id + '" data-c="' + esc(id) + '">Привязать к записи от ' + esc(ruDate(r.date)) + (r.description ? ' (' + esc(r.description) + ')' : '') + '</button>'; }).join('');
      return '<div class="dec glass"><div class="bold">' + esc(wname(d.wallet)) + ': строка выписки подходит к нескольким записям</div><div class="small mu">Строка: ' + rowTxt + '. К какой записи привязать?</div><div class="opts">' + btns + '<button type="button" class="btn" data-act="resolve" data-id="' + d.id + '" data-c="new">Добавить как новую запись</button></div></div>';
    }
    if (d.type === 'only_in_bank') return '<div class="dec glass"><div class="bold">Есть у ' + esc(wname(d.wallet)) + ', нет у нас: ' + money(row.amount, { sign: true }) + '</div><div class="small mu">Строка выписки: ' + rowTxt + (row.purpose ? '. ' + esc(row.purpose) : '') + '. В вашем учёте такой записи нет.</div><div class="opts"><button type="button" class="btn main" data-act="resolve" data-id="' + d.id + '" data-c="add">Добавить в учёт</button><button type="button" class="btn" data-act="resolve" data-id="' + d.id + '" data-c="ignore">Это ошибка Промоса</button></div></div>';
    var r = byId(d.recId); if (!r) return '';
    return '<div class="dec glass"><div class="bold">Нет в выписке ' + esc(wname(d.wallet)) + ': ' + money(r.amount, { sign: true }) + '</div><div class="small mu">Ваша запись от ' + esc(ruDate(r.date)) + (r.description ? ' («' + esc(r.description) + '»)' : '') + ' попадает в период выписки, но в ней не найдена.</div><div class="opts"><button type="button" class="btn" data-act="resolve" data-id="' + d.id + '" data-c="keep">Оставить как есть</button><button type="button" class="btn" data-act="edit" data-id="' + esc(r.id) + '">Открыть запись</button><button type="button" class="btn danger" data-act="resolve" data-id="' + d.id + '" data-c="delete">Удалить запись</button></div></div>';
  }
  function stmCard(id, desc) {
    var last = null; S.meta.statements.forEach(function (s) { if (s.wallet === id) last = s; });
    return '<div class="glass" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px"><div class="row between"><div class="bold" style="font-size:15px">' + esc(wname(id)) + '</div><span class="pill warn">' + esc(desc) + '</span></div><div class="small mu">' + (last ? 'Последняя загрузка: ' + esc(ruDate(last.at)) + ', период ' + esc(ruDate(last.from)) + ' — ' + esc(ruDate(last.to)) + ', строк ' + last.rows + '.' : 'Выписок ещё не загружали.') + '</div>' +
      '<label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer;border-color:var(--chiponb);color:var(--acclink);font-weight:600">Загрузить выписку (xlsx)<input type="file" accept=".xlsx,.xls,.csv" data-stm="' + id + '" hidden></label>' +
      (S.mode === 'test' ? '<button type="button" class="btn" data-act="teststm" data-w="' + id + '">Прогнать тестовую выписку</button>' : '') + '</div>';
  }
  function viewStatements() {
    var out = '<div class="row between"><div class="h2" style="margin:0">Выписки и сверка</div><button type="button" class="iconbtn glass" data-act="theme" aria-label="Сменить тему">' + svg(S.theme === 'dark' ? 'sun' : 'moon') + '</button></div>';
    out += stmCard('alfa', 'автозагрузка с почты — позже') + stmCard('promos', 'раз в квартал, вручную');
    var decs = S.decisions.filter(function (x) { return !x.resolvedAt; }).map(decisionHtml).filter(Boolean);
    out += '<div class="dayh">Нужно ваше решение: ' + decs.length + '</div>' + (decs.length ? decs.join('') : '<div class="glass mu small" style="padding:14px">Всё сверено, решений нет</div>');
    var un = KC.unpairedTransfers(S.records);
    if (un.length) out += '<div class="dayh">Переводы без пары: ' + un.length + '</div><div class="list">' + un.map(opRow).join('') + '</div>';
    return out;
  }

  /* ---------- экран: настройки (статьи, данные и копии) ---------- */
  function artUsageCount(a, use) { return use[a.name.toLowerCase()] || 0; }
  function artRow(a, use) {
    var pills = '<span class="pill">' + (a.kind === 'income' ? 'приход' : 'расход') + '</span>' + (a.fixed ? '<span class="pill warn">постоянная</span>' : '') + (a.system ? '<span class="pill">системная</span>' : '') + (a.archived ? '<span class="pill">в архиве</span>' : '');
    return '<button type="button" class="op glass" data-act="art-open" data-id="' + esc(a.id) + '"><div style="flex:1;min-width:0"><div class="t">' + esc(a.name) + '</div><div class="tags">' + pills + '</div></div><div class="s num" style="align-self:center">' + artUsageCount(a, use) + ' оп.</div></button>';
  }
  function settingsArticles() {
    var cat = S.meta.articles, use = KC.articleUsage(S.records), out = '';
    out += '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="bold">Справочник статей</div><div class="small mu">Единый список статей для всех записей и для финансовой модели. В формах статьи только выбираются, названия и виды деятельности меняются только здесь.</div><button type="button" class="btn main wide" data-act="art-open" data-id="">Добавить статью</button>' +
      (S.mode === 'test' && !cat.filter(function (x) { return !x.system; }).length ? '<button type="button" class="btn wide" data-act="seedcat">Добавить тестовый список статей</button>' : '') + '</div>';
    var pending = cat.filter(function (x) { return !x.system && !x.archived && x.activity === 'none'; }).length;
    if (pending) out += '<div class="banner warn">Не указан вид деятельности: ' + pending + ' ' + (pending === 1 ? 'статья' : 'статей') + '. Откройте статью и укажите вид деятельности.</div>';
    KC.ACTIVITIES.forEach(function (act) {
      var list = cat.filter(function (x) { return !x.archived && x.activity === act.id; }).sort(function (p, q) { return p.system !== q.system ? (p.system ? 1 : -1) : p.kind !== q.kind ? (p.kind === 'expense' ? -1 : 1) : (p.name < q.name ? -1 : 1); });
      if (list.length) out += '<div class="dayh">' + esc(act.name) + ': ' + list.length + '</div><div class="list">' + list.map(function (x) { return artRow(x, use); }).join('') + '</div>';
    });
    var arch = cat.filter(function (x) { return x.archived; });
    if (arch.length) out += '<div class="dayh">Архив: ' + arch.length + '</div><div class="list">' + arch.map(function (x) { return artRow(x, use); }).join('') + '</div>';
    if (!cat.length) out += '<div class="glass mu small" style="padding:14px">Справочник пуст. Добавьте статьи вручную или загрузите сводную таблицу: статьи из неё добавятся сами, а вид деятельности вы укажете здесь.</div>';
    return out;
  }
    function settingsData() {
    var out = '';
    var live = S.records.filter(function (r) { return !r.deleted; }).length;
    out += '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="bold">База: ' + (S.mode === 'test' ? 'тестовая' : 'рабочая') + '</div><div class="small mu">Записей: ' + live + '. ' + (CFG.firebase ? esc(S.sync.text || 'Облако не подключено') : 'Данные хранятся только в этом браузере или телефоне. Облако Firebase не подключено.') + '</div><div class="tiny mu">Права: у всех, кто имеет доступ к инструменту, полные права, включая настройки статей. Список доступа задаётся в правилах Firebase (файл firestore.rules).</div>' +
      (CFG.firebase && Remote.authMod && !Remote.user ? '<button type="button" class="btn main" data-act="signin">Войти через Google</button>' : '') +
      (CFG.allowProd ? '<button type="button" class="btn" data-act="switchmode">' + (S.mode === 'test' ? 'Перейти на рабочую базу' : 'Перейти на тестовую базу') + '</button>' : '') + '</div>';
    out += '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="bold">Резервная копия</div><div class="small mu">' + (S.meta.lastBackupAt ? 'Последняя копия: ' + esc(ruDate(S.meta.lastBackupAt)) + '.' : 'Копия ещё не делалась.') + ' JSON нужен для восстановления, xlsx только для просмотра. На iPhone JSON откроется в меню «Поделиться»: выберите «Сохранить в Файлы». Раз в неделю копию нужно сохранять на Google Диск: автоматически этот шаг пока не работает, нужен серверный планировщик.</div><button type="button" class="btn main" data-act="backup">Скачать копию для восстановления (JSON)</button><button type="button" class="btn" data-act="backupxlsx">Скачать таблицу для просмотра (xlsx)</button>' +
      '<label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Восстановить из копии (JSON)<input type="file" accept=".json,application/json" id="restorefile" hidden></label></div>';
    out += '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="bold">Импорт сводной таблицы</div><div class="small mu">Таблица с колонками Финолога (xlsx). Ниже можно указать, сколько первых строк загрузить: для проверки хватит 5.</div><input id="importlimit" class="input" type="text" inputmode="numeric" placeholder="Сколько строк загрузить (пусто = все)"><label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Выбрать файл xlsx<input type="file" accept=".xlsx,.xls" id="summaryfile" hidden></label></div>';
    if (S.mode === 'test') out += '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="bold">Тестовая база</div><div class="small mu">Выдуманные данные для проверки. Сброс удаляет всю тестовую базу целиком, рабочая база не затрагивается.</div><button type="button" class="btn" data-act="seed">Добавить тестовые данные</button><button type="button" class="btn danger" data-act="resetTest">Сбросить тестовую базу</button></div>';
    var log = S.log.slice(-30).reverse();
    out += '<div class="dayh">Журнал изменений</div><div class="glass" style="padding:4px 14px">' + (log.length ? '<table class="tb"><tbody>' + log.map(function (l) { return '<tr><td class="mu small" style="white-space:nowrap">' + esc(ruDate(l.at)) + '</td><td>' + esc(l.summary) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="small mu" style="padding:12px 0">Пока пусто</div>') + '</div>';
    return out;
  }
  function viewSettings() {
    var out = '<div class="row between"><div class="h2" style="margin:0">Настройки</div><button type="button" class="iconbtn glass" data-act="theme" aria-label="Сменить тему">' + svg(S.theme === 'dark' ? 'sun' : 'moon') + '</button></div>';
    out += '<div class="seg glass"><button type="button" class="' + (S.settingsTab === 'articles' ? 'on' : '') + '" data-act="stab" data-v="articles">Статьи</button><button type="button" class="' + (S.settingsTab === 'data' ? 'on' : '') + '" data-act="stab" data-v="data">Данные и копии</button></div>';
    return out + (S.settingsTab === 'data' ? settingsData() : settingsArticles());
  }
  function openArtSheet(id) {
    var a = id ? S.meta.articles.filter(function (x) { return x.id === id; })[0] : null;
    S.artSheet = a ? { id: a.id, name: a.name, kind: a.kind, activity: a.activity, fixed: a.fixed, archived: a.archived, system: a.system, errors: [] } : { id: '', name: '', kind: 'expense', activity: 'operating', fixed: false, archived: false, system: false, errors: [] };
    renderArtSheet();
  }
  function renderArtSheet() {
    var d = S.artSheet, host = $('#asheet');
    if (!d) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'asheet'; document.body.appendChild(host); }
    var used = d.id ? artUsageCount(d, KC.articleUsage(S.records)) : 0, lock = d.system ? ' disabled' : '';
    var h = '<div class="sheet" style="z-index:55"><div class="inner"><div class="row between"><button type="button" class="iconbtn" data-act="art-close" aria-label="Закрыть">' + svg('close', 22) + '</button><div class="bold" style="font-size:17px">' + (d.id ? 'Статья' : 'Новая статья') + '</div><span></span></div><div class="glass" style="overflow:hidden">';
    h += '<div class="field"><label for="a-name">Название</label><input id="a-name" class="input" type="text" autocomplete="off" value="' + esc(d.name) + '"' + lock + '></div>';
    h += '<div class="field"><label>Вид статьи</label><div class="seg"><button type="button" class="' + (d.kind === 'expense' ? 'on' : '') + '" data-act="art-kind" data-v="expense"' + (used || d.system ? ' disabled' : '') + '>Расход</button><button type="button" class="' + (d.kind === 'income' ? 'on' : '') + '" data-act="art-kind" data-v="income"' + (used || d.system ? ' disabled' : '') + '>Приход</button></div>' + (used ? '<div class="tiny mu">Вид нельзя менять: по статье есть операции (' + used + ').</div>' : '') + '</div>';
    h += '<div class="field"><label>Вид деятельности</label><div class="wsel">' + KC.ACTIVITIES.map(function (x) { return '<button type="button" class="chip ' + (d.activity === x.id ? 'on' : '') + '" data-act="art-act" data-v="' + x.id + '"' + lock + '>' + esc(x.name) + '</button>'; }).join('') + '</div></div>';
    if (d.kind === 'expense') h += '<div class="field" style="flex-direction:row;align-items:center;justify-content:space-between"><div><label>Постоянные расходы</label><div class="tiny mu">Распределяются на проекты при завершении по доле поступлений</div></div><button type="button" class="switch ' + (d.fixed ? 'on' : '') + '" data-act="art-fixed" aria-label="Постоянная статья" aria-pressed="' + (d.fixed ? 'true' : 'false') + '"' + lock + '></button></div>';
    h += '</div>';
    if (d.system) h += '<div class="tiny mu">Системная статья: используется для операций из выписок, пока им не назначена нужная статья. Менять её нельзя.</div>';
    h += '<div class="errs" id="aerrs">' + esc(d.errors.join('. ')) + '</div>';
    if (!d.system) h += '<button type="button" class="btn main wide" data-act="art-save">Сохранить</button>';
    if (d.id && !d.system) {
      if (d.archived) h += '<button type="button" class="btn wide" data-act="art-unarchive">Вернуть из архива</button>';
      else if (used) h += '<button type="button" class="btn wide" data-act="art-archive">В архив (скрыть из выбора)</button>';
      else h += '<button type="button" class="btn danger wide" data-act="art-delete">Удалить статью</button>';
    }
    h += '</div></div>';
    host.innerHTML = h;
  }
  function saveArticle() {
    var d = S.artSheet, cat = S.meta.articles;
    var errs = KC.validateArticleDraft(cat, d, d.id); if (errs.length) { d.errors = errs; return renderArtSheet(); }
    var clean = d.name.trim().replace(/\s+/g, ' ');
    if (d.id) {
      var art = cat.filter(function (x) { return x.id === d.id; })[0], oldName = art.name, patches = oldName !== clean ? KC.renameArticlePatches(S.records, oldName, clean) : [];
      var used = artUsageCount(art, KC.articleUsage(S.records));
      art.name = clean; art.activity = d.activity; if (!used) art.kind = d.kind; art.fixed = art.kind === 'expense' && d.fixed; art.updatedAt = KC.nowISO();
      commit({ patches: patches }, 'catalog', 'Статья «' + clean + '» изменена' + (oldName !== clean ? ' (было «' + oldName + '», обновлено операций: ' + patches.length + ')' : ''));
    } else {
      cat.push(KC.newArticle({ name: clean, kind: d.kind, activity: d.activity, fixed: d.fixed }));
      addLog('catalog', 'Добавлена статья «' + clean + '»'); persist();
    }
    S.artSheet = null; renderArtSheet(); render(); toast('Статья сохранена');
  }
  function artAction(a, t) {
    var d = S.artSheet;
    if (a === 'art-close') { S.artSheet = null; return renderArtSheet(); }
    if (a === 'art-save') return saveArticle();
    if (a === 'art-kind') { d.kind = t.getAttribute('data-v'); if (d.kind === 'income') d.fixed = false; return renderArtSheet(); }
    if (a === 'art-act') { d.activity = t.getAttribute('data-v'); return renderArtSheet(); }
    if (a === 'art-fixed') { d.fixed = !d.fixed; return renderArtSheet(); }
    var art = S.meta.articles.filter(function (x) { return x.id === d.id; })[0]; if (!art) return;
    if (a === 'art-archive' || a === 'art-unarchive') { art.archived = a === 'art-archive'; art.updatedAt = KC.nowISO(); addLog('catalog', 'Статья «' + art.name + '» ' + (art.archived ? 'отправлена в архив' : 'возвращена из архива')); persist(); S.artSheet = null; renderArtSheet(); render(); return; }
    if (a === 'art-delete') { S.meta.articles = S.meta.articles.filter(function (x) { return x.id !== d.id; }); S.meta.deletedArticles.push({ id: d.id, at: KC.nowISO() }); addLog('catalog', 'Удалена статья «' + art.name + '»'); persist(); S.artSheet = null; renderArtSheet(); render(); return toast('Статья удалена'); }
  }

  /* ---------- форма ввода ---------- */
  var ORDER = ['f-amount', 'f-cp', 'f-art', 'f-proj', 'f-desc'];
  function newForm() { return { type: 'expense', amount: '', wallet: 'cash', counterparty: '', article: '', project: '', description: '', date: KC.today(), planned: false, artSuggested: false, from: 'cash', to: 'alfa', editId: null, locked: false, errors: [] }; }
  function openForm(rec) {
    var f = newForm();
    if (rec) {
      f.editId = rec.id; f.type = KC.isTransfer(rec) ? 'transfer' : (rec.amount < 0 ? 'expense' : 'income');
      f.amount = String(Math.abs(rec.amount) / 100).replace('.', ','); f.wallet = rec.wallet; f.counterparty = rec.counterparty; f.article = rec.article; f.project = rec.project;
      f.description = rec.description; f.date = rec.date; f.planned = rec.planned; f.artSuggested = rec.autofill === 'suggested'; f.locked = rec.source === 'bank' || !!rec.bankKey;
    }
    S.form = f; renderForm();
  }
  function walletBtns(sel, key) {
    return '<div class="wsel">' + KC.WALLETS.filter(function (w) { return !w.hidden || sel === w.id; }).map(function (w) { return '<button type="button" class="chip ' + (sel === w.id ? 'on' : '') + '" data-act="wallet" data-k="' + key + '" data-v="' + w.id + '"' + (S.form.locked && key === 'wallet' ? ' disabled' : '') + '>' + esc(w.name) + '</button>'; }).join('') + '</div>';
  }
  function renderForm() {
    var f = S.form, host = $('#sheet'); if (!host) { host = document.createElement('div'); host.id = 'sheet'; document.body.appendChild(host); }
    if (!f) { host.remove(); return; }
    var title = (f.editId ? 'Операция' : 'Новая операция'), isTr = f.type === 'transfer', lock = f.locked ? ' disabled' : '';
    var ro = isTr && f.editId;
    var h = '<div class="sheet"><div class="inner"><div class="row between"><button type="button" class="iconbtn" data-act="closeform" aria-label="Закрыть">' + svg('close', 22) + '</button><div class="bold" style="font-size:17px">' + title + '</div>' + (f.editId ? '<button type="button" class="iconbtn" style="color:var(--neg)" data-act="deleterec" aria-label="' + (ro ? 'Удалить перевод (обе записи)' : 'Удалить операцию') + '">' + svg('trash', 22) + '</button>' : '<span style="width:44px"></span>') + '</div>';
    if (!S.online) h += '<div class="banner warn">Нет связи: запись сохранится в телефоне и отправится позже</div>';
    if (!f.editId) h += '<div class="seg glass"><button type="button" class="' + (f.type === 'income' ? 'on' : '') + '" data-act="ftype" data-v="income">Приход</button><button type="button" class="' + (f.type === 'expense' ? 'on' : '') + '" data-act="ftype" data-v="expense">Расход</button><button type="button" class="' + (f.type === 'transfer' ? 'on' : '') + '" data-act="ftype" data-v="transfer">Перевод</button></div>';
    h += '<div class="glass" style="overflow:hidden">';
    if (ro) {
      var rec = byId(f.editId); h += '<div class="field"><label>Перевод</label><div class="bold">' + esc(transferText(rec)) + '</div></div><div class="field"><label>Сумма</label><div class="bold num">' + money(Math.abs(rec.amount)) + '</div></div><div class="field"><label>Дата</label><div>' + esc(KC.dayLabel(rec.date, KC.today())) + '</div></div>';
    } else if (isTr) {
      h += '<div class="field"><label for="f-amount">Сумма</label><input id="f-amount" class="input big" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0" value="' + esc(f.amount) + '"></div>' +
        '<div class="field"><label>Откуда</label>' + walletBtns(f.from, 'from') + '</div><div class="field"><label>Куда</label>' + walletBtns(f.to, 'to') + '</div>' +
        '<div class="field"><label for="f-desc">Описание</label><input id="f-desc" class="input" type="text" enterkeyhint="next" autocomplete="off" value="' + esc(f.description) + '"></div>' +
        '<div class="field"><label for="f-date">Когда</label><input id="f-date" class="input" type="date" value="' + esc(f.date) + '"></div>';
    } else {
      h += '<div class="field"><label for="f-amount">Сумма</label><input id="f-amount" class="input big ' + (f.type === 'expense' ? 'neg' : 'pos') + '" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0" value="' + esc(f.amount) + '"' + lock + '></div>' +
        '<div class="field"><label>Со счёта</label>' + walletBtns(f.wallet, 'wallet') + '</div>' +
        '<div class="field"><label for="f-cp">Контрагент</label><input id="f-cp" class="input" type="text" enterkeyhint="next" autocomplete="off" value="' + esc(f.counterparty) + '"><div class="sug" id="sug-f-cp"></div></div>' +
        '<div class="field"><label for="f-art">Статья</label><input id="f-art" class="input ' + (f.artSuggested ? 'suggested' : '') + '" type="text" enterkeyhint="next" autocomplete="off" placeholder="Выберите из списка" value="' + esc(f.article) + '"><div class="sug" id="sug-f-art"></div><div class="tiny" id="arthint" style="color:var(--warntx)">' + (!S.meta.articles.filter(function (x) { return !x.system && !x.archived; }).length ? 'Справочник статей пуст: добавьте статьи в Настройках. ' : '') + (f.artSuggested ? 'Подставлена по истории контрагента. Нажмите на поле, чтобы изменить, или <a href="#" data-act="confirmart" style="color:inherit;font-weight:600">подтвердить</a>' : '') + '</div></div>' +
        '<div class="field"><label for="f-proj">Проект</label><input id="f-proj" class="input" type="text" enterkeyhint="next" autocomplete="off" placeholder="Поиск по буквам" value="' + esc(f.project) + '"><div class="sug" id="sug-f-proj"></div></div>' +
        '<div class="field"><label for="f-desc">Описание</label><input id="f-desc" class="input" type="text" enterkeyhint="done" autocomplete="off" placeholder="Что оплатили" value="' + esc(f.description) + '"></div>' +
        '<div class="field"><label for="f-date">Когда</label><input id="f-date" class="input" type="date" value="' + esc(f.date) + '"' + lock + '></div>';
    }
    if (!ro) h += '<div class="field" style="flex-direction:row;align-items:center;justify-content:space-between"><label>Плановая</label><button type="button" class="switch ' + (f.planned ? 'on' : '') + '" data-act="planned" aria-label="Плановая" aria-pressed="' + (f.planned ? 'true' : 'false') + '"></button></div>';
    h += '</div>';
    if (f.locked) h += '<div class="tiny mu">Запись из выписки: сумму, счёт и дату менять нельзя.</div>';
    h += '<div class="errs" id="errs">' + esc(f.errors.join('. ')) + '</div>';
    if (!ro) h += '<button type="button" class="btn main wide" data-act="saveform">Сохранить</button>';
    if (!f.editId) h += '<div class="tiny mu">Кнопка «Далее» в поле «Описание» сохраняет запись и закрывает окно: дата по умолчанию сегодня, план выключен. Сохранить можно и с одной суммой и кошельком, незаполненное попадёт в счётчик «не заполнено».</div>';
    h += '</div></div>';
    host.innerHTML = h;
    if (!f.editId) { var a = $('#f-amount', host); if (a) a.focus(); }
  }
  function formKind() { return S.form.type === 'expense' ? -1 : 1; }
  function suggestionsFor(id, text) {
    if (id === 'f-cp') return KC.suggestCounterparties(S.records, text, 6);
    if (id === 'f-art') return KC.suggestCatalog(S.meta.articles, S.records, text, formKind(), 8);
    if (id === 'f-proj') return KC.suggestProjects(S.records, text, 8);
    return [];
  }
  function showSug(id) {
    var inp = $('#' + id), box = $('#sug-' + id); if (!inp || !box) return;
    var list = suggestionsFor(id, inp.value).filter(function (s) { return s.toLowerCase() !== inp.value.trim().toLowerCase(); });
    box.innerHTML = list.map(function (s, i) { return '<button type="button" class="' + (i === 0 && inp.value ? 'first' : '') + '" data-act="pick" data-f="' + id + '" data-v="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    box.classList.toggle('open', list.length > 0);
  }
  function hideSug(id) { var box = $('#sug-' + id); if (box) box.classList.remove('open'); }
  function setField(id, val) {
    var f = S.form, inp = $('#' + id); if (inp) inp.value = val;
    if (id === 'f-cp') { f.counterparty = val; autoArticle(); }
    if (id === 'f-art') { f.article = val; f.artSuggested = false; refreshArt(); }
    if (id === 'f-proj') f.project = val;
    if (id === 'f-desc') f.description = val;
  }
  function autoArticle() {
    var f = S.form; if (f.type === 'transfer') return;
    if (f.article && !f.artSuggested) return;
    var a = KC.suggestArticleFor(S.records, f.counterparty, formKind()), ca = a ? KC.findArticle(S.meta.articles, a) : null;
    a = ca && !ca.archived && !ca.system && (ca.kind === 'expense') === (formKind() < 0) ? ca.name : null;
    if (a) { f.article = a; f.artSuggested = true; var inp = $('#f-art'); if (inp) inp.value = a; refreshArt(); }
    else if (f.artSuggested) { f.article = ''; f.artSuggested = false; var i2 = $('#f-art'); if (i2) i2.value = ''; refreshArt(); }
  }
  function refreshArt() {
    var f = S.form, inp = $('#f-art'), hint = $('#arthint'); if (!inp) return;
    inp.classList.toggle('suggested', f.artSuggested);
    if (hint) hint.innerHTML = f.artSuggested ? 'Подставлена по истории контрагента. Нажмите на поле, чтобы изменить, или <a href="#" data-act="confirmart" style="color:inherit;font-weight:600">подтвердить</a>' : '';
  }
  function nextFocus(id) {
    var f = S.form, order = f.type === 'transfer' ? ['f-amount', 'f-desc'] : ORDER, i = order.indexOf(id);
    if (i >= 0 && i < order.length - 1) { var n = $('#' + order[i + 1]); if (n) { n.focus(); if (n.select) try { n.select(); } catch (e) {} showSug(order[i + 1]); } }
    else saveForm();
  }
  function onFormKey(e) {
    if (e.key !== 'Enter') return;
    var id = e.target.id; if (!id || id.indexOf('f-') !== 0) return;
    e.preventDefault();
    if (id === 'f-art') {
      var vv = e.target.value.trim(), ff = S.form;
      if (!vv) { ff.article = ''; ff.artSuggested = false; refreshArt(); }
      else {
        var ex = KC.findArticle(S.meta.articles, vv), sg = KC.suggestCatalog(S.meta.articles, S.records, vv, formKind(), 1);
        var pick = ex && !ex.archived && !ex.system && (ex.kind === 'expense') === (formKind() < 0) ? ex.name : (sg[0] || '');
        if (!pick) { toast('Такой статьи нет в списке. Добавьте её в Настройках.'); return; }
        if (!(ff.artSuggested && pick === ff.article)) setField('f-art', pick);
      }
      hideSug(id); return nextFocus(id);
    }
    if (id === 'f-cp' || id === 'f-proj') {
      var inp = e.target, v = inp.value.trim(), box = $('#sug-' + id), first = box && box.classList.contains('open') ? box.querySelector('button') : null;
      if (v.length >= 1 && first && first.getAttribute('data-v').toLowerCase().indexOf(v.toLowerCase()) === 0) setField(id, first.getAttribute('data-v'));
      else if (id === 'f-cp') { S.form.counterparty = v; autoArticle(); }
      hideSug(id);
    }
    nextFocus(id);
  }
  function onFormInput(e) {
    var id = e.target.id, f = S.form; if (!f || !id) return;
    var v = e.target.value;
    if (id === 'f-amount') f.amount = v;
    else if (id === 'f-cp') { f.counterparty = v; showSug(id); }
    else if (id === 'f-art') { showSug(id); }
    else if (id === 'f-proj') { f.project = v; showSug(id); }
    else if (id === 'f-desc') f.description = v;
    else if (id === 'f-date') f.date = v;
  }
  function saveForm() {
    var f = S.form; if (!f) return;
    var amt = KC.parseMoney(f.amount), errs, t = f.date;
    if (f.type === 'transfer') {
      errs = KC.validateTransfer({ from: f.from, to: f.to, amount: isNaN(amt) ? 0 : amt, date: f.date });
      if (errs.length) { f.errors = errs; return renderErrs(); }
      var pair = KC.makeTransfer({ from: f.from, to: f.to, amount: amt, date: f.date, description: f.description, planned: f.planned });
      commit({ newRecords: pair }, 'create', 'Перевод ' + money(amt) + ': ' + wname(f.from) + ' → ' + wname(f.to), pair[0].id);
      closeForm(); toast('Перевод сохранён: две парные записи'); return render();
    }
    var artInp = $('#f-art');
    if (artInp && artInp.value.trim() !== f.article) {
      var fa = KC.findArticle(S.meta.articles, artInp.value.trim());
      if (fa && !fa.archived && !fa.system && (fa.kind === 'expense') === (f.type === 'expense')) { f.article = fa.name; f.artSuggested = false; }
      else { f.errors = ['Выберите статью из списка: свободный ввод не допускается']; return renderErrs(); }
    }
    var signed = (isNaN(amt) ? 0 : Math.abs(amt)) * (f.type === 'expense' ? -1 : 1);
    errs = KC.validate({ wallet: f.wallet, amount: signed, date: f.date });
    if (errs.length) { f.errors = errs; return renderErrs(); }
    var fields = { wallet: f.wallet, amount: signed, date: f.date, planned: f.planned, counterparty: f.counterparty.trim(), article: f.article.trim(), project: f.project.trim(), description: f.description.trim(), autofill: f.artSuggested && f.article ? 'suggested' : '' };
    if (f.editId) {
      var rec = byId(f.editId), patch = { counterparty: fields.counterparty, article: fields.article, project: fields.project, description: fields.description, planned: fields.planned, autofill: fields.autofill };
      if (!f.locked) { patch.amount = signed; patch.wallet = f.wallet; patch.date = f.date; if (rec.wallet !== f.wallet) patch.bankState = KC.defaultBankState(f.wallet, rec.source); }
      commit({ patches: [{ id: rec.id, patch: patch }] }, 'update', 'Изменена операция ' + money(signed) + (fields.article ? ' (' + fields.article + ')' : ''), rec.id);
      closeForm(); toast('Изменения сохранены'); return render();
    }
    var r = KC.newRecord(fields);
    commit({ newRecords: [r] }, 'create', 'Новая операция ' + money(signed) + (fields.article ? ' (' + fields.article + ')' : ''), r.id);
    if (!S.project && KC.monthKey(r.date) !== S.month) S.month = KC.monthKey(r.date);
    closeForm(); toast('Сохранено'); render();
  }
  function renderErrs() { var el = $('#errs'); if (el) el.textContent = S.form.errors.join('. '); }
  function closeForm() { S.form = null; var h = $('#sheet'); if (h) h.remove(); }
  function deleteRec(id) {
    var rec = byId(id); if (!rec) return;
    var ids = [id];
    if (KC.hasPair(rec)) S.records.forEach(function (x) { if (x.pairId === rec.pairId && x.id !== id && !x.deleted) ids.push(x.id); });
    commit({ patches: ids.map(function (i) { return { id: i, patch: { deleted: true } }; }) }, 'delete', 'Удалена операция ' + money(rec.amount) + (ids.length > 1 ? ' (перевод, обе записи)' : ''), id);
    closeForm(); render();
    toast('Удалено', 'Отменить', function () { commit({ patches: ids.map(function (i) { return { id: i, patch: { deleted: false } }; }) }, 'restore', 'Восстановлена операция', id); render(); });
  }


  /* ---------- карточка проекта и завершение проекта ---------- */
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(1).replace('.', ',') + '%'; }
  function pkey() { return S.pcard.project === '__none__' ? '' : S.pcard.project; }
  function fixedNames() { return KC.fixedArticleNames(S.meta.articles); }
  function openProjectCard(name) { S.pcard = { project: name, step: 'view', custom: false, from: '', to: '', inc: {} }; renderPCard(); }
  function incomeIds() { var ids = []; for (var k in S.pcard.inc) if (S.pcard.inc[k]) ids.push(k); return ids; }
  function calcOpts() { var p = S.pcard; return { from: p.from, to: p.to, mode: 'articles', fixedArticles: fixedNames(), incomeIds: incomeIds() }; }
  function initIncomes() { var p = S.pcard; p.inc = {}; KC.periodIncomes(S.records, p.from, p.to).forEach(function (r) { p.inc[r.id] = !!r.project; }); }
  function frow(label, val, cls, bold) { return '<div class="row between" style="padding:6px 0;border-top:1px solid var(--div);gap:12px"><span class="' + (bold ? 'bold' : '') + '">' + label + '</span><span class="num ' + (bold ? 'bold ' : '') + (cls || '') + '">' + val + '</span></div>'; }
  function cb(on) { return '<span class="cb ' + (on ? 'on' : '') + '" role="img" aria-label="' + (on ? 'отмечено' : 'не отмечено') + '">' + (on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : '') + '</span>'; }
  function pcView(key, title) {
    var fx = fixedNames(), f = KC.projectFinance(S.records, key, fx), pm = S.meta.projects[key], done = pm && pm.status === 'done', ops = KC.projectOps(S.records, key), h = '';
    h += '<div class="glass" style="padding:12px 14px"><div class="bold" style="margin-bottom:2px">Финансовый результат без постоянных расходов</div>' +
      frow('Поступления (факт)', money(f.income), 'pos') + frow('Переменные расходы (себестоимость)', money(-f.variable), 'neg') +
      frow('Прибыль до постоянных расходов', money(f.gross), f.gross < 0 ? 'neg' : '', true) + frow('Рентабельность до постоянных расходов', pct(f.margin)) +
      (f.fixedOwn ? frow('Расходы по постоянным статьям с этим проектом', money(-f.fixedOwn), 'neg') : '') +
      '<div class="tiny mu" style="margin-top:6px">Переменные расходы: фактические расходы с этим проектом по статьям, которые не отмечены постоянными. Постоянные расходы распределяются при завершении проекта.</div></div>';
    if (f.byArticle.length) h += '<div class="glass" style="padding:12px 14px"><div class="bold" style="margin-bottom:6px">Расходы по статьям</div>' + f.byArticle.map(function (x) {
      var w = f.variable ? Math.round(x.sum / f.variable * 100) : 0;
      return '<div style="padding:5px 0"><div class="row between small"><span>' + esc(x.article) + '</span><span class="num bold">' + money(x.sum) + '</span></div><div class="track"><div class="fill" style="width:' + w + '%"></div></div></div>';
    }).join('') + '</div>';
    if (done) {
      var r = pm.result;
      h += '<div class="glass" style="padding:12px 14px"><div class="bold" style="margin-bottom:2px">Итог завершённого проекта</div><div class="tiny mu">Закрыт ' + esc(ruDate(pm.doneAt)) + '. Период расчёта: ' + esc(ruDate(r.from)) + ' — ' + esc(ruDate(r.to)) + '. Доля заказа в поступлениях периода: ' + pct(r.share) + '.</div>' +
        frow('Поступления', money(r.income), 'pos') + frow('Переменные расходы', money(-r.variable), 'neg') + frow('Постоянные расходы на заказ', money(-r.fixedAllocated), 'neg') +
        frow('Чистая прибыль', money(r.net), r.net < 0 ? 'neg' : 'pos', true) + frow('Рентабельность', pct(r.netMargin)) +
        '<div class="row gap8 wrap" style="margin-top:10px"><button type="button" class="btn" data-act="pc-done">Пересчитать</button><button type="button" class="btn" data-act="pc-reopen">Вернуть в работу</button></div></div>';
    } else if (key) h += '<button type="button" class="btn main wide" data-act="pc-done">Проект завершён</button>';
    h += '<button type="button" class="btn wide" data-act="pc-ops">Показать в операциях</button>';
    h += '<div class="dayh">Операции проекта: ' + ops.length + '</div><div class="list">' + (ops.length ? ops.map(function (r) { return KC.isTransfer(r) ? '' : opRow(r); }).join('') : '<div class="glass mu small" style="padding:14px">Операций пока нет</div>') + '</div>';
    return h;
  }
  function pcPeriod(key) {
    var f = KC.projectFinance(S.records, key), p = S.pcard, h = '<div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:10px"><div class="bold">Завершение проекта</div>';
    if (f.firstPay) {
      h += '<div class="small">Первый платёж по заказу: <b>' + esc(KC.dayLabel(f.firstPay, KC.today())) + '</b>.<br>Последний платёж по заказу: <b>' + esc(KC.dayLabel(f.lastPay, KC.today())) + '</b>.</div><div class="small mu">Платежи заказчика, то есть поступления по этому проекту. Для распределения постоянных расходов беру период между ними. Использовать эти сроки или указать другие?</div>';
      if (!p.custom) h += '<div class="row gap8 wrap"><button type="button" class="btn main" style="flex:1" data-act="pc-useperiod">Использовать эти сроки</button><button type="button" class="btn" style="flex:1" data-act="pc-custom">Указать другие</button></div>';
    } else h += '<div class="small neg">По заказу нет поступлений, поэтому период определить нельзя. Укажите период вручную.</div>';
    if (p.custom || !f.firstPay) h += '<div class="row gap8 wrap"><div style="flex:1;min-width:140px"><label class="tiny mu" for="pc-from">С даты</label><input id="pc-from" class="input" type="date" value="' + esc(p.from || f.firstPay) + '"></div><div style="flex:1;min-width:140px"><label class="tiny mu" for="pc-to">По дату</label><input id="pc-to" class="input" type="date" value="' + esc(p.to || f.lastPay) + '"></div></div><button type="button" class="btn main wide" data-act="pc-calc">Далее</button>';
    h += '<button type="button" class="btn wide" data-act="pc-back">Назад</button></div>';
    return h;
  }
  function pcSelect(key) {
    var p = S.pcard, incs = KC.periodIncomes(S.records, p.from, p.to), h = '', selSum = 0, nSel = 0;
    incs.forEach(function (r) { if (p.inc[r.id]) { selSum += r.amount; nSel++; } });
    h += '<div class="glass" style="padding:14px"><div class="bold">Период: ' + esc(ruDate(p.from)) + ' — ' + esc(ruDate(p.to)) + '</div><button type="button" class="chip" style="margin-top:8px" data-act="pc-period">Изменить период</button></div>';
    h += '<div class="glass" style="padding:12px 14px"><div class="bold">Поступления за период</div><div class="tiny mu" style="margin:2px 0 8px">Все поступления за период. Уберите галочку у тех, которые не нужно учитывать в расчёте доли.</div><div class="row gap8 wrap" style="margin-bottom:6px"><button type="button" class="chip" data-act="pc-incall" data-v="1">Отметить все</button><button type="button" class="chip" data-act="pc-incall" data-v="0">Снять все</button></div>';
    if (!incs.length) h += '<div class="small mu" style="padding:8px 0">За период поступлений нет</div>';
    incs.forEach(function (r) {
      var mine = (r.project || '') === key, pj = r.project ? (mine ? '<span class="pill warn">этот проект</span>' : '<span class="pill">' + esc(r.project) + '</span>') : '<span class="pill">без проекта</span>';
      h += '<button type="button" class="row gap12" data-act="pc-inc" data-id="' + esc(r.id) + '" style="width:100%;padding:8px 0;border:0;border-top:1px solid var(--div);background:transparent;text-align:left;align-items:center">' + cb(p.inc[r.id]) + '<div style="flex:1;min-width:0"><div class="small bold">' + esc(ruDate(r.date)) + ' · ' + esc(r.counterparty || r.article || 'Поступление') + '</div><div class="tiny mu" style="overflow:hidden;text-overflow:ellipsis">' + esc(r.description || '') + '</div><div style="margin-top:2px">' + pj + '</div></div><div class="num bold pos">' + money(r.amount) + '</div></button>';
    });
    h += frow('Выбрано поступлений: ' + nSel + ' из ' + incs.length, money(selSum), 'pos', true) + '</div>';
    var sums = KC.expenseSumsByArticle(S.records, p.from, p.to), arts = S.meta.articles.filter(function (x) { return x.kind === 'expense' && !x.archived && !x.system; });
    arts.sort(function (x, y) { return x.fixed !== y.fixed ? (x.fixed ? -1 : 1) : (x.name < y.name ? -1 : 1); });
    var fxTotal = 0; arts.forEach(function (x) { if (x.fixed) fxTotal += sums[x.name] || 0; });
    h += '<div class="glass" style="padding:12px 14px"><div class="bold">Постоянные расходы: статьи</div><div class="tiny mu" style="margin:2px 0 8px">Все статьи расходов из справочника. Галочкой отмечены постоянные, справа сумма расходов за период. Проверьте список: изменить его можно только в настройках.</div>';
    if (!arts.length) h += '<div class="small mu">Справочник статей расходов пуст</div>';
    arts.forEach(function (x) { h += '<div class="row gap12" style="padding:7px 0;border-top:1px solid var(--div);align-items:center">' + cb(x.fixed) + '<div style="flex:1;min-width:0" class="small">' + esc(x.name) + '</div><div class="num small ' + ((sums[x.name] || 0) ? 'neg' : 'mu') + '">' + money(sums[x.name] || 0) + '</div></div>'; });
    if (sums['']) h += '<div class="row gap12" style="padding:7px 0;border-top:1px solid var(--div);align-items:center"><span class="cb"></span><div style="flex:1" class="small neg">Без статьи</div><div class="num small neg">' + money(sums['']) + '</div></div>';
    h += frow('Постоянные расходы за период', money(fxTotal), 'neg', true) + '<button type="button" class="btn wide" style="margin-top:8px" data-act="pc-settings">Изменить статьи в настройках</button></div>';
    h += '<button type="button" class="btn main wide" data-act="pc-calc2"' + (nSel ? '' : ' disabled') + '>Рассчитать</button>';
    h += '<button type="button" class="btn wide" data-act="pc-back">Назад</button>';
    return h;
  }
  function pcCalc(key) {
    var res = KC.projectResult(S.records, key, calcOpts()), a = res.alloc, h = '';
    h += '<div class="glass" style="padding:14px"><div class="bold">Период расчёта: ' + esc(ruDate(a.from)) + ' — ' + esc(ruDate(a.to)) + '</div><button type="button" class="chip" style="margin-top:8px" data-act="pc-back2">Назад к составу расчёта</button></div>';
    h += '<div class="glass" style="padding:12px 14px"><div class="bold" style="margin-bottom:2px">Расчёт по шагам</div>' +
      frow('1. Поступления по этому заказу за период', money(a.ownIncome), 'pos') +
      frow('2. Выбранные поступления за период (заказов: ' + a.ordersCount + ')', money(a.allIncome), 'pos') +
      frow('3. Доля этого заказа (1 ÷ 2)', pct(a.share)) +
      frow('4. Постоянные расходы за период (операций: ' + a.fixedCount + ')', money(a.fixedTotal), 'neg') +
      frow('5. Постоянные расходы на этот заказ (4 × 3)', money(a.fixedAllocated), 'neg', true) + '</div>';
    if (a.share == null) h += '<div class="banner warn">Выбранных поступлений по этому заказу за период нет, доля не определяется. Вернитесь к составу расчёта.</div>';
    if (a.unassignedCount) h += '<div class="banner warn">Не учтены нигде: ' + a.unassignedCount + ' расход(ов) без проекта на ' + money(a.unassignedTotal) + ' за период, их статьи не отмечены постоянными. Назначьте им проект или отметьте статью постоянной в настройках.</div>';
    h += '<div class="glass" style="padding:12px 14px"><div class="bold" style="margin-bottom:2px">Финансовый итог проекта</div>' +
      frow('Поступления', money(res.income), 'pos') + frow('Переменные расходы (себестоимость)', money(-res.variable), 'neg') + frow('Постоянные расходы на заказ', money(-a.fixedAllocated), 'neg') +
      frow('Чистая прибыль', money(res.net), res.net < 0 ? 'neg' : 'pos', true) + frow('Рентабельность', pct(res.netMargin)) + '</div>';
    var done = S.meta.projects[key] && S.meta.projects[key].status === 'done';
    h += '<button type="button" class="btn main wide" data-act="pc-save"' + (a.share == null ? ' disabled' : '') + '>' + (done ? 'Сохранить пересчёт' : 'Завершить проект и сохранить итог') + '</button>';
    return h;
  }
  function renderPCard() {
    var p = S.pcard, host = $('#pcard');
    if (!p) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'pcard'; document.body.appendChild(host); }
    var key = pkey(), title = key || 'Без проекта', pm = S.meta.projects[key], done = pm && pm.status === 'done';
    var body = p.step === 'period' ? pcPeriod(key) : p.step === 'select' ? pcSelect(key) : p.step === 'calc' ? pcCalc(key) : pcView(key, title);
    var prev = host.querySelector('.sheet'), top = prev ? prev.scrollTop : 0;
    host.innerHTML = '<div class="sheet" style="z-index:40"><div class="inner"><div class="row between"><button type="button" class="iconbtn" data-act="pc-close" aria-label="Закрыть">' + svg('close', 22) + '</button><div class="bold" style="font-size:17px;text-align:center">' + esc(title) + '</div><span class="pill ' + (done ? '' : 'warn') + '">' + (done ? 'завершён' : 'в работе') + '</span></div>' + body + '</div></div>';
    if (prev) host.querySelector('.sheet').scrollTop = top;
  }
  function pcAction(a, t) {
    var p = S.pcard, key = pkey();
    if (a === 'pc-close') { S.pcard = null; return renderPCard(); }
    if (a === 'pc-ops') { S.project = key || '__none__'; S.view = 'ops'; S.query = ''; S.pcard = null; renderPCard(); return render(); }
    if (a === 'pc-settings') { S.pcard = null; renderPCard(); S.view = 'settings'; S.settingsTab = 'articles'; return render(); }
    if (a === 'pc-done') { p.step = 'period'; p.custom = false; p.from = ''; p.to = ''; return renderPCard(); }
    if (a === 'pc-back') { p.step = 'view'; return renderPCard(); }
    if (a === 'pc-period') { p.step = 'period'; p.custom = true; return renderPCard(); }
    if (a === 'pc-back2') { p.step = 'select'; return renderPCard(); }
    if (a === 'pc-useperiod') { var f = KC.projectFinance(S.records, key); p.from = f.firstPay; p.to = f.lastPay; initIncomes(); p.step = 'select'; return renderPCard(); }
    if (a === 'pc-custom') { p.custom = true; return renderPCard(); }
    if (a === 'pc-calc') {
      var fr = ($('#pc-from') || {}).value, to = ($('#pc-to') || {}).value;
      if (!KC.validDate(fr) || !KC.validDate(to) || fr > to) return toast('Укажите период: дата начала не позже даты окончания');
      p.from = fr; p.to = to; initIncomes(); p.step = 'select'; return renderPCard();
    }
    if (a === 'pc-inc') { var id = t.getAttribute('data-id'); p.inc[id] = !p.inc[id]; return renderPCard(); }
    if (a === 'pc-incall') { var on = t.getAttribute('data-v') === '1'; for (var k in p.inc) p.inc[k] = on; return renderPCard(); }
    if (a === 'pc-calc2') { p.step = 'calc'; return renderPCard(); }
    if (a === 'pc-save') {
      var res = KC.projectResult(S.records, key, calcOpts()); if (res.alloc.share == null) return;
      S.meta.projects[key] = { status: 'done', doneAt: KC.nowISO(), updatedAt: KC.nowISO(), result: { from: res.alloc.from, to: res.alloc.to, fixedArticles: fixedNames(), incomeCount: incomeIds().length, income: res.income, variable: res.variable, ownIncome: res.alloc.ownIncome, allIncome: res.alloc.allIncome, share: res.alloc.share, fixedTotal: res.alloc.fixedTotal, fixedAllocated: res.alloc.fixedAllocated, net: res.net, netMargin: res.netMargin } };
      addLog('project', 'Проект «' + key + '» завершён: чистая прибыль ' + money(res.net) + ', постоянные расходы на заказ ' + money(res.alloc.fixedAllocated), '');
      persist(); p.step = 'view'; renderPCard(); render(); return toast('Итог проекта сохранён');
    }
    if (a === 'pc-reopen') { S.meta.projects[key] = { status: 'work', updatedAt: KC.nowISO() }; addLog('project', 'Проект «' + key + '» возвращён в работу'); persist(); renderPCard(); render(); return toast('Проект возвращён в работу'); }
  }

  /* ---------- выписки: загрузка, сверка ---------- */
  function applyStatement(walletId, rows, name) {
    var pendingKeys = S.decisions.filter(function (x) { return !x.resolvedAt && x.row; }).map(function (x) { return x.row.key; });
    var res = KC.reconcile({ records: S.records, wallet: walletId, rows: rows, ignored: S.meta.ignoredKeys, skipKeys: pendingKeys });
    S.decisions = S.decisions.concat(res.decisions);
    var st = res.stats;
    S.meta.statements.push({ wallet: walletId, at: KC.nowISO(), from: res.period ? res.period.from : '', to: res.period ? res.period.to : '', rows: st.rows, name: name || '' });
    ensureCatalogNow(true);
    commit({ patches: res.patches, newRecords: res.newRecords }, 'reconcile', 'Выписка ' + wname(walletId) + ': строк ' + st.rows + ', привязано ' + st.matched + ', добавлено ' + st.added + ', дублей ' + st.duplicates + ', решений ' + st.decisions);
    render();
    var parts = ['строк ' + st.rows, 'привязано ' + st.matched, 'добавлено ' + st.added, 'дублей ' + st.duplicates, 'нужно решение ' + st.decisions];
    if (st.absent) parts.push('нет в выписке ' + st.absent);
    toast('Выписка ' + wname(walletId) + ': ' + parts.join(', '));
  }
  function readTable(file, cb) {
    if (!window.XLSX) { toast('Библиотека xlsx не загрузилась (нет связи). Повторите позже.'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      try { var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true }); var ws = wb.Sheets[wb.SheetNames[0]]; cb(ws, wb); }
      catch (e) { toast('Не удалось прочитать файл: ' + (e && e.message ? e.message : '')); }
    };
    fr.readAsArrayBuffer(file);
  }
  var FIELD_LABELS = { date: 'Дата', amount: 'Сумма (со знаком)', debit: 'Списание (дебет)', credit: 'Поступление (кредит)', counterparty: 'Контрагент', purpose: 'Назначение платежа', docNo: 'Номер документа' };
  function openStatementFile(walletId, file) {
    readTable(file, function (ws) {
      var table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      var hi = KC.findHeaderRow(table), map = hi >= 0 ? KC.detectColumns(table[hi]) : {};
      S.modal = { type: 'map', wallet: walletId, table: table, header: hi >= 0 ? hi : 0, map: map, name: file.name };
      renderModal();
    });
  }
  function renderModal() {
    var m = S.modal, host = $('#modal'); if (!m) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'modal'; document.body.appendChild(host); }
    var head = m.table[m.header] || [];
    var opts = function (sel) { return '<option value="">не использовать</option>' + head.map(function (h, i) { return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(String(h || ('Колонка ' + (i + 1)))) + '</option>'; }).join(''); };
    var rowsHtml = Object.keys(FIELD_LABELS).map(function (k) { return '<div class="field"><label>' + FIELD_LABELS[k] + '</label><select class="input" data-map="' + k + '">' + opts(m.map[k]) + '</select></div>'; }).join('');
    var preview = KC.rowsFromTable(m.table, m.header, m.map);
    host.innerHTML = '<div class="sheet"><div class="inner"><div class="row between"><button type="button" class="iconbtn" data-act="closemodal" aria-label="Закрыть">' + svg('close', 22) + '</button><div class="bold" style="font-size:17px">Проверьте колонки</div><span></span></div><div class="small mu">Файл: ' + esc(m.name) + '. Строка заголовков: <input id="hdr" class="input" style="width:70px;display:inline-block;height:32px" type="text" inputmode="numeric" value="' + (m.header + 1) + '"></div><div class="glass" style="overflow:hidden">' + rowsHtml + '</div>' +
      '<div class="small ' + (preview.rows.length ? '' : 'neg') + '">' + (preview.rows.length ? 'Распознано строк: ' + preview.rows.length + (preview.skipped ? ', пропущено: ' + preview.skipped : '') + '. Первая: ' + esc(ruDate(preview.rows[0].date)) + ', ' + money(preview.rows[0].amount, { sign: true }) : 'Строки не распознаны: укажите колонки даты и суммы (или списания и поступления).') + '</div>' +
      '<button type="button" class="btn main wide" data-act="runstm"' + (preview.rows.length ? '' : ' disabled') + '>Загрузить и сверить</button></div></div>';
  }
  function resolveDec(id, c) {
    var d = S.decisions.filter(function (x) { return x.id === id && !x.resolvedAt; })[0]; if (!d) return;
    var choice = c; if (d.type === 'choose' && c !== 'new') choice = { recId: c };
    var res = KC.resolveDecision(d, choice, S.records);
    d.resolvedAt = KC.nowISO();
    if (res.ignoredKeys.length) S.meta.ignoredKeys = S.meta.ignoredKeys.concat(res.ignoredKeys);
    commit({ patches: res.patches, newRecords: res.newRecords }, 'reconcile', 'Решение по выписке: ' + d.type + ' → ' + (typeof choice === 'string' ? choice : 'привязка'));
    render();
  }

  /* ---------- копии, импорт ---------- */
  // одно нажатие = один файл (iPhone Safari отбрасывает второе скачивание из одного нажатия)
  function backupBase() { return 'kubcrafter-dengi-' + S.mode + '-' + KC.today(); }
  function markBackup() { S.meta.lastBackupAt = KC.nowISO(); addLog('backup', 'Сделана копия (' + S.records.length + ' записей)'); persist(); render(); }
  function doBackupJson() {
    var obj = KC.backupObject({ records: S.records, log: S.log, decisions: S.decisions, meta: { ignoredKeys: S.meta.ignoredKeys, statements: S.meta.statements, projects: S.meta.projects, articles: S.meta.articles }, namespace: S.mode });
    var name = backupBase() + '.json', text = JSON.stringify(obj);
    var file = null;
    try { file = new File([text], name, { type: 'application/json' }); } catch (e) {}
    // iPhone: системное меню «Поделиться» → «Сохранить в Файлы»; если недоступно или отменено, обычное скачивание
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).then(markBackup, function (e) {
        if (e && e.name === 'AbortError') return;
        return download(name, new Blob([text], { type: 'application/octet-stream' })).then(markBackup);
      });
    }
    return download(name, new Blob([text], { type: 'application/octet-stream' })).then(markBackup);
  }
  function doBackupXlsx() {
    if (!window.XLSX) { toast('Библиотека xlsx не загрузилась (нет связи). Для восстановления используйте JSON.'); return Promise.resolve(); }
    var ws = XLSX.utils.aoa_to_sheet(KC.recordsToTable(S.records)), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Операции');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return download(backupBase() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function doRestore(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var o = jparse(fr.result, null), err = KC.validateBackup(o);
      if (err) return toast(err);
      if (!confirm('Заменить текущие данные (' + S.records.length + ' записей) данными из копии (' + o.records.length + ' записей)?')) return;
      S.records = o.records; S.log = o.log || []; S.decisions = o.decisions || [];
      S.meta.ignoredKeys = (o.meta && o.meta.ignoredKeys) || []; S.meta.statements = (o.meta && o.meta.statements) || []; S.meta.projects = (o.meta && o.meta.projects) || {}; S.meta.articles = (o.meta && o.meta.articles) || []; ensureCatalogNow(true);
      S.records.forEach(function (r) { S.meta.dirty[r.id] = 1; });
      addLog('restore', 'Восстановлено из копии от ' + ruDate(o.createdAt) + ' (' + o.records.length + ' записей)'); persist(); render(); toast('Данные восстановлены');
    };
    fr.readAsText(file);
  }
  function doImportSummary(file) {
    var lim = parseInt(($('#importlimit') || {}).value, 10);
    readTable(file, function (ws) {
      var objs = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', cellDates: true });
      if (lim > 0) objs = objs.slice(0, lim);
      var res = KC.importSummary(objs, S.records);
      if (!res.records.length) return toast('Нечего загружать: пропущено ' + res.skipped + ', дублей ' + res.duplicates);
      if (!confirm('Будет добавлено записей: ' + res.records.length + ', пропущено: ' + res.skipped + ', уже есть: ' + res.duplicates + '. Продолжить?')) return;
      commit({ newRecords: res.records }, 'import', 'Импорт сводной таблицы: добавлено ' + res.records.length + ', пропущено ' + res.skipped + ', уже были ' + res.duplicates);
      var newArts = ensureCatalogNow(); if (newArts) addLog('catalog', 'Из таблицы добавлено статей в справочник: ' + newArts + ' (вид деятельности не определён)'); persist();
      render(); toast('Импортировано записей: ' + res.records.length + (newArts ? '. Новых статей: ' + newArts + ', укажите им вид деятельности в Настройках' : ''));
    });
  }
  function resetTest() {
    if (S.mode !== 'test') return;
    if (!confirm('Удалить всю тестовую базу целиком? Рабочая база не затрагивается.')) return;
    ['records', 'log', 'decisions', 'meta'].forEach(function (k) { lsDel('kc.test.' + k); });
    load(); S.view = 'ops'; render(); toast('Тестовая база сброшена');
  }

  /* ---------- общий рендер и события ---------- */
  var NAV = [['ops', 'Операции', 'ops'], ['projects', 'Проекты', 'proj'], ['statements', 'Выписки', 'stm'], ['settings', 'Настройки', 'gear']];
  function render() {
    document.documentElement.setAttribute('data-theme', S.theme);
    var body = S.view === 'projects' ? viewProjects() : S.view === 'statements' ? viewStatements() : S.view === 'settings' ? viewSettings() : viewOps();
    var nav = '<nav class="nav" aria-label="Разделы">' + NAV.map(function (n) { return '<button type="button" class="' + (S.view === n[0] ? 'on' : '') + '" data-act="nav" data-v="' + n[0] + '">' + svg(n[2], 22) + n[1] + '</button>'; }).join('') + '</nav>';
    var fab = S.view === 'ops' ? '<button type="button" class="fab" data-act="newrec" aria-label="Новая операция">' + svg('plus', 26) + '</button>' : '';
    $('#root').innerHTML = '<div class="app"><main class="page" id="main">' + body + '</main>' + nav + fab + '</div>';
    if (S.view === 'ops' && S.sync.text) { var sp = $('#syncpill'); if (sp) sp.textContent = S.sync.text; }
    if (S.pcard) renderPCard();
  }
  function refreshOpsParts() {
    var l = $('#list'); if (l) l.innerHTML = listHtml();
    var u = $('#unfilledchip'); if (u) u.textContent = 'Не заполнено: ' + KC.unfilledCount(S.records);
  }
  function onClick(e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (a === 'pick') { e.preventDefault(); var id = t.getAttribute('data-f'); setField(id, t.getAttribute('data-v')); hideSug(id); nextFocus(id); return; }
    if (a === 'confirmart') { e.preventDefault(); S.form.artSuggested = false; refreshArt(); return; }
    if (a.indexOf('pc-') === 0) { e.preventDefault(); return pcAction(a, t); }
    if (a.indexOf('art-') === 0) { e.preventDefault(); if (a === 'art-open') return openArtSheet(t.getAttribute('data-id')); return artAction(a, t); }
    if (a === 'closeform') return closeForm();
    if (a === 'saveform') return saveForm();
    if (a === 'ftype') { var f = S.form; f.type = t.getAttribute('data-v'); f.errors = []; var cur = f.article ? KC.findArticle(S.meta.articles, f.article) : null; if (f.type === 'transfer' || f.artSuggested || (cur && (cur.kind === 'expense') !== (f.type === 'expense'))) { f.article = ''; f.artSuggested = false; } renderForm(); return; }
    if (a === 'wallet') { var k = t.getAttribute('data-k'); S.form[k] = t.getAttribute('data-v'); renderForm(); return; }
    if (a === 'planned') { S.form.planned = !S.form.planned; renderForm(); return; }
    if (a === 'deleterec') return deleteRec(S.form.editId);
    if (a === 'closemodal') { S.modal = null; return renderModal(); }
    if (a === 'runstm') { var m = S.modal, rows = KC.rowsFromTable(m.table, m.header, m.map).rows; S.modal = null; renderModal(); return applyStatement(m.wallet, rows, m.name); }
    e.preventDefault && t.tagName === 'A' && e.preventDefault();
    if (a === 'nav') { S.view = t.getAttribute('data-v'); return render(); }
    if (a === 'gocopies') { S.view = 'settings'; S.settingsTab = 'data'; return render(); }
    if (a === 'theme') { S.theme = S.theme === 'dark' ? 'light' : 'dark'; lsSet('kc.theme', S.theme); return render(); }
    if (a === 'month') { S.month = KC.shiftMonth(S.month, +t.getAttribute('data-n')); return render(); }
    if (a === 'type') { S.type = t.getAttribute('data-v'); return render(); }
    if (a === 'unfilled') { S.unfilled = !S.unfilled; return render(); }
    if (a === 'walletstoggle') { S.walletsOpen = !S.walletsOpen; return render(); }
    if (a === 'newrec') return openForm(null);
    if (a === 'edit') { var rec = byId(t.getAttribute('data-id')); if (rec) openForm(rec); return; }
    if (a === 'openproject') return openProjectCard(t.getAttribute('data-p'));
    if (a === 'clearproject') { S.project = ''; return render(); }
    if (a === 'stab') { S.settingsTab = t.getAttribute('data-v'); return render(); }
    if (a === 'seedcat') { var have = {}; S.meta.articles.forEach(function (x) { have[x.name.toLowerCase()] = 1; }); var sc = KC.sampleCatalog().filter(function (x) { return !have[x.name.toLowerCase()]; }); S.meta.articles = S.meta.articles.concat(sc); addLog('catalog', 'Добавлен тестовый список статей (' + sc.length + ')'); persist(); render(); return toast('Добавлен тестовый список статей'); }
    if (a === 'seed') { var hv = {}; S.meta.articles.forEach(function (x) { hv[x.name.toLowerCase()] = 1; }); S.meta.articles = S.meta.articles.concat(KC.sampleCatalog().filter(function (x) { return !hv[x.name.toLowerCase()]; })); var smp = KC.sampleRecords(); commit({ newRecords: smp }, 'import', 'Добавлены тестовые данные (' + smp.length + ' записей)'); render(); return toast('Добавлены выдуманные тестовые данные'); }
    if (a === 'resetTest') return resetTest();
    if (a === 'backup') return doBackupJson();
    if (a === 'backupxlsx') return doBackupXlsx();
    if (a === 'teststm') return applyStatement(t.getAttribute('data-w'), KC.sampleStatement(t.getAttribute('data-w')), 'тестовая выписка');
    if (a === 'resolve') return resolveDec(t.getAttribute('data-id'), t.getAttribute('data-c'));
    if (a === 'signin') return remoteSignIn();
    if (a === 'switchmode') {
      var to = S.mode === 'test' ? 'prod' : 'test';
      if (to === 'prod' && !confirm('Перейти на РАБОЧУЮ базу? Все записи будут настоящими.')) return;
      lsSet('kc.mode', to); load(); render(); remoteInit(); return;
    }
    if (a === 'theme' ) return;
  }
  function onInput(e) {
    var id = e.target.id;
    if (id === 'a-name' && S.artSheet) { S.artSheet.name = e.target.value; return; }
    if (id === 'q') { S.query = e.target.value; return refreshOpsParts(); }
    if (id === 'pq') { S.projQuery = e.target.value; var l = $('#projlist'); if (l) { var keep = S.projQuery; render(); var el = $('#pq'); if (el) { el.focus(); el.setSelectionRange(keep.length, keep.length); } } return; }
    if (S.form) onFormInput(e);
  }
  function onChange(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-stm')) { var f = t.files[0]; t.value = ''; if (f) openStatementFile(t.getAttribute('data-stm'), f); return; }
    if (t.id === 'restorefile') { var f2 = t.files[0]; t.value = ''; if (f2) doRestore(f2); return; }
    if (t.id === 'summaryfile') { var f3 = t.files[0]; t.value = ''; if (f3) doImportSummary(f3); return; }
    if (t.getAttribute && t.getAttribute('data-map') && S.modal) { var v = t.value; S.modal.map[t.getAttribute('data-map')] = v === '' ? undefined : +v; renderModal(); return; }
    if (t.id === 'hdr' && S.modal) { var n = parseInt(t.value, 10); if (n > 0 && n <= S.modal.table.length) { S.modal.header = n - 1; S.modal.map = KC.detectColumns(S.modal.table[n - 1] || []); renderModal(); } return; }
    if (t.id === 'f-cp' && S.form) { S.form.counterparty = t.value; autoArticle(); }
    if (t.id === 'pc-from' && S.pcard) S.pcard.from = t.value;
    if (t.id === 'pc-to' && S.pcard) S.pcard.to = t.value;
  }
  function onFocusOut(e) { var id = e.target && e.target.id; if (id && (id === 'f-cp' || id === 'f-art' || id === 'f-proj')) setTimeout(function () { hideSug(id); if (id === 'f-art' && S.form) { var el = $('#f-art'); if (el && document.activeElement !== el) el.value = S.form.article; } }, 150); }
  function onFocusIn(e) { var id = e.target && e.target.id; if (id && (id === 'f-cp' || id === 'f-art' || id === 'f-proj')) showSug(id); }

  function init() {
    storageInit().then(start);
  }
  function start() {
    load();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onFormKey);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.sug')) e.preventDefault(); });
    // iOS Safari игнорирует user-scalable=no, поэтому щипок и двойное касание гасим отдельно
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); }); });
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    window.addEventListener('online', function () { S.online = true; render(); scheduleSync(); });
    window.addEventListener('offline', function () { S.online = false; render(); });
    if (CFG.firebase) { setSync('connecting', 'Облако: подключение…'); remoteInit(); } else setSync('local', '');
    if (CFG.sw && 'serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {} }
    render();
    window.KCApp = { S: S, commit: commit, render: render };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
