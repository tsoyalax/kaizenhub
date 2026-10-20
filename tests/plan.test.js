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
  assert.ok(row && row.children[1].classList.contains('start') && /-й день/.test(row.children[1].textContent)); ok('компактная матрица: отдельный столбец «Старт» сразу после проекта');
  assert.equal(o.w.document.querySelector('.cx thead tr').children[1].textContent, 'Старт'); ok('компактная матрица: заголовок «Старт»');
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
  assert.ok(o.w.document.querySelector(`.pf-item[data-pfsel="${demoP.id}"] .subnow`)); ok('производство: в списке проектов виден подэтап');
  // 7) ссылка на чат проекта
  const D = o.w.document, q = x => D.querySelector(x), ls = () => JSON.parse(o.w.localStorage.getItem('agency-pipeline-demo-v2'));
  const submit = () => q('#cForm').dispatchEvent(new o.w.Event('submit', { bubbles: true, cancelable: true }));
  q('#newBtn').click(); await wait(100);
  q('#cName').value = 'Чат-проект'; q('#cClient').value = 'Клиент Ч'; q('#cChat').value = 'javascript:alert(1)'; submit(); await wait(100);
  assert.ok(/https:\/\//.test(q('#cErr').textContent) && !ls().projects.some(p => p.name === 'Чат-проект')); ok('чат: опасная или неверная ссылка не принимается');
  q('#cChat').value = 't.me/kaizen_test'; submit(); await wait(300);
  const cp = ls().projects.find(p => p.name === 'Чат-проект');
  assert.equal(cp && cp.chat_url, 'https://t.me/kaizen_test'); ok('чат: ссылка без https:// дополняется и сохраняется при создании');
  const sel = `a[data-chat][href="https://t.me/kaizen_test"]`;
  q('[data-view="matrix"]').click(); setDensity('Компактный'); await wait(150);
  assert.ok(q(`.cx tr[data-open="${cp.id}"] ${sel}`)); ok('чат: иконка в компактной матрице');
  q(`.cx tr[data-open="${cp.id}"] ${sel}`).dispatchEvent(new o.w.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(100);
  assert.ok(!q('.drawer')); ok('чат: нажатие на иконку не открывает карточку проекта');
  setDensity('Подробный'); await wait(150);
  assert.ok(q(`.mx ${sel}`)); ok('чат: иконка в подробной матрице');
  q('[data-view="kanban"]').click(); await wait(150);
  const kt2 = q('#kbTpl'); kt2.value = cp.template_id; kt2.dispatchEvent(new o.w.Event('change', { bubbles: true })); await wait(150);
  assert.ok(q(`.card[data-card="${cp.id}"] ${sel}`)); ok('чат: иконка на карточке в канбане');
  q('[data-view="production"]').click(); await wait(150);
  q(`.pf-item[data-pfsel="${cp.id}"]`).click(); await wait(150);
  assert.ok(q(`.pf-row ${sel}`) && q(`.pf-head ${sel}`)); ok('чат: иконка в списке проектов и в заголовке проекта');
  q(`.pf-head [data-open="${cp.id}"]`).click(); await wait(150);
  assert.ok(q(`.drawer ${sel}`)); ok('чат: иконка внутри карточки проекта');
  const pc = q('#pChat'); pc.value = 'https://chat.whatsapp.com/AbC123'; pc.dispatchEvent(new o.w.Event('change', { bubbles: true })); await wait(150);
  assert.equal(ls().projects.find(p => p.id === cp.id).chat_url, 'https://chat.whatsapp.com/AbC123'); ok('чат: ссылку можно поменять в карточке проекта');
  assert.ok(/WhatsApp/.test(q('.drawer a[data-chat]').getAttribute('title'))); ok('чат: мессенджер определяется по ссылке');
  const pc2 = q('#pChat'); pc2.value = ''; pc2.dispatchEvent(new o.w.Event('change', { bubbles: true })); await wait(150);
  assert.ok(!ls().projects.find(p => p.id === cp.id).chat_url && !q('.drawer a[data-chat]')); ok('чат: ссылку можно удалить');
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('ошибок на странице нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
