// Transaction links and pending withdrawals, honestly sourced.
//
// TX JOURNAL (exact): the contract stores no tx hashes, so every write
// sent from this device is recorded in localStorage the moment the
// wallet returns its hash, keyed by market. EXPLORER MATCHING (fallback):
// the explorer's v1 API lists every tx to the contract with base64
// calldata; for market-scoped writes the first argument IS the market
// id, so a tx belongs to a market when its decoded args carry that id.
// (create_market's first argument is the question text, not an id, so
// creations only ever appear through this device's journal.)
// Nothing here ever invents or guesses a hash.
//
// PENDING JOURNAL: since v2 the contract exposes get_pending, so the
// pending amount and its emission time are read from chain (data.js
// fetchPending) — the journal is no longer the source for amounts.
// What the journal still carries is the claim transaction's HASH,
// which no view exposes: when claim_payout finalizes from THIS device,
// its return string states the emitted amount
// ("WITHDRAWAL_PENDING: <wei> wei to <addr> (#<id>)") and the journal
// records the amount + hash so the purse can link the exact claim tx.
// Confirm / restore / write-off clear the entry. A withdrawal claimed
// on another device still shows in the purse from get_pending — just
// without the local tx link.
import { explorerTxUrl } from "./config.js";

const TX_API = "/api/explorer"; // same-origin proxy (vercel.json) — the API sends no CORS headers

function txKey(contract) {
  return `callit.journal.${String(contract).toLowerCase()}`;
}
function pendingKey(contract) {
  return `callit.pendings.${String(contract).toLowerCase()}`;
}

// --- tx journal ----------------------------------------------------------------
export function loadJournal(contract) {
  try {
    const j = JSON.parse(localStorage.getItem(txKey(contract)) || "[]");
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export function recordTx(contract, entry) {
  try {
    const j = loadJournal(contract);
    j.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(txKey(contract), JSON.stringify(j.slice(0, 200)));
  } catch { /* storage full/blocked — the write itself already happened */ }
}

export function journalForMarket(contract, marketId) {
  return loadJournal(contract).filter((e) => String(e.marketId) === String(marketId));
}

// --- pending-withdrawal journal ---------------------------------------------------
export function loadPendings(contract) {
  try {
    const j = JSON.parse(localStorage.getItem(pendingKey(contract)) || "[]");
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function savePendings(contract, list) {
  try {
    localStorage.setItem(pendingKey(contract), JSON.stringify(list.slice(0, 100)));
  } catch { /* ignore */ }
}

export function recordPending(contract, { account, marketId, amountWei, hash }) {
  const list = loadPendings(contract).filter(
    (p) => !(p.account.toLowerCase() === account.toLowerCase() && String(p.marketId) === String(marketId))
  );
  list.unshift({ account, marketId: String(marketId), amountWei: String(amountWei), hash: hash || null, at: Date.now() });
  savePendings(contract, list);
}

export function clearPending(contract, account, marketId) {
  savePendings(
    contract,
    loadPendings(contract).filter(
      (p) => !(p.account.toLowerCase() === String(account).toLowerCase() && String(p.marketId) === String(marketId))
    )
  );
}

export function pendingFor(contract, account, marketId) {
  if (!account) return null;
  return (
    loadPendings(contract).find(
      (p) => p.account.toLowerCase() === account.toLowerCase() && String(p.marketId) === String(marketId)
    ) || null
  );
}

export function pendingsForAccount(contract, account) {
  if (!account) return [];
  return loadPendings(contract).filter((p) => p.account.toLowerCase() === account.toLowerCase());
}

/** Parse claim_payout's return string: "WITHDRAWAL_PENDING: <wei> wei to <addr> (#<id>)." */
export function parsePendingReturn(returnValue) {
  if (typeof returnValue !== "string") return null;
  const m = /^WITHDRAWAL_PENDING:\s*(\d+)\s*wei to (0x[0-9a-fA-F]{40}) \(#(\d+)\)/.exec(returnValue.trim());
  if (!m) return null;
  return { amountWei: m[1], account: m[2], marketId: m[3] };
}

// --- explorer v1 API ---------------------------------------------------------------
let txCache = { at: 0, txs: null, contract: "" };
const TX_TTL = 60 * 1000;

export async function fetchContractTxs(contract) {
  if (txCache.txs && txCache.contract === contract && Date.now() - txCache.at < TX_TTL) return txCache.txs;
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const r = await fetch(`${TX_API}/transactions?address=${contract}&page=${page}&page_size=50`);
    if (!r.ok) throw new Error(`explorer API ${r.status}`);
    const j = await r.json();
    const items = j.items || j.transactions || j.data || [];
    out.push(...items);
    if (items.length < 50) break;
  }
  txCache = { at: Date.now(), txs: out, contract };
  return out;
}

/** Decode a tx's calldata: base64 JSON {"": "<function>", "args": [...]} (UTF-8 safe). */
export function decodeCalldata(tx) {
  try {
    const content = tx?.data?.params?.encoded_data?.calldata?.content;
    if (!content) return null;
    const binary = atob(content);
    let text;
    try {
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = binary;
    }
    const obj = JSON.parse(text);
    return { fn: obj[""] || obj.function || "", args: obj.args || [] };
  } catch {
    return null;
  }
}

export function txHashOf(tx) {
  return tx?.hash || tx?.tx_hash || tx?.transaction_hash || null;
}

export function txTimeOf(tx) {
  const t = tx?.timestamp || tx?.created_at || tx?.block_timestamp;
  if (!t) return null;
  const n = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  return Number.isNaN(n) ? null : n;
}

/**
 * Explorer txs whose calldata targets this market (first arg == market
 * id for every market-scoped write). Returns [{ hash, fn, at, status, url }].
 */
export async function explorerTxsForMarket(contract, marketId) {
  const txs = await fetchContractTxs(contract);
  const out = [];
  for (const tx of txs) {
    const hash = txHashOf(tx);
    if (!hash) continue;
    const cd = decodeCalldata(tx);
    if (!cd || !cd.args.length) continue;
    const first = cd.args[0];
    const id = typeof first === "object" && first !== null ? first.value ?? first : first;
    if (String(id) !== String(marketId)) continue;
    out.push({ hash, fn: cd.fn, at: txTimeOf(tx), status: tx.status || null, url: explorerTxUrl(hash), source: "explorer" });
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** Poll one tx's explorer status (for live progress while consensus runs). */
export async function fetchTxStatus(hash) {
  try {
    const r = await fetch(`${TX_API}/transactions/${hash}`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.status || j.data?.status || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export const TX_STAGES = ["PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED", "FINALIZED"];
const STAGE_BY_STATUS = {
  pending: 0, proposing: 1, committing: 2, revealing: 3, accepted: 4, finalized: 5,
  appeal_committing: 2, appeal_revealing: 3, leader_revealing: 3,
};
export function stageIndexFor(status) {
  const s = String(status || "").toLowerCase();
  return s in STAGE_BY_STATUS ? STAGE_BY_STATUS[s] : -1;
}
export function isTerminalBadStatus(status) {
  return ["canceled", "undetermined", "validators_timeout", "leader_timeout"].includes(String(status || "").toLowerCase());
}

export function safeHref(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

// --- execution return values ---------------------------------------------------
// The genlayer-js receipt does NOT carry the contract's return value: its
// `result` is the numeric consensus code (1 = majority agree) and no field
// holds the returned string (verified field-by-field against a finalized
// claim_payout receipt: keys are status/result/txData/txDataDecoded/
// messages/eqBlocksOutputs/... — the string "WITHDRAWAL_PENDING: ..." is
// nowhere in it). The return string exists only in the explorer's
// execution trace: enrichment_data.traces[<n>].return_data, a GenVM blob
// whose head is a small map — 0x6e, then length-prefixed keys ("backtrace",
// "data", ...) each followed by one calldata-encoded value. The "data"
// entry IS the return value; both contracts return strings, encoded as
// varint (len << 3) | 4 followed by the UTF-8 bytes. Anything unexpected
// decodes to null and callers fall back to the generic message.

function hexToBytes(hex) {
  const h = String(hex || "").replace(/^0x/, "");
  if (!h || h.length % 2) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readVarint(bytes, off) {
  let v = 0n, shift = 0n, i = off;
  while (i < bytes.length) {
    const b = bytes[i++];
    v |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    if (!(b & 0x80)) return [v, i];
    if (shift > 63n) return null;
  }
  return null;
}

/** One calldata-encoded value at `off` -> [value, nextOff]; value is undefined for an undecodable tag. */
function readTraceValue(bytes, off) {
  const r = readVarint(bytes, off);
  if (!r) return null;
  const [v, next] = r;
  const tag = Number(v & 7n);
  if (tag === 4) {
    const len = Number(v >> 3n);
    if (next + len > bytes.length) return null;
    try {
      return [new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(next, next + len)), next + len];
    } catch {
      return null;
    }
  }
  if (tag === 0) return [null, next]; // special values (null/false/true) ride in the varint itself
  return [undefined, next];
}

/** Decode the return string out of a trace's return_data blob, or null. */
export function decodeTraceReturnData(hex) {
  try {
    const bytes = hexToBytes(hex);
    if (!bytes || bytes.length < 2 || bytes[0] !== 0x6e) return null;
    let off = 1;
    for (let guard = 0; guard < 16; guard++) {
      const kr = readVarint(bytes, off);
      if (!kr) return null;
      const len = Number(kr[0]);
      if (len <= 0 || len > 64 || kr[1] + len > bytes.length) return null;
      const key = new TextDecoder().decode(bytes.slice(kr[1], kr[1] + len));
      const vr = readTraceValue(bytes, kr[1] + len);
      if (!vr) return null;
      if (key === "data") return typeof vr[0] === "string" ? vr[0] : null;
      if (vr[0] === undefined) return null; // unknown value shape before "data" — bail
      off = vr[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Poll the explorer until the tx's execution trace is enriched, then decode its return string. */
export async function fetchTxReturnValue(hash, attempts = 30, intervalMs = 3000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${TX_API}/transactions/${hash}`);
      if (r.ok) {
        const j = await r.json();
        const traces = j?.enrichment_data?.traces || j?.data?.enrichment_data?.traces;
        if (traces && typeof traces === "object") {
          const t = Object.values(traces).find((x) => x && x.result_label === "Return" && x.return_data);
          if (t) return decodeTraceReturnData(t.return_data);
        }
      }
    } catch { /* enrichment lags finalization — keep polling */ }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, intervalMs));
  }
  return null;
}
