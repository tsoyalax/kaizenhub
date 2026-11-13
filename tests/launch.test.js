// Шаблоны из другого пространства: выбрать пространство → отметить шаблоны → копия с этапами, подэтапами и карточками
const fs = require('fs'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeBackend } = require('./fake-supabase');
const root = __dirname + '/../';
let html = fs.readFileSync(root + 'launch/index.html', 'utf8');
const shim = fs.readFileSync(root + 'claude-shim.js', 'utf8'), cfg = fs.readFileSync(root + 'config.js', 'utf8');
html = html
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>/* supabase подставляется тестом */</script>')
  .replace('<script src="/config.js"></script>', '<script>' + cfg + '</script>')
  .replace('<script src="/claude-shim.js"></script>', '<script>' + shim + '</script>');
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('PASS ' + m); };

function openApp(backend, userId, url = 'https://kz.test/launch/', extra, keepStorage) {
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
  const o = openApp(be, A); await wait(3500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const row = () => be.rows.get(`data/users/${A}/launch/igor`)?.data?.board;
  assert.equal($('h1').textContent, 'Воронка Игоря'); ok('отдельная страница: «Воронка Игоря»');
  assert.equal(D.querySelectorAll('.stage').length, 8); assert.equal(D.querySelectorAll('.proj').length, 5); ok('8 этапов воронки и 5 проектов вокруг, как в артефакте');
  await wait(800);
  assert.ok(row() && row().stages.length === 8); ok('воронка сохранена в аккаунте KaizenHub (data/users/<id>/launch)');
  assert.ok(/Сохранено в KaizenHub/.test($('#sync').textContent)); ok('видно, что сохранено в KaizenHub');
  // задача: исполнитель и сроки
  $('[data-addtask="stage|article"]').click(); await wait(30);
  $('#tkT1').value = 'Добавить кейсы в статью'; $('#tkWho').value = 'Юля'; $('#tkStart').value = '2026-11-20'; $('#tkDue').value = '2026-12-01';
  $('#tkFx').checked = true; fire($('#tkForm'), 'submit'); await wait(800);
  const t = row().stages.find(s => s.id === 'article').todo.find(x => x.t === 'Добавить кейсы в статью');
  assert.ok(t && t.who === 'Юля' && t.due === '2026-12-01' && t.start && t.fx); ok('задача: исполнитель, начало, срок, «утверждён» — сохраняются');
  assert.ok([...D.querySelectorAll('[data-task]')].some(b => /Добавить кейсы в статью/.test(b.textContent) && /Юля/.test(b.textContent) && /1 дек/.test(b.textContent))); ok('на карточке видно исполнителя и срок');
  // просроченная — в колокольчике
  const k = w.kzLaunch; const b = k.board(); b.stages[1].todo[0].due = '2020-01-01'; k.save(); k.render(); await wait(50);
  assert.ok(!$('#bellN').hidden && +$('#bellN').textContent >= 1); ok('колокольчик считает просроченные и задачи на сегодня');
  $('#bellBtn').click(); await wait(30);
  assert.ok(/Просрочено/.test($('#drop').textContent) && /Докрутить новую статью/.test($('#drop').textContent)); ok('в колокольчике — список просроченного');
  const sel = $('#bellWho'); sel.value = 'Алексей'; fire(sel, 'change'); await wait(30);
  assert.ok(!/Докрутить новую статью/.test($('#drop').textContent)); ok('фильтр по исполнителю');
  $('#drop [data-task]')?.click(); D.body.click(); await wait(30);
  // напоминание
  D.querySelector('[data-task]').click(); await wait(30);
  const tg = [...D.querySelectorAll('.send a')].find(a => /Telegram/.test(a.textContent));
  assert.ok(tg && /t\.me\/share/.test(tg.href) && /%D0%9D%D0%B0%D0%BF%D0%BE%D0%BC%D0%B8%D0%BD%D0%B0%D0%BD%D0%B8%D0%B5/.test(tg.href)); ok('«Напомнить исполнителю»: Telegram / WhatsApp с готовым текстом');
  D.querySelector('[data-close]').click();
  // отдел контента: план / факт рилсов
  assert.ok($('#cd') && /Рилсы: план \/ факт/.test($('#cd').textContent)); ok('отдел контента: рилсы план / факт');
  const wk = w.eval('kzLaunch.S.wk'); const before = k.weekStats(b.content, wk);
  const plan = b.content.reels.find(x => x.st !== 'pub' && D.querySelector(`[data-rst="${x.id}|pub"]`));
  D.querySelector(`[data-rst="${plan.id}|pub"]`).click(); await wait(50);
  const after = k.weekStats(k.board().content, wk);
  assert.equal(after.fact, before.fact + 1); ok('«Вышел» — факт недели растёт');
  const f = $('#reelAdd'); f.elements.namedItem('title').value = 'Рилс про Porsche'; fire(f, 'submit'); await wait(50);
  assert.equal(k.weekStats(k.board().content, wk).plan, after.plan + 1); ok('новый рилс добавляет в план');
  const inp = D.querySelector(`[data-fact="${wk}|posts"]`); inp.value = '4'; fire(inp, 'change'); await wait(50);
  assert.equal(k.board().content.facts[wk].posts, 4); ok('посты и сторис: факт по неделе вводится в таблице');
  assert.ok(/Рилсы на этой неделе/.test(D.querySelector('.stage').textContent)); ok('на этапе «Контент» — план / факт этой недели');
  // статус этапа и редактирование
  const pill = D.querySelector('[data-cycle="vsl"]'); pill.click(); await wait(30);
  assert.equal(k.board().stages.find(s => s.id === 'vsl').s, 'part'); ok('статус этапа меняется нажатием');
  $('#editBtn').click(); await wait(30); assert.ok(D.querySelector('[data-sf="vsl|name"]')); ok('режим «Редактировать»: этапы, «есть», проекты, вопросы');
  $('#editBtn').click(); await wait(900);
  // новая воронка и повторное открытие — данные из аккаунта
  w.prompt = () => 'Воронка Ромы'; D.querySelector('[data-newboard]').click(); await wait(900);
  assert.equal(k.S.boards.length, 2); ok('можно завести ещё воронку');
  const ids = [...be.rows.keys()].filter(p => p.startsWith(`data/users/${A}/launch/`)); assert.equal(ids.length, 2); ok('каждая воронка — свой документ');
  o.w.close();
  const o2 = openApp(be, A); await wait(3500);
  const k2 = o2.w.kzLaunch; const ig = k2.S.boards.find(x => x.id === 'igor');
  assert.ok(ig.stages.find(s => s.id === 'article').todo.some(x => x.t === 'Добавить кейсы в статью' && x.who === 'Юля')); ok('на другом устройстве всё на месте (из аккаунта)');
  assert.deepEqual([...o.errors, ...o2.errors].filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
