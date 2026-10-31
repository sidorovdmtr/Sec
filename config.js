// Настройки инструмента. Пока облако не подключено, данные хранятся только в этом браузере или телефоне.
window.KC_CONFIG = {
  allowProd: false,   // true откроет переключатель на рабочую базу (включать после проверки на тестовой)
  sw: true,           // офлайн-режим: сервис-воркер (нужен для работы без связи на iPhone)
  firebase: {
    apiKey: "AIzaSyBaMVYVzfcvS7pOtmtPBMFrAvK9CgVSQ0c",
    authDomain: "kubcrafter-finance.firebaseapp.com",
    projectId: "kubcrafter-finance",
    appId: "1:568410311355:web:c4bc09b9b456d9387f779e"
  }  // конфигурация проекта Firebase; было: сюда вставляется конфигурация проекта Firebase, пример в config.example.js
};
