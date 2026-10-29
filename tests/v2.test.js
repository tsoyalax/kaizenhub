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
function openApp(cfg, backend, userId, fetchStub) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e.message || e); if (!/navigation/i.test(m)) errors.push(m.slice(0, 200)); });
  const dom = new JSDOM(page(cfg), {
    runScripts: 'dangerously', url: 'https://kz.test/v2', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (fetchStub) w.fetch = fetchStub;
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
  const sphAt = src.indexOf('Object.assign(IT_CAT, SPHERES)');
  assert.ok(sphAt > 0 && sphAt < src.indexOf('restoreView();\n')); ok('сферы жизни известны до первой отрисовки (после перезагрузки задача не «Другое»)');

  // 2) без настроек Supabase: v2 работает на данных в браузере и не трогает основную версию
  const local = openApp(fs.readFileSync(root + 'v2/config.js', 'utf8'));
  await wait(3000);
  assert.equal(local.errors.length, 0, local.errors.join('\n')); ok('v2 без облака: ошибок нет');
  assert.ok(local.w.localStorage.getItem('kz2-data')); ok('v2 без облака: данные в kz2-data');
  checkStorage(local.w, 'без облака'); ok('v2 без облака: ключи основной версии целы, свои — с kz2-');

  // AI-помощник без облака: разбор по ключевым словам -> внутренние задачи по сферам
  const d = local.w.document, $ = q => d.querySelector(q);
  $('#aiBtn').click(); assert.ok($('.bd-modal')); ok('AI-помощник: окно брейн-дампа открывается');
  $('#bdText').value = 'позвонить маме сегодня, а ещё оплатить кредит. Записаться к врачу и ещё подготовить отчёт для клиента';
  $('#bdText').dispatchEvent(new local.w.Event('input', { bubbles: true }));
  assert.ok(local.w.localStorage.getItem('kz2-dump').includes('позвонить маме')); ok('AI-помощник: черновик сохраняется (kz2-dump)');
  $('#bdGo').click(); await wait(300);
  const rows = d.querySelectorAll('.bd-row'); assert.equal(rows.length, 4, d.querySelector('.bd-modal').textContent);
  const sph = [...d.querySelectorAll('[data-bdsph]')].map(x => x.value).sort();
  assert.deepEqual(sph, ['family', 'health', 'money', 'work']); ok('AI-помощник: 4 дела разложены по сферам (семья, финансы, здоровье, работа)');
  d.querySelector('[data-bdon="1"]').click(); await wait(50);
  $('#bdAdd').click(); await wait(300);
  const its = local.w.eval('db.itasks').filter(t => t.source === 'braindump');
  assert.equal(its.length, 3); ok('AI-помощник: выбранные дела стали задачами (снятая галочка — нет)');
  const mama = its.find(t => /маме/i.test(t.title));
  assert.ok(mama && mama.category === 'family' && mama.due_date === local.w.eval('today()') && mama.status === 'todo'); ok('AI-помощник: сфера и срок «сегодня» сохранены в задаче');
  assert.equal(local.w.eval('ui.view'), 'mytasks'); assert.ok(!local.w.localStorage.getItem('kz2-dump')); ok('AI-помощник: после добавления — «Мои задачи», черновик очищен');
  checkStorage(local.w, 'брейн-дамп');
  local.w.close();

  // 3) с облаком: вход, синхронизация, выход
  const be = makeBackend(), A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const calls = [];
  const fetchStub = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ json: { items: [
    { title: 'Пробежать 3 км', sphere: 'health', when: 'week', priority: 'high', step: 'Положить кроссовки у двери' },
    { title: 'Что-то странное', sphere: 'space', when: 'never', priority: 'x' }] } }) }; };
  const cloud = openApp("window.KZ_CONFIG = { supabaseUrl: 'https://v2.test', supabaseKey: 'sb_publishable_test' };", be, A, fetchStub);
  await wait(4500);
  assert.equal(cloud.errors.length, 0, cloud.errors.join('\n')); ok('v2 с облаком: ошибок нет');
  assert.equal(cloud.w.__authOpts.auth.storageKey, 'kz2-auth'); ok('v2 с облаком: сессия входа под ключом kz2-auth');
  assert.ok([...be.rows.keys()].includes('data/users/' + A + '/meta')); ok('v2 с облаком: данные ушли в облако');
  checkStorage(cloud.w, 'с облаком'); ok('v2 с облаком: ключи основной версии целы');
  { const d = cloud.w.document, $ = q => d.querySelector(q);
    $('#aiBtn').click(); $('#bdText').value = 'бегать надо начать и ещё что-то'; $('#bdGo').click(); await wait(500);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/v2/sample'); assert.equal(calls[0].body.mode, 'json');
    assert.ok(calls[0].body.prompt.includes('бегать надо начать')); ok('AI-помощник с облаком: текст ушёл в Claude через /api/v2/sample');
    assert.ok(d.querySelector('.bd-modal').textContent.includes('Первый шаг: Положить кроссовки')); ok('AI-помощник: показан первый маленький шаг');
    assert.deepEqual([...d.querySelectorAll('[data-bdsph]')].map(x => x.value).sort(), ['health', 'other']); ok('AI-помощник: неизвестная сфера -> «Другое»');
    $('#bdAdd').click(); await wait(600);
    const docs = [...be.rows.keys()].filter(k => k.startsWith('it/')).map(k => JSON.parse(be.rows.get(k).data.json));
    const run = docs.find(t => t.title === 'Пробежать 3 км');
    assert.ok(run && run.category === 'health' && run.priority === 'high' && run.description.includes('кроссовки')); ok('AI-помощник с облаком: задача сохранена в облаке (it/…)');
  }
  await cloud.w.kzSignOut(); await wait(100);
  for (const k in MAIN) assert.equal(cloud.w.localStorage.getItem(k), MAIN[k], 'выход из v2 стёр ' + k);
  assert.ok(!Object.keys(cloud.w.localStorage).some(k => k.startsWith('kz2-data'))); ok('выход из v2 чистит только данные v2');
  cloud.w.close();

  console.log(`\nv2: все проверки пройдены (${n})`);
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
