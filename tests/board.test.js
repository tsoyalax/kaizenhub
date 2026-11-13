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
  const o = openApp(be, 'aaaaaaaa-0000-0000-0000-000000000081'); await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), E = x => w.eval(x);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  D.getElementById('spPick')?.remove(); E(`layer.innerHTML = ''`);
  const projN = E('db.projects.length');
  assert.ok(/Канбан/.test(E(`KINDS.board[0]`))); ok('тип пространства «Канбан»');
  E(`db.prefs = db.prefs || {}; db.prefs.kind = 'board'; ensureKindTemplate(db, 'board'); ui.view = 'matrix'; commit();`); await wait(50);
  assert.equal(E('ui.view'), 'kanban'); assert.ok($('.b-board')); ok('пространство открывается сразу на доске');
  assert.ok(D.body.classList.contains('kind-board') && $('#filters').hidden); ok('без проектов: матрицы, производства и фильтров проектов нет');
  assert.equal(E('db.projects.filter(p => p.board).length'), 1); ok('одна доска на пространство');
  assert.deepEqual([...D.querySelectorAll('.b-col header b')].map(b => b.textContent), ['Нужно сделать', 'В работе', 'На проверке', 'Готово']); ok('колонки доски');
  assert.equal($('#newBtn').textContent, 'Новый пункт'); ok('кнопка — «Новый пункт»');
  const add = (i, name, due) => { const f = D.querySelectorAll('[data-badd]')[i]; f.elements.namedItem('bname').value = name; f.elements.namedItem('bdue').value = due || ''; fire(f, 'submit'); };
  const T = E('today()'), plus = n => E(`addDays(today(), ${n})`);
  add(0, 'Купить домен', plus(3)); add(0, 'Написать оффер'); add(1, 'Настроить рекламу', plus(-1)); await wait(50);
  const col = i => [...D.querySelectorAll('.b-col')[i].querySelectorAll('.b-item b')].map(b => b.textContent.trim());
  assert.ok(col(0).includes('Купить домен') && col(0).includes('Написать оффер') && col(1).includes('Настроить рекламу')); ok('пункт вбивается прямо в колонку');
  const card = n => [...D.querySelectorAll('.b-item')].find(c => c.querySelector('b').textContent.trim() === n);
  assert.ok(/просрочено/.test(card('Настроить рекламу').textContent) && card('Настроить рекламу').classList.contains('k-late')); ok('срок на карточке, просроченное подсвечено');
  // перенос между колонками и «Готово»
  const key = card('Купить домен').dataset.bsub; const toSid = D.querySelectorAll('.b-col')[3].dataset.bcol;
  E(`moveBoardItem('${key}', '${toSid}')`); await wait(30);
  assert.ok(col(3).includes('Купить домен') && card('Купить домен').classList.contains('done')); ok('перетащили в «Готово» — выполнено');
  // все функции карточки: открывается окно подзадачи (чек-лист, ответственный, материалы)
  card('Написать оффер').click(); await wait(100);
  assert.ok(E('ui.taskId') && $('.modal')); ok('нажатие на пункт — карточка со всеми функциями');
  const tid = E('ui.taskId'); E(`layer.innerHTML = ''; ui.taskId = null`);
  // таймлайн
  $('[data-bmode="timeline"]').click(); await wait(50);
  assert.ok($('.b-gantt') && $('.b-today')); ok('вид «Таймлайн» с линией «Сегодня»');
  assert.ok([...D.querySelectorAll('.b-trow .b-tname b')].some(b => b.textContent === 'Настроить рекламу') && $('.b-bar.k-late')); ok('пункты со сроками — полосами по датам');
  assert.ok(/Без срока/.test($('.b-nodate').textContent) && /Написать оффер/.test($('.b-nodate').textContent)); ok('пункты без срока — списком, срок ставится там же');
  const nd = [...D.querySelectorAll('.b-nd')].find(x => /Написать оффер/.test(x.textContent)).querySelector('input'); nd.value = plus(6); fire(nd, 'change'); await wait(50);
  assert.equal(E(`taskById('${tid}').due_date`), plus(6)); ok('срок пункта = срок его карточки (видно в «Моих задачах»)');
  const st = D.querySelector(`[data-bstart]`); st.value = plus(1); fire(st, 'change'); await wait(30);
  assert.ok(E(`bItems(boardProject()).some(it => it.start === '${plus(1)}')`)); ok('начало пункта меняется в таймлайне');
  E(`db.prefs.kind = 'agency'; ui.view = 'matrix'; commit();`); await wait(30);
  assert.ok(!D.body.classList.contains('kind-board') && E('ui.view') === 'matrix'); ok('тип «Агентство» — всё как раньше');
  assert.deepEqual(o.errors.filter(e => !/Not implemented/.test(e)), []); ok('без ошибок');
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
