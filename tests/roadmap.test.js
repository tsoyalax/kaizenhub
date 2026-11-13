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
  const o = openApp(be, 'aaaaaaaa-0000-0000-0000-000000000061'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  const projN = E('db.projects.length');
  assert.ok($('#rmTab').hidden); ok('в агентстве вкладки «Дорожная карта» нет — остальное приложение как было');
  E(`db.prefs = db.prefs || {}; db.prefs.kind = 'roadmap'; ensureKindTemplate(db, 'roadmap'); ui.view = 'roadmap'; commit();`); await wait(50);
  assert.ok(!$('#rmTab').hidden && $('.rm')); ok('тип «Дорожная карта»: своя вкладка и доска');
  assert.equal(D.querySelectorAll('.rm-pipe .rm-blk').length, 9); assert.equal(D.querySelectorAll('.rm-orbit .rm-blk').length, 3); ok('ядро — 9 этапов воронки, орбита — 3 модуля');
  const names = [...D.querySelectorAll('.rm-pipe .rm-blk b')].map(b => b.textContent);
  assert.deepEqual(names, ['Контент и трафик', 'Статья', 'Кодовое слово', 'Квалификация', 'VSL', 'Трипваер ($50)', 'Созвон с менеджером', 'Дожим после созвона', 'Оплата']); ok('этапы по порядку пути клиента');
  const blk = n => [...D.querySelectorAll('.rm-blk')].find(b => b.querySelector('b').textContent === n);
  assert.ok(/Путь клиента обрывается здесь/.test(blk('Статья').textContent) && blk('Статья').classList.contains('bn-hot')); ok('обрыв пути — на первом незакрытом этапе (Статья)');
  assert.ok(/Узкое горлышко/.test(blk('VSL').textContent) && !/горлышко|обрывается/.test(blk('Кодовое слово').textContent)); ok('VSL в сборке — узкое горлышко, работающий этап — нет');
  // этап: подзадачи двух типов, ответственный, дедлайн, EN
  blk('Статья').click(); await wait(30);
  assert.ok($('.rm-detail') && /Разовые/.test($('.rm-detail').textContent) && /Регулярные/.test($('.rm-detail').textContent)); ok('в этапе — разовые (сборка) и регулярные (поток) задачи');
  assert.ok($('.rm-detail [data-rmf="owner_id"]') && $('.rm-detail [data-rmf="deadline"]') && $('.rm-detail [data-rmen]')); ok('ответственный, дедлайн и [EN]');
  const f1 = $('[data-rmadd="once"]'); f1.querySelector('input').value = 'Согласовать оффер'; fire(f1, 'submit'); await wait(30);
  const f2 = $('[data-rmadd="flow"]'); f2.querySelector('input').value = 'Публикация вне плана'; fire(f2, 'submit'); await wait(30);
  const art = () => E(`JSON.parse(JSON.stringify(rmCur().core[1]))`);
  assert.ok(art().tasks.some(x => x.title === 'Согласовать оффер' && x.kind === 'once') && art().tasks.some(x => x.title === 'Публикация вне плана' && x.kind === 'flow' && x.freq)); ok('добавляются разовые и регулярные задачи');
  const enBefore = E('rmCur().core.filter(b => b.en).length'); const en = $('[data-rmen]'); en.checked = true; fire(en, 'change'); await wait(30);
  assert.equal(E('rmCur().core.filter(b => b.en).length'), enBefore + 1); assert.ok(blk('Статья').querySelector('.rm-en.on')); ok('[EN] отмечается по этапу и считается в сводке');
  $('[data-rmdl="approved"]').click(); await wait(30); assert.equal(art().dlKind, 'approved'); ok('срок этапа: утверждённый / предложенный');
  // закрыть сборку — этап работает, обрыв переходит дальше
  for (const x of art().tasks.filter(t => t.kind === 'once' && !t.done)){ const c = $(`[data-rmdone="${art().id}|${x.id}"]`); c.checked = true; fire(c, 'change'); await wait(20); }
  assert.equal(art().status, 'live'); ok('все разовые задачи закрыты — этап «Работает / На потоке»');
  assert.ok(/Путь клиента обрывается здесь/.test(blk('Квалификация').textContent) && !/обрывается|горлышко/.test(blk('Статья').textContent)); ok('обрыв пути сдвинулся на следующий незакрытый этап');
  // таймлайн и общая дата готовности
  assert.ok($('.rm-gantt') && D.querySelectorAll('.rm-grow .rm-gbar').length === 12 && $('.rm-gtoday')); ok('единый таймлайн: все блоки и линия «Сегодня»');
  assert.ok($('.rm-gbar.approved') && $('.rm-gbar.proposed')); ok('утверждённые и предложенные сроки различаются');
  const ready = E('rmReady(rmCur())'); assert.ok(ready && ready.date === E(`rmBlocks(rmCur()).flatMap(b => [b.deadline, ...rmOnce(b).filter(x => !x.done).map(x => x.due)]).filter(Boolean).sort().at(-1)`)); ok('дата готовности системы — самый поздний срок');
  assert.ok(/готовность системы к запуску/.test($('.rm-sum').textContent)); ok('дата готовности в сводке');
  // шаблон и клонирование
  w.prompt = () => 'Воронка Icon'; $('[data-rmtpl]').click(); await wait(30);
  assert.equal(E('db.prefs.rmTpls.length'), 1); assert.ok(E(`db.prefs.rmTpls[0].core[1].tasks.some(x => x.title === 'Согласовать оффер') && !('done' in db.prefs.rmTpls[0].core[1].tasks[0])`)); ok('«Сохранить как шаблон» — структура без отметок');
  $('[data-rmnew]').click(); await wait(30);
  $('#rmNName').value = 'Запуск Ромы'; $('#rmNFounder').value = 'Рома Рукунов'; $('#rmNTpl').value = E('db.prefs.rmTpls[0].id'); fire($('#rmNewForm'), 'submit'); await wait(50);
  assert.equal(E('rmList().length'), 2); assert.equal(E('rmCur().founder'), 'Рома Рукунов'); ok('новая карта под другого фаундера разворачивается из шаблона');
  assert.ok(E(`rmCur().core[1].tasks.some(x => x.title === 'Согласовать оффер')`) && E(`rmBlocks(rmCur()).every(b => b.status === 'todo' && b.tasks.every(x => !x.done))`)); ok('структура та же, статусы с нуля');
  $('[data-rmclone]').click(); await wait(30); fire($('#rmNewForm'), 'submit'); await wait(50);
  assert.equal(E('rmList().length'), 3); assert.equal(E('rmCur().core.length'), 9); ok('«Клонировать структуру» — в один клик');
  assert.ok($('#rmSel')); const sel = $('#rmSel'); sel.value = E('rmList()[0].id'); fire(sel, 'change'); await wait(30);
  assert.equal(E('rmCur().id'), E('rmList()[0].id')); ok('карты переключаются');
  // хранится в пространстве и не трогает проекты
  const saved = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  assert.equal(saved.prefs.roadmaps.length, 3); assert.equal(saved.projects.length, projN); ok('карты сохранены в пространстве, проекты на месте');
  E(`db.prefs.kind = 'agency'; commit();`); await wait(30);
  assert.ok($('#rmTab').hidden && E('ui.view') === 'matrix'); ok('вернули тип «Агентство» — обычная матрица');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
