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
      w.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
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
  const D = o.w.document, $ = s => D.querySelector(s);
  D.querySelector('[data-mview="matrix"]').click(); await wait(150);
  assert.ok(D.querySelectorAll('.mc').length > 3); ok('телефон: карточки проектов в новом виде');
  assert.ok(!$('.hero') && !$('.ring') && !$('.dchip') && !$('.pc-stagebox')); ok('телефон: нет цветной шапки, колец, цветных плашек и серых блоков');
  const c = $('.mc');
  assert.ok(c.querySelector('.st-pill .pi') && c.querySelector('.tprog .ticks i') && /\d+\/\d+/.test(c.querySelector('.tprog').textContent) && c.querySelector('.mc-stage')); ok('телефон: статус в рамке со значком, прогресс штрихами по этапам и текущий этап — как на компьютере');
  const chips = D.querySelectorAll('.mh-chips .chip[data-htile]');
  assert.equal(chips.length, 4); ok('телефон: фильтры по статусу чипами');
  const before = D.querySelectorAll('.mc').length; chips[0].click(); await wait(150);
  const after = D.querySelectorAll('.mc').length;
  assert.ok(after < before && $('.mh-chips .chip[aria-pressed="true"]')); ok('телефон: чип фильтрует проекты');
  $('.mh-chips .chip[data-htile=""]').click(); await wait(150);
  assert.equal(D.querySelectorAll('.mc').length, before); ok('телефон: «Все» сбрасывает фильтр');
  assert.ok(!$('.mc [data-mxtoggle]') && $('.mc .mc-dl svg') && !/·/.test($('.mc .mc-sub').textContent)); ok('телефон: карточка без лишних строк, дедлайн с флажком справа внизу, без точек');
  $('.mc .mc-main').click(); await wait(150);
  assert.ok($('.drawer')); ok('телефон: нажатие на карточку открывает проект');
  assert.ok($('.mc .mc-hd .pava.md') && $('.mc .mc-badges .st-pill')); ok('телефон: в карточке крупное фото, статус и срок под названием');
  // Производство: текущий проект + выдвижная панель со всеми проектами
  o.w.document.querySelector('.drawer [data-close], .drawer .close')?.click(); await wait(30); $('[data-mview="production"]').click(); await wait(100);
  if (!$('[data-pmpick]')){ [...D.querySelectorAll('button')].find(b => b.textContent.trim() === 'По проекту')?.click(); await wait(100); }
  assert.ok($('[data-pmpick] .pava.md')); ok('производство: кнопка текущего проекта с фото');
  $('[data-pmpick]').click(); await wait(50);
  const rows = D.querySelectorAll('.pk-sheet .pk-row'); assert.ok(rows.length > 3 && $('.pk-row.on')); ok('производство: панель со всеми проектами, текущий отмечен');
  const q = $('#pkQ'); const target = rows[2]; const nm = target.querySelector('b').textContent;
  q.value = nm.slice(0, 5); q.dispatchEvent(new o.w.Event('input', { bubbles:true }));
  assert.ok(!target.hidden && [...rows].some(r => r.hidden)); ok('производство: поиск в панели фильтрует проекты');
  target.click(); await wait(80);
  assert.ok(!$('.pk-sheet') && $('.pm-ct b').textContent === nm); ok('производство: выбор в панели переключает проект');
  // меню «Ещё»: профиль и разделы плитками
  $('[data-mmore]').click(); await wait(30);
  assert.ok($('.more-sheet .side-me') && $('.more-sheet .mlist [data-mview="team"]')); ok('меню «Ещё»: профиль, тема и разделы');
  $('.more-sheet [data-mview="team"]').click(); await wait(80);
  assert.ok(!$('.more-sheet') && $('[data-mmore][aria-current="page"]')); ok('меню «Ещё»: переход в раздел закрывает лист');
  assert.equal(o.errors.length, 0, o.errors.join('\n')); ok('телефон: ошибок нет');
  o.w.close();
  console.log(`\nИтого: ${n} проверок прошло`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
