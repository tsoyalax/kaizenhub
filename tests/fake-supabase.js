// Упрощённая имитация Supabase для проверки «переходника»: таблица docs в памяти + нужные RPC.
function makeBackend() {
  const rows = new Map();       // path -> {path,parent,data,updated_at}
  const profiles = new Map();   // id -> {id,name,email,avatar_url,job_title,contact}
  let tick = 0;
  const parentOf = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const put = (path, data) => { rows.set(path, { path, parent: parentOf(path), data: JSON.parse(JSON.stringify(data)), updated_at: '2026-10-20T00:00:' + String(++tick).padStart(6, '0') }); };
  const handlers = [];
  return {
    rows, put, handlers, profiles,
    emit(row) { handlers.forEach(h => h({ new: row })); },
    client(userId, extra = {}) {
      const session = { access_token: 'tok-' + userId, user: { id: userId, email: userId + '@t.test', user_metadata: extra.meta || {} } };
      const self = this;
      if (!profiles.has(userId)) profiles.set(userId, { id: userId, name: (extra.meta || {}).name || userId.slice(0, 4), email: userId + '@t.test', avatar_url: (extra.meta || {}).avatar_url || '', job_title: '', contact: '' });
      // таблица profiles: читать и менять можно только свою строку (как в RLS)
      const profilesTable = () => {
        let patch = null, id = null;
        const b = {
          select() { return b; }, update(p) { patch = p; return b; }, eq(c, v) { id = v; return b; }, maybeSingle() { return b; },
          then(res, rej) {
            if (id !== userId) return Promise.resolve({ data: null, error: null }).then(res, rej);
            if (patch) { Object.assign(profiles.get(id), patch); return Promise.resolve({ data: null, error: null }).then(res, rej); }
            return Promise.resolve({ data: { ...profiles.get(id) }, error: null }).then(res, rej);
          }
        };
        return b;
      };
      const from = (table) => {
        if (table === 'profiles') return profilesTable();
        let cols = '*', filters = [], rng = null, order = null, single = false;
        const b = {
          select(c) { cols = c; return b; },
          eq(col, val) { filters.push(r => r[col] === val); return b; },
          contains(col, obj) { filters.push(r => Object.entries(obj).every(([k, arr]) => Array.isArray(r[col][k]) && arr.every(x => r[col][k].includes(x)))); return b; },
          order(c) { order = c; return b; },
          range(a, z) { rng = [a, z]; return b; },
          maybeSingle() { single = true; return b; },
          then(res, rej) {
            let list = [...rows.values()].filter(r => filters.every(f => f(r)));
            if (order) list.sort((x, y) => x[order] < y[order] ? -1 : 1);
            if (rng) list = list.slice(rng[0], rng[1] + 1);
            const pick = r => { const o = {}; cols.split(',').forEach(c => o[c.trim()] = r[c.trim()]); return o; };
            const out = single ? { data: list[0] ? pick(list[0]) : null, error: null } : { data: list.map(pick), error: null };
            return Promise.resolve(out).then(res, rej);
          }
        };
        return b;
      };
      const rpc = async (name, a) => {
        if (self.failRpc) return { data: null, error: { code: self.failRpc, message: 'boom' } };
        if (name === 'doc_set') { self.put(a.p_path, a.p_data); self.emit(rows.get(a.p_path)); return { data: null, error: null }; }
        if (name === 'doc_update') { const r = rows.get(a.p_path); if (!r) return { data: null, error: { code: 'P0002', message: 'nf' } }; self.put(a.p_path, { ...r.data, ...a.p_patch }); return { data: null, error: null }; }
        if (name === 'doc_delete') { rows.delete(a.p_path); for (const k of [...rows.keys()]) if (a.p_path.split('/').length === 2 && k.startsWith(a.p_path + '/')) rows.delete(k); return { data: null, error: null }; }
        if (name === 'invite_get') { const r = rows.get('inv/' + a.p_code); return { data: r ? r.data : null, error: null }; }
        if (name === 'get_profiles_full') return { data: a.ids.filter(id => profiles.has(id)).map(id => ({ ...profiles.get(id) })), error: null };
        if (name === 'get_profiles') return { data: a.ids.map(id => ({ id, name: 'N-' + id.slice(0, 4), email: id.slice(0, 4) + '@x.y' })), error: null };
        if (name === 'search_users') return { data: a.q.length >= 2 ? [{ id: '11111111-1111-1111-1111-111111111111', name: 'Bob', email: 'bob@x.y' }] : [], error: null };
        return { data: null, error: { code: 'X', message: 'unknown rpc ' + name } };
      };
      return {
        auth: {
          async getSession() { return { data: { session: extra.noSession ? null : session } }; },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() {}, async signInWithPassword() { return { error: null }; }, async signUp() { return { data: { session: null }, error: null }; },
          async signInWithOAuth(a) { self.oauthCalls = (self.oauthCalls || []).concat([a]); return { data: {}, error: null }; },
          async updateUser(a) { self.updateCalls = (self.updateCalls || []).concat([a]); session.user = { ...session.user, user_metadata: { ...session.user.user_metadata, ...a.data } }; return { data: { user: session.user }, error: null }; }
        },
        from, rpc,
        storage: { from() { const st = self.storage = self.storage || new Map(); return {
          async upload(path, file) { if (!/^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(path)) return { error: { message: 'Invalid key: ' + path, statusCode: '400' } }; if (st.has(path)) return { error: { message: 'The resource already exists' } }; st.set(path, { file, by: userId }); return { data: { path }, error: null }; },
          async createSignedUrl(path) { return st.has(path) ? { data: { signedUrl: 'https://files.test/' + path + '?token=1' }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }; },
          async copy(a, b) { if (!st.has(a)) return { error: { message: 'Object not found' } }; st.set(b, { ...st.get(a), by: userId }); self.copies = (self.copies || []).concat([[a, b]]); return { data: { path: b }, error: null }; }
        }; } },
        channel() { const ch = { on(t, f, h) { self.handlers.push(h); return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; } }; return ch; }
      };
    }
  };
}
module.exports = { makeBackend };
