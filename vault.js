/* Vault — encrypted storage locked by a PIN.
 *
 *  PIN (4-8 digits)  -> PBKDF2 (200,000 rounds) -> HKDF -> AES-256-GCM key
 *  data on phone     = ciphertext in IndexedDB, unreadable without the PIN
 *
 * There is no separate key file: the PIN is the only thing that unlocks the
 * vault, so a forgotten PIN means starting over from the last Excel backup.
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------- small helpers ----------
  function b64e(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function b64d(s) { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

  // ---------- IndexedDB ----------
  let dbp = null;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('ledger-vault', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        ['meta', 'vault', 'photos'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  async function idbRun(stores, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('tx aborted'));
      result = fn(t);
    });
  }
  const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const idb = {
    async get(store, key) { const db = await openDB(); return reqP(db.transaction(store).objectStore(store).get(key)); },
    async put(store, key, val) { await idbRun([store], 'readwrite', (t) => { t.objectStore(store).put(val, key); }); },
    async del(store, key) { await idbRun([store], 'readwrite', (t) => { t.objectStore(store).delete(key); }); },
    async keys(store) { const db = await openDB(); return reqP(db.transaction(store).objectStore(store).getAllKeys()); },
    async batch(ops) { // [{op:'put'|'del', store, key, val}] in ONE transaction
      const stores = [...new Set(ops.map((o) => o.store))];
      await idbRun(stores, 'readwrite', (t) => {
        ops.forEach((o) => { const s = t.objectStore(o.store); if (o.op === 'put') s.put(o.val, o.key); else s.delete(o.key); });
      });
    },
    async wipe() {
      await idbRun(['meta', 'vault', 'photos'], 'readwrite', (t) => { ['meta', 'vault', 'photos'].forEach((s) => t.objectStore(s).clear()); });
    },
  };

  // ---------- crypto ----------
  async function deriveKey(pin, salt) {
    const pk = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, pk, 256));
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('ledger-vault-pin-v1') },
      hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, u8) {
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8));
    return { iv, ct };
  }
  async function open(key, rec) {
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct)); }
    catch (e) { throw err('BAD_KEY', 'Wrong PIN'); }
  }

  // ---------- session (an unlocked vault) ----------
  function makeSession(key, meta) {
    const s = {
      async saveDb(db) {
        const { iv, ct } = await seal(key, enc.encode(JSON.stringify(db)));
        await idb.put('vault', 'db', { iv, ct });
      },
      async loadDb() {
        const rec = await idb.get('vault', 'db');
        if (!rec) throw err('NO_DATA', 'No data');
        return JSON.parse(dec.decode(await open(key, rec)));
      },
      async putPhoto(id, blob) {
        const { iv, ct } = await seal(key, new Uint8Array(await blob.arrayBuffer()));
        await idb.put('photos', id, { iv, ct, type: blob.type || 'image/jpeg' });
      },
      async getPhoto(id) {
        const rec = await idb.get('photos', id);
        if (!rec) return null;
        return new Blob([await open(key, rec)], { type: rec.type });
      },
      delPhoto(id) { return idb.del('photos', id); },
      async changePin(db, newPin) {
        // Re-encrypt everything under the new PIN in ONE transaction so a crash cannot half-convert.
        if (!/^\d{4,8}$/.test(newPin)) throw err('BAD_PIN', 'The PIN must be 4 to 8 digits');
        const salt = rand(16);
        const newKey = await deriveKey(newPin, salt);
        const ops = [];
        const dbSeal = await seal(newKey, enc.encode(JSON.stringify(db)));
        ops.push({ op: 'put', store: 'vault', key: 'db', val: dbSeal });
        for (const id of await idb.keys('photos')) {
          const rec = await idb.get('photos', id);
          const plain = await open(key, rec);
          const s2 = await seal(newKey, plain);
          ops.push({ op: 'put', store: 'photos', key: id, val: { iv: s2.iv, ct: s2.ct, type: rec.type } });
        }
        const newMeta = { salt: b64e(salt), v: 1, created: meta.created };
        ops.push({ op: 'put', store: 'meta', key: 'meta', val: newMeta });
        await idb.batch(ops);
        key = newKey; meta = newMeta;
      },
    };
    return s;
  }

  const Vault = {
    async meta() { return idb.get('meta', 'meta'); },
    async exists() { return !!(await idb.get('meta', 'meta')); },

    async create({ pin, db }) {
      if (!/^\d{4,8}$/.test(pin)) throw err('BAD_PIN', 'The PIN must be 4 to 8 digits');
      const salt = rand(16);
      const key = await deriveKey(pin, salt);
      const meta = { salt: b64e(salt), v: 1, created: new Date().toISOString() };
      const { iv, ct } = await seal(key, enc.encode(JSON.stringify(db)));
      await idb.batch([
        { op: 'put', store: 'vault', key: 'db', val: { iv, ct } },
        { op: 'put', store: 'meta', key: 'meta', val: meta },
      ]);
      return makeSession(key, meta);
    },

    async unlock(pin) {
      const meta = await idb.get('meta', 'meta');
      if (!meta) throw err('NO_VAULT', 'No vault on this phone');
      const key = await deriveKey(pin, b64d(meta.salt));
      const session = makeSession(key, meta);
      await session.loadDb(); // throws BAD_KEY if the PIN is wrong
      return session;
    },

    async wipe() { await idb.wipe(); },
  };

  root.Vault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
