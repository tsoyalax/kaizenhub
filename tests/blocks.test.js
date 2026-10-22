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
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const o = openApp(be, A);
  await wait(4500);
  const w = o.w, D = w.document, $ = s => D.querySelector(s), LS = () => JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  const opened = []; w.open = () => { const win = { location: '', close() {} }; opened.push(win); return win; };
  // карточка подэтапа в проекте A и такая же в проекте B того же шаблона
  let L = LS();
  const pairs = L.tasks.map(t => ({ t, p: L.projects.find(p => p.id === t.project_id) })).filter(x => x.p && x.p.state === 'active');
  const T1 = pairs.find(x => pairs.some(y => y.p.id !== x.p.id && y.p.template_id === x.p.template_id && y.t.title === x.t.title));
  const pA = T1.p, sub = T1.t.title, tpl = pA.template_id;
  w.openTask(T1.t.id); await wait(100); $('[data-tedit]').click(); await wait(100);
  assert.ok($('.bk-field [data-bkadd="text"]') && $('[data-bkadd="file"]') && $('[data-bkadd="video"]') && $('[data-bkadd="link"]')); ok('редактирование: можно добавить блоки «Текст», «Ссылка», «Видео», «Файл»');
  const add = async type => { $(`.bk-add [data-bkadd="${type}"]`).click(); await wait(50); return D.querySelectorAll('.bk-list[data-bkctx="td"] .bk').length - 1; };
  const setF = (k, f, v) => { const el = $(`.bk-list[data-bkctx="td"] [data-bkf="${f}"][data-bki="${k}"]`); el.value = v; fire(el, 'input'); };
  let k = await add('text'); setF(k, 'title', 'ТЗ дизайнеру'); setF(k, 'value', 'Сделать 3 варианта баннера');
  k = await add('link'); setF(k, 'title', 'Макеты'); setF(k, 'value', 'https://figma.com/file/abc');
  k = await add('video'); setF(k, 'value', 'https://youtu.be/dQw4w9WgXcQ');
  k = await add('file');
  const fin = $(`.bk-list[data-bkctx="td"] [data-bkfile="${k}"]`); const file = new w.File(['%PDF-1.4 test'], 'Бриф клиента.pdf', { type: 'application/pdf' });
  Object.defineProperty(fin, 'files', { value: [file] }); fire(fin, 'change'); await wait(200);
  const up = [...be.storage.keys()];
  assert.ok(up.length === 1 && up[0].startsWith(`${A}/p/${pA.id}/`) && up[0].endsWith('Бриф_клиента.pdf')); ok('файл: загружен в закрытое хранилище, в папку проекта');
  assert.ok(/Бриф клиента\.pdf/.test($('.bk-list .fchip').textContent)); ok('файл: в конструкторе видно имя и размер');
  await add('text');   // пустой блок — не сохранится
  // перестановка: «Макеты» наверх
  const pe = (type, el, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  pe('pointerdown', $('.bk-list[data-bkctx="td"] [data-bkdrag="1"]'), 0); pe('pointermove', $('.bk-list[data-bkctx="td"] [data-bk="0"]'), -1e6); pe('pointerup', $('.bk-list[data-bkctx="td"] [data-bk="0"]'), -1e6); await wait(50);
  assert.equal($('.bk-list[data-bkctx="td"] [data-bk="0"] [data-bkf="title"]').value, 'Макеты'); ok('блоки: переставляются перетаскиванием');
  // неверная ссылка в блоке
  setF(0, 'value', 'figma.com'); fire($('#tkForm'), 'submit'); await wait(50);
  assert.ok(/https/.test($('#tdErr').textContent)); ok('блоки: ссылка без https:// не сохраняется');
  setF(0, 'value', 'https://figma.com/file/abc');
  assert.ok($('#tdTpl').checked); fire($('#tkForm'), 'submit'); await wait(300);
  const t1 = LS().tasks.find(t => t.id === T1.t.id);
  assert.deepEqual(t1.blocks.map(b => b.type), ['link', 'text', 'video', 'file']); ok('сохранение: 4 блока в нужном порядке, пустой блок отброшен');
  const heads = [...D.querySelectorAll('.tk-modal .bk-v h3')].map(h => h.textContent);
  assert.deepEqual(heads, ['Макеты', 'ТЗ дизайнеру', 'Видео', 'Файл']); ok('просмотр: блоки показаны в карточке по порядку');
  assert.ok($('.tk-modal .bk-v a[href="https://figma.com/file/abc"]') && $('.tk-modal .bk-v .vthumb') && /Сделать 3 варианта/.test(D.querySelector('.tk-modal').textContent)); ok('просмотр: ссылка, видео-миниатюра и текст на месте');
  $('.tk-modal [data-fopen]').click(); await wait(100);
  assert.ok(opened.length && /^https:\/\/files\.test\/.+\?token=1$/.test(opened[0].location)); ok('файл: открывается по временной ссылке');
  await wait(300);
  // шаблон и другие проекты процесса
  L = LS(); const key = tpl + '|' + sub.toLowerCase().trim();
  const cb = L.cardTpls[key].b;
  assert.equal(cb.length, 4); ok('шаблон: блоки сохранены в шаблон карточки');
  assert.ok(cb[3].path.includes(`/t/${tpl}/`) && (be.copies || []).length === 1); ok('файл: скопирован в папку шаблона, чтобы его видели участники других проектов');
  const others = L.tasks.filter(t => t.title === sub && t.id !== T1.t.id && L.projects.find(p => p.id === t.project_id && p.template_id === tpl && p.state === 'active'));
  assert.ok(others.length && others.every(t => (t.blocks || []).length === 4 && t.blocks[3].path === cb[3].path)); ok(`проекты шаблона (${others.length}): получили те же блоки и ссылку на файл`);
  const foreign = L.tasks.filter(t => t.title === sub && L.projects.find(p => p.id === t.project_id && p.template_id !== tpl));
  assert.ok(foreign.every(t => !(t.blocks || []).length)); ok('проекты других шаблонов не изменились');
  w.closeTask(); await wait(50);
  // блоки в «Настройки → Шаблоны»
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $('[data-settab="templates"]').click(); await wait(100);
  $(`[data-tpl="${tpl}"]`).click(); await wait(100);
  const stIdx = L.templates.find(t => t.id === tpl).stages.findIndex(s => (s.subs || []).some(x => x.name.toLowerCase() === sub.toLowerCase()));
  $(`[data-tsubtog="${L.templates.find(t => t.id === tpl).stages[stIdx].id}"]`).click(); await wait(100);
  const row = [...D.querySelectorAll('.tsub')].find(r => r.querySelector('input').value.toLowerCase() === sub.toLowerCase());
  assert.ok(/4 пункт|Карточка/.test(row.querySelector('.tcard').textContent)); row.querySelector('[data-tcard]').click(); await wait(100);
  assert.equal(D.querySelectorAll('.bk-list[data-bkctx="ce"] .bk').length, 4); ok('шаблон: в редакторе карточки шаблона видны те же блоки');
  $('.bk-add[data-bkctx="ce"] [data-bkadd="text"]').click(); await wait(50);
  const ce = D.querySelectorAll('.bk-list[data-bkctx="ce"] .bk').length - 1;
  const cev = $(`.bk-list[data-bkctx="ce"] [data-bkf="value"][data-bki="${ce}"]`); cev.value = 'Новый блок из шаблона'; fire(cev, 'input');
  const cef = $('.bk-add[data-bkctx="ce"] [data-bkadd="file"]'); cef.click(); await wait(50);
  const ceFile = $(`.bk-list[data-bkctx="ce"] [data-bkfile="${ce + 1}"]`); Object.defineProperty(ceFile, 'files', { value: [new w.File(['x'], 'Гайд.pdf', { type: 'application/pdf' })] }); fire(ceFile, 'change'); await wait(200);
  assert.ok([...be.storage.keys()].some(k2 => k2.startsWith(`${A}/t/${tpl}/`) && k2.endsWith('Гайд.pdf'))); ok('шаблон: файл в карточке шаблона загружается сразу в папку шаблона');
  fire($('#ceForm'), 'submit'); await wait(100); $('#tSave').click(); await wait(300);
  L = LS();
  assert.ok(L.tasks.filter(t => others.some(x => x.id === t.id)).every(t => t.blocks.length === 6 && t.blocks.some(b => b.value === 'Новый блок из шаблона'))); ok('шаблон → проекты: новые блоки пришли во все проекты процесса');
  // старые поля «регламент» и «видео» превращаются в блоки (в проекте и в шаблоне)
  const anyP = LS().projects.find(p => p.state === 'active');
  w.mergeSnapshot({ meta: { cardTpls: { [anyP.template_id + '|старый подэтап']: { sub: 'Старый подэтап', d: 'описание', reg: 'https://docs.example/old', vid: 'https://youtu.be/dQw4w9WgXcQ', c: ['a'] } } }, projects: [],
    tasks: [{ id: 'legacy1', project_id: anyP.id, stage_id: anyP.stages[0].id, substage_id: null, title: 'Старая карточка', description: 'x', regulation_link: 'https://docs.example/reg', video_url: 'https://vimeo.com/1', checklist: [], blocks: [{ id: 'kb', type: 'text', title: 'Было', value: 'текст' }] }] }, { keepDemo: true });
  w.commit(); await wait(100);
  L = LS(); const lt = L.tasks.find(t => t.id === 'legacy1');
  assert.deepEqual(lt.blocks.map(b => [b.type, b.title, b.value]), [['link', 'Регламент', 'https://docs.example/reg'], ['video', 'Видео', 'https://vimeo.com/1'], ['text', 'Было', 'текст']]);
  assert.ok(!lt.regulation_link && !lt.video_url); ok('перенос: регламент и видео старой карточки стали первыми блоками');
  const lc = L.cardTpls[anyP.template_id + '|старый подэтап'];
  assert.deepEqual(lc.b.map(b => b.type), ['link', 'video']); assert.ok(!lc.reg && !lc.vid); ok('перенос: и в шаблоне карточки тоже');
  w.openTask('legacy1'); await wait(100);
  assert.ok(D.querySelector('.tk-modal a[href="https://docs.example/reg"]') && D.querySelector('.tk-modal .vthumb')); ok('перенос: в окне карточки ссылка и видео видны как блоки');
  $('[data-tedit]').click(); await wait(100);
  assert.ok(!D.querySelector('[data-td="video_url"]') && !D.querySelector('[data-td="regulation_link"]') && !D.querySelector('#tkVideoFile')); ok('редактирование: полей «регламент», «видео» и «проверить локальный файл» нет');
  w.closeTask(); await wait(50);
  // шаблон сообщения: добавляется в карточку шаблона, приходит в проекты, копируется одним нажатием
  D.querySelector('.tabs [data-view="templates"]').click(); await wait(100); $('[data-settab="templates"]').click(); await wait(100);
  $(`[data-tpl="${tpl}"]`).click(); await wait(100);
  { const st = LS().templates.find(t => t.id === tpl).stages[stIdx]; if (!D.querySelector('.tsub')) { $(`[data-tsubtog="${st.id}"]`).click(); await wait(100); } }
  const rowM = [...D.querySelectorAll('.tsub')].find(r => r.querySelector('input').value.toLowerCase() === sub.toLowerCase());
  rowM.querySelector('[data-tcard]').click(); await wait(100);
  assert.ok($('[data-msgon="ce"]') && !$('.bk-add[data-bkctx="ce"] [data-bkadd="msg"]')); ok('сообщение: в редактировании — галочка «Шаблон сообщения», а не обычный блок');
  assert.ok(!$('[data-msgval="ce"]')); ok('сообщение: без галочки поля нет');
  { const cb = $('[data-msgon="ce"]'); cb.checked = true; fire(cb, 'change'); await wait(50); }
  const mv = $('[data-msgval="ce"]'); assert.ok(mv); ok('сообщение: поставили галочку — появилось поле текста');
  mv.value = 'Здравствуйте, {клиент}! По проекту «{проект}» всё готово.'; fire(mv, 'input');
  fire($('#ceForm'), 'submit'); await wait(100); $('#tSave').click(); await wait(300);
  const tB = LS().tasks.find(x => others.some(o2 => o2.id === x.id)); const pB = LS().projects.find(x => x.id === tB.project_id);
  assert.ok(tB.blocks.some(b => b.type === 'msg')); ok('сообщение: пришло в карточки проектов процесса');
  const copied = []; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async s => { copied.push(s); } }, configurable: true });
  const want = `Здравствуйте, ${pB.client}! По проекту «${pB.name}» всё готово.`;
  // иконка справа у подэтапа на доске → окошко с готовым сообщением → «Копировать»
  D.querySelector('.tabs [data-view="production"]').click(); await wait(100); $('[data-pmode="project"]').click(); await wait(100);
  w.eval(`ui.prodProject = '${pB.id}'; render();`); await wait(150);
  const ico = $(`.pf-card[data-pfsub$="|${tB.substage_id}"] .msg-ico`);
  assert.ok(ico); ok('иконка шаблона сообщения справа на карточке подэтапа');
  ico.click(); await wait(100);
  assert.ok(!$('.tk-modal') && $('.msg-pop') && $('.msg-pop .msg-pop-text').textContent.includes(want.replace(/\n/g, ''))); ok('нажатие на иконку — окошко с готовым сообщением (подэтап не открывается)');
  $('.msg-pop .msg-pop-copy').click(); await wait(100);
  assert.equal(copied[0], want); ok('«Копировать» копирует готовый текст с подставленным клиентом и проектом');
  // окно подэтапа: сообщение не отдельным блоком, а той же иконкой
  w.openTask(tB.id); await wait(150);
  assert.ok(!$('.tk-modal .msg-box') && $('.tk-modal .tk-head .msg-ico')); ok('в окне подэтапа — иконка сообщения в шапке');
  w.closeTask(); await wait(50);
  const noMsg = LS().tasks.find(x => x.project_id === pB.id && x.id !== tB.id && !(x.blocks || []).some(b => b.type === 'msg'));
  if (noMsg){ w.openTask(noMsg.id); await wait(100); assert.ok(!$('.tk-modal .msg-ico')); ok('сообщение необязательно: у подэтапа без него иконки нет'); w.closeTask(); await wait(50); }
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
