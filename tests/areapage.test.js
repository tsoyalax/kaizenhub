// Шаблоны из другого пространства: выбрать пространство → отметить шаблоны → копия с этапами, подэтапами и карточками
const fs = require('fs'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const root = __dirname + '/../';
let html = fs.readFileSync(root + 'index.html', 'utf8');
const shim = fs.readFileSync(root + 'claude-shim.js', 'utf8'), cfg = fs.readFileSync(root + 'config.js', 'utf8');
html = html
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>/* supabase подставляется тестом */</script>')
  .replace('<script src="/config.js"></script>', '<script>' + cfg + '</script>')
  .replace('<script src="/claude-shim.js"></script>', '<script>' + shim + '</script>');
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };

function openApp(backend, userId, url = 'https://kz.test/', extra, keepStorage) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 200)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ').slice(0, 200)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => backend.client(userId, extra) };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {}; w.IntersectionObserver = w.IntersectionObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
      if (extra && extra.session) for (const k in extra.session) w.sessionStorage.setItem(k, extra.session[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
// Отдельная страница области: /?area=<id> — только эта область
(async () => {
  const be = makeBackend(); const A = 'aaaaaaaa-0000-0000-0000-0000000000b1';
  const o = openApp(be, A); await wait(4500);
  const w = o.w, D = w.document, E = x => w.eval(x);
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  const area = await w.eval(`createArea('Игорь Шаламов')`); await wait(200);
  const sp = await w.eval(`createSpace({ name:'Игорь: запуск', kind:'agency', area:'${area}', copy:false })`); await wait(400);
  E(`ui.areaMenu = true; renderSide();`); await wait(30);
  const ext = [...D.querySelectorAll('.am-ext')].find(a => a.getAttribute('href').endsWith('area=' + area));
  assert.ok(ext && ext.target === '_blank'); ok('у области в меню — «Открыть отдельной страницей» (↗)');
  const store = {}; for (let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); store[k] = w.localStorage.getItem(k); }
  o.w.close();
  // открываем ссылку области
  const reloads = [];
  const o2 = openApp(be, A, 'https://kz.test/?area=' + area, {}, store); o2.w.kzReloadHook = () => reloads.push(1); await wait(4500);
  const w2 = o2.w, E2 = x => w2.eval(x);
  assert.ok(E2('focusOn()')); ok('страница области узнаёт свою область');
  assert.ok(!w2.document.getElementById('spPick')); ok('без экрана «Где работаем?»');
  assert.ok(E2(`localStorage.getItem('kz-space')`) === sp || reloads.length >= 1); ok('сразу открывается пространство этой области');
  E2(`ui.areaMenu = true; renderSide();`); await wait(30);
  const names = [...w2.document.querySelectorAll('.area-menu [data-areaopen]')].map(b => b.dataset.areaopen);
  assert.deepEqual(names, [area]); ok('в меню только эта область — других не видно');
  assert.ok(!w2.document.querySelector('[data-areamnew]') && w2.document.querySelector('.area-menu a.am-new[href="/"]')); ok('нет «Новой области», есть «← Все области»');
  assert.ok(/Игорь Шаламов/.test(w2.document.title)); ok('вкладка браузера подписана названием области');
  assert.deepEqual([...o.errors, ...o2.errors].filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
