// page/net.js
// Fetch with a timeout, one retry on a minutely 429 (never on a daily or hourly limit) and one retry after our own timeout,
// a device cache with TTL, a saved-copy fallback (opts.lastGoodMin) when a fetch fails, eviction of expired cache entries,
// and a pool that isolates failures.
const PREFIX = "mw2:";
// The limits a retry can't clear. Open-Meteo says which one in its error text.
export const limitOf = (msg) => /\b(daily|hourly) API request limit/i.exec(String(msg ?? ""))?.[1].toLowerCase() ?? null;
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
      if (r.status === 429) {
        const reason = await r.json().then((b) => b?.reason, () => null);
        if (tries.r429 > 0 && !limitOf(reason)) {   // a daily or hourly limit won't clear in 1.5 seconds
          clearTimeout(timer);
          await new Promise((res) => setTimeout(res, retryDelayMs));
          return fetchJson(url, opts, { ...tries, r429: tries.r429 - 1 });
        }
        throw new Error(`HTTP 429${reason ? `: ${reason}` : ""}`);
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
  function writeCache(url, data, lastGoodMin) {
    try { store?.setItem(key(url), JSON.stringify({ at: now(), data, ...(lastGoodMin ? { last: lastGoodMin } : {}) })); } catch { /* quota or private mode */ }
  }
  // opts.lastGoodMin: on a failed fetch, answer with a copy up to this old, marked saved: true, and tag the entry so evict keeps it that long.
  // opts.force: skip a fresh copy but keep it as that fallback.
  async function cachedJson(url, ttlMin = 30, opts = {}) {
    const hit = opts.force ? null : readCache(url, ttlMin);
    if (hit) return { ...hit, cached: true };
    const fallback = (reason) => {
      const old = opts.lastGoodMin ? readCache(url, opts.lastGoodMin) : null;
      return old ? { ...old, cached: true, saved: true, reason } : null;
    };
    let data;
    try { data = await fetchJson(url, opts); }
    catch (e) {
      const old = fallback(String((e && e.message) || e));
      if (old) return old;
      throw e;
    }
    if (data && data.error === true) return fallback(data.reason || "error body") ?? { at: now(), data, cached: false };
    writeCache(url, data, opts.lastGoodMin);
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
          const limit = Math.max(ttlMin, Number.isFinite(v?.last) ? v.last : 0);
          stale = typeof v?.at !== "number" || !Number.isFinite(age) || age < 0 || age > limit * 60000;
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
