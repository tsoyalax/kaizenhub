/*
 * KaizenHub · claude-shim.js
 *
 * Приложение написано под claude.ai и обращается к window.claude.use('user' | 'db' | 'sample').
 * Этот файл подставляет те же возможности поверх Supabase (вход, база, синхронизация)
 * и серверной функции /api/sample (распознавание скриншотов и AI-резюме).
 * Код приложения почти не меняется.
 */
(function () {
  'use strict';

  var CFG = window.KZ_CONFIG || {};
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) {
    console.error('KaizenHub: не заданы настройки Supabase (config.js). Приложение работает только локально.');
    return;
  }

  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { storageKey: 'kz2-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var INVITE_KEY = 'kz2-invite';
  var INVITE = (function () {
    try {
      var m = (location.search + ' ' + location.hash).match(/invite[=:\/]([a-z0-9]{8,32})/i);
      if (m) return m[1].toLowerCase();
      // вернулись со входа через Google: код приглашения сохранили перед уходом на страницу Google
      var saved = sessionStorage.getItem(INVITE_KEY);
      if (saved && /^[a-z0-9]{8,32}$/.test(saved)) {
        sessionStorage.removeItem(INVITE_KEY);
        var q = new URLSearchParams(location.search); q.set('invite', saved);
        history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
        return saved;
      }
    } catch (e) { /* ничего */ }
    return null;
  })();

  // Вкладка входа: «Руководитель» (своё пространство) или «Исполнитель» (видит проекты, куда его назначили).
  // По ссылке-приглашению сразу открыта вкладка исполнителя. Выбор переживает уход на страницу Google.
  var WHO_KEY = 'kz2-who';
  var WHO = (function () { try { var v = sessionStorage.getItem(WHO_KEY); sessionStorage.removeItem(WHO_KEY); return v === 'worker' || v === 'lead' ? v : null; } catch (e) { return null; } })();

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var POLL_MS = 20000;

  /* ---------------------------------------------------------------- ошибки */
  function toErr(e) {
    if (!e) return { code: 'unavailable' };
    var c = String(e.code || '');
    if (c === '42501') return { code: 'not_granted', message: 'Нет прав на это действие' };
    if (c === 'P0002') return { code: 'not_found' };
    if (c === '54000') return { code: 'quota_exceeded' };
    if (c === 'PGRST301' || c === 'PGRST303' || e.status === 401) return { code: 'revoked' };
    return { code: 'unavailable', message: e.message };
  }
  async function rpc(name, args) {
    var r = await sb.rpc(name, args);
    if (r.error) throw toErr(r.error);
    return r.data;
  }

  /* ----------------------------------------------------------------- вход */
  var session = null;
  var readyP = null;

  function authErrText(e) {
    var m = String((e && e.message) || '');
    if (/invalid login credentials/i.test(m)) return 'Неверная почта или пароль.';
    if (/already registered|already been registered/i.test(m)) return 'Такой аккаунт уже есть. Нажмите «Войти».';
    if (/at least \d+ characters|password should/i.test(m)) return 'Пароль слишком короткий: нужно не меньше 8 символов.';
    if (/rate limit/i.test(m)) return 'Слишком много попыток. Подождите немного и повторите.';
    if (/email not confirmed/i.test(m)) return 'Почта ещё не подтверждена. Откройте письмо от нас и перейдите по ссылке.';
    if (/valid email|invalid email|unable to validate email/i.test(m)) return 'Проверьте адрес почты.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return 'Вход через Google пока не включён. Войдите по почте и паролю.';
    if (/fetch|network/i.test(m)) return 'Нет связи с сервером. Проверьте интернет.';
    return 'Не получилось войти: ' + m;
  }

  function urlAuthNote() {
    try {
      var h = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (h.get('error_code') === 'otp_expired') {
        history.replaceState(null, '', location.pathname + location.search);
        return 'Ссылка из письма устарела или уже использована. Просто войдите по почте и паролю.';
      }
      var q = new URLSearchParams(location.search);
      if (h.get('error') || q.get('error')) {
        history.replaceState(null, '', location.pathname + (INVITE ? '?invite=' + INVITE : ''));
        return 'Не получилось войти через Google. Попробуйте ещё раз или войдите по почте и паролю.';
      }
    } catch (e) { /* ничего */ }
    return '';
  }

  function loginScreen(note, opts) {
    return new Promise(function (resolve) {
      var mode = 'in';
      var who = (opts && opts.who) || (INVITE ? 'worker' : 'lead');
      var tabCss = 'flex:1;padding:8px 10px;font:inherit;font-size:14px;font-weight:600;border:0;border-radius:7px;cursor:pointer;';
      var el = document.createElement('div');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Вход');
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;' +
        'background:Canvas;color:CanvasText;color-scheme:light dark;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
      el.innerHTML =
        '<div style="width:100%;max-width:380px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;padding:24px">' +
        '<h1 style="margin:0 0 4px;font-size:22px">KaizenHub</h1>' +
        '<div role="tablist" aria-label="Кто входит" style="display:flex;gap:4px;padding:4px;margin:12px 0 10px;border-radius:10px;background:color-mix(in srgb,CanvasText 8%,transparent)">' +
        '<button type="button" role="tab" id="kzLead" data-who="lead">Руководитель</button>' +
        '<button type="button" role="tab" id="kzWorker" data-who="worker">Исполнитель</button></div>' +
        '<p id="kzNote" style="margin:0 0 16px;opacity:.75;font-size:14px"></p>' +
        '<button id="kzGoogle" type="button" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px 12px;font:inherit;font-weight:600;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:Canvas;color:CanvasText;cursor:pointer">' +
        '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
        'Войти через Google</button>' +
        '<p style="display:flex;align-items:center;gap:10px;margin:14px 0;font-size:13px;opacity:.6"><span style="flex:1;height:1px;background:currentColor;opacity:.3"></span>или по почте<span style="flex:1;height:1px;background:currentColor;opacity:.3"></span></p>' +
        '<form id="kzForm" style="display:grid;gap:10px">' +
        '<input id="kzEmail" type="email" autocomplete="email" required placeholder="Почта" aria-label="Почта" style="padding:11px 12px;font:inherit;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:Canvas;color:CanvasText">' +
        '<input id="kzPass" type="password" autocomplete="current-password" required minlength="8" placeholder="Пароль (от 8 символов)" aria-label="Пароль" style="padding:11px 12px;font:inherit;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:Canvas;color:CanvasText">' +
        '<button id="kzGo" type="submit" style="padding:11px 12px;font:inherit;font-weight:600;border-radius:8px;border:0;background:#2563eb;color:#fff;cursor:pointer">Войти</button>' +
        '</form>' +
        '<p id="kzMsg" role="alert" style="min-height:1.4em;margin:10px 0 0;font-size:14px;color:#dc2626"></p>' +
        '<p style="margin:6px 0 0;font-size:14px"><a href="#" id="kzSwitch">Нет аккаунта? Создать</a></p>' +
        '</div>';
      document.body.appendChild(el);
      var $ = function (s) { return el.querySelector(s); };
      var msg = function (t, ok) { var m = $('#kzMsg'); m.textContent = t || ''; m.style.color = ok ? '#15803d' : '#dc2626'; };
      function paintWho() {
        ['lead', 'worker'].forEach(function (k) {
          var b = el.querySelector('[data-who="' + k + '"]'), on = who === k;
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.style.cssText = tabCss + (on ? 'background:Canvas;color:CanvasText;box-shadow:0 1px 3px rgba(0,0,0,.15)' : 'background:transparent;color:inherit;opacity:.65');
        });
        $('#kzNote').textContent = note || (who === 'worker'
          ? (INVITE ? 'Вас пригласили в команду или проект. Войдите или создайте аккаунт — откроются проекты, где вы назначены.'
                    : 'Для исполнителей: войдите и откройте ссылку от руководителя — появятся проекты, где вы назначены.')
          : 'Для руководителей: ваши проекты, команда, шаблоны и загрузка.');
      }
      el.querySelectorAll('[data-who]').forEach(function (b) { b.addEventListener('click', function () { who = b.getAttribute('data-who'); paintWho(); msg(''); }); });
      paintWho();
      function paint() {
        $('#kzGo').textContent = mode === 'in' ? 'Войти' : 'Создать аккаунт';
        $('#kzSwitch').textContent = mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти';
        $('#kzPass').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
        msg('');
      }
      $('#kzSwitch').addEventListener('click', function (e) { e.preventDefault(); mode = mode === 'in' ? 'up' : 'in'; paint(); });
      $('#kzGoogle').addEventListener('click', async function () {
        var btn = $('#kzGoogle'); btn.disabled = true; msg('');
        try {
          // Google вернёт человека на этот же адрес; код приглашения дублируем на случай, если он потеряется в пути
          if (INVITE) { try { sessionStorage.setItem(INVITE_KEY, INVITE); } catch (x) { /* ничего */ } }
          try { sessionStorage.setItem(WHO_KEY, who); } catch (x) { /* ничего */ }
          var r = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname + location.search, queryParams: { prompt: 'select_account' } }
          });
          if (r.error) throw r.error;
        } catch (err) { msg(authErrText(err)); btn.disabled = false; }
      });
      var sub = sb.auth.onAuthStateChange(function (ev, s) {
        if (s) { WHO = who; try { sub.data.subscription.unsubscribe(); } catch (e) {} el.remove(); resolve(s); }
      });
      $('#kzForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = $('#kzEmail').value.trim(), password = $('#kzPass').value;
        var btn = $('#kzGo'); btn.disabled = true; msg('');
        try {
          if (mode === 'in') {
            var r = await sb.auth.signInWithPassword({ email: email, password: password });
            if (r.error) throw r.error;
          } else {
            var u = await sb.auth.signUp({
              email: email, password: password,
              options: {
                data: who === 'worker' ? { role: 'guest' } : {},
                emailRedirectTo: location.origin + location.pathname + location.search
              }
            });
            if (u.error) throw u.error;
            if (!u.data.session) msg('Мы отправили письмо для подтверждения. Перейдите по ссылке из него, затем вернитесь сюда и нажмите «Войти».', true);
          }
        } catch (err) { msg(authErrText(err)); }
        btn.disabled = false;
      });
    });
  }

  function ensureSession() {
    if (readyP) return readyP;
    readyP = (async function () {
      var r = await sb.auth.getSession();
      session = r.data && r.data.session;
      var note = urlAuthNote();
      sb.auth.onAuthStateChange(function (ev, s) {
        session = s;
        if (ev === 'SIGNED_OUT' && !gating) location.href = location.pathname;
      });
      for (;;) {
        if (!session) session = await loginScreen(note, gateWho ? { who: gateWho } : null);
        // вкладка «Руководитель» открывается только аккаунтам с доступом руководителя
        if (WHO === 'lead' && !(await isLead(session.user))) {
          gating = true;
          // только на этом устройстве: глобальный выход выкидывал человека со всех его устройств
          try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* всё равно не пускаем */ }
          gating = false; session = null; WHO = null; gateWho = 'worker';
          note = 'У этого аккаунта нет доступа руководителя. Войдите на вкладке «Исполнитель» — откроются проекты, где вы назначены. Доступ руководителя выдаёт администратор сервиса.';
          continue;
        }
        break;
      }
      await markInvitedGuest();
      startRealtime();
      return session;
    })();
    return readyP;
  }

  // Доступ руководителя: у аккаунта уже есть своё пространство (руководители, работающие в сервисе) или роль lead в профиле.
  // Новые аккаунты и исполнители (role guest) руководителями сами не становятся.
  var gating = false, gateWho = null;
  // ссылка-приглашение руководителя (kind team, role lead) — проверяем один раз
  var leadInviteP = null;
  function isLeadInvite() {
    if (!INVITE) return Promise.resolve(false);
    if (!leadInviteP) leadInviteP = rpc('invite_get', { p_code: INVITE }).then(function (d) { return !!(d && d.kind === 'team' && d.role === 'lead'); }, function () { return false; });
    return leadInviteP;
  }
  async function isLead(u) {
    var role = (u && u.user_metadata || {}).role;
    if (role === 'lead') return true;
    if (await isLeadInvite()) return true;              // пришёл по ссылке руководителя
    if (role === 'guest' || !u) return false;
    try { return !!(await fetchOne('data/users/' + u.id + '/meta', 'path')); } catch (e) { return true; }   // нет связи — не запираем своих
  }

  // Вход через Google не передаёт роль при регистрации (как форма с почтой). Поэтому новичка, пришедшего
  // по ссылке-приглашению, отмечаем исполнителем здесь. Того, у кого уже есть свои данные, не трогаем.
  async function markInvitedGuest() {
    try {
      var u = session && session.user;
      // ссылка руководителя: роль руководителя (даже если раньше человек был исполнителем)
      if (u && (await isLeadInvite())) {
        if ((u.user_metadata || {}).role !== 'lead') {
          var rl = await sb.auth.updateUser({ data: { role: 'lead' } });
          if (!rl.error && rl.data && rl.data.user) session = Object.assign({}, session, { user: rl.data.user });
        }
        return;
      }
      var asWorker = WHO ? WHO === 'worker' : !!INVITE;     // выбранная при входе вкладка важнее ссылки
      if (!asWorker || !u || (u.user_metadata || {}).role) return;
      if (await fetchOne('data/users/' + u.id + '/meta', 'path')) return;
      var r = await sb.auth.updateUser({ data: { role: 'guest' } });
      if (!r.error && r.data && r.data.user) session = Object.assign({}, session, { user: r.data.user });
    } catch (e) { /* не вышло: человек просто откроет своё пустое пространство */ }
  }

  // Выход: чистим локальные данные приложения, чтобы следующий человек на этом компьютере их не увидел
  window.kzSignOut = async function () {
    // выходим только на этом устройстве — на телефоне и других браузерах человек остаётся в аккаунте
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* всё равно выходим */ }
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('kz2-data') === 0 || k === 'kz2-mode' || k === 'kz2-space' || k === 'kz2-org' || k === 'kz2-org-own') localStorage.removeItem(k); });
    } catch (e) { /* ничего */ }
    location.href = location.pathname;
  };

  /* ------------------------------------------------------------------ user */
  var user = {
    id: async function () { return (await ensureSession()).user.id; },
    me: async function () {
      var u = (await ensureSession()).user;
      var meta = u.user_metadata || {};
      var p = null;
      try { var r = await sb.from('profiles').select('name,avatar_url,job_title,contact').eq('id', u.id).maybeSingle(); p = r.data; } catch (e) { /* профиль не обязателен */ }
      return {
        id: u.id, email: u.email, isOwner: meta.role !== 'guest',
        name: (p && p.name) || meta.name || meta.full_name || (u.email || '').split('@')[0],
        avatar: (p && p.avatar_url) || meta.avatar_url || meta.picture || '',
        title: (p && p.job_title) || '', contact: (p && p.contact) || ''
      };
    },
    // Человек меняет свой профиль: имя, должность, контакт. Фото и почта приходят из аккаунта
    updateProfile: async function (f) {
      var u = (await ensureSession()).user;
      var patch = {};
      if (f.name != null) patch.name = String(f.name).trim().slice(0, 120);
      if (f.title != null) patch.job_title = String(f.title).trim().slice(0, 120);
      if (f.contact != null) patch.contact = String(f.contact).trim().slice(0, 200);
      var r = await sb.from('profiles').update(patch).eq('id', u.id);
      if (r.error) throw toErr(r.error);
    },
    profiles: async function (ids) {
      var list = (ids || []).filter(function (x) { return UUID_RE.test(String(x)); });
      var out = {};
      if (!list.length) return out;
      var rows;
      try { rows = await rpc('get_profiles_full', { ids: list }); }
      catch (e) { rows = await rpc('get_profiles', { ids: list }); }   // база ещё без новых полей
      (rows || []).forEach(function (p) {
        out[p.id] = { name: p.name, email: p.email, avatar: p.avatar_url || '', title: p.job_title || '', contact: p.contact || '' };
      });
      return out;
    },
    search: async function (q) {
      var rows = await rpc('search_users', { q: q || '' });
      return (rows || []).map(function (p) { return { id: p.id, name: p.name, email: p.email, isMe: false }; });
    }
  };

  /* -------------------------------------------------------------------- db */
  var META = { fromCache: false, hasPendingWrites: false };
  var lastSeg = function (p) { return p.slice(p.lastIndexOf('/') + 1); };
  var parentOf = function (p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  var clean = function (o) { return JSON.parse(JSON.stringify(o)); };

  function docSnap(path, row) {
    return { id: lastSeg(path), exists: !!row, data: function () { return row ? row.data : undefined; }, metadata: META };
  }
  function colSnap(rows) {
    var docs = rows.map(function (r) {
      return { id: lastSeg(r.path), exists: true, data: function () { return r.data; }, metadata: META };
    });
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: META, forEach: function (f) { docs.forEach(f); } };
  }

  // Постраничная выборка: Supabase отдаёт не больше 1000 строк за раз
  async function fetchAll(build) {
    var out = [];
    for (var from = 0; ; from += 1000) {
      var r = await build().order('path').range(from, from + 999);
      if (r.error) throw toErr(r.error);
      out = out.concat(r.data);
      if (r.data.length < 1000) break;
    }
    return out;
  }
  function colQuery(parent, where, cols) {
    return function () {
      var q = sb.from('docs').select(cols).eq('parent', parent);
      return where ? q.contains('data', where) : q;
    };
  }
  async function fetchOne(path, cols) {
    var r = await sb.from('docs').select(cols).eq('path', path).maybeSingle();
    if (r.error) throw toErr(r.error);
    return r.data;
  }
  var sigOfRows = function (rows) { return rows.map(function (r) { return r.path + '@' + r.updated_at; }).join('|'); };
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ':' + h; }
  var contentSig = function (rows) { return hash(rows.map(function (r) { return r.path + '\u0000' + JSON.stringify(r.data); }).join('\u0001')); };

  var listeners = new Set();
  // Счётчик своих записей. Загрузка, во время которой мы что-то записали, могла прочитать базу ДО записи —
  // такой снимок устарел: отдать его приложению значит откатить только что сохранённое. Его выбрасываем и грузим заново.
  var writeSeq = 0;
  var wrote = function () { writeSeq++; };

  function addListener(spec, cb, errCb) {
    var L = Object.assign({ cb: cb, errCb: errCb, sig: null, csig: null, busy: false, pending: null, timer: null, dead: false }, spec);
    listeners.add(L);
    refresh(L, false);
    return function () { L.dead = true; clearTimeout(L.timer); listeners.delete(L); };
  }
  function schedule(L) {
    clearTimeout(L.timer);
    L.timer = setTimeout(function () { refresh(L, false); }, 120);
  }
  async function refresh(L, cheap) {
    if (L.dead) return;
    if (L.busy) { L.pending = (cheap && L.pending !== 'full') ? 'cheap' : 'full'; return; }
    L.busy = true;
    try {
      // дешёвая проверка: сначала смотрим только на метки времени и скачиваем данные, если что-то изменилось
      var skip = false;
      if (cheap && L.sig !== null) skip = (await L.sigNow()) === L.sig;
      if (!skip) {
        var seq = writeSeq;
        var res = await L.load();
        if (!L.dead && seq !== writeSeq) { L.pending = 'full'; }
        else if (!L.dead) {
          L.sig = res.sig;
          // снимок отдаём приложению только если изменилось содержимое (метка времени меняется и при той же записи)
          if (res.csig !== L.csig) { L.csig = res.csig; L.cb(res.value); }
        }
      }
    } catch (e) {
      if (!L.dead && L.errCb && (L.sig === null || (e && e.code === 'revoked'))) { try { L.errCb(e); } catch (x) { /* ничего */ } }
    }
    L.busy = false;
    if (L.pending) { var p = L.pending; L.pending = null; refresh(L, p === 'cheap'); }
  }

  function poke(path) {
    var row = { path: path, parent: parentOf(path) };
    listeners.forEach(function (L) { if (L.matches(row)) schedule(L); });
  }
  function pokeAll() { listeners.forEach(schedule); }

  var channel = null;
  function startRealtime() {
    if (channel) return;
    var h = function (payload) {
      var row = (payload && payload.new) || {};
      listeners.forEach(function (L) { if (L.matches(row)) schedule(L); });
    };
    channel = sb.channel('kz-docs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs' }, h)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs' }, h)
      .subscribe(function (status) { if (status === 'SUBSCRIBED') pokeAll(); });
  }
  // Страховка: удаления Realtime не присылает, поэтому раз в 20 секунд сверяемся с базой
  // Вкладка в фоне тоже сверяется (реже): иначе, вернувшись к ней, человек правил старую копию данных
  var hiddenTicks = 0;
  function pollAll(e) {
    if (document.hidden && !(e && e.type)) { if (++hiddenTicks % 3) return; }
    hiddenTicks = 0; listeners.forEach(function (L) { refresh(L, true); });
  }
  setInterval(pollAll, POLL_MS);
  document.addEventListener('visibilitychange', pollAll);
  window.addEventListener('online', pollAll);

  function docRef(path) {
    return {
      path: path,
      id: lastSeg(path),
      get: async function () {
        if (/^inv\/[^/]+$/.test(path)) {
          var d = await rpc('invite_get', { p_code: lastSeg(path) });
          return docSnap(path, d ? { data: d } : null);
        }
        return docSnap(path, await fetchOne(path, 'path,data'));
      },
      set: async function (body) { wrote(); try { await rpc('doc_set', { p_path: path, p_data: clean(body) }); } finally { wrote(); } poke(path); },
      update: async function (patch) { wrote(); try { await rpc('doc_update', { p_path: path, p_patch: clean(patch) }); } finally { wrote(); } poke(path); },
      delete: async function () { wrote(); try { await rpc('doc_delete', { p_path: path }); } finally { wrote(); } pokeAll(); },
      collection: function (sub) { return colRef(path + '/' + sub); },
      onSnapshot: function (cb, errCb) {
        return addListener({
          matches: function (r) { return r.path === path; },
          sigNow: async function () { var r = await fetchOne(path, 'path,updated_at'); return r ? sigOfRows([r]) : '0'; },
          load: async function () {
            var r = await fetchOne(path, 'path,data,updated_at');
            return { sig: r ? sigOfRows([r]) : '0', csig: r ? contentSig([r]) : '0', value: docSnap(path, r) };
          }
        }, cb, errCb);
      }
    };
  }

  function colRef(path, where) {
    return {
      path: path,
      doc: function (id) { return docRef(path + '/' + id); },
      where: function (field, op, value) {
        if (op !== 'array-contains') throw new Error('KaizenHub: поддерживается только array-contains');
        var w = {}; w[field] = [value];
        return colRef(path, w);
      },
      get: async function () { return colSnap(await fetchAll(colQuery(path, where, 'path,data'))); },
      onSnapshot: function (cb, errCb) {
        return addListener({
          matches: function (r) { return r.parent === path; },
          sigNow: async function () { return sigOfRows(await fetchAll(colQuery(path, where, 'path,updated_at'))); },
          load: async function () {
            var rows = await fetchAll(colQuery(path, where, 'path,data,updated_at'));
            return { sig: sigOfRows(rows), csig: contentSig(rows), value: colSnap(rows) };
          }
        }, cb, errCb);
      }
    };
  }

  var store = {
    collection: function (p) { return colRef(p); },
    doc: function (p) { return docRef(p); }
  };

  /* ---------------------------------------------------------------- sample */
  var OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var MAX_IMAGES = 4;
  var MAX_B64 = 3400000;

  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej({ code: 'image_rejected' }); };
      fr.readAsDataURL(blob);
    });
  }
  async function shrink(file, maxSide, q) {
    var bmp = await createImageBitmap(file);
    var k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', q); });
    return blobToB64(blob);
  }
  // Сервер принимает запрос не больше ~4,5 МБ, поэтому скриншоты сжимаем до разумного размера
  async function prepareImages(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return [];
    if (list.length > MAX_IMAGES || list.some(function (f) { return OK_TYPES.indexOf(f.type) < 0; })) throw { code: 'image_rejected' };
    var steps = [[1600, 0.82], [1400, 0.7], [1200, 0.6], [1000, 0.5]];
    for (var i = 0; i < steps.length; i++) {
      var out = [], total = 0;
      for (var j = 0; j < list.length; j++) {
        var d = await shrink(list[j], steps[i][0], steps[i][1]).catch(function () { throw { code: 'image_rejected' }; });
        total += d.length; out.push({ media_type: 'image/jpeg', data: d });
      }
      if (total <= MAX_B64) return out;
    }
    throw { code: 'prompt_too_large' };
  }
  async function callSample(payload) {
    await ensureSession();
    var cur = await sb.auth.getSession();
    var token = cur.data && cur.data.session ? cur.data.session.access_token : '';
    var res;
    try {
      res = await fetch('/api/v2/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload)
      });
    } catch (e) { throw { code: 'unavailable', message: 'Нет связи с сервером. Проверьте интернет.' }; }
    var body = null;
    try { body = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) throw { code: (body && body.error && body.error.code) || 'unavailable', message: body && body.error && body.error.message };
    return body;
  }
  var sample = async function (prompt, opts) {
    opts = opts || {};
    var r = await callSample({ prompt: prompt, mode: 'text', modelTier: opts.modelTier || 'default' });
    if (typeof opts.onText === 'function') { try { opts.onText({ text: r.text }); } catch (e) { /* ничего */ } }
    return { text: r.text };
  };
  sample.json = async function (prompt, opts) {
    opts = opts || {};
    var images = await prepareImages(opts.images);
    var r = await callSample({ prompt: prompt, mode: 'json', modelTier: opts.modelTier || 'default', images: images });
    return r.json;
  };
  sample.limits = async function () { return { images: { mediaTypes: OK_TYPES.slice(), maxCount: MAX_IMAGES } }; };

  /* ----------------------------------------------------------------- files */
  // Файлы карточек: закрытая корзина kz-files, ссылки на скачивание — временные (1 час)
  var BUCKET = 'kz-files', MAX_FILE = 50 * 1024 * 1024;
  function stErr(e) {
    var m = String((e && (e.message || e.error)) || '');
    if (/exceed|too large|payload/i.test(m)) return { code: 'too_large', message: 'Файл больше 50 МБ' };
    if (/row-level|security|not authorized|unauthorized|403/i.test(m + (e && e.statusCode))) return { code: 'not_granted', message: 'Нет доступа к файлу' };
    if (/not found|404/i.test(m + (e && e.statusCode))) return { code: 'not_found', message: 'Файл не найден' };
    return { code: 'unavailable', message: m };
  }
  var files = {
    maxSize: MAX_FILE,
    upload: async function (path, file) {
      await ensureSession();
      if (file.size > MAX_FILE) throw { code: 'too_large', message: 'Файл больше 50 МБ' };
      var r = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (r.error) throw stErr(r.error);
      return path;
    },
    url: async function (path) {
      await ensureSession();
      var r = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (r.error) throw stErr(r.error);
      return r.data.signedUrl;
    },
    copy: async function (from, to) {
      await ensureSession();
      var r = await sb.storage.from(BUCKET).copy(from, to);
      if (r.error) throw stErr(r.error);
      return to;
    }
  };

  /* ----------------------------------------------------------- точка входа */
  window.claude = {
    use: async function (name) {
      await ensureSession();
      if (name === 'user') return user;
      if (name === 'db') return store;
      if (name === 'sample') return sample;
      if (name === 'files') return files;
      return null;
    }
  };
})();
