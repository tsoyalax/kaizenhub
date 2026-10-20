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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var INVITE = (function () {
    try {
      var m = (location.search + ' ' + location.hash).match(/invite[=:\/]([a-z0-9]{8,32})/i);
      return m ? m[1].toLowerCase() : null;
    } catch (e) { return null; }
  })();

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
    } catch (e) { /* ничего */ }
    return '';
  }

  function loginScreen(note) {
    return new Promise(function (resolve) {
      var mode = 'in';
      var el = document.createElement('div');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Вход');
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;' +
        'background:Canvas;color:CanvasText;color-scheme:light dark;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
      el.innerHTML =
        '<div style="width:100%;max-width:380px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;padding:24px">' +
        '<h1 style="margin:0 0 4px;font-size:22px">KaizenHub</h1>' +
        '<p id="kzNote" style="margin:0 0 16px;opacity:.75;font-size:14px"></p>' +
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
      $('#kzNote').textContent = note || (INVITE ? 'Вас пригласили в проект. Войдите или создайте аккаунт, чтобы открыть его.' : 'Войдите, чтобы открыть свои проекты.');
      function paint() {
        $('#kzGo').textContent = mode === 'in' ? 'Войти' : 'Создать аккаунт';
        $('#kzSwitch').textContent = mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти';
        $('#kzPass').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
        msg('');
      }
      $('#kzSwitch').addEventListener('click', function (e) { e.preventDefault(); mode = mode === 'in' ? 'up' : 'in'; paint(); });
      var sub = sb.auth.onAuthStateChange(function (ev, s) {
        if (s) { try { sub.data.subscription.unsubscribe(); } catch (e) {} el.remove(); resolve(s); }
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
                data: INVITE ? { role: 'guest' } : {},
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
        if (ev === 'SIGNED_OUT') location.href = location.pathname;
      });
      if (!session) session = await loginScreen(note);
      startRealtime();
      return session;
    })();
    return readyP;
  }

  // Выход: чистим локальные данные приложения, чтобы следующий человек на этом компьютере их не увидел
  window.kzSignOut = async function () {
    try { await sb.auth.signOut(); } catch (e) { /* всё равно выходим */ }
    try {
      ['agency-pipeline-demo-v2', 'agency-pipeline-demo-v2-backup', 'agency-mode'].forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ничего */ }
    location.href = location.pathname;
  };

  /* ------------------------------------------------------------------ user */
  var user = {
    id: async function () { return (await ensureSession()).user.id; },
    me: async function () {
      var u = (await ensureSession()).user;
      var meta = u.user_metadata || {};
      return { id: u.id, email: u.email, name: meta.name || (u.email || '').split('@')[0], isOwner: meta.role !== 'guest' };
    },
    profiles: async function (ids) {
      var list = (ids || []).filter(function (x) { return UUID_RE.test(String(x)); });
      var out = {};
      if (!list.length) return out;
      var rows = await rpc('get_profiles', { ids: list });
      (rows || []).forEach(function (p) { out[p.id] = { name: p.name, email: p.email }; });
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
        var res = await L.load();
        if (!L.dead) {
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
  function pollAll() { if (!document.hidden) listeners.forEach(function (L) { refresh(L, true); }); }
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
      set: async function (body) { await rpc('doc_set', { p_path: path, p_data: clean(body) }); poke(path); },
      update: async function (patch) { await rpc('doc_update', { p_path: path, p_patch: clean(patch) }); poke(path); },
      delete: async function () { await rpc('doc_delete', { p_path: path }); pokeAll(); },
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
      res = await fetch('/api/sample', {
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

  /* ----------------------------------------------------------- точка входа */
  window.claude = {
    use: async function (name) {
      await ensureSession();
      if (name === 'user') return user;
      if (name === 'db') return store;
      if (name === 'sample') return sample;
      return null;
    }
  };
})();
