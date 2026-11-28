// Chain data access for CallIt: overview, market records, positions,
// claimable pots. Bounded-concurrency fan-out, sessionStorage SWR
// seeding, terminal markets never revalidated (cache.js).
import { readJsonView, readView, parseJson, readStringView } from "./genlayer.js";
import { getRecordCache, setRecordCache, isTerminalMarket } from "./cache.js";
import { BOND_WEI, CREATOR_BOND_WEI, FEE_WEI } from "./config.js";

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

export async function fetchOverview(contract) {
  const cached = getRecordCache(contract, "overview", "0");
  const ov = await readJsonView("get_overview", []);
  if (!ov || typeof ov !== "object") throw new Error("The contract's overview could not be read.");
  setRecordCache(contract, "overview", "0", ov);
  return { overview: ov, cached: cached?.record || null };
}

export async function fetchMarket(contract, id) {
  const raw = await readView("get_market", [BigInt(id)]);
  const m = parseJson(raw);
  if (!m || typeof m !== "object") return null; // "NOT_FOUND"
  return { ...m, id: Number(id) };
}

/** Market with SWR seeding; terminal markets are served from cache only. */
export async function fetchMarketBundle(contract, id) {
  const cached = getRecordCache(contract, "market", String(id));
  if (cached && isTerminalMarket(cached.record)) {
    return { market: cached.record, fromCache: true };
  }
  const market = await fetchMarket(contract, id);
  if (market) setRecordCache(contract, "market", String(id), market);
  return { market, fromCache: false };
}

/** All markets 1..nmarket. */
export async function fetchMarketList(contract, nmarket) {
  const ids = Array.from({ length: Number(nmarket) || 0 }, (_, i) => i + 1);
  const rows = await mapLimit(ids, 6, async (id) => {
    const cached = getRecordCache(contract, "market", String(id));
    if (cached && isTerminalMarket(cached.record)) return cached.record;
    const m = await fetchMarket(contract, id).catch(() => null);
    if (m) setRecordCache(contract, "market", String(id), m);
    return m;
  });
  return rows.filter(Boolean);
}

/** Position of one address on one market — always a fresh read. */
export async function fetchPosition(address, marketId) {
  const p = await readJsonView("get_position", [String(address).toLowerCase(), BigInt(marketId)]);
  if (!p || typeof p !== "object") return { y: "0", n: "0", seq: 0 };
  return p;
}

/** Claimable pot for one address on one market — always a fresh read. */
export async function fetchClaimable(address, marketId) {
  const s = await readStringView("get_claimable", [String(address).toLowerCase(), BigInt(marketId)]);
  try { return BigInt(s || "0"); } catch { return 0n; }
}

/**
 * Pending withdrawal for one address on one market — always a fresh
 * read of the v2 get_pending view: { amt: BigInt, since: number }
 * (since = unix time of the pending's FIRST unconfirmed emission).
 * Returns null when the read itself fails, so callers can tell
 * "nothing pending" ({ amt: 0n }) apart from "unknown".
 */
export async function fetchPending(address, marketId) {
  try {
    const p = await readJsonView("get_pending", [String(address).toLowerCase(), BigInt(marketId)]);
    if (!p || typeof p !== "object") return null;
    return { amt: BigInt(p.amt || "0"), since: Number(p.since || 0) };
  } catch {
    return null;
  }
}

/** Non-zero pendings of one address across a set of markets (bounded fan-out). */
export async function fetchPendingsFor(address, markets) {
  const rows = await mapLimit(markets, 6, async (m) => {
    const p = await fetchPending(address, m.id);
    return p && p.amt > 0n ? { market: m, amt: p.amt, since: p.since } : null;
  });
  return rows.filter(Boolean);
}

/** Positions of one address across a set of markets (bounded fan-out). */
export async function fetchPositionsFor(address, markets) {
  const rows = await mapLimit(markets, 6, async (m) => {
    try {
      const pos = await fetchPosition(address, m.id);
      return { market: m, pos };
    } catch {
      return { market: m, pos: null };
    }
  });
  return rows.filter((r) => r.pos && (BigInt(r.pos.y || "0") > 0n || BigInt(r.pos.n || "0") > 0n));
}

// --- market shape helpers --------------------------------------------------------

export function poolY(m) { try { return BigInt(m?.pool_y ?? "0"); } catch { return 0n; } }
export function poolN(m) { try { return BigInt(m?.pool_n ?? "0"); } catch { return 0n; } }
export function totalPool(m) { return poolY(m) + poolN(m); }
export function oddsYesBps(m) {
  const t = totalPool(m);
  if (t === 0n) return 0;
  return Number((poolY(m) * 10000n) / t);
}

/** The appeal sub-state of a RESOLVED market. */
export function appealPhase(m) {
  if (!m || m.st !== "RESOLVED") return "none";
  if (m.appeal && !m.appeal_done) return "pending"; // filed, awaiting re-resolution
  if (m.appeal_done) return "done"; // re-resolution landed
  return "open"; // no appeal yet, window running
}

/**
 * The live phase of a market, derived from its record + the clock.
 * This drives chips, countdowns and which actions exist. The contract
 * remains the judge — a button enabled here can still meet a contract
 * error, which the UI surfaces verbatim.
 */
export function phaseOf(m, now, windows) {
  if (!m) return "unknown";
  switch (m.st) {
    case "OPEN":
      if (now < Number(m.close)) return "trading";
      if (now < Number(m.resolve_after)) return "closed"; // trading over, resolution not yet open
      return "resolvable"; // resolution open, no verdict yet
    case "RESOLVED": {
      const ap = appealPhase(m);
      if (ap === "pending") return "appeal-pending";
      if (ap === "done") return "finalizable";
      return now < Number(m.resolved_at) + windows.appealWindowSeconds ? "appeal-open" : "finalizable";
    }
    case "FINAL": return "final";
    case "VOID": return "void";
    case "CANCELLED": return "cancelled";
    default: return "unknown";
  }
}

/** Whether void_market's gate is open for this market right now (per the mirrored windows). */
export function voidAvailable(m, now, windows) {
  if (!m) return false;
  if (m.st === "OPEN") return now > Number(m.resolve_after) + windows.voidOpenSpanSeconds;
  if (m.st === "RESOLVED" && appealPhase(m) === "pending") {
    return now > Number(m.resolved_at) + windows.voidAppealSpanSeconds;
  }
  return false;
}

// --- settlement preview math (mirrors the contract, display only) --------------

/**
 * Preview what finalize would credit the connected position if the
 * standing outcome settled now. Pure function of the chain record +
 * position; the panel labels it an estimate. Returns null when the
 * market is not RESOLVED.
 */
export function previewSettlement(m, pos) {
  if (!m || m.st !== "RESOLVED" || !pos) return null;
  const py = poolY(m);
  const pn = poolN(m);
  const stakes = py + pn;
  const y = BigInt(pos.y || "0");
  const n = BigInt(pos.n || "0");
  const mine = y + n;
  const ap = m.appeal;
  const bond = ap ? BigInt(ap.bond_held || "0") : 0n;
  const bondBack = ap ? !!ap.bond_back : false;
  if (m.outcome === "UNRESOLVED" || py === 0n || pn === 0n) {
    return {
      kind: "refund",
      credit: mine,
      bondToAppellant: bondBack ? bond : 0n,
      note: "UNRESOLVED / one-sided settlement refunds every stake exactly — no fee.",
    };
  }
  const winTotal = m.outcome === "YES" ? py : pn;
  const myWinStake = m.outcome === "YES" ? y : n;
  let pool = stakes;
  let bondToAppellant = 0n;
  if (bond > 0n) {
    if (bondBack) bondToAppellant = bond;
    else pool += bond;
  }
  const fee = pool > FEE_WEI ? FEE_WEI : 0n;
  const dist = pool - fee;
  const share = myWinStake > 0n && winTotal > 0n ? (dist * myWinStake) / winTotal : 0n;
  return {
    kind: "decisive",
    credit: share,
    isWinner: myWinStake > 0n,
    winTotal,
    distributable: dist,
    fee,
    bondToAppellant,
    note: "Floor-division share of the distributable pool; the settlement remainder goes to the largest winning position, so the credited amount can be slightly higher.",
  };
}

/**
 * Implied payout preview for a prospective stake, computed from the
 * CURRENT pools exactly as the brief requires: your share if your side
 * wins = (your stake + your existing same-side stake) / (side pool +
 * your stake) of the projected total pool. Fee and any appeal bond are
 * ignored (unknowable before settlement); an UNRESOLVED or one-sided
 * settlement refunds the stake instead.
 */
export function previewStake(m, pos, side, stakeWei) {
  const py = poolY(m);
  const pn = poolN(m);
  const myY = BigInt(pos?.y || "0");
  const myN = BigInt(pos?.n || "0");
  const sidePool = side === "YES" ? py : pn;
  const mySide = side === "YES" ? myY : myN;
  const newSidePool = sidePool + stakeWei;
  const newTotal = py + pn + stakeWei;
  if (newSidePool === 0n) return null;
  const gross = ((mySide + stakeWei) * newTotal) / newSidePool;
  return {
    gross, // total credit if your side wins (stake back + winnings share)
    profit: gross - (mySide + stakeWei), // winnings beyond the returned stake on this side
    newOddsYesBps: newTotal === 0n ? 0 : Number(((side === "YES" ? newSidePool : py) * 10000n) / newTotal),
  };
}

// --- roles ------------------------------------------------------------------------

export function rolesOf(m, account, admin) {
  const roles = { creator: false, holder: false, admin: false };
  // holder needs the position too — see rolesOfPosition in components.
  if (!account || !m) return roles;
  const a = account.toLowerCase();
  roles.creator = a === String(m.creator).toLowerCase();
  roles.admin = !!admin && a === String(admin).toLowerCase();
  return roles;
}

export function hasPosition(pos) {
  return !!pos && (BigInt(pos.y || "0") > 0n || BigInt(pos.n || "0") > 0n);
}

// --- labels ------------------------------------------------------------------------

export const STATE_LABEL = {
  trading: "Trading",
  closed: "Closed · awaiting resolution time",
  resolvable: "Resolution open",
  "appeal-open": "Resolved · appeal window open",
  "appeal-pending": "Resolved · appeal filed",
  finalizable: "Resolved · ready to finalize",
  final: "Settled",
  void: "Void · refunded",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export const OUTCOME_LABEL = {
  YES: "YES",
  NO: "NO",
  UNRESOLVED: "UNRESOLVED",
};

/** The creator bond's state, read from the market record's cbond_st field. */
export const CBOND_STATE_LABEL = {
  HELD: "held by the contract",
  RETURNED: "returned to the creator",
  SPLIT: "split among the traders",
  ADMIN: "sent to the admin (no traders)",
};

export function cbondStateLabel(m) {
  if (!m || !m.cbond_st) return null;
  return CBOND_STATE_LABEL[m.cbond_st] || String(m.cbond_st).toLowerCase();
}

/** The creator bond amount on a market record (wei BigInt), or the v2 constant. */
export function cbondWei(m) {
  try { return BigInt(m?.cbond ?? CREATOR_BOND_WEI); } catch { return CREATOR_BOND_WEI; }
}

export const REASON_LABEL = {
  CRITERIA_MET: "The jury found the criteria met",
  CRITERIA_NOT_MET: "The jury found the criteria not met",
  INSUFFICIENT_EVIDENCE: "The sources did not decide the criteria — UNRESOLVED",
};

// --- source URL validation (mirrors the contract's _srcs / _domain) ---------------
//
// The contract's registrable-domain rule: last two host labels; rejects
// localhost, IP literals (four numeric labels, bracketed IPv6), single-
// label hosts and empty labels. The create form mirrors it so a bad
// source set is caught before signing; the contract stays the judge.

export function registrableDomain(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  let host = url.slice(8).split("/")[0].split("?")[0].split("#")[0];
  host = host.slice(host.lastIndexOf("@") + 1);
  if (host.startsWith("[")) return null;
  if (host.includes(":")) host = host.split(":")[0];
  host = host.trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (labels.length === 4 && labels.every((x) => /^\d+$/.test(x))) return null;
  if (labels.some((x) => x === "")) return null;
  return labels[labels.length - 2] + "." + labels[labels.length - 1];
}

/** Returns an error string for one source URL, or null when it passes. */
export function sourceUrlError(url) {
  const u = String(url || "").trim();
  if (!u) return "Enter a source URL.";
  if (u.length > 500) return "Over 500 characters — the contract rejects it (BAD_SOURCES).";
  if (!u.startsWith("https://")) return "Must start with https:// — the contract rejects it (BAD_SOURCES).";
  if (registrableDomain(u) === null) {
    return "Host has no usable registrable domain — localhost, IP literals and single-label hosts are rejected (BAD_SOURCES).";
  }
  return null;
}

/** The whole 3-source set: per-URL validity + distinct registrable domains. */
export function sourceSetError(urls) {
  for (const u of urls) {
    const e = sourceUrlError(u);
    if (e) return e;
  }
  const doms = urls.map((u) => registrableDomain(String(u).trim()));
  if (new Set(doms).size !== doms.length) {
    return "The three sources must sit on three distinct registrable domains (BAD_SOURCES).";
  }
  return null;
}

export { BOND_WEI, CREATOR_BOND_WEI };
