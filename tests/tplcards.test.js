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
  // добавить блок в конструкторе (ctx: 'ce' — карточка шаблона, 'td' — карточка проекта)
  const addBlock = async (ctx, type, value, title = '') => { D.querySelector(`.bk-add[data-bkctx="${ctx}"] [data-bkadd="${type}"]`).click(); await wait(30);
    const k = D.querySelectorAll(`.bk-list[data-bkctx="${ctx}"] .bk`).length - 1;
    const v = D.querySelector(`.bk-list[data-bkctx="${ctx}"] [data-bkf="value"][data-bki="${k}"]`); v.value = value; fire(v, 'input');
    if (title){ const t = D.querySelector(`.bk-list[data-bkctx="${ctx}"] [data-bkf="title"][data-bki="${k}"]`); t.value = title; fire(t, 'input'); } return k; };
  const bval = (o, type) => ((o.blocks || o.b || []).find(b => b.type === type) || {}).value;
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100);
  $('[data-settab="templates"]').click(); await wait(100);
  const tpl = LS().templates[0];
  $(`[data-tpl="${tpl.id}"]`).click(); await wait(100);
  const st0 = tpl.stages[0];
  $(`[data-tsubtog="${st0.id}"]`).click(); await wait(100);
  assert.ok($('.tsubs .tsub-add') && $('.set-nav')); ok('шаблон: у этапа раскрываются подэтапы, переключатель настроек на месте');
  const f = $('[data-tsubadd="0"]'); f.querySelector('input').value = 'Тестовый подэтап'; fire(f, 'submit'); await wait(100);
  const rows = [...D.querySelectorAll('.tsub')]; const row = rows.find(r => r.querySelector('input').value === 'Тестовый подэтап');
  assert.ok(row); ok('шаблон: подэтап добавлен');
  row.querySelector('[data-tcard]').click(); await wait(100);
  assert.ok(!$('#ceReg') && !$('#ceVid')); ok('карточка шаблона: отдельных полей «регламент» и «видео» больше нет');
  $('#ceD').value = 'Как делать: по регламенту'; fire($('#ceD'), 'input'); const bad = await addBlock('ce', 'link', 'ftp://bad', 'Регламент'); fire($('#ceForm'), 'submit'); await wait(50);
  assert.ok(/https/.test($('#ceErr').textContent)); ok('карточка: ссылка без https:// не принимается');
  { const v = D.querySelector(`.bk-list[data-bkctx="ce"] [data-bkf="value"][data-bki="${bad}"]`); v.value = 'https://docs.example/reg'; fire(v, 'input'); }
  await addBlock('ce', 'video', 'https://youtu.be/x'); $('#ceC').value = 'Пункт А\n\nПункт Б\nПункт В'; fire($('#ceC'), 'input'); fire($('#ceForm'), 'submit'); await wait(100);
  assert.ok([...D.querySelectorAll('.tcard.on')].some(b => /Карточка · 3 пункта/.test(b.textContent))); ok('карточка: оформлена, 3 пункта чек-листа');
  assert.ok([...D.querySelectorAll('.tcard:not(.on)')].every(b => b.textContent.trim() === '+ Карточка')); ok('карточка: пустые подписаны «+ Карточка»');
  assert.ok(!D.querySelector('[data-move],[data-smove]')); ok('шаблон: стрелок нет, порядок меняется перетаскиванием');
  // перетаскивание подэтапа: «Тестовый подэтап» (последний) — на первое место
  const subsNow = () => [...D.querySelectorAll('.tsub[data-i="0"] input')].map(i => i.value);
  const lastJ = subsNow().length - 1; const g = D.querySelector(`[data-drag="sub"][data-i="0"][data-j="${lastJ}"]`);
  const first = D.querySelector('.tsub[data-i="0"][data-j="0"]');
  const ev = (type, target, y) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  ev('pointerdown', g, 0); ev('pointermove', first, -1e6); ev('pointerup', first, -1e6); await wait(50);
  assert.equal(subsNow()[0], 'Тестовый подэтап'); ok('перетаскивание: подэтап переставлен наверх');
  // клавиатура: стрелка вниз на ручке возвращает его на место
  D.querySelector('[data-drag="sub"][data-i="0"][data-j="0"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(50);
  assert.equal(subsNow()[1], 'Тестовый подэтап'); ok('клавиши ↑ ↓ на ручке тоже переставляют');
  // перетаскивание этапа: второй этап — на первое место
  const names = () => [...D.querySelectorAll('.trow input[data-f="name"]')].map(i => i.value);
  const n0 = names(); const gs = D.querySelector('[data-drag="stage"][data-i="1"]');
  ev('pointerdown', gs, 0); ev('pointermove', D.querySelector('.tstage[data-i="0"] .trow'), -1e6); ev('pointerup', D.querySelector('.tstage[data-i="0"] .trow'), -1e6); await wait(50);
  assert.deepEqual(names().slice(0, 2), [n0[1], n0[0]]); ok('перетаскивание: этапы меняются местами');
  ev('pointerdown', D.querySelector('[data-drag="stage"][data-i="1"]'), 0); ev('pointermove', D.querySelector('.tstage[data-i="0"] .trow'), -1e6); ev('pointerup', D.querySelector('.tstage[data-i="0"] .trow'), -1e6); await wait(50);
  assert.deepEqual(names().slice(0, 2), n0.slice(0, 2)); ok('перетаскивание: вернули как было');
  assert.ok($('#tSave').classList.contains('t-dirty')); ok('шаблон: кнопка «Сохранить» подсвечена, пока не сохранили');
  $('#tSave').click(); await wait(150);
  let L = LS(); const key = tpl.id + '|тестовый подэтап';
  assert.ok(L.cardTpls[key] && L.cardTpls[key].c.length === 3 && bval(L.cardTpls[key], 'link') === 'https://docs.example/reg'); ok('шаблон сохранён: карточка записана');
  assert.ok(L.templates.find(t => t.id === tpl.id).stages[0].subs.some(x => x.name === 'Тестовый подэтап' && !('card' in x))); ok('шаблон: подэтап в шаблоне, карточка хранится отдельно');
  assert.ok($('.set-nav')); ok('шаблон: после сохранения переключатель настроек на месте');

  // новый проект по шаблону получает подэтап и готовую карточку
  $('#newBtn').click(); await wait(100);
  $('#cName').value = 'Проект по шаблону'; $('#cClient').value = 'К'; $('#cTpl').value = tpl.id; fire($('#cTpl'), 'change');
  fire($('#cForm'), 'submit'); await wait(300);
  L = LS(); const np = L.projects.find(p => p.name === 'Проект по шаблону');
  const sub = np.stages[0].subs.find(x => x.name === 'Тестовый подэтап');
  const tk = L.tasks.find(t => t.project_id === np.id && t.substage_id === sub.id);
  assert.ok(tk && tk.checklist.length === 3 && tk.description === 'Как делать: по регламенту' && bval(tk, 'link') === 'https://docs.example/reg' && bval(tk, 'video') === 'https://youtu.be/x'); ok('новый проект: подэтап и карточка скопированы из шаблона');

  // идущий проект получил подэтап и карточку сразу при сохранении шаблона
  const old = L.projects.find(p => p.template_id === tpl.id && p.state === 'active' && p.id !== np.id && p.stages.find(s => s.name === st0.name).status !== 'done');
  const os = old.stages.find(s => s.name === st0.name).subs.find(x => x.name === 'Тестовый подэтап');
  const otk = () => LS().tasks.find(t => t.project_id === old.id && t.substage_id === os.id);
  assert.ok(os && otk() && otk().checklist.length === 3); ok('сохранение шаблона сразу добавило подэтап и карточку в идущий проект');
  assert.ok(!$('#tApply')); ok('отдельная кнопка «Обновить активные проекты» больше не нужна');
  // отмечаем пункт в идущем проекте
  w.openTask(otk().id); await wait(100);
  const ck = D.querySelector('.tk-modal [data-ck]'); ck.checked = true; fire(ck, 'change'); await wait(100); w.closeTask(); await wait(50);
  assert.ok(otk().checklist[0].done);
  // 1) правка карточки в шаблоне доходит до проектов, отметки сохраняются
  $(`[data-tpl="${tpl.id}"]`).click(); await wait(100);
  if (!D.querySelector('.tsub')) { $(`[data-tsubtog="${st0.id}"]`).click(); await wait(100); }
  const rowT = [...D.querySelectorAll('.tsub')].find(r => r.querySelector('input').value === 'Тестовый подэтап');
  rowT.querySelector('[data-tcard]').click(); await wait(100);
  { const k = [...D.querySelectorAll('.bk-list[data-bkctx="ce"] .bk')].findIndex(li => li.querySelector('.bk-type').textContent === 'Видео');
    const v = D.querySelector(`.bk-list[data-bkctx="ce"] [data-bkf="value"][data-bki="${k}"]`); v.value = 'https://youtu.be/dQw4w9WgXcQ'; fire(v, 'input'); }
  $('#ceC').value = 'Пункт А\nПункт Б\nПункт В\nПункт Г'; fire($('#ceC'), 'input'); fire($('#ceForm'), 'submit'); await wait(100);
  $('#tSave').click(); await wait(200);
  let ot = otk();
  assert.equal(bval(ot, 'video'), 'https://youtu.be/dQw4w9WgXcQ'); ok('шаблон → проекты: видео появилось в карточке идущего проекта');
  assert.deepEqual(ot.checklist.map(i => i.text), ['Пункт А', 'Пункт Б', 'Пункт В', 'Пункт Г']); ok('шаблон → проекты: новый пункт чек-листа добавлен');
  assert.ok(ot.checklist[0].done); ok('шаблон → проекты: отмеченный пункт остался отмеченным');
  const ntk = () => LS().tasks.find(t => t.project_id === np.id && t.substage_id === sub.id);
  assert.equal(bval(ntk(), 'video'), 'https://youtu.be/dQw4w9WgXcQ'); ok('шаблон → проекты: и в новом проекте тоже');
  // проекты другого шаблона с тем же подэтапом и завершённый проект этого шаблона
  const tpl2 = LS().templates.find(t => t.id !== tpl.id).id;
  const mk = (id, tplId, state, stStatus, done) => ({ id, name: id, client: 'К', template_id: tplId, pm_id: 'me', start_date: '2026-09-01', deadline: '2026-12-01', state,
    stages: [{ id: id + 's', position: 0, name: st0.name, days: 2, status: stStatus, planned_start: '2026-09-01', due_date: '2026-09-03', started_at: '2026-09-01', completed_at: stStatus === 'done' ? '2026-09-03' : null, subs: [{ id: id + 'x', name: 'Тестовый подэтап', done }] }], log: [] });
  w.mergeSnapshot({ meta: {}, projects: [mk('foreign', tpl2, 'active', 'in_progress', false), mk('closedp', tpl.id, 'completed', 'done', true)],
    tasks: [{ id: 'tforeign', project_id: 'foreign', stage_id: 'foreigns', substage_id: 'foreignx', title: 'Тестовый подэтап', description: 'Своё описание другого шаблона', regulation_link: '', video_url: '', checklist: [{ id: 'f1', text: 'Своё', done: false }] },
            { id: 'tclosed', project_id: 'closedp', stage_id: 'closedps', substage_id: 'closedpx', title: 'Тестовый подэтап', description: 'Старое', regulation_link: '', video_url: '', checklist: [{ id: 'c1', text: 'Старый пункт', done: true }] }] }, { keepDemo: true });
  w.commit(); await wait(100);
  assert.equal(w.cardTplFor({ template_id: tpl2 }, 'Тестовый подэтап'), null); ok('карточка другого шаблона не подставляется в проекты чужого процесса');
  // 2) правка из карточки проекта с галочкой «Сохранить как шаблон» доходит до других проектов
  w.openTask(ntk().id); await wait(100); $('[data-tedit]').click(); await wait(100);
  assert.ok($('#tdTpl').checked && /во всех проектах процесса/.test($('.tpl-check').textContent) && /других процессов не изменятся/.test($('.tpl-check').textContent)); ok('карточка: галочка «Сохранить как шаблон» объясняет, что обновит все проекты');
  const desc = $('#tdDesc') || D.querySelector('[data-td="description"]'); desc.value = 'Новое описание из проекта'; fire(desc, 'input'); fire(desc, 'change');
  assert.ok(!D.querySelector('[data-td="video_url"]') && !D.querySelector('[data-td="regulation_link"]')); ok('карточка проекта: отдельных полей ссылок больше нет');
  { const k = [...D.querySelectorAll('.bk-list[data-bkctx="td"] .bk')].findIndex(li => li.querySelector('.bk-type').textContent === 'Видео');
    const v = D.querySelector(`.bk-list[data-bkctx="td"] [data-bkf="value"][data-bki="${k}"]`); v.value = 'https://vimeo.com/76979871'; fire(v, 'input'); }
  $('#tkForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await wait(200); w.closeTask(); await wait(50);
  ot = otk();
  assert.equal(ot.description, 'Новое описание из проекта'); assert.equal(bval(ot, 'video'), 'https://vimeo.com/76979871'); ok('проект → другие проекты: описание и видео обновились');
  assert.ok(ot.checklist[0].done); ok('проект → другие проекты: отметки сохранились');
  assert.equal(bval(LS().cardTpls[key], 'video'), 'https://vimeo.com/76979871'); ok('проект → шаблон: шаблон карточки обновлён');
  const tf = LS().tasks.find(t => t.id === 'tforeign');
  assert.equal(tf.description, 'Своё описание другого шаблона'); assert.ok(!(tf.blocks || []).length); ok('проект другого шаблона с таким же подэтапом не изменился');
  const tc = LS().tasks.find(t => t.id === 'tclosed');
  assert.equal(bval(tc, 'video'), 'https://vimeo.com/76979871'); assert.equal(tc.description, 'Новое описание из проекта'); ok('завершённый проект этого шаблона: описание и видео обновились');
  assert.deepEqual(tc.checklist.map(i => [i.text, i.done]), [['Старый пункт', true]]); assert.equal(LS().projects.find(p => p.id === 'closedp').stages[0].status, 'done'); ok('завершённый проект: чек-лист и сданный этап не тронуты');
  // 3) пустая карточка не стирает шаблон и другие проекты
  const tplBefore = JSON.stringify(LS().cardTpls[key]);
  const empty = LS().tasks.find(t => t.id === ntk().id); w.openTask(empty.id); await wait(100); $('[data-tedit]').click(); await wait(100);
  { const el = D.querySelector('[data-td="description"]'); el.value = ''; fire(el, 'input'); fire(el, 'change'); }
  while (D.querySelector('.bk-list[data-bkctx="td"] [data-bkdel]')) { D.querySelector('.bk-list[data-bkctx="td"] [data-bkdel]').click(); await wait(20); }
  while (D.querySelector('[data-ckbdel]')) { D.querySelector('[data-ckbdel]').click(); await wait(20); }
  $('#tkForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await wait(200); w.closeTask(); await wait(50);
  assert.equal(JSON.stringify(LS().cardTpls[key]), tplBefore); assert.equal(bval(otk(), 'video'), 'https://vimeo.com/76979871'); ok('пустая карточка не стирает шаблон и карточки в других проектах');
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $('[data-settab="templates"]').click(); await wait(100); $(`[data-tpl="${tpl.id}"]`).click(); await wait(100);
  // правка карточки в шаблоне не перезаписывает карточки в проектах; удаление подэтапа убирает карточку шаблона
  $(`[data-tsubtog="${st0.id}"]`) || null;
  const row2 = [...D.querySelectorAll('.tsub')].find(r => r.querySelector('input').value === 'Тестовый подэтап') || (() => { $(`[data-tsubtog="${st0.id}"]`).click(); return null; })();
  await wait(100);
  const r2 = row2 || [...D.querySelectorAll('.tsub')].find(r => r.querySelector('input').value === 'Тестовый подэтап');
  r2.querySelector('[data-sdel]').click(); await wait(100); $('#tSave').click(); await wait(150);
  L = LS();
  assert.ok(!L.cardTpls[key] && !L.templates.find(t => t.id === tpl.id).stages[0].subs.some(x => x.name === 'Тестовый подэтап')); ok('удалили подэтап из шаблона — его карточка тоже удалена');
  assert.ok(L.tasks.some(t => t.id === tk.id)); ok('карточки в уже созданных проектах остались');
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
