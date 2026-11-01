// Kubcrafter: выдача выписок из одной папки Google Диска для кнопки «Синхронизировать выписки».
// Запускается от вашего аккаунта и отдаёт только файлы xlsx/xls из папки FOLDER_ID, и только при верном ключе.
// Установка: см. README.md, раздел «Автозагрузка выписок».

var FOLDER_ID = 'ВСТАВЬТЕ_ID_ПАПКИ'; // часть ссылки на папку после /folders/

// Запустить один раз: создаёт секретный ключ (хранится в свойствах скрипта, не в коде).
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('KEY')) p.setProperty('KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  DriveApp.getFolderById(FOLDER_ID).getName(); // проверка доступа к папке и запрос разрешений
  showLink();
}

// Показывает ссылку, которую нужно вставить в инструмент (Выписки, «Ссылка скрипта»). Ссылка секретна, как пароль.
function showLink() {
  var url = ScriptApp.getService().getUrl();
  // из редактора getUrl() возвращает тестовый адрес /dev, браузеру нужен рабочий /exec
  Logger.log(url ? url.replace(/\/dev$/, '/exec') + '?key=' + PropertiesService.getScriptProperties().getProperty('KEY') : 'Сначала опубликуйте скрипт как веб-приложение (Начать развёртывание).');
}

function doGet(e) {
  var q = (e && e.parameter) || {}, cb = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(q.callback || '') ? q.callback : '';
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || FOLDER_ID.indexOf('ВСТАВЬТЕ') === 0) return out_({ error: 'not_configured' }, cb);
  if (q.key !== key) return out_({ error: 'forbidden' }, cb);
  var folder = DriveApp.getFolderById(FOLDER_ID);
  if (q.action === 'list') {
    var it = folder.getFiles(), files = [];
    while (it.hasNext()) {
      var f = it.next(), n = f.getName();
      if (/\.(xlsx|xls)$/i.test(n)) files.push({ id: f.getId(), name: n, size: f.getSize(), modified: f.getLastUpdated().toISOString() });
    }
    return out_({ ok: true, files: files }, cb);
  }
  if (q.action === 'file' && q.id) {
    var file = DriveApp.getFileById(q.id), inFolder = false, parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inFolder = true;
    if (!inFolder) return out_({ error: 'not_in_folder' }, cb);
    return out_({ ok: true, name: file.getName(), base64: Utilities.base64Encode(file.getBlob().getBytes()) }, cb);
  }
  return out_({ error: 'bad_action' }, cb);
}

// Если задан callback (имя функции), ответ отдаётся как JavaScript: так его принимает Safari на iPhone, который блокирует обычные запросы между сайтами.
function out_(o, cb) {
  var json = JSON.stringify(o);
  if (cb) return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
