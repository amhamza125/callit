// Session record cache (WarrantyCourt pattern): prior REAL chain reads
// from THIS session, kept in memory + sessionStorage (session-scoped:
// survives in-session navigation and F5, nothing more). Entries seed
// stale-while-revalidate paints and are always replaced by a fresh read
// — except terminal records, which cannot change on chain.
//
// A market record is terminal when the market is FINAL, VOID or
// CANCELLED. Claimable pots and positions are NEVER cached here —
// money reads always go fresh to the chain.
//
// Key: callit-cache:v1:<contract-lowercase>:<type>:<id>

const PREFIX = "callit-cache:v1";
const mem = new Map();

function keyFor(address, type, id) {
  return `${PREFIX}:${String(address || "").toLowerCase()}:${type}:${id}`;
}

function ssGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "record" in parsed ? parsed : null;
  } catch {
    return null;
  }
}
function ssSet(key, entry) {
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {}
}

export function getRecordCache(address, type, id) {
  const key = keyFor(address, type, id);
  if (mem.has(key)) return mem.get(key);
  const entry = ssGet(key);
  if (entry) mem.set(key, entry);
  return entry;
}

export function setRecordCache(address, type, id, record) {
  if (record == null) return;
  const key = keyFor(address, type, id);
  const entry = { record, ts: Date.now() };
  mem.set(key, entry);
  ssSet(key, entry);
}

export function isTerminalMarket(market) {
  return !!market && (market.st === "FINAL" || market.st === "VOID" || market.st === "CANCELLED");
}

/** Contract switch: a different address is a different scope anyway, but
 * the in-memory map is dropped so nothing stale can be served. */
export function clearMemoryCache() {
  mem.clear();
}
