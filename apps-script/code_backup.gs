/**
 * Kubcrafter: копия кода инструмента на Google Диск (раз в неделю).
 * Скачивает архив ветки main публичного репозитория GitHub и кладёт его в папку Диска.
 * Секретов в коде нет: репозиторий читается без входа, папку указывает владелец ниже.
 *
 * Настройка (один раз):
 * 1. https://script.google.com, «Новый проект», вставить этот код.
 * 2. В FOLDER_ID вместо ВСТАВЬТЕ_ID_ПАПКИ записать идентификатор папки (часть ссылки после /folders/).
 * 3. Выбрать функцию backupCode, «Выполнить», дать разрешения (Диск и внешние запросы). Это первая копия.
 * 4. Выбрать функцию setupTrigger, «Выполнить»: расписание создано (день и время ниже).
 * 5. По желанию: «Триггеры», изменить уведомления об ошибках («Уведомлять каждый день»).
 */
var FOLDER_ID = 'ВСТАВЬТЕ_ID_ПАПКИ';
var REPO = 'sidorovdmtr/Sec';
var BRANCH = 'main';
var KEEP = 8;                       // сколько последних копий хранить
var PREFIX = 'Kubcrafter_код_';
var TRIGGER_WEEKDAY = 'MONDAY';     // день недели расписания
var TRIGGER_HOUR = 3;               // час (по часовому поясу проекта скрипта)
var MUST_CONTAIN = ['/index.html', '/config.js', '/firestore.rules', '/sw.js'];

function backupCode() {
  if (!FOLDER_ID || FOLDER_ID.indexOf('ВСТАВЬТЕ') === 0) throw new Error('Не указан FOLDER_ID: впишите идентификатор папки Диска в начале скрипта.');
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var sha = latestSha_();                       // может быть пустым, если GitHub API временно недоступен
  var short = sha ? sha.slice(0, 7) : '';
  if (short && hasCopyOf_(folder, short)) { Logger.log('Без изменений: копия коммита ' + short + ' уже есть.'); return 'без изменений'; }
  var resp = UrlFetchApp.fetch('https://codeload.github.com/' + REPO + '/zip/refs/heads/' + BRANCH, { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new Error('GitHub вернул ' + resp.getResponseCode() + ': копия не сделана.');
  var bytes = resp.getContent();
  if (!bytes || bytes.length < 10000 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error('Ответ GitHub не похож на архив: копия не сделана.');
  var name = PREFIX + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm') + (short ? '_' + short : '') + '.zip';
  var blob = resp.getBlob().setName(name);
  var names = Utilities.unzip(blob).map(function (b) { return b.getName(); });
  MUST_CONTAIN.forEach(function (tail) {
    if (!names.some(function (n) { return n.slice(-tail.length) === tail; })) throw new Error('В архиве нет ' + tail + ': копия не сохранена.');
  });
  folder.createFile(blob);
  PropertiesService.getScriptProperties().setProperty('LAST_OK', name);
  var removed = prune_(folder);
  Logger.log('Сохранено: ' + name + ' (файлов в архиве: ' + names.length + '). Удалено старых копий: ' + removed + '.');
  return name;
}

function latestSha_() {
  try {
    var r = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/commits/' + BRANCH, { muteHttpExceptions: true, headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'kubcrafter-code-backup' } });
    if (r.getResponseCode() !== 200) return '';
    var sha = JSON.parse(r.getContentText()).sha;
    return /^[0-9a-f]{40}$/.test(sha || '') ? sha : '';
  } catch (e) { return ''; }
}

function listCopies_(folder) {
  var out = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf(PREFIX) === 0 && !f.isTrashed()) out.push(f); }
  return out;
}
function hasCopyOf_(folder, short) {
  return listCopies_(folder).some(function (f) { return f.getName().slice(-(short.length + 4)) === short + '.zip'; });
}
// старые копии уходят в корзину Диска (там ещё 30 дней), остаются KEEP последних по имени (в имени дата)
function prune_(folder) {
  var files = listCopies_(folder).sort(function (a, b) { return a.getName() < b.getName() ? 1 : a.getName() > b.getName() ? -1 : 0; });
  var n = 0;
  for (var i = KEEP; i < files.length; i++) { files[i].setTrashed(true); n++; }
  return n;
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupCode') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupCode').timeBased().onWeekDay(ScriptApp.WeekDay[TRIGGER_WEEKDAY]).atHour(TRIGGER_HOUR).create();
  Logger.log('Расписание: каждую неделю, ' + TRIGGER_WEEKDAY + ', около ' + TRIGGER_HOUR + ':00.');
}

// посмотреть, когда была последняя удачная копия
function status() {
  var last = PropertiesService.getScriptProperties().getProperty('LAST_OK') || 'ещё не было';
  Logger.log('Последняя удачная копия: ' + last);
  return last;
}
