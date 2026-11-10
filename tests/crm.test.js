// CRM-пространство «Блогеры»: тип, «блогер» вместо «проекта», шаблон этапов общения, воронка и фильтр по этапу
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

function openApp(backend, userId, keepStorage, session) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e).slice(0, 200)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://kz.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => backend.client(userId) };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.scrollTo = () => {}; w.IntersectionObserver = w.IntersectionObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (keepStorage) for (const k in keepStorage) w.localStorage.setItem(k, keepStorage[k]);
      if (session) for (const k in session) w.sessionStorage.setItem(k, session[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
(async () => {
  const be = makeBackend();
  const A = 'aaaaaaaa-0000-0000-0000-000000000078';
  const o = openApp(be, A, { 'kz-pick-seen': '1' });
  await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const ls = () => JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));

  // 1) тип пространства → CRM
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="spaces"]').click(); await wait(200);
  assert.ok($('.kind-seg [data-spkind="crm"]')); ok('в переключателе типа есть третий — «CRM»');
  $('.kind-seg [data-spkind="crm"]').click(); await wait(300);
  assert.equal(ls().prefs.kind, 'crm'); ok('тип CRM сохранён');
  const tpl = ls().templates.find(t => t.name === 'CRM: оффер на запуск');
  assert.ok(tpl && tpl.stages.map(s => s.name).join('|') === 'Найден|Первый контакт|Переговоры|Встреча|Оффер отправлен|Условия согласованы|Договор подписан|Запуск'); ok('добавлен шаблон «CRM: оффер на запуск» с этапами от контакта до запуска');
  assert.equal(be.rows.get(`data/users/${A}/spaces/main`)?.data?.kind, 'crm'); ok('тип записан в аккаунт');

  // 2) главная: «Новый блогер», воронка
  D.querySelector('.tabs [data-view="matrix"]').click(); await wait(150);
  assert.equal($('#newBtn').textContent, 'Новый блогер'); ok('кнопка «Новый блогер»');
  assert.ok($('.crm-pf') && /Воронка блогеров/.test($('.crm-pf').textContent)); ok('на главной — воронка блогеров');
  assert.equal(D.querySelectorAll('.crm-funnel [data-crmstage]').length, 8); ok('в воронке 8 этапов');

  // 3) три блогера через форму
  w.eval("db.projects.forEach(p => p.state = 'archived'); db.projects = db.projects.filter(p => false); commit()"); await wait(100);
  const add = async (name) => {
    $('#newBtn').click(); await wait(80);
    assert.equal($('#cTitle').textContent, 'Новый блогер');
    $('#cName').value = name; $('#cClient').value = 'Instagram @' + name.toLowerCase(); fire($('#cForm'), 'submit'); await wait(150);
  };
  await add('Анна');
  await add('Борис'); await add('Вера');
  const ps = ls().projects; assert.equal(ps.length, 3); assert.ok(ps.every(p => p.template_id === tpl.id)); ok('блогеры созданы по шаблону CRM');
  // Борис дошёл до «Переговоры», Вера прошла всё
  w.eval(`(() => { const b = db.projects.find(p => p.name === 'Борис'); b.stages.forEach((s, i) => { s.status = i < 2 ? 'done' : i === 2 ? 'in_progress' : 'not_started'; });
    const v = db.projects.find(p => p.name === 'Вера'); v.stages.forEach(s => s.status = 'done'); syncState(v); commit(); })()`); await wait(150);
  const st = w.eval('JSON.stringify(crmStats())'); const S = JSON.parse(st);
  assert.deepEqual(S.reached, [3, 2, 2, 1, 1, 1, 1, 1]); assert.equal(S.won, 1); ok('воронка: дошли 3 → 2 → 2 → 1…, завершил 1');
  assert.equal(S.at[0], 1); assert.equal(S.at[2], 1); ok('«сейчас» на этапе: Найден 1, Переговоры 1');
  const row2 = $('.crm-funnel [data-crmstage="1"]');
  assert.ok(/67%/.test(row2.textContent)); ok('переход между этапами в процентах (3 → 2 = 67%)');

  // 4) фильтр по этапу
  $('.crm-funnel [data-crmstage="2"]').click(); await wait(150);
  const names = () => [...D.querySelectorAll('.mx .pcol, .mx td.pcol')].map(x => x.textContent).join(' ');
  assert.ok(/Борис/.test(names()) && !/Анна/.test(names())); ok('нажатие на этап показывает только блогеров на нём');
  assert.ok($('.crm-reset')); $('.crm-reset').click(); await wait(150);
  assert.ok(/Анна/.test(names())); ok('«показать всех» снимает фильтр');

  // 5) отказ = архив
  w.eval("db.projects.find(p => p.name === 'Анна').state = 'archived'; commit()"); await wait(150);
  assert.equal(JSON.parse(w.eval('JSON.stringify(crmStats())')).lost, 1); assert.ok(/отказ 1/.test($('.crm-pf').textContent)); ok('блогер в архиве считается отказом');

  // 5б) редактирование воронки: переименовать, добавить, убрать
  $('[data-crmedit]').click(); await wait(100);
  assert.equal(D.querySelectorAll('#crmEd [data-crmname]').length, 8); ok('«Редактировать воронку» открывает список этапов');
  const nm = $('#crmEd [data-crmname="3"]'); nm.value = 'Созвон'; fire(nm, 'input');
  $('#crmEd [data-crmdel="7"]').click(); await wait(80);
  $('#crmEd [data-crmadd]').click(); await wait(80);
  const last = [...D.querySelectorAll('#crmEd [data-crmname]')].pop(); last.value = 'Отчёт по запуску'; fire(last, 'input');
  fire($('#crmEd'), 'submit'); await wait(200);
  const nt = ls().templates.find(x => x.id === tpl.id).stages.map(s => s.name);
  assert.deepEqual(nt, ['Найден', 'Первый контакт', 'Переговоры', 'Созвон', 'Оффер отправлен', 'Условия согласованы', 'Договор подписан', 'Отчёт по запуску']); ok('воронка сохранена: переименован, убран и добавлен этап');
  assert.ok(!$('#crmEd') && D.querySelectorAll('.crm-funnel [data-crmstage]').length === 8 && /Созвон/.test($('.crm-funnel').textContent)); ok('воронка перерисована с новыми этапами');
  const bor = ls().projects.find(p => p.name === 'Борис');
  assert.ok(bor.stages.some(s => s.name === 'Созвон') && bor.stages.some(s => s.name === 'Отчёт по запуску') && !bor.stages.some(s => s.name === 'Запуск')); ok('у блогеров этапы обновились');

  // 6) назад в агентство — воронки нет
  w.eval("db.prefs.kind = 'agency'; render()"); await wait(100);
  assert.ok(!$('.crm-pf')); assert.equal($('#newBtn').textContent, 'Новый проект'); ok('в агентстве воронки нет, кнопка «Новый проект»');

  assert.deepEqual(o.errors, []); ok('без ошибок в консоли');
  console.log(`\n${n} проверок пройдено`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
