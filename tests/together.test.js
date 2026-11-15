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
// Инфобизнес: таймлайн «Вместе» — несколько инфоповодов на одной шкале, пересечения по дням
(async () => {
  const be = makeBackend(); const o = openApp(be, 'aaaaaaaa-0000-0000-0000-0000000000c1'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  E(`db.prefs = db.prefs || {}; db.prefs.kind = 'info'; ensureInfoTemplate(db); db.projects = db.projects.filter(p => p.template_id !== INFO_TPL_ID && p.id !== INFO_BOARD_ID);
     window.T = today(); window.ig = createInfoBoard('Блок Игоря', addDays(T, -5)); window.em = createInfoBoard('Челлендж Эма', addDays(T, -2));
     const fill = (p, list) => list.forEach(([st, name, d]) => { const s = p.stages[st]; (s.subs = s.subs || []).push({ id:uid(), name, done:false, due_date:addDays(T, d) }); });
     fill(ig, [[0, 'Оффер', 1], [1, 'Рилс 1', 2], [2, 'Эфир', 6]]); fill(em, [[1, 'Анонс челленджа', 2], [3, 'Старт', 9]]);
     ui.view = 'production'; ui.prodProject = ig.id; ui.infoMode = 'board'; commit();`); await wait(100);
  assert.ok($('[data-infomode="together"]')); ok('у доски инфоповода — вид «Вместе»');
  $('[data-infomode="together"]').click(); await wait(100);
  assert.ok($('.tg-tl') && D.querySelectorAll('.tg-lane').length === 2); ok('«Вместе»: блок Игоря и челлендж Эма — две полосы на одной шкале');
  assert.equal(D.querySelectorAll('.tg-task').length, 5); ok('задачи обоих инфоповодов на таймлайне');
  const crossDay = E(`addDays(T, 2)`);
  assert.equal(D.querySelectorAll('.tg-cross').length, 1); assert.ok(new RegExp(E(`fmt('${crossDay}')`)).test($('.tg-sum').textContent)); ok('день, где задачи пересекаются, подсвечен и назван');
  assert.ok($('.tg-cnt.x')); ok('в строке «Пересечения» — сколько задач у каждого');
  assert.ok(!$('[data-infomode="board"]').getAttribute('aria-pressed').includes('true')); ok('выбран только вид «Вместе»');
  // снять челлендж Эма — остаётся одна полоса, пересечений нет
  [...D.querySelectorAll('[data-tgp]')].find(b => /Эма/.test(b.textContent)).click(); await wait(50);
  assert.equal(D.querySelectorAll('.tg-lane').length, 1); assert.equal(D.querySelectorAll('.tg-cross').length, 0); ok('инфоповод можно убрать со шкалы');
  // клик по задаче другого инфоповода — её карточка
  [...D.querySelectorAll('[data-tgp]')].find(b => /Эма/.test(b.textContent)).click(); await wait(50);
  [...D.querySelectorAll('.tg-task')].find(b => /Старт/.test(b.textContent)).click(); await wait(100);
  assert.ok(E('ui.taskId') && E(`taskById(ui.taskId).project_id`) === E('em.id')); ok('клик по задаче Эма открывает её карточку');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
