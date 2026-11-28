import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { journalForMarket, explorerTxsForMarket } from "../lib/journal.js";
import { explorerTxUrl } from "../lib/config.js";
import { formatDateTime } from "../lib/genlayer.js";

const FN_LABEL = {
  create_market: "Market created",
  buy: "Stake placed",
  cancel_market: "Market cancelled",
  resolve: "Resolution round",
  appeal: "Appeal filed",
  finalize: "Finalized",
  void_market: "Market voided",
  claim_payout: "Payout claimed",
  confirm_withdrawal: "Withdrawal confirmed",
  restore_pending: "Pending restored",
};

/**
 * The market's transaction trail, honestly sourced: writes sent from
 * this device (journaled at signature time) merged with explorer txs
 * whose calldata targets this market. The contract stores no hashes;
 * nothing here is invented — an entry exists only because this device
 * sent it or the explorer lists it.
 */
export function ActivityLog({ marketId, tick = 0 }) {
  const { contractAddr } = useStore();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let dead = false;
    const local = journalForMarket(contractAddr, marketId).map((e) => ({
      hash: e.hash,
      fn: e.fn,
      at: e.at,
      url: explorerTxUrl(e.hash),
      source: "this device",
    }));
    setRows(local);
    explorerTxsForMarket(contractAddr, marketId)
      .then((found) => {
        if (dead) return;
        const byHash = new Map();
        for (const r of [...found, ...local]) {
          if (r.hash && !byHash.has(r.hash)) byHash.set(r.hash, r);
        }
        setRows([...byHash.values()].sort((a, b) => (b.at || 0) - (a.at || 0)));
      })
      .catch(() => { /* journal rows stay shown */ });
    return () => { dead = true; };
  }, [contractAddr, marketId, tick]);

  return (
    <div className="activity">
      <h3 className="panel-title">Activity on this market</h3>
      {rows === null ? (
        <p className="hint">Reading the trail…</p>
      ) : rows.length === 0 ? (
        <p className="hint">
          No transactions are recorded for this market yet — writes sent from this device appear here,
          alongside explorer transactions whose calldata targets the market.
        </p>
      ) : (
        <ul className="activity-list">
          {rows.slice(0, 12).map((r) => (
            <li key={r.hash} className="activity-row">
              <span className="activity-fn">{FN_LABEL[r.fn] || r.fn}</span>
              <span className="activity-meta">
                {r.at ? <span className="num">{formatDateTime(Math.floor(r.at / 1000))}</span> : null}
                <span className="activity-src">{r.source}</span>
                <a href={r.url} target="_blank" rel="noreferrer">tx ↗</a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
