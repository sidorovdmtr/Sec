// Скрипт копии кода на Диск (apps-script/code_backup.gs): проверка на заглушках Google и GitHub. Живой Диск и GitHub не затрагиваются.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'code_backup.gs'), 'utf8');

function world(o) {
  o = o || {};
  const files = (o.existing || []).map(n => ({ name: n, trashed: false }));
  const log = [], triggers = [], props = {}, fetched = [];
  const zipBytes = o.zipBytes || [0x50, 0x4B].concat(new Array(20000).fill(7));
  const ctx = {
    Logger: { log: m => log.push(String(m)) },
    DriveApp: { getFolderById: id => { ctx._folderId = id; return { getFiles: () => { const l = files.filter(f => !f.trashed || true); let i = 0; return { hasNext: () => i < l.length, next: () => { const f = l[i++]; return { getName: () => f.name, isTrashed: () => f.trashed, setTrashed: v => { f.trashed = v; } }; } }; }, createFile: b => { files.push({ name: b.name, trashed: false }); } }; } },
    UrlFetchApp: { fetch: (url) => {
      fetched.push(url);
      if (url.indexOf('api.github.com') >= 0) { if (o.apiDown) throw new Error('rate limit'); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sha: o.sha || 'abcdef1234567890abcdef1234567890abcdef12' }) }; }
      if (o.zipStatus && o.zipStatus !== 200) return { getResponseCode: () => o.zipStatus };
      return { getResponseCode: () => 200, getContent: () => zipBytes, getBlob: () => ({ name: '', setName(n) { this.name = n; return this; } }) };
    } },
    Utilities: { formatDate: () => o.stamp || '2026-11-09_0300', unzip: () => (o.entries || ['Sec-main/index.html', 'Sec-main/config.js', 'Sec-main/firestore.rules', 'Sec-main/sw.js', 'Sec-main/src/app.js']).map(n => ({ getName: () => n })) },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => { props[k] = v; }, getProperty: k => props[k] || null }) },
    ScriptApp: { WeekDay: { MONDAY: 'MON' }, getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }; const b = { timeBased: () => b, onWeekDay: d => { t.day = d; return b; }, atHour: h => { t.hour = h; return b; }, create: () => { triggers.push(t); return t; } }; return b; } }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC.replace("var FOLDER_ID = 'ВСТАВЬТЕ_ID_ПАПКИ';", "var FOLDER_ID = '" + (o.folder === undefined ? 'FOLDER123' : o.folder) + "';"), ctx);
  return { ctx, files, log, triggers, props, fetched };
}
const live = w => w.files.filter(f => !f.trashed).map(f => f.name).sort();

// успешная копия
{
  const w = world();
  const r = w.ctx.backupCode();
  ok('saves a zip named with prefix, date and short commit', r === 'Kubcrafter_код_2026-11-09_0300_abcdef1.zip' && live(w).join() === 'Kubcrafter_код_2026-11-09_0300_abcdef1.zip', live(w));
  ok('uses the folder id from settings', w.ctx._folderId === 'FOLDER123');
  ok('downloads the zip of the main branch from codeload', w.fetched.some(u => u === 'https://codeload.github.com/sidorovdmtr/Sec/zip/refs/heads/main'), w.fetched);
  ok('remembers the last good copy', w.ctx.status() === r);
}
// та же версия: не дублируем
{
  const w = world({ existing: ['Kubcrafter_код_2026-11-02_0300_abcdef1.zip'] });
  const r = w.ctx.backupCode();
  ok('same commit already saved: nothing new', r === 'без изменений' && live(w).length === 1 && !w.fetched.some(u => u.indexOf('codeload') >= 0), [r, live(w)]);
}
// новая версия: сохраняем, старые остаются
{
  const w = world({ existing: ['Kubcrafter_код_2026-11-02_0300_1111111.zip'] });
  w.ctx.backupCode();
  ok('different commit: new copy added next to the old one', live(w).length === 2);
}
// чистка: хранить 8
{
  const old = []; for (let d = 1; d <= 10; d++) old.push('Kubcrafter_код_2026-10-' + (d < 10 ? '0' + d : d) + '_0300_a00000' + d + '.zip');
  const w = world({ existing: old.concat(['Другой файл.txt']) });
  w.ctx.backupCode();
  const kept = live(w).filter(n => n.indexOf('Kubcrafter_код_') === 0);
  ok('keeps only the 8 newest copies', kept.length === 8, kept);
  ok('oldest ones are trashed, the newest copy is kept', !kept.includes('Kubcrafter_код_2026-10-01_0300_a000001.zip') && !kept.includes('Kubcrafter_код_2026-10-02_0300_a000002.zip') && kept.includes('Kubcrafter_код_2026-11-09_0300_abcdef1.zip'), kept);
  ok('other files in the folder are not touched', live(w).includes('Другой файл.txt'));
}
// отказ: ничего не сохраняем и не чистим
{
  const old = []; for (let d = 1; d <= 9; d++) old.push('Kubcrafter_код_2026-10-0' + d + '_0300_b00000' + d + '.zip');
  const w = world({ existing: old, zipStatus: 404 });
  let err = ''; try { w.ctx.backupCode(); } catch (e) { err = e.message; }
  ok('GitHub error: raises, saves nothing, trashes nothing', /404/.test(err) && live(w).length === 9, [err, live(w).length]);
}
{
  const w = world({ zipBytes: [0x3C, 0x68, 0x74, 0x6D, 0x6C] });
  let err = ''; try { w.ctx.backupCode(); } catch (e) { err = e.message; }
  ok('a non-zip answer is refused', /не похож на архив/.test(err) && live(w).length === 0, err);
}
{
  const w = world({ entries: ['Sec-main/README.md', 'Sec-main/sw.js'] });
  let err = ''; try { w.ctx.backupCode(); } catch (e) { err = e.message; }
  ok('an archive without index.html is not saved', /index\.html/.test(err) && live(w).length === 0, err);
}
{
  const w = world({ folder: 'ВСТАВЬТЕ_ID_ПАПКИ' });
  let err = ''; try { w.ctx.backupCode(); } catch (e) { err = e.message; }
  ok('placeholder folder id gives a clear error', /FOLDER_ID/.test(err) && w.fetched.length === 0, err);
}
// GitHub API недоступен: копия всё равно делается
{
  const w = world({ apiDown: true });
  const r = w.ctx.backupCode();
  ok('API down: copy is still made, without commit in the name', r === 'Kubcrafter_код_2026-11-09_0300.zip', r);
}
// расписание
{
  const w = world();
  w.ctx.setupTrigger(); w.ctx.setupTrigger();
  ok('trigger: one weekly trigger, repeated setup does not duplicate', w.triggers.length === 1 && w.triggers[0].fn === 'backupCode' && w.triggers[0].day === 'MON' && w.triggers[0].hour === 3, w.triggers);
}
// в коде нет секретов и чужих адресов
ok('no tokens or keys in the script', !/(ghp_|github_pat_|AIza|apiKey|Authorization)/i.test(SRC));
ok('script mentions only github hosts', (SRC.match(/https?:\/\/[a-z0-9.]+/gi) || []).every(u => /github\.com|script\.google\.com/.test(u)), SRC.match(/https?:\/\/[a-z0-9.]+/gi));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
