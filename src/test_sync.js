// Проверка синхронизации на двух «устройствах» с общей фиктивной базой вместо Firestore.
// Реальный Firebase не используется: проверяется наша логика обмена и слияния.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve('dist/deploy/index.html');
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) pass++; else { fail++; console.log('FAIL', n, i === undefined ? '' : JSON.stringify(i)); } };
const store = {};
const clone = (x) => JSON.parse(JSON.stringify(x));
function fsCall(op, a) {
  if (op === 'setDoc') { const [c, id] = a.path.split('/'); (store[c] = store[c] || {})[id] = clone(a.data); return null; }
  if (op === 'batchSet') { a.items.forEach(([p, d]) => { const [c, id] = p.split('/'); (store[c] = store[c] || {})[id] = clone(d); }); return null; }
  if (op === 'getDoc') { const [c, id] = a.path.split('/'); return (store[c] || {})[id] ? clone(store[c][id]) : null; }
  if (op === 'getDocs') { const docs = Object.values(store[a.path] || {}); const w = a.where; return clone(w ? docs.filter(d => (d[w[0]] || '') > w[2]) : docs); }
  throw new Error('op ' + op);
}
const FAKE = {
  app: `export function initializeApp(c){return {c}}`,
  auth: `export class GoogleAuthProvider{}; export function getAuth(){return {}}; export function onAuthStateChanged(a,cb){setTimeout(()=>cb({email:'t@example.com'}),0)}; export function signInWithRedirect(){}; export function signInWithPopup(){return Promise.resolve({})}`,
  fs: `const call=(o,a)=>window.__fsCall(o,a);
export function getFirestore(){return {}}
export function collection(db,name){return {path:name}}
export function doc(c,id){return {path:c.path+'/'+id}}
export function writeBatch(){const items=[];return {set(r,d){items.push([r.path,d])},commit(){return call('batchSet',{items})}}}
export function where(f,o,v){return [f,o,v]}
export function query(c,w){return {path:c.path,where:w}}
export async function getDocs(q){const docs=await call('getDocs',{path:q.path,where:q.where||null});return {forEach(fn){docs.forEach(d=>fn({data:()=>d}))}}}
export async function getDoc(r){const d=await call('getDoc',{path:r.path});return {exists:()=>!!d,data:()=>d}}
export async function setDoc(r,d){return call('setDoc',{path:r.path,data:d})}`
};
async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.exposeFunction('__fsCall', async (op, a) => fsCall(op, a));
  await ctx.route(/^https?:/, (r) => {
    const u = r.request().url();
    const hdr = { 'access-control-allow-origin': '*', 'content-type': 'application/javascript' };
    if (/firebase-app\.js/.test(u)) return r.fulfill({ status: 200, headers: hdr, body: FAKE.app });
    if (/firebase-auth\.js/.test(u)) return r.fulfill({ status: 200, headers: hdr, body: FAKE.auth });
    if (/firebase-firestore\.js/.test(u)) return r.fulfill({ status: 200, headers: hdr, body: FAKE.fs });
    return r.abort();
  });
  await ctx.route(/config\.js$/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/javascript' }, body: "window.KC_CONFIG={allowProd:false,sw:false,firebase:{projectId:'fake'}};" }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(FILE);
  return { ctx, page, errors };
}
const settle = (p) => p.waitForTimeout(1800);
(async () => {
  const browser = await chromium.launch();
  const A = await device(browser), B = await device(browser);
  await settle(A.page);
  ok('A connected', (await A.page.evaluate(() => KCApp.S.sync.state)) === 'online', await A.page.evaluate(() => KCApp.S.sync));

  // 1. A заполняет данные -> уходят в «облако»
  await A.page.click('button[data-act="seed"]'); await settle(A.page);
  const nA = await A.page.evaluate(() => KCApp.S.records.length);
  ok('records pushed', Object.keys(store.money_test_records || {}).length === nA, [nA, Object.keys(store.money_test_records || {}).length]);
  ok('meta docs pushed', !!(store.money_test_meta && store.money_test_meta.state && store.money_test_meta.decisions && store.money_test_meta.log), Object.keys(store.money_test_meta || {}));

  // 2. B подключается и получает всё
  await B.page.reload(); await settle(B.page);
  const nB = await B.page.evaluate(() => KCApp.S.records.length);
  ok('B pulled records', nB === nA, [nA, nB]);
  const catA = await A.page.evaluate(() => KCApp.S.meta.articles.length), catB = await B.page.evaluate(() => KCApp.S.meta.articles.length);
  ok('B pulled catalog', catA === catB && catB > 10, [catA, catB]);
  ok('B total equals A total', (await B.page.evaluate(() => KC.balances(KCApp.S.records).total)) === (await A.page.evaluate(() => KC.balances(KCApp.S.records).total)));

  // 3. B переименовывает статью -> A получает и название статьи, и обновлённые операции
  await B.page.click('.nav button[data-v="settings"]');
  await B.page.locator('button[data-act="art-open"]:has-text("Закупка материала")').first().click();
  await B.page.fill('#a-name', 'Закупка материалов');
  await B.page.click('button[data-act="art-save"]'); await settle(B.page);
  await A.page.reload(); await settle(A.page);
  const renamedA = await A.page.evaluate(() => ({ cat: KCApp.S.meta.articles.some(a => a.name === 'Закупка материалов') && !KCApp.S.meta.articles.some(a => a.name === 'Закупка материала'), recs: KCApp.S.records.filter(r => r.article === 'Закупка материалов').length, old: KCApp.S.records.filter(r => r.article === 'Закупка материала').length }));
  ok('A sees renamed article in catalog and records', renamedA.cat && renamedA.recs > 0 && renamedA.old === 0, renamedA);

  // 4. A завершает проект -> B видит статус
  await A.page.click('.nav button[data-v="projects"]');
  const pname = await A.page.locator('#projlist .op[data-p]:not([data-p="__none__"])').first().getAttribute('data-p');
  await A.page.locator('#projlist .op[data-p]:not([data-p="__none__"])').first().click();
  await A.page.click('#pcard button[data-act="pc-done"]'); await A.page.click('#pcard button[data-act="pc-useperiod"]');
  await A.page.click('#pcard button[data-act="pc-calc2"]'); await A.page.click('#pcard button[data-act="pc-save"]'); await A.page.click('#pcard button[data-act="pc-close"]'); await settle(A.page);
  await B.page.reload(); await settle(B.page);
  ok('B sees project done', await B.page.evaluate((n) => KCApp.S.meta.projects[n] && KCApp.S.meta.projects[n].status === 'done', pname));

  // 5. решения по выписке: A загружает тестовую выписку, B решает, A видит
  await A.page.click('.nav button[data-v="statements"]');
  await A.page.click('button[data-act="teststm"][data-w="alfa"]'); await settle(A.page);
  const open = await A.page.evaluate(() => KCApp.S.decisions.filter(d => !d.resolvedAt).length);
  ok('A has open decisions', open >= 1, open);
  await B.page.reload(); await settle(B.page);
  ok('B sees same open decisions', (await B.page.evaluate(() => KCApp.S.decisions.filter(d => !d.resolvedAt).length)) === open);
  await B.page.click('.nav button[data-v="statements"]');
  await B.page.locator('.dec button[data-act="resolve"]').first().click(); await settle(B.page);
  await A.page.reload(); await settle(A.page);
  ok('A sees decision resolved on B', (await A.page.evaluate(() => KCApp.S.decisions.filter(d => !d.resolvedAt).length)) === open - 1);

  // 6. журнал содержит записи обоих устройств, записи не теряются
  const logs = await A.page.evaluate(() => KCApp.S.log.map(l => l.summary));
  ok('log has entries from both devices', logs.some(s => /переимен|изменена|Статья «Закупка материалов»/.test(s)) && logs.some(s => /Проект «/.test(s)), logs.slice(-6));
  // 7. оба устройства сошлись
  await B.page.reload(); await settle(B.page);
  const sig = (p) => p.evaluate(() => JSON.stringify([KCApp.S.records.length, KCApp.S.meta.articles.length, Object.keys(KCApp.S.meta.projects).length, KCApp.S.decisions.filter(d => !d.resolvedAt).length]));
  ok('devices converge', (await sig(A.page)) === (await sig(B.page)), [await sig(A.page), await sig(B.page)]);
  // 8. ссылка скрипта выписок: A сохраняет, B получает; B удаляет, и удаление доходит до A и не возвращается из облака
  const URLX = 'https://script.google.com/macros/s/TEST/exec?key=abc';
  await A.page.click('.nav button[data-v="statements"]');
  await A.page.fill('#stm-url', URLX); await A.page.click('button[data-act="stmurlsave"]'); await settle(A.page);
  await B.page.reload(); await settle(B.page);
  ok('B got script url from cloud', (await B.page.evaluate(() => KCApp.S.meta.stmUrl)) === URLX);
  await B.page.click('.nav button[data-v="statements"]'); await B.page.click('button[data-act="stmurlclear"]'); await settle(B.page);
  ok('B cleared url and sync did not bring it back', (await B.page.evaluate(() => KCApp.S.meta.stmUrl)) === '');
  await B.page.reload(); await settle(B.page);
  ok('B url still empty after reload', (await B.page.evaluate(() => KCApp.S.meta.stmUrl)) === '');
  await A.page.reload(); await settle(A.page);
  ok('A got the deletion', (await A.page.evaluate(() => KCApp.S.meta.stmUrl)) === '');
  // можно вставить новую ссылку, она тоже расходится
  const URL2 = 'https://script.google.com/macros/s/NEW/exec?key=xyz';
  await A.page.click('.nav button[data-v="statements"]'); await A.page.fill('#stm-url', URL2); await A.page.click('button[data-act="stmurlsave"]'); await settle(A.page);
  await B.page.reload(); await settle(B.page);
  ok('new url reaches B', (await B.page.evaluate(() => KCApp.S.meta.stmUrl)) === URL2);
  ok('no js errors', A.errors.length === 0 && B.errors.length === 0, [A.errors, B.errors]);
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(2); });
