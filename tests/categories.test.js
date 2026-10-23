// Запуск настоящего index.html с «переходником» и имитацией Supabase
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
  const be = makeBackend();
  const o = openApp(be, 'aaaaaaaa-0000-0000-0000-000000000001');
  await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), LS = () => JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const heads = () => [...D.querySelectorAll('#app .grp > h2')].map(h => h.childNodes[h.childNodes.length - 2]?.textContent?.trim() || h.textContent.replace(/\s*\d+$/, '').trim());
  // без категорий главная группирует по процессу
  D.querySelector('[data-view="matrix"]').click(); await wait(100);
  assert.equal($('#group').value, 'template'); ok('пока категорий нет — группировка по процессу');
  // раздел «Категории» в настройках
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="categories"]').click(); await wait(100);
  assert.ok($('#catAdd') && $('.set-nav [data-settab="categories"][aria-pressed="true"]')); ok('настройки: раздел «Категории»');
  for (const n of ['Инфобизнес', 'Медицина', 'Личные бренды']) { $('#catNew').value = n; fire($('#catAdd'), 'submit'); await wait(50); }
  $('#catNew').value = 'медицина'; fire($('#catAdd'), 'submit'); await wait(50);
  let L = LS();
  assert.deepEqual(L.categories.map(c => c.name), ['Инфобизнес', 'Медицина', 'Личные бренды']); ok('категории созданы, дубль не добавился');
  const ren = $(`[data-catname="${L.categories[2].id}"]`); ren.value = 'Эксперты'; fire(ren, 'change'); await wait(50);
  L = LS(); assert.equal(L.categories[2].name, 'Эксперты'); assert.ok(!D.querySelector('.cat-col,[data-catcolor]')); ok('категорию можно переименовать; выбора цвета нет');
  const pe = (type, el, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  pe('pointerdown', $('[data-catdrag="2"]'), 0); pe('pointermove', $('.cat-list [data-cat="0"]'), -1e6); pe('pointerup', $('.cat-list [data-cat="0"]'), -1e6); await wait(50);
  L = LS(); assert.deepEqual(L.categories.map(c => c.name), ['Эксперты', 'Инфобизнес', 'Медицина']); ok('порядок категорий меняется перетаскиванием');
  const [cE, cI, cM] = L.categories;
  // создание проекта с категорией
  $('#newBtn').click(); await wait(100);
  assert.ok($('#cCat')); $('#cName').value = 'Клиника Х'; $('#cClient').value = 'Х'; $('#cCat').value = cM.id;
  fire($('#cForm'), 'submit'); await wait(200);
  const px = LS().projects.find(p => p.name === 'Клиника Х'); assert.equal(px.category_id, cM.id); ok('при создании проекта можно выбрать категорию');
  // назначить категорию в карточке проекта
  const p2 = LS().projects.find(p => p.state === 'active' && p.id !== px.id);
  w.openProject(p2.id); await wait(100); $('[data-dedit="1"]').click(); await wait(50);
  const pc = $('#pCat'); assert.ok(pc); pc.value = cI.id; fire(pc, 'change'); await wait(100);
  assert.equal(LS().projects.find(p => p.id === p2.id).category_id, cI.id); ok('в карточке проекта категорию можно поменять');
  w.closeLayer(); await wait(50);
  // главная: группы по категориям в порядке настроек, «Без категории» в конце
  D.querySelector('[data-view="matrix"]').click(); await wait(150);
  assert.equal($('#group').value, 'category'); ok('главная: по умолчанию группировка по категориям');
  const hs = [...D.querySelectorAll('#app .grp > h2')].map(h => h.textContent);
  assert.ok(/^Инфобизнес/.test(hs[0]) && /^Медицина/.test(hs[1]) && /^Без категории/.test(hs[2]) && hs.length === 3); ok('главная: «Инфобизнес», «Медицина», затем «Без категории»; пустая «Эксперты» не показана');
  assert.ok(!D.querySelector('#app .grp > h2 .cat-dot')); ok('главная: группы без цветовой маркировки');
  const btns = [...D.querySelectorAll('#density button')]; const comp = btns.find(b => /Компакт/.test(b.textContent)); comp?.click(); await wait(100);
  assert.ok(/^Инфобизнес/.test(D.querySelector('#app .grp > h2').textContent)); ok('главная (компактный вид): тоже по категориям');
  $('#group').value = 'template'; fire($('#group'), 'change'); await wait(100);
  assert.ok(![...D.querySelectorAll('#app .grp > h2')].some(h => /Без категории/.test(h.textContent))); ok('группировку можно переключить обратно на процесс');
  $('#group').value = 'category'; fire($('#group'), 'change'); await wait(100);
  // удаление категории с проектами
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $('[data-settab="categories"]').click(); await wait(100);
  $(`[data-catdel="${cM.id}"]`).click(); await wait(50); $('#cfmOk').click(); await wait(100);
  L = LS(); assert.ok(!L.categories.some(c => c.id === cM.id) && !L.projects.find(p => p.id === px.id).category_id); ok('удалили категорию — её проекты остались, но без категории');
  await wait(2500); assert.ok(JSON.parse(be.rows.get('data/users/aaaaaaaa-0000-0000-0000-000000000001/meta').data.json).categories.length === 2); ok('категории сохраняются в аккаунте');
  // открытая вкладка со старой версией перезаписала данные без категорий — категории не теряются
  const mk = 'data/users/aaaaaaaa-0000-0000-0000-000000000001/meta';
  const meta = JSON.parse(be.rows.get(mk).data.json); delete meta.categories; meta.futureField = 'из будущей версии'; meta.savedAt = Date.now() + 1000;
  be.put(mk, { ...be.rows.get(mk).data, json: JSON.stringify(meta) }); be.emit(be.rows.get(mk)); await wait(1500);
  assert.equal(LS().categories.length, 2); ok('данные от старой версии без категорий не стирают категории');
  w.commit(); await wait(2500);
  const m2 = JSON.parse(be.rows.get(mk).data.json);
  assert.equal(m2.categories.length, 2); assert.equal(m2.futureField, 'из будущей версии'); ok('при следующем сохранении категории записаны обратно, незнакомые поля сохранены');
  // второе устройство: категории и назначения подтягиваются из аккаунта
  const o2 = openApp(be, 'aaaaaaaa-0000-0000-0000-000000000001'); await wait(3500);
  const L2 = JSON.parse(o2.w.localStorage.getItem('agency-pipeline-demo-v2'));
  assert.deepEqual(L2.categories.map(c => c.name), ['Эксперты', 'Инфобизнес']); assert.equal(L2.projects.find(p => p.id === p2.id).category_id, cI.id); ok('второе устройство: категории и назначения на месте');
  o2.w.document.querySelector('[data-view="matrix"]').click(); await wait(100);
  assert.ok(/^Инфобизнес/.test(o2.w.document.querySelector('#app .grp > h2').textContent)); ok('второе устройство: главная тоже по категориям');
  o2.w.close();
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
