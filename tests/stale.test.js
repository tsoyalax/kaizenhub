// Старое устройство не затирает облако; кнопки «Сохранить» и «Синхронизировать»
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
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', K = 'agency-pipeline-demo-v2';
  const be = makeBackend();
  const d1 = openApp(be, A); await wait(4500); const w1 = d1.w; const E1 = x => w1.eval(x);
  E1(`db.onboarded = true; commit()`); await wait(2500);
  const pid = E1(`db.projects.find(p => p.state === 'active').id`);
  const cloudP = () => JSON.parse([...be.rows.values()].find(r => r.path.endsWith('/p_' + pid)).data.json);
  // устройство B открылось и сверилось с облаком — запоминаем его браузер
  const d2 = openApp(be, A); await wait(4500); const w2 = d2.w;
  const store = {}; for (let i = 0; i < w2.localStorage.length; i++){ const k = w2.localStorage.key(i); store[k] = w2.localStorage.getItem(k); }
  w2.close();
  // на A переименовали проект
  E1(`projById('${pid}').name = 'НОВОЕ ИМЯ'; commit()`); await wait(2500);
  assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('правка A в облаке');
  // в браузере B копия проекта отличается от облака не из-за правки (например, пересчитались даты) — и B старый
  const old = JSON.parse(store[K]); const op = old.projects.find(p => p.id === pid); op.recalc = 'пересчитано при открытии'; old.savedAt = Date.now() + 1e7;
  store[K] = JSON.stringify(old); delete store[K + '-dirty'];
  const d3 = openApp(be, A, undefined, undefined, store); await wait(6000);
  assert.equal(d3.w.eval(`projById('${pid}').name`), 'НОВОЕ ИМЯ'); ok('старое устройство показывает данные из облака');
  await wait(2500);
  assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('старое устройство не затёрло облако своей копией');
  // своя несохранённая правка (отмечена в -dirty) при следующем открытии не теряется
  d3.w.eval(`projById('${pid}').client = 'Клиент Б'; save()`);
  const st2 = {}; for (let i = 0; i < d3.w.localStorage.length; i++){ const k = d3.w.localStorage.key(i); st2[k] = d3.w.localStorage.getItem(k); }
  d3.w.close();                                                  // закрыли раньше, чем ушло в облако
  assert.ok(JSON.parse(st2[K + '-dirty'] || '[]').includes('p_' + pid)); ok('несохранённая правка отмечена');
  const d4 = openApp(be, A, undefined, undefined, st2); await wait(6000);
  assert.equal(d4.w.eval(`projById('${pid}').client`), 'Клиент Б'); ok('несохранённая правка подхватилась при открытии');
  await wait(2500); assert.equal(cloudP().client, 'Клиент Б'); assert.equal(cloudP().name, 'НОВОЕ ИМЯ'); ok('и дописалась в облако, не откатив имя');
  // кнопки
  const w4 = d4.w; w4.eval(`openSide && openSide()`); await wait(50);
  assert.ok(w4.document.querySelector('[data-savenow]') && w4.document.querySelector('[data-syncnow]')); ok('кнопки «Сохранить» и «Синхронизировать» есть');
  w4.eval(`projById('${pid}').note = 'через кнопку'; save()`);
  w4.document.querySelector('[data-savenow]').click(); await wait(800);
  assert.equal(cloudP().note, 'через кнопку'); ok('«Сохранить» сразу пишет в облако');
  E1(`projById('${pid}').name = 'С ДРУГОГО УСТРОЙСТВА'; commit()`); await wait(2000);
  w4.eval(`projById('${pid}').name = 'СТАРАЯ КОПИЯ'; cloud.hashes.set('p_${pid}', 'x')`);   // будто вкладка отстала
  w4.document.querySelector('[data-syncnow]').click(); await wait(1500);
  assert.equal(w4.eval(`projById('${pid}').name`), 'С ДРУГОГО УСТРОЙСТВА'); ok('«Синхронизировать» забирает актуальное из облака');
  assert.equal(d1.errors.length + d4.errors.length, 0, d1.errors.concat(d4.errors).join('\n')); ok('ошибок нет');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
