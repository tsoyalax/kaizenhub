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
  const A = 'aaaaaaaa-0000-0000-0000-000000000071';
  const o = openApp(be, A); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  const row = () => be.rows.get(`data/users/${A}/launch/igor`)?.data?.board;
  const tab = D.querySelector('.tabs [data-view="launch"]');
  assert.ok(tab && !tab.hidden && /Воронка/.test(tab.textContent)); ok('пункт «Воронка» в меню приложения');
  const projN = E('db.projects.length');
  tab.click(); await wait(600);
  assert.ok($('.ln') && /Воронка Игоря/.test($('.ln-head').textContent)); ok('раздел внутри KaizenHub: «Воронка Игоря»');
  assert.equal(D.querySelectorAll('.ln-stage').length, 8); assert.equal(D.querySelectorAll('.ln-proj').length, 5); ok('8 этапов воронки и 5 проектов вокруг');
  assert.ok($('.ln-stage .pill.st-pill.s-yellow') && $('.ln-stage .pill.st-pill.s-green') && $('.ln-stage .pill.st-pill.s-red')); ok('статусы — плашки приложения');
  await wait(800);
  assert.ok(row() && row().stages.length === 8); ok('воронка в аккаунте: data/users/<id>/launch');
  // задача: исполнитель, начало, срок
  $('[data-lnadd="stage|article"]').click(); await wait(30);
  assert.ok($('#lnForm') && $('.modal')); ok('окно задачи — модалка приложения');
  $('#lnT1').value = 'Добавить кейсы в статью'; $('#lnWho').value = 'Юля'; $('#lnStart').value = '2026-11-20'; $('#lnDue').value = '2026-12-01'; $('#lnFx').checked = true;
  fire($('#lnForm'), 'submit'); await wait(800);
  const t = row().stages.find(x => x.id === 'article').todo.find(x => x.t === 'Добавить кейсы в статью');
  assert.ok(t && t.who === 'Юля' && t.start === '2026-11-20' && t.due === '2026-12-01' && t.fx); ok('исполнитель, начало и срок задачи сохраняются');
  assert.ok([...D.querySelectorAll('[data-lntask]')].some(b => /Добавить кейсы/.test(b.textContent) && /Юля/.test(b.textContent))); ok('на этапе видно исполнителя и срок');
  // уведомления: просрочено — в блоке «Сроки» и в колокольчике приложения
  E(`lnBoard().stages[1].todo[0].due = '2020-01-01'; lnSave(); render();`); await wait(50);
  assert.ok(/Просрочено/.test($('.ln-hot').textContent) && /Докрутить новую статью/.test($('.ln-hot').textContent)); ok('блок «Сроки»: просрочено и на сегодня');
  const sel = $('[data-lnwho]'); sel.value = 'Алексей'; fire(sel, 'change'); await wait(30);
  assert.ok(!/Докрутить новую статью/.test($('.ln-hot').textContent)); ok('фильтр сроков по исполнителю');
  E('LN.who = ""; render(); openBell()'); await wait(30);
  assert.ok(/Воронка: сроки/.test($('.pop').textContent) && /Докрутить новую статью/.test($('.pop').textContent)); ok('колокольчик приложения показывает сроки воронки');
  $('.pop [data-lntask]').click(); await wait(30);
  assert.ok($('#lnForm') && /Докрутить/.test($('#lnT1').value)); ok('из колокольчика открывается задача');
  const tg = [...D.querySelectorAll('.send-row a')].find(a => /Telegram/.test(a.textContent));
  assert.ok(tg && /t\.me\/share/.test(tg.href)); ok('«Напомнить исполнителю» — Telegram / WhatsApp');
  E(`layer.innerHTML = ''`);
  // отдел контента
  assert.ok($('#lnCd') && /рилсы план \/ факт/.test($('#lnCd').textContent)); ok('отдел контента: рилсы план / факт');
  const wk = E('LN.wk'); const before = E(`lnWeekStats(lnBoard().content, '${wk}')`);
  const id = E(`lnBoard().content.reels.find(r => r.st !== 'pub' && lnInWeek(r.date, '${wk}')).id`);
  $(`[data-lnrst="${id}|pub"]`).click(); await wait(50);
  assert.equal(E(`lnWeekStats(lnBoard().content, '${wk}')`).fact, before.fact + 1); ok('«Вышел» — факт недели растёт');
  const f = $('#lnReelAdd'); f.elements.namedItem('rtitle').value = 'Рилс про Porsche'; fire(f, 'submit'); await wait(50);
  assert.equal(E(`lnWeekStats(lnBoard().content, '${wk}')`).plan, before.plan + 1); ok('новый рилс — в план');
  const inp = $(`[data-lnfact="${wk}|posts"]`); inp.value = '4'; fire(inp, 'change'); await wait(50);
  assert.equal(E(`lnBoard().content.facts['${wk}'].posts`), 4); ok('посты и сторис — план и факт по неделям');
  assert.ok(/Рилсы на этой неделе/.test(D.querySelector('.ln-stage').textContent)); ok('на этапе «Контент» — план / факт недели');
  // статус и редактирование
  $('[data-lncycle="vsl"]').click(); await wait(30); assert.equal(E(`lnBoard().stages.find(x => x.id === 'vsl').s`), 'part'); ok('статус этапа меняется нажатием');
  $('[data-lnedit]').click(); await wait(30); assert.ok($('[data-lnsf="vsl|name"]')); ok('«Редактировать»: этапы, «есть», проекты, вопросы');
  $('[data-lnedit]').click(); await wait(900);
  // проекты не тронуты, другое устройство видит воронку
  assert.equal(E('db.projects.length'), projN); ok('проекты KaizenHub не тронуты');
  o.w.close();
  const o2 = openApp(be, A); await wait(4500); o2.w.document.getElementById('spPick')?.remove();
  o2.w.eval(`layer.innerHTML = ''; ui.view = 'launch'; render();`); await wait(600);
  assert.ok(o2.w.eval(`lnBoard().stages.find(x => x.id === 'article').todo.some(x => x.t === 'Добавить кейсы в статью' && x.who === 'Юля')`)); ok('на другом устройстве всё на месте');
  assert.deepEqual([...o.errors, ...o2.errors].filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
