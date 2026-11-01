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
  Logger.log(url ? url + '?key=' + PropertiesService.getScriptProperties().getProperty('KEY') : 'Сначала опубликуйте скрипт как веб-приложение (Начать развёртывание).');
}

function doGet(e) {
  var key = PropertiesService.getScriptProperties().getProperty('KEY'), q = (e && e.parameter) || {};
  if (!key || FOLDER_ID.indexOf('ВСТАВЬТЕ') === 0) return out_({ error: 'not_configured' });
  if (q.key !== key) return out_({ error: 'forbidden' });
  var folder = DriveApp.getFolderById(FOLDER_ID);
  if (q.action === 'list') {
    var it = folder.getFiles(), files = [];
    while (it.hasNext()) {
      var f = it.next(), n = f.getName();
      if (/\.(xlsx|xls)$/i.test(n)) files.push({ id: f.getId(), name: n, size: f.getSize(), modified: f.getLastUpdated().toISOString() });
    }
    return out_({ ok: true, files: files });
  }
  if (q.action === 'file' && q.id) {
    var file = DriveApp.getFileById(q.id), inFolder = false, parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inFolder = true;
    if (!inFolder) return out_({ error: 'not_in_folder' });
    return out_({ ok: true, name: file.getName(), base64: Utilities.base64Encode(file.getBlob().getBytes()) });
  }
  return out_({ error: 'bad_action' });
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
