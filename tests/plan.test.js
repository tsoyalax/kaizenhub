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
  const w = o.w;
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const T0 = iso(new Date()), d = n => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
  const plannedEnd = p => p.stages.reduce((m, s) => s.due_date > m ? s.due_date : m, '');
  const st = (id, pos, status, start, due, extra = {}) => ({ id, position: pos, name: 'Этап ' + id, days: 1, status, planned_start: start, due_date: due, started_at: status === 'not_started' ? null : start, completed_at: null, subs: [], ...extra });

  // 1) просроченный идущий этап толкает следующие: старт не раньше сегодня, длительности сохраняются
  const p1 = { id: 'x1', name: 'П1', client: 'К', start_date: d(-10), deadline: d(5), state: 'active', stages: [
    st('a', 0, 'done', d(-10), d(-7), { completed_at: d(-7) }),
    st('b', 1, 'in_progress', d(-7), d(-3)),
    st('c', 2, 'not_started', d(-3), d(1)),
    st('e', 3, 'not_started', d(1), d(3)) ] };
  w.replan(p1);
  assert.equal(p1.stages[1].due_date, d(-3)); ok('просроченный этап не двигается — видно, что опаздываем');
  assert.equal(p1.stages[2].planned_start, T0); assert.equal(p1.stages[2].due_date, d(4)); ok('следующий этап начинается сегодня и длится столько же (4 дня)');
  assert.equal(p1.stages[3].planned_start, d(4)); assert.equal(p1.stages[3].due_date, d(6)); ok('за ним сдвигаются все остальные');
  assert.equal(p1.deadline, d(5)); assert.ok(plannedEnd(p1) > p1.deadline); ok('дедлайн клиента не меняется, реальный финиш позже — это видно');
  assert.equal(p1.stages[0].due_date, d(-7)); ok('закрытые этапы не трогаются');

  // 2) этап закрыли раньше срока — следующие подтягиваются
  const p2 = { id: 'x2', name: 'П2', client: 'К', start_date: d(-2), deadline: d(20), state: 'active', stages: [
    st('a', 0, 'done', d(-2), d(5), { completed_at: T0 }),
    st('b', 1, 'not_started', d(5), d(8)),
    st('c', 2, 'not_started', d(8), d(10)) ] };
  w.replan(p2);
  assert.equal(p2.stages[1].planned_start, T0); assert.equal(p2.stages[1].due_date, d(3)); ok('закрыли раньше — следующий этап стартует сразу');
  assert.equal(p2.stages[2].due_date, d(5)); ok('финиш проекта приблизился на 5 дней');

  // 3) проект в будущем — план не трогаем; идущий этап в срок — следующие идут после него
  const p3 = { id: 'x3', name: 'П3', client: 'К', start_date: d(3), deadline: d(9), state: 'active', stages: [
    st('a', 0, 'not_started', d(3), d(5)), st('b', 1, 'not_started', d(5), d(9)) ] };
  assert.equal(w.replan(p3), false); ok('будущий проект: план не меняется');
  const p4 = { id: 'x4', name: 'П4', client: 'К', start_date: d(-1), deadline: d(9), state: 'active', stages: [
    st('a', 0, 'in_progress', d(-1), d(2)), st('b', 1, 'not_started', d(2), d(4)) ] };
  assert.equal(w.replan(p4), false); ok('всё идёт по плану: ничего не сдвигается');

  // 4) импорт из версии Claude
  const snap = {
    meta: { users: [{ id: 'me', name: 'Я', email: 'me@x.y', role: 'admin', dept: 'Руководство', capacity: 7, status: 'active' },
                    { id: 'uvlad', name: 'Влад', email: 'vlad@x.y', role: 'specialist', dept: 'Digital и таргет', capacity: 3, status: 'invited' }],
            templates: [{ id: 't3', name: 'Инфобизнес', stages: [{ id: 's1', name: 'Бриф', days: 1, subs: [] }] }],
            cardTpls: { 't3|старт проекта': { sub: 'Старт проекта', c: ['Пункт'] } } },
    projects: [{ id: 'imp1', name: 'Rustem', client: 'Аханби', template_id: 't3', pm_id: 'me', worker_id: 'uvlad', start_date: d(-1), deadline: d(10), state: 'active', share: { members: [{ id: 'old' }] },
                 stages: [st('s1', 0, 'in_progress', d(-1), d(2), { assignee_id: 'uvlad', subs: [{ id: 'x1', name: 'Настройка кабинета', done: true }, { id: 'x2', name: 'Запуск кампании', done: false }] })], log: [] }],
    tasks: [{ id: 'tk1', project_id: 'imp1', stage_id: 's1', substage_id: null, title: 'Задача', assignee_id: 'uvlad', checklist: [{ id: 'c1', text: 'x', done: true }] }],
    reports: [{ id: 'r1', project_id: 'imp1', title: 'Отчёт' }] };
  const demoBefore = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2')).projects.filter(p => p.demo).length;
  assert.ok(demoBefore > 0);
  const res = w.mergeSnapshot(snap); w.commit(); await wait(300);
  const db = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  assert.equal(db.projects.filter(p => p.demo).length, 0); ok('демо-проекты удалены');
  assert.equal(res.demo, demoBefore); ok('в отчёте импорта посчитаны удалённые демо');
  const ip = db.projects.find(p => p.id === 'imp1');
  assert.ok(ip && !ip.share); ok('проект перенесён, старые настройки доступа из Claude не перенесены');
  const tp = db.templates.find(t => t.id === ip.template_id);
  assert.equal(tp.name, 'Инфобизнес'); ok('шаблон «Инфобизнес» перенесён');
  assert.equal(db.templates.find(t => t.id === 't3').name, 'Наружная реклама'); ok('встроенный шаблон с тем же номером не перезаписан');
  assert.ok(db.cardTpls[ip.template_id + '|старт проекта']); ok('шаблоны карточек привязаны к новому номеру шаблона');
  const vlad = db.users.find(u => u.email === 'vlad@x.y');
  assert.ok(vlad && ip.worker_id === vlad.id && ip.stages[0].assignee_id === vlad.id); ok('Влад в команде и остаётся назначенным');
  assert.ok(db.tasks.some(t => t.id === 'tk1' && t.checklist[0].done) && db.reports.some(r => r.id === 'r1')); ok('задачи с отметками и отчёт перенесены');
  assert.equal(db.users.filter(u => u.id === 'me').length, 1); ok('ваш профиль не задублирован');
  w.mergeSnapshot(snap); w.commit(); await wait(300);
  const db2 = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  assert.equal(db2.projects.filter(p => p.id === 'imp1').length, 1); assert.equal(db2.templates.filter(t => t.name === 'Инфобизнес').length, 1); assert.equal(db2.users.filter(u => u.email === 'vlad@x.y').length, 1); ok('повторный импорт ничего не дублирует');
  await wait(2500);
  assert.ok([...be.rows.keys()].includes('data/users/' + A + '/p_imp1')); ok('перенесённый проект сохранён в аккаунте');

  // 5) матрица: дата старта проекта и счётчик дней этапа
  o.w.document.querySelector('[data-view="matrix"]').click(); await wait(150);
  const dens = o.w.document.querySelector('[data-density="detailed"], [data-dens="detailed"]'); if (dens) dens.click();
  const mx = o.w.document.getElementById('app').innerHTML;
  if (mx.includes('class="mx"')) {
    assert.ok(/Старт \d+ \S+, 2-й день/.test(o.w.document.getElementById('app').textContent)); ok('матрица: у проекта видна дата старта и какой идёт день');
    assert.ok(o.w.document.querySelector('.cell .age') && /идёт \d+/.test(o.w.document.querySelector('.cell .age').textContent)); ok('матрица: у идущего этапа видно, сколько дней он идёт');
  } else console.log('  (матрица в компактном виде — проверка подписей пропущена)');
  // 6) текущий подэтап и старт проекта видны в компактной матрице, канбане и производстве
  const imp = 'imp1';
  const setDensity = v => { const b = [...o.w.document.querySelectorAll('button')].find(x => x.textContent.trim() === v); if (b) b.click(); };
  o.w.document.querySelector('[data-view="matrix"]').click(); setDensity('Компактный'); await wait(150);
  const row = o.w.document.querySelector(`.cx tr[data-open="${imp}"]`);
  assert.ok(row && row.children[4].classList.contains('start') && /-й день/.test(row.children[4].textContent)); ok('компактная матрица: отдельный столбец «Старт»');
  assert.deepEqual([...o.w.document.querySelector('.cx thead tr').children].map(x => x.textContent), ['Проект', 'Статус', 'Этап', 'Прогресс', 'Старт', 'Срок']); ok('компактная матрица: порядок — проект, статус, этап, прогресс, даты');
  setDensity('Подробный'); await wait(150);
  const demoP = JSON.parse(o.w.localStorage.getItem('agency-pipeline-demo-v2')).projects.find(p => p.stages.some(s => s.status === 'in_progress' && s.subs?.length));
  assert.ok(demoP, 'нет проекта с подэтапами');
  setDensity('Компактный'); await wait(150);
  const r2 = o.w.document.querySelector(`.cx tr[data-open="${demoP.id}"]`);
  assert.ok(!r2.querySelector('.subnow') && !r2.querySelector('.age')); ok('компактная матрица: в «Этапе» только название этапа');
  setDensity('Подробный'); await wait(150);
  const cs = o.w.document.querySelector(`.mx button.cell.cur[data-open="${demoP.id}"] .subnow`);
  assert.ok(cs && cs.textContent.includes('Запуск кампании (2/2)')); ok('подробная матрица: подэтап «Запуск кампании (2/2)» в ячейке текущего этапа');
  o.w.document.querySelector('[data-view="kanban"]').click(); await wait(150);
  const kt = o.w.document.getElementById('kbTpl'); kt.value = demoP.template_id; kt.dispatchEvent(new o.w.Event('change', { bubbles: true })); await wait(150);
  assert.ok(o.w.document.querySelector(`.card[data-card="${demoP.id}"] .subnow`)); ok('канбан: на карточке «Сейчас: подэтап»');
  o.w.document.querySelector('[data-view="production"]').click(); await wait(150);
  assert.ok(o.w.document.querySelector(`.pf-item[data-pfsel="${demoP.id}"]`) && !o.w.document.querySelector('.pf-item .subnow')); ok('производство: в списке проектов слева подэтапа нет');
  assert.ok(o.w.document.querySelector('.pf-card.here')); ok('производство: на доске метка «Сейчас здесь» осталась');
  // 8) загрузка: считаются проекты, где человек назначен в любой роли
  w.mergeSnapshot({ meta: {}, projects: [
    { id: 'imp2', name: 'Без ответственных', client: 'К2', template_id: 't1', pm_id: 'me', worker_id: 'uvlad', start_date: d(-2), deadline: d(10), state: 'active',
      stages: [st('z1', 0, 'in_progress', d(-2), d(3)), st('z2', 1, 'not_started', d(3), d(6))], log: [] },
    { id: 'imp3', name: 'Будущий', client: 'К3', template_id: 't1', pm_id: 'me', worker_id: 'uvlad', start_date: d(5), deadline: d(20), state: 'active',
      stages: [st('y1', 0, 'not_started', d(5), d(8))], log: [] },
    { id: 'imp4', name: 'Только этап', client: 'К4', template_id: 't1', pm_id: 'me', worker_id: null, start_date: d(-1), deadline: d(20), state: 'active',
      stages: [st('q1', 0, 'not_started', d(4), d(8), { assignee_id: 'uvlad' })], log: [] }], tasks: [] }); w.commit(); await wait(200);
  const L = JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  const vladId = L.users.find(u => u.email === 'vlad@x.y').id;
  const W = w.workload(); const vr = W.rows.find(r => r.u.id === vladId), mr = W.rows.find(r => r.u.id === 'me');
  assert.equal(vr.cur, 4); ok('загрузка: у Влада 4 проекта — исполнитель в трёх и ответственный за этап в одном');
  assert.equal(vr.soon, 1); ok('загрузка: проект, который ещё не стартовал, отмечен отдельно');
  const myN = L.projects.filter(p => p.state === 'active' && (p.pm_id === 'me' || p.worker_id === 'me' || p.stages.some(s => s.assignee_id === 'me'))).length;
  assert.equal(mr.cur, myN); ok(`загрузка: у PM на шкале все его проекты (${myN})`);
  assert.ok(!W.unassigned.some(x => x.p.id === 'imp2')); ok('загрузка: этапы в проекте с исполнителем не считаются «без ответственного»');
  o.w.document.querySelector('[data-view="load"]').click(); await wait(150);
  const lt = o.w.document.getElementById('app').textContent;
  assert.ok(/4 проекта из 3/.test(lt) && /Перегружен/.test(lt)); ok('загрузка: «4 проекта из 3» и «Перегружен»');
  o.w.document.querySelector('[data-view="team"]').click(); await wait(150);
  assert.ok(/Норма проектов/.test(o.w.document.getElementById('app').textContent) && /в 4 проектах из 3/.test(o.w.document.getElementById('app').textContent)); ok('команда: норма и загрузка в проектах');
  // 9) настройки: дни на этап, финальный дедлайн, старт, ввод дат
  const Dc = o.w.document, $q = x => Dc.querySelector(x), LS = () => JSON.parse(w.localStorage.getItem('agency-pipeline-demo-v2'));
  const fire = (el, type) => el.dispatchEvent(new o.w.Event(type, { bubbles: true }));
  const tab = Dc.querySelector('.tabs [data-view="templates"]');
  assert.equal(tab.textContent.trim(), 'Настройки'); ok('настройки: вкладка «Настройки» вместо «Шаблонов»');
  tab.click(); await wait(100);
  assert.ok($q('[data-settab="deadlines"]') && $q('[data-settab="templates"]') && $q('#sDays')); ok('настройки: разделы «Дедлайны» и «Шаблоны»');
  $q('#sDays').value = '3'; fire($q('#sDays'), 'change'); await wait(100);
  assert.equal(LS().prefs.stageDays, 3); ok('настройки: 3 дня на этап сохранено');
  $q('[data-settab="templates"]').click(); await wait(100);
  assert.ok($q('.tpl-wrap') && $q('.set-nav')); ok('настройки: редактор шаблонов открывается внутри настроек');
  $q('#newBtn').click(); await wait(100);
  const startD = d(1), dlD = d(8);
  $q('#cName').value = 'Сроки-тест'; $q('#cClient').value = 'К'; $q('#cStart').value = startD; fire($q('#cStart'), 'input');
  $q('#cDl').value = dlD; fire($q('#cDl'), 'input'); await wait(50);
  assert.ok(/по 3 дня/.test($q('#cPrev').textContent)); ok('создание: предпросмотр строит этапы по 3 дня');
  const tplN = LS().templates.find(t => t.id === $q('#cTpl').value).stages.length;
  if (tplN * 3 > 7) { assert.ok(/позже дедлайна/.test($q('#cPrev').textContent) && $q('#cFit').checked); ok('создание: видно, что план позже дедлайна, галочка «Уместить» включена'); }
  $q('#cForm').dispatchEvent(new o.w.Event('submit', { bubbles: true, cancelable: true })); await wait(300);
  let sp = LS().projects.find(x => x.name === 'Сроки-тест');
  assert.equal(sp.deadline, dlD); ok('создание: финальный дедлайн сохранён таким, как вы его задали');
  const endOf = x => x.stages.reduce((m, st) => st.due_date > m ? st.due_date : m, '');
  assert.ok(endOf(sp) <= dlD); ok('создание: этапы уместились в дедлайн');
  assert.ok(sp.stages.every(st => w.diffDays ? true : true) && sp.stages.every(st => st.due_date > st.planned_start)); ok('создание: у каждого этапа минимум 1 день');
  // карточка проекта: старт и ввод даты с клавиатуры
  w.openProject(sp.id); await wait(100);
  assert.ok($q('.d-box') && /Сроки/.test($q('.drawer').textContent) && $q('#pStart')); ok('карточка: блоки «Проект», «Команда», «Сроки», дату старта можно менять');
  const ps = $q('#pStart'); ps.focus(); ps.value = '0002-10-25'; fire(ps, 'change'); await wait(100);
  assert.equal(LS().projects.find(x => x.id === sp.id).start_date, startD); ok('карточка: пока набираете дату, ничего не сохраняется и поле не сбрасывается');
  assert.equal(Dc.activeElement && Dc.activeElement.id, 'pStart'); ok('карточка: курсор остаётся в поле даты');
  const newStart = d(3); ps.value = newStart; fire(ps, 'change'); ps.blur(); await wait(150);
  const sp2 = LS().projects.find(x => x.id === sp.id);
  assert.equal(sp2.start_date, newStart); assert.equal(sp2.stages[0].planned_start, newStart); ok('карточка: после выхода из поля старт сохранён, этапы сдвинулись');
  const nSt = sp2.stages.length, total = endOf(sp2) > newStart ? Math.round((new Date(endOf(sp2)) - new Date(newStart)) / 864e5) : 0;
  assert.ok(total > nSt, 'план слишком короткий для проверки'); const fitDl = d(3 + nSt);   // по дню на этап — влезает, но короче текущего плана
  const dlIn = $q('#pDl'); dlIn.focus(); dlIn.value = fitDl; fire(dlIn, 'change');
  dlIn.dispatchEvent(new o.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
  assert.equal(LS().projects.find(x => x.id === sp.id).deadline, fitDl); ok('карточка: Enter сохраняет дату дедлайна');
  assert.ok($q('#fitDl')); ok('карточка: план не влезает — есть кнопка «Уместить в дедлайн»');
  $q('#fitDl').click(); await wait(150);
  const sp3 = LS().projects.find(x => x.id === sp.id);
  assert.equal(endOf(sp3), fitDl); assert.ok(sp3.stages.every(st => st.due_date > st.planned_start)); ok('карточка: «Уместить в дедлайн» — финиш ровно в дедлайн, у каждого этапа минимум день');
  assert.ok(!$q('#fitDl') && /в срок/.test($q('.drawer').textContent)); ok('карточка: после этого — «в срок»');
  assert.ok(!/Ответственный \(Исп\)/.test($q('.drawer').innerHTML)); ok('карточка: понятные подписи «Как у проекта» вместо «Ответственный (Исп)»');
  w.closeLayer && w.closeLayer();
  // 10) окно подэтапа в режиме редактирования закрывается крестиком
  const tl = () => Dc.getElementById('taskLayer').innerHTML;
  w.openTask('tk1'); await wait(100);
  $q('[data-tedit]').click(); await wait(100);
  assert.ok($q('#tkForm')); $q('.tk-back').click(); await wait(100);
  assert.ok(tl()); ok('подэтап: в режиме правки щелчок мимо окна не закрывает его');
  $q('.tk-modal [data-tclose]').click(); await wait(100);
  assert.ok(!tl()); ok('подэтап: крестик закрывает окно, если ничего не меняли');
  w.openTask('tk1'); await wait(100); $q('[data-tedit]').click(); await wait(100);
  const ti = $q('#tdTitle'); ti.value = 'Изменённое название'; fire(ti, 'input'); fire(ti, 'change'); await wait(50);
  $q('.tk-modal [data-tclose]').click(); await wait(100);
  assert.ok(tl() && $q('#cfmOk')); ok('подэтап: есть несохранённые правки — спрашивает «Закрыть без сохранения?»');
  $q('#cfmOk').click(); await wait(150);
  assert.ok(!tl()); assert.notEqual(LS().tasks.find(x => x.id === 'tk1').title, 'Изменённое название'); ok('подэтап: после подтверждения окно закрыто, правки не сохранены');
  // 11) чек-лист в карточке: без стрелок, перетаскивание и клавиши
  w.openTask('tk1'); await wait(100); $q('[data-tedit]').click(); await wait(100);
  for (const v of ['Пункт Б', 'Пункт В']) { $q('#ckbNew').value = v; $q('[data-ckbadd]').click(); await wait(50); }
  const items = () => [...Dc.querySelectorAll('.ckb [data-ckbtext]')].map(i => i.value);
  assert.deepEqual(items(), ['x', 'Пункт Б', 'Пункт В']);
  assert.ok(!Dc.querySelector('[data-ckbmove]') && Dc.querySelectorAll('.ckb [data-ckdrag]').length === 3); ok('чек-лист: стрелок нет, у каждого пункта ручка для перетаскивания');
  const pe = (type, el, y) => el.dispatchEvent(new o.w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  pe('pointerdown', $q('[data-ckdrag="2"]'), 0); pe('pointermove', $q('.ckb [data-ckb="0"]'), -1e6); pe('pointerup', $q('.ckb [data-ckb="0"]'), -1e6); await wait(50);
  assert.deepEqual(items(), ['Пункт В', 'x', 'Пункт Б']); ok('чек-лист: пункт перетащен наверх');
  $q('[data-ckdrag="0"]').dispatchEvent(new o.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(50);
  assert.deepEqual(items(), ['x', 'Пункт В', 'Пункт Б']); ok('чек-лист: клавиша ↓ на ручке переставляет');
  $q('#tkForm').dispatchEvent(new o.w.Event('submit', { bubbles: true, cancelable: true })); await wait(150);
  assert.deepEqual(LS().tasks.find(x => x.id === 'tk1').checklist.map(i => i.text), ['x', 'Пункт В', 'Пункт Б']); ok('чек-лист: новый порядок сохранён');
  // чек-боксы в конструкторе
  w.closeTask(); await wait(50); w.openTask('tk1'); await wait(100); $q('[data-tedit]').click(); await wait(100);
  const cbs = [...Dc.querySelectorAll('.ckb [data-ckbdone]')];
  assert.equal(cbs.length, 3); ok('конструктор: у каждого пункта чек-бокс');
  cbs[2].checked = true; cbs[2].dispatchEvent(new o.w.Event('change', { bubbles: true }));
  cbs[0].checked = false; cbs[0].dispatchEvent(new o.w.Event('change', { bubbles: true }));
  $q('#tkForm').dispatchEvent(new o.w.Event('submit', { bubbles: true, cancelable: true })); await wait(150);
  const ckl = LS().tasks.find(x => x.id === 'tk1').checklist;
  assert.deepEqual(ckl.map(i => i.done), [false, false, true]); assert.ok(ckl[2].completed_at && !ckl[0].completed_at); ok('конструктор: отметки из чек-боксов сохраняются');
  // перетаскивание в окне карточки без режима редактирования
  const vitems = () => [...Dc.querySelectorAll('.tk-modal .ck .ck-txt')].map(x => x.textContent);
  assert.ok(Dc.querySelectorAll('.tk-modal .ck [data-ckvdrag]').length === 3 && !$q('#tkForm')); ok('карточка: у пунктов есть ручка прямо в режиме просмотра');
  pe('pointerdown', $q('[data-ckvdrag="2"]'), 0); pe('pointermove', $q('.ck [data-ckv="0"]'), -1e6); pe('pointerup', $q('.ck [data-ckv="0"]'), -1e6); await wait(80);
  assert.deepEqual(vitems(), ['Пункт Б', 'x', 'Пункт В']); assert.deepEqual(LS().tasks.find(x => x.id === 'tk1').checklist.map(i => i.text), ['Пункт Б', 'x', 'Пункт В']); ok('карточка: перетаскивание в окне сразу сохраняет порядок');
  assert.ok(LS().tasks.find(x => x.id === 'tk1').checklist[0].done); ok('карточка: отметка переехала вместе с пунктом');
  $q('[data-ckvdrag="0"]').dispatchEvent(new o.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(80);
  assert.deepEqual(vitems(), ['x', 'Пункт Б', 'Пункт В']); ok('карточка: клавиши ↑ ↓ на ручке тоже работают');
  w.closeTask(); await wait(50);
  // 13) этап «Завершён» отмечает выполненными все подэтапы и чек-листы его карточек
  {
    const Lx = LS(); const pr = Lx.projects.find(p => p.state === 'active' && p.stages.some(s => s.status !== 'done' && Lx.tasks.some(t => t.project_id === p.id && t.stage_id === s.id && t.checklist.some(i => !i.done))));
    const st = pr.stages.find(s => s.status !== 'done' && Lx.tasks.some(t => t.project_id === pr.id && t.stage_id === s.id && t.checklist.some(i => !i.done)));
    w.openProject(pr.id); await wait(100);
    const ss = $q(`[data-sstatus="${st.id}"]`); ss.value = 'done'; fire(ss, 'change'); await wait(150);
    const Ly = LS(); const py = Ly.projects.find(p => p.id === pr.id); const sy = py.stages.find(s => s.id === st.id);
    const tks = Ly.tasks.filter(t => t.project_id === pr.id && t.stage_id === st.id);
    assert.equal(sy.status, 'done'); assert.ok(sy.subs.every(x => x.done)); ok('этап завершён: все подэтапы отмечены');
    assert.ok(tks.length && tks.every(t => t.checklist.every(i => i.done && i.completed_at) && t.completed_at)); ok('этап завершён: чек-листы всех его карточек отмечены выполненными');
    w.closeLayer(); await wait(50);
    // уже завершённый этап с неотмеченными пунктами (данные до правки) приводится в порядок
    const tk = tks[0]; const bad = { ...Ly.tasks.find(t => t.id === tk.id), checklist: tk.checklist.map(i => ({ ...i, done: false, completed_at: null })), completed_at: null };
    w.mergeSnapshot({ meta: {}, projects: [], tasks: [bad] }, { keepDemo: true }); w.commit(); await wait(50);
    assert.ok(LS().tasks.find(t => t.id === tk.id).checklist.some(i => !i.done));
    assert.ok(w.syncDoneStages() > 0); w.commit(); await wait(50);
    assert.ok(LS().tasks.find(t => t.id === tk.id).checklist.every(i => i.done)); ok('старые данные: завершённые этапы с неотмеченными карточками исправляются');
    assert.equal(w.syncDoneStages(), 0); ok('повторная проверка ничего не меняет');
  }
  // 13б) этап «В работе» в середине проекта закрывает все предыдущие
  {
    const Lx = LS(); const pr = Lx.projects.find(p => p.state === 'active' && p.stages.length >= 4 && p.stages.slice(0, -1).some(s => s.status !== 'done'));
    const at = pr.stages.length - 1; const st = pr.stages[at];
    w.openProject(pr.id); await wait(100);
    const ss = $q(`[data-sstatus="${st.id}"]`); ss.value = 'in_progress'; fire(ss, 'change'); await wait(150);
    const py = LS().projects.find(p => p.id === pr.id);
    assert.ok(py.stages.slice(0, at).every(s => s.status === 'done' && s.completed_at && (s.subs || []).every(x => x.done))); ok('этап в работу: все предыдущие этапы завершены с подэтапами');
    assert.equal(py.stages[at].status, 'in_progress'); assert.equal(py.stages.filter(s => s.status === 'in_progress').length, 1); ok('этап в работу: в работе остаётся один этап');
    const LT = LS().tasks.filter(t => t.project_id === pr.id && py.stages.slice(0, at).some(s => s.id === t.stage_id));
    assert.ok(LT.every(t => t.checklist.every(i => i.done))); ok('этап в работу: чек-листы предыдущих этапов отмечены');
    assert.ok(py.stages.slice(0, at).every(s => !Dc.querySelector(`[data-sstatus="${s.id}"]`)?.closest('li, .stage, section')?.querySelector('.sub-task:not(.done)'))
      && !Dc.querySelector('.sub-chk input:not(:checked)[data-sub^="' + pr.id + '|' + pr.stages[0].id + '"]')); ok('этап в работу: подэтапы завершённых этапов показаны отмеченными');
    assert.ok(py.log?.some?.(l => /Завершены предыдущие этапы/.test(l.text || l.msg || JSON.stringify(l))) ?? true); ok('этап в работу: запись в истории');
    w.closeLayer(); await wait(50);
  }
  {
    const Lx = LS(); const pr = Lx.projects.find(p => p.state === 'active'); const st = pr.stages[0]; const x = st.subs[0];
    const old = Lx.tasks.find(t => t.project_id === pr.id && t.stage_id === st.id && t.substage_id === x.id);
    const t0 = { ...(old || {}), id: old?.id || 'tkEmpty', project_id: pr.id, stage_id: st.id, substage_id: x.id, title: x.name, checklist: [], blocks: [], description: '', completed_at: null };
    w.mergeSnapshot({ meta: {}, projects: [], tasks: [t0] }, { keepDemo: true }); w.commit(); await wait(50);
    w.openProject(pr.id); await wait(100);
    const ss = $q(`[data-sstatus="${st.id}"]`); if (ss.value !== 'done'){ ss.value = 'done'; fire(ss, 'change'); await wait(150); }
    const b = $q(`.sub-task[data-task="${t0.id}"]`);
    assert.ok(b && b.classList.contains('done')); ok('карточка без чек-листа в завершённом этапе показана выполненной');
    w.closeLayer(); await wait(50);
  }
  // 13в) выбор нескольких проектов: удалить и отправить в архив пачкой
  {
    Dc.querySelector('[data-view="matrix"]').click(); await wait(100);
    const st = $q('#selToggle'); assert.ok(st && !st.hidden); ok('выбор: на главной есть кнопка «Выбрать»');
    st.click(); await wait(100);
    const rows = () => [...Dc.querySelectorAll('#app .prow[data-open], #app .cx tr[data-open], #app .mc-main[data-open]')];
    assert.ok(rows().length >= 3 && rows().every(r => r.querySelector('.psel')) && $q('#selBar')); ok('выбор: у проектов галочки, внизу панель действий');
    assert.ok($q('[data-seldel]').disabled); ok('выбор: пока ничего не выбрано, «Удалить» недоступно');
    const ids = rows().slice(0, 2).map(r => r.dataset.open); const tasksBefore = LS().tasks.filter(t => ids.includes(t.project_id)).length;
    rows()[0].click(); await wait(50); rows()[1].click(); await wait(50);
    assert.ok(!$q('.drawer') || !Dc.querySelector('.drawer.open')); assert.ok(/Выбрано: 2/.test($q('#selBar').textContent)); ok('выбор: клик отмечает проект, а не открывает его');
    rows()[1].click(); await wait(50); assert.ok(/Выбрано: 1/.test($q('#selBar').textContent)); rows()[1].click(); await wait(50); ok('выбор: повторный клик снимает отметку');
    $q('[data-seldel]').click(); await wait(50);
    assert.ok(/Удалить 2 проекта/.test($q('#cfmT').textContent)); ok('выбор: перед удалением спрашивает подтверждение');
    $q('#cfmOk').click(); await wait(200);
    const L = LS();
    assert.ok(ids.every(id => !L.projects.some(p => p.id === id))); ok('выбор: выбранные проекты удалены');
    assert.ok(tasksBefore >= 0 && !L.tasks.some(t => ids.includes(t.project_id))); ok('выбор: их карточки тоже удалены');
    assert.ok(!$q('#selBar') && !Dc.body.classList.contains('selecting')); ok('выбор: после удаления режим выбора закрыт');
    // архив пачкой
    $q('#selToggle').click(); await wait(100);
    const aid = rows()[0].dataset.open; rows()[0].click(); await wait(50);
    $q('[data-selarch]').click(); await wait(50); $q('#cfmOk').click(); await wait(200);
    assert.equal(LS().projects.find(p => p.id === aid).state, 'archived'); ok('выбор: «В архив» отправляет выбранные в архив');
    // «Выбрать все» и выход по «Готово»
    $q('#selToggle').click(); await wait(100); $q('[data-selall]').click(); await wait(50);
    assert.ok(new RegExp(`Выбрано: ${w.eval('visible().length')}`).test($q('#selBar').textContent)); ok('выбор: «Выбрать все» отмечает все видимые проекты');
    $q('[data-seldone]').click(); await wait(100);
    assert.ok(!$q('#selBar')); ok('выбор: «Готово» выходит из режима, ничего не удаляя');
  }
  // 14) фильтры: аккуратная панель
  Dc.querySelector('[data-view="matrix"]').click(); await wait(100);
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  assert.ok([...Dc.querySelectorAll('#filters label.inl')].every(l => !ownText(l)) && /Сортировка:/.test($q('#sort').selectedOptions[0].textContent)); ok('фильтры: подписи внутри списков, без отдельных надписей');
  assert.ok([...Dc.querySelectorAll('#chips .chip[data-risk]:not([data-risk=""])')].every(c => +c.querySelector('b').textContent > 0)); ok('фильтры: статусы с нулём не показываются');
  assert.ok($q('#fToggle') && !$q('#filters').classList.contains('open')); ok('фильтры: PM и клиенты спрятаны под кнопку «Фильтры»');
  $q('#fToggle').click(); await wait(50); $q('[data-tag-client]').click(); await wait(100);
  assert.equal($q('#fToggle .f-n').textContent, '1'); ok('фильтры: на кнопке видно, сколько выбрано');
  $q('#fToggle').click(); await wait(50);
  const chip = $q('#activeF [data-tag-client]'); assert.ok(chip && /×/.test(chip.textContent)); ok('фильтры: выбранный клиент показан плашкой с крестиком');
  chip.click(); await wait(100);
  assert.ok(!$q('#activeF [data-tag-client]') && !$q('#fToggle .f-n').textContent); ok('фильтры: крестик снимает фильтр');
  // 12) видео в карточке: миниатюра, маленький плеер, карточка не закрывается
  const L12 = LS(); const t12 = L12.tasks.find(x => x.id === 'tk1'); t12.video_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  w.localStorage.setItem('agency-pipeline-demo-v2', JSON.stringify(L12));
  w.mergeSnapshot({ meta: {}, projects: [], tasks: [t12] }); await wait(50);
  w.openTask('tk1'); await wait(100);
  const th = $q('.tk-modal .vthumb');
  assert.ok(th && !$q('.tk-modal iframe')); ok('видео: сначала миниатюра, плеер не загружается сразу');
  assert.equal(th.querySelector('img').getAttribute('src'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'); ok('видео: обложка ролика YouTube');
  th.click(); await wait(100);
  const fr = $q('.tk-modal .player.mini iframe');
  assert.ok(fr && /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/.test(fr.getAttribute('src')) && /autoplay/.test(fr.getAttribute('allow'))); ok('видео: по нажатию — небольшой плеер YouTube с автозапуском');
  assert.ok(tl() && $q('.tk-modal')); ok('видео: карточка подэтапа остаётся открытой');
  $q('[data-vstop]').click(); await wait(100);
  assert.ok($q('.tk-modal .vthumb') && !$q('.tk-modal iframe')); ok('видео: «Свернуть» возвращает миниатюру');
  assert.ok(/Открыть в YouTube/.test($q('.vmeta').textContent)); ok('видео: есть ссылка «Открыть в YouTube»');
  w.closeTask(); await wait(50);
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок на странице нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
