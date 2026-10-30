// page/net.js
// Fetch with a timeout, one retry on 429 and one retry after our own timeout, a device cache with TTL,
// eviction of expired cache entries, and a pool that isolates failures.
const PREFIX = "mw2:";
export function makeNet({ fetchImpl, storage, now = () => Date.now(), timeoutMs = 8000, retryDelayMs = 1500 } = {}) {
  let store = storage;
  if (store === undefined) { try { store = globalThis.localStorage; } catch { store = null; } }
  const doFetch = fetchImpl ? fetchImpl : globalThis.fetch?.bind(globalThis);
  // opts: { timeoutMs } overrides the net's default for this call.
  async function fetchJson(url, opts = {}, tries = { r429: 1, rTimeout: 1 }) {
    const ms = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : timeoutMs;
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
    try {
      const r = await doFetch(url, { signal: ctl.signal, cache: "no-store" });
      if (r.status === 429 && tries.r429 > 0) {
        clearTimeout(timer);
        await new Promise((res) => setTimeout(res, retryDelayMs));
        return fetchJson(url, opts, { ...tries, r429: tries.r429 - 1 });
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (timedOut && tries.rTimeout > 0) {   // only an abort from our own timer earns the retry
        clearTimeout(timer);
        return fetchJson(url, opts, { ...tries, rTimeout: tries.rTimeout - 1 });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const key = (url) => `${PREFIX}${url}`;
  function readCache(url, ttlMin) {
    try {
      const raw = store?.getItem(key(url));
      if (!raw) return null;
      const { at, data } = JSON.parse(raw);
      if (typeof at !== "number") return null;
      const age = now() - at;
      return age < 0 || age > ttlMin * 60000 ? null : { at, data };
    } catch { return null; }
  }
  function writeCache(url, data) {
    try { store?.setItem(key(url), JSON.stringify({ at: now(), data })); } catch { /* quota or private mode */ }
  }
  async function cachedJson(url, ttlMin = 30, opts = {}) {
    const hit = readCache(url, ttlMin);
    if (hit) return { ...hit, cached: true };
    const data = await fetchJson(url, opts);
    if (!(data && data.error === true)) writeCache(url, data);
    return { at: now(), data, cached: false };
  }
  // Remove mw2:* cache entries older than ttlMin, from the future, or unreadable. Keys in keepKeys are never touched.
  // Returns the number removed. Blocked storage is harmless: returns 0.
  function evict(ttlMin, keepKeys = []) {
    const keep = new Set(keepKeys);
    let gone = 0;
    try {
      if (!store || typeof store.key !== "function") return 0;
      const keys = [];
      for (let i = 0; i < store.length; i++) { const k = store.key(i); if (typeof k === "string" && k.startsWith(PREFIX) && !keep.has(k)) keys.push(k); }
      for (const k of keys) {
        let stale = true;
        try {
          const v = JSON.parse(store.getItem(k));
          const age = now() - v?.at;
          stale = typeof v?.at !== "number" || !Number.isFinite(age) || age < 0 || age > ttlMin * 60000;
        } catch { stale = true; }
        if (stale) { try { store.removeItem(k); gone++; } catch { /* blocked */ } }
      }
    } catch { /* storage blocked */ }
    return gone;
  }
  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const k = next++;
        try { out[k] = { ok: true, value: await fn(items[k], k) }; }
        catch (e) { out[k] = { ok: false, error: String((e && e.message) || e) }; }
      }
    };
    const n = Math.max(1, limit | 0);
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
    return out;
  }
  return { fetchJson, cachedJson, evict, pool };
}
