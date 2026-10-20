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

  // 1) первый запуск: облако пустое -> локальные (демо) данные уходят в аккаунт
  const a1 = openApp(be, A);
  await wait(4500);
  const paths = [...be.rows.keys()];
  console.log('  записано документов:', paths.length, '| ошибок на странице:', a1.errors.length);
  a1.errors.slice(0, 5).forEach(e => console.log('   ERR', e));
  assert.ok(paths.includes('data/users/' + A + '/meta'), 'нет документа meta'); ok('данные приложения записаны в data/users/<id>/meta');
  assert.ok(paths.some(p => p.includes('/p_')) && paths.some(p => p.includes('/t_')), 'нет проектов/задач'); ok('проекты и задачи записаны по документам');
  assert.ok(paths.every(p => p.startsWith('data/users/' + A + '/')), 'записано что-то вне личной папки'); ok('всё записано только в личную папку пользователя');
  assert.equal(a1.errors.length, 0); ok('на странице нет ошибок JavaScript');
  const btnState = a1.w.document.getElementById('cloudBtn') && a1.w.document.getElementById('cloudBtn').dataset.state;
  assert.equal(btnState, 'saved'); ok('значок облака: «сохранено»');
  assert.ok(a1.w.document.body.textContent.length > 500); ok('интерфейс отрисован');
  a1.w.close();

  // 2) «второе устройство»: чистый браузер, тот же пользователь -> данные подтягиваются из базы
  const before = be.rows.size;
  const a2 = openApp(be, A);
  await wait(3500);
  assert.equal(be.rows.size, before); ok('второе устройство не плодит лишних записей');
  assert.equal(a2.w.document.getElementById('cloudBtn').dataset.state, 'saved'); ok('второе устройство: «сохранено»');
  assert.equal(a2.errors.length, 0, a2.errors.join('\n')); ok('второе устройство: ошибок нет');
  const appHtml = a2.w.document.getElementById('app').innerHTML;
  assert.ok(!appHtml.includes('class="empty">Загрузка') && appHtml.includes('class="mx"')); ok('второе устройство: проекты отрисованы из данных базы');
  a2.w.close();

  // 3) приглашённый по ссылке: режим «гость», личное хранилище не создаётся
  const G = 'gggggggg-0000-0000-0000-000000000009';
  const a3 = openApp(be, G, 'https://kz.test/?invite=abcdefgh12', { meta: { role: 'guest' } });
  await wait(2500);
  assert.ok(a3.w.document.body.classList.contains('guest')); ok('приглашённый: включён режим гостя');
  assert.ok(![...be.rows.keys()].some(p => p.startsWith('data/users/' + G + '/meta')), 'гость создал личные данные'); ok('гость не создаёт личные данные');
  a3.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
