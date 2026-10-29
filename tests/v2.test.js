// KaizenHub v2 (/v2): отдельный продукт на том же домене — не трогает ключи браузера основной версии
const fs = require('fs'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const root = __dirname + '/../';
const src = fs.readFileSync(root + 'v2/index.html', 'utf8');
const shim = fs.readFileSync(root + 'v2/claude-shim.js', 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };

// ключи основной версии: v2 не должна их читать, менять и удалять
const MAIN = {
  'agency-pipeline-demo-v2': '{"main":1}', 'agency-pipeline-demo-v2-sync': '{"main":1}', 'agency-theme': 'dark', 'agency-mode': 'owner',
  'kz-space': 'sMain', 'kz-org': 'oMain', 'kz-org-own': '1', 'kz-space-colors': '{"main":1}', 'kz-side-pin': '1'
};
const SESSION_MAIN = { 'kz-view': 'main', 'kz-who': 'lead', 'kz-invite': 'mainmainmain' };

function page(cfg) {
  const html = src
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>/* supabase подставляется тестом */</script>')
    .replace('<script src="/v2/config.js"></script>', '<script>' + cfg + '</script>')
    .replace('<script src="/v2/claude-shim.js"></script>', '<script>' + shim + '</script>');
  assert.notEqual(html, src); return html;
}
function openApp(cfg, backend, userId) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e.message || e); if (!/navigation/i.test(m)) errors.push(m.slice(0, 200)); });
  const dom = new JSDOM(page(cfg), {
    runScripts: 'dangerously', url: 'https://kz.test/v2', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (backend) w.supabase = { createClient: (u, k, o) => { w.__authOpts = o; return backend.client(userId); } };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {}; w.IntersectionObserver = w.IntersectionObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      for (const k in MAIN) w.localStorage.setItem(k, MAIN[k]);
      for (const k in SESSION_MAIN) w.sessionStorage.setItem(k, SESSION_MAIN[k]);
    }
  });
  return { w: dom.window, errors };
}
function checkStorage(w, where) {
  for (const k in MAIN) assert.equal(w.localStorage.getItem(k), MAIN[k], where + ': изменён ключ основной версии ' + k);
  for (const k in SESSION_MAIN) assert.equal(w.sessionStorage.getItem(k), SESSION_MAIN[k], where + ': изменён ключ вкладки основной версии ' + k);
  const own = Object.keys(w.localStorage).filter(k => !(k in MAIN));
  assert.ok(own.length > 0, where + ': v2 ничего не сохранила');
  own.forEach(k => assert.ok(k.startsWith('kz2-'), where + ': ключ без префикса kz2-: ' + k));
}

(async () => {
  // 1) в коде v2 нет ключей основной версии, страница грузит свои файлы
  const code = src + shim;
  ['agency-pipeline-demo', "'agency-theme'", '"agency-theme"', "'agency-mode'", "'kz-space'", "'kz-org'", "'kz-org-own'", "'kz-view'",
   "'kz-space-colors'", "'kz-side-pin'", "'kz-who'", "'kz-invite'"].forEach(k => assert.ok(!code.includes(k), 'в v2 остался ключ ' + k));
  ok('в коде v2 нет ключей хранилища основной версии');
  assert.ok(src.includes('<script src="/v2/config.js">') && src.includes('<script src="/v2/claude-shim.js">')); ok('v2 подключает свои config.js и claude-shim.js');
  assert.ok(shim.includes("storageKey: 'kz2-auth'")); ok('у v2 своя сессия входа (kz2-auth)');
  assert.ok(shim.includes("'/api/v2/sample'")); ok('v2 ходит в свою серверную функцию /api/v2/sample');
  const vj = JSON.parse(fs.readFileSync(root + 'vercel.json', 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/v2' && r.destination === '/v2/index.html')); ok('vercel.json: /v2 -> v2/index.html');
  assert.ok(!/supabaseKey:\s*'sb_secret/.test(fs.readFileSync(root + 'v2/config.js', 'utf8'))); ok('v2/config.js без секретного ключа');

  // 2) без настроек Supabase: v2 работает на данных в браузере и не трогает основную версию
  const local = openApp(fs.readFileSync(root + 'v2/config.js', 'utf8'));
  await wait(3000);
  assert.equal(local.errors.length, 0, local.errors.join('\n')); ok('v2 без облака: ошибок нет');
  assert.ok(local.w.localStorage.getItem('kz2-data')); ok('v2 без облака: данные в kz2-data');
  checkStorage(local.w, 'без облака'); ok('v2 без облака: ключи основной версии целы, свои — с kz2-');
  local.w.close();

  // 3) с облаком: вход, синхронизация, выход
  const be = makeBackend(), A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const cloud = openApp("window.KZ_CONFIG = { supabaseUrl: 'https://v2.test', supabaseKey: 'sb_publishable_test' };", be, A);
  await wait(4500);
  assert.equal(cloud.errors.length, 0, cloud.errors.join('\n')); ok('v2 с облаком: ошибок нет');
  assert.equal(cloud.w.__authOpts.auth.storageKey, 'kz2-auth'); ok('v2 с облаком: сессия входа под ключом kz2-auth');
  assert.ok([...be.rows.keys()].includes('data/users/' + A + '/meta')); ok('v2 с облаком: данные ушли в облако');
  checkStorage(cloud.w, 'с облаком'); ok('v2 с облаком: ключи основной версии целы');
  await cloud.w.kzSignOut(); await wait(100);
  for (const k in MAIN) assert.equal(cloud.w.localStorage.getItem(k), MAIN[k], 'выход из v2 стёр ' + k);
  assert.ok(!Object.keys(cloud.w.localStorage).some(k => k.startsWith('kz2-data'))); ok('выход из v2 чистит только данные v2');
  cloud.w.close();

  console.log(`\nv2: все проверки пройдены (${n})`);
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
