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
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000031';
  const o = openApp(be, A);
  await wait(4500);
  const w = o.w;
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const ls = (win, k = 'agency-pipeline-demo-v2') => JSON.parse(win.localStorage.getItem(k));
  // в основном («Icon») — свой шаблон с подэтапом и карточкой подэтапа
  w.eval(`db.templates.push({ id:'tIcon', name:'Reels Icon', stages:[{ id:'a1', name:'Сценарий', days:2, subs:[{ id:'x1', name:'Хук' }] }, { id:'b1', name:'Съёмка', days:1, subs:[] }] });
    db.cardTpls = db.cardTpls || {}; db.cardTpls['tIcon|' + norm('Хук')] = { sub:'Хук', d:'Первые 3 секунды', c:['Проверить хук'], b:[] }; commit();`);
  await wait(3000);
  const sid = await w.eval(`createSpace({ name:'Рома Рукунов', kind:'smm', area:'', copy:false })`); await wait(500);
  assert.ok(sid); ok('создано пустое пространство «Рома Рукунов»');
  assert.ok(!ls(w, `agency-pipeline-demo-v2-${sid}`).templates.some(t => t.name === 'Reels Icon')); ok('в нём шаблона «Reels Icon» нет');
  const store = { 'kz-space': sid, [`agency-pipeline-demo-v2-${sid}`]: w.localStorage.getItem(`agency-pipeline-demo-v2-${sid}`), 'agency-mode': 'owner', 'kz-pick-seen': '1' };
  o.w.close();
  const o2 = openApp(be, A, 'https://kz.test/', {}, store); await wait(4000);
  const w2 = o2.w, D = w2.document, $ = s => D.querySelector(s);
  D.getElementById('spPick')?.remove();
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="templates"]').click(); await wait(200);
  assert.ok($('[data-tplimport]')); ok('в «Шаблонах» есть кнопка «Из другого пространства»');
  $('[data-tplimport]').click(); await wait(100);
  const srcs = [...D.querySelectorAll('[data-tisrc]')].map(b => b.dataset.tisrc);
  assert.ok(srcs.includes('main') && srcs.includes('preset') && !srcs.includes(sid)); ok('список: другие пространства и «Готовые», без открытого');
  $('[data-tisrc="main"]').click(); await wait(600);
  const items = [...D.querySelectorAll('.ti-item')].map(x => x.textContent);
  assert.ok(items.some(x => /Reels Icon/.test(x) && /Сценарий → Съёмка/.test(x))); ok('шаблоны выбранного пространства с этапами');
  const idx = items.findIndex(x => /Reels Icon/.test(x)); const cb = D.querySelector(`[data-tisel="${idx}"]`);
  cb.checked = true; fire(cb, 'change'); await wait(50);
  assert.ok(/Добавить \(1\)/.test($('[data-tido]').textContent)); $('[data-tido]').click(); await wait(300);
  const sp = ls(w2, `agency-pipeline-demo-v2-${sid}`);
  const t = sp.templates.find(x => x.name === 'Reels Icon');
  assert.ok(t && t.id !== 'tIcon' && t.stages.length === 2 && t.stages[0].subs[0].name === 'Хук'); ok('шаблон скопирован с этапами и подэтапами (новый id)');
  assert.equal(sp.cardTpls[`${t.id}|${w2.eval('norm("Хук")')}`]?.d, 'Первые 3 секунды'); ok('карточка подэтапа скопирована');
  assert.ok($('.tpl-item[aria-current="true"]')?.textContent.includes('Reels Icon')); ok('добавленный шаблон открыт в редакторе');
  const mainT = (await w2.eval(`loadSpaceTemplates('')`)).tpls.find(x => x.id === 'tIcon'); assert.ok(mainT && mainT.name === 'Reels Icon'); ok('оригинал в «Icon» не тронут');
  // готовые
  $('[data-tplimport]').click(); await wait(100); $('[data-tisrc="preset"]').click(); await wait(100);
  const pi = [...D.querySelectorAll('.ti-item')].findIndex(x => /CRM/.test(x.textContent)); const pc = D.querySelector(`[data-tisel="${pi}"]`);
  pc.checked = true; fire(pc, 'change'); $('[data-tido]').click(); await wait(200);
  assert.ok(ls(w2, `agency-pipeline-demo-v2-${sid}`).templates.some(x => x.name === 'CRM: оффер на запуск')); ok('готовый шаблон CRM добавляется');
  // повтор того же — с пометкой источника
  $('[data-tplimport]').click(); await wait(100); $('[data-tisrc="main"]').click(); await wait(600);
  const i2 = [...D.querySelectorAll('.ti-item')].findIndex(x => /Reels Icon/.test(x.textContent)); const c2 = D.querySelector(`[data-tisel="${i2}"]`);
  c2.checked = true; fire(c2, 'change'); $('[data-tido]').click(); await wait(200);
  assert.ok(ls(w2, `agency-pipeline-demo-v2-${sid}`).templates.some(x => x.name === 'Reels Icon (Основное)')); ok('одноимённый получает пометку пространства');
  assert.deepEqual(o2.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
