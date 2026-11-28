import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { Gen } from "../components/bits.jsx";
import { MarketCard } from "../components/MarketCard.jsx";
import { fetchOverview, fetchMarketList, fetchPositionsFor, fetchPendingsFor, phaseOf } from "../lib/data.js";
import { getRecordCache } from "../lib/cache.js";
import { windowsFor } from "../lib/config.js";
import { useNow } from "../lib/hooks.js";

const FILTERS = [
  { key: "all", label: "All markets" },
  { key: "live", label: "Live" },
  { key: "resolving", label: "Resolving" },
  { key: "settled", label: "Settled" },
  { key: "mine", label: "Mine" },
];

function inFilter(phase, key) {
  switch (key) {
    case "all": return true;
    case "live": return phase === "trading" || phase === "closed";
    case "resolving": return phase === "resolvable" || phase === "appeal-open" || phase === "appeal-pending" || phase === "finalizable";
    case "settled": return phase === "final" || phase === "void" || phase === "cancelled";
    default: return true;
  }
}

/**
 * The market board: protocol totals from get_overview, a strip of the
 * connected wallet's positions, and the grid of market cards. Reads
 * are walletless; the positions strip appears once a wallet connects.
 */
export function Board({ navigate }) {
  const { contractAddr, contractKind, account, overview, registerRefresh } = useStore();
  const windows = windowsFor(contractKind);
  const now = useNow();
  const [markets, setMarkets] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [myRows, setMyRows] = useState(null);
  const [myPendings, setMyPendings] = useState([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const { overview: ov } = await fetchOverview(contractAddr);
      const list = await fetchMarketList(contractAddr, ov.nmarket);
      setMarkets(list);
      setError("");
    } catch (e) {
      setError(e.message || "The board could not be read.");
    }
  }, [contractAddr]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { registerRefresh(() => setTick((t) => t + 1)); }, [registerRefresh]);

  // SWR seed: paint cached non-terminal markets instantly on revisit.
  useEffect(() => {
    if (markets !== null) return;
    const n = Number(overview?.nmarket || 0);
    if (!n) return;
    const seeded = [];
    for (let id = 1; id <= n; id++) {
      const c = getRecordCache(contractAddr, "market", String(id));
      if (c?.record) seeded.push(c.record);
    }
    if (seeded.length) setMarkets(seeded);
  }, [overview, markets, contractAddr]);

  useEffect(() => {
    let dead = false;
    if (!account || !markets) { setMyRows(null); setMyPendings([]); return; }
    fetchPositionsFor(account, markets).then((rows) => { if (!dead) setMyRows(rows); });
    // Pendings are chain state since v2 (get_pending) — swept across
    // the board like positions, not read from the device journal.
    fetchPendingsFor(account, markets).then((rows) => { if (!dead) setMyPendings(rows); });
    return () => { dead = true; };
  }, [account, markets]);

  const myById = useMemo(() => {
    const map = new Map();
    for (const r of myRows || []) {
      map.set(r.market.id, { y: BigInt(r.pos.y || "0"), n: BigInt(r.pos.n || "0") });
    }
    return map;
  }, [myRows]);

  const visible = useMemo(() => {
    if (!markets) return [];
    return markets
      .filter((m) => {
        if (filter === "mine") return myById.has(m.id);
        return inFilter(phaseOf(m, now, windows), filter);
      })
      .slice()
      .sort((a, b) => b.id - a.id);
  }, [markets, filter, now, windows, myById]);

  const ov = overview;
  const solvent = ov ? BigInt(ov.contract_balance_wei || "0") >= BigInt(ov.lockw || "0") + BigInt(ov.tcw || "0") + BigInt(ov.tpw || "0") : null;

  return (
    <div className="page">
      <div className="board-head">
        <div>
          <h1 className="display">The board</h1>
          <p className="lede">
            Prediction markets for questions only judgment can settle. The question, the criteria and
            three named sources are committed on-chain before the first stake — an AI jury resolves
            against exactly that standard, and UNRESOLVED refunds everyone instead of guessing.
          </p>
        </div>
      </div>

      <section className="stat-strip" aria-label="Protocol totals">
        <div className="stat">
          <span className="stat-label">Markets</span>
          <span className="stat-value num">{ov ? String(ov.nmarket) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Locked in markets + bonds</span>
          <span className="stat-value">{ov ? <Gen wei={ov.lockw} short /> : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Claimable</span>
          <span className="stat-value">{ov ? <Gen wei={ov.tcw} short /> : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Withdrawals pending</span>
          <span className="stat-value">{ov ? <Gen wei={ov.tpw} short /> : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Written off</span>
          <span className="stat-value">{ov ? <Gen wei={ov.written_off || "0"} short /> : "—"}</span>
          <span className="stat-note">Stale pendings extinguished, never re-credited</span>
        </div>
        <div className="stat">
          <span className="stat-label">Contract balance</span>
          <span className="stat-value">{ov ? <Gen wei={ov.contract_balance_wei} short /> : "—"}</span>
          {ov ? (
            <span className={`stat-note ${solvent ? "ok" : "bad"}`}>
              {solvent
                ? "Solvent — balance covers every accounted pot"
                : "Balance below the accounted total — the expected shape while a landed withdrawal awaits its confirm; the written-off counter keeps the gap auditable"}
            </span>
          ) : null}
        </div>
      </section>

      {account && (myRows === null || myRows.length > 0 || myPendings.length > 0) ? (
        <section className="positions-strip" aria-label="Your positions">
          <h2 className="strip-title">Your positions</h2>
          {myRows === null ? (
            <p className="hint">Reading your positions across the board…</p>
          ) : myRows.length === 0 && myPendings.length === 0 ? (
            <p className="hint">No stakes yet on this contract. Open a market card to take a side.</p>
          ) : (
            <div className="positions-rows">
              {myRows.map(({ market, pos }) => (
                <button
                  key={market.id}
                  type="button"
                  className="position-row"
                  onClick={() => navigate("market", { id: market.id })}
                >
                  <span className="position-q"><span className="num dim">#{market.id}</span> {market.q}</span>
                  <span className="position-sides num">
                    {BigInt(pos.y || "0") > 0n ? <span className="side-y">YES <Gen wei={pos.y} short /></span> : null}
                    {BigInt(pos.y || "0") > 0n && BigInt(pos.n || "0") > 0n ? " · " : null}
                    {BigInt(pos.n || "0") > 0n ? <span className="side-n">NO <Gen wei={pos.n} short /></span> : null}
                  </span>
                </button>
              ))}
              {myPendings.map((p) => (
                <button
                  key={`pending:${p.market.id}`}
                  type="button"
                  className="position-row pending"
                  onClick={() => navigate("market", { id: p.market.id })}
                >
                  <span className="position-q"><span className="num dim">#{p.market.id}</span> Withdrawal pending — confirm or restore it</span>
                  <span className="position-sides num"><Gen wei={p.amt} short /></span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="board-filters" role="tablist" aria-label="Filter markets">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`filter-chip ${filter === f.key ? "on" : ""}`}
            disabled={f.key === "mine" && !account}
            title={f.key === "mine" && !account ? "Connect a wallet to see your markets" : undefined}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <p className="msg err" role="alert">{error}</p> : null}
      {markets === null ? (
        <p className="hint">Reading the board from chain…</p>
      ) : markets.length === 0 ? (
        <div className="empty-board">
          <p className="empty-title">No markets yet on this contract.</p>
          <p className="hint">The first question is waiting to be asked — create one and the board lights up.</p>
          <button type="button" className="btn btn-accent" onClick={() => navigate("create")}>Create the first market</button>
        </div>
      ) : visible.length === 0 ? (
        <p className="hint">No markets match this filter right now.</p>
      ) : (
        <div className="board-grid">
          {visible.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              now={now}
              windows={windows}
              myStake={myById.get(m.id) || null}
              onOpen={(id) => navigate("market", { id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
