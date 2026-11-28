import React from "react";
import { Gen, OddsBar, StateChip, Timer } from "./bits.jsx";
import { phaseOf, totalPool, oddsYesBps, cbondWei, cbondStateLabel } from "../lib/data.js";

/**
 * One board card: the question in the creator's words, the live
 * implied-odds bar, pool size, a close (or resolution) countdown and a
 * state chip. Every figure comes from the market's chain record.
 */
export function MarketCard({ market, now, windows, myStake = null, onOpen }) {
  const phase = phaseOf(market, now, windows);
  const total = totalPool(market);

  let timerLine = null;
  if (phase === "trading") {
    timerLine = <>Closes in <Timer until={market.close} now={now} /></>;
  } else if (phase === "closed") {
    timerLine = <>Resolution opens in <Timer until={market.resolve_after} now={now} /></>;
  } else if (phase === "resolvable") {
    timerLine = <>Resolution open since <Timer until={market.resolve_after} now={now} /></>;
  } else if (phase === "appeal-open") {
    timerLine = <>Appeal window ends in <Timer until={Number(market.resolved_at) + windows.appealWindowSeconds} now={now} /></>;
  } else if (phase === "appeal-pending") {
    timerLine = <>Appeal filed — awaiting re-resolution</>;
  } else if (phase === "finalizable") {
    timerLine = <>Ready to finalize</>;
  } else if (phase === "final") {
    timerLine = <>Settled — pots are claimable</>;
  } else if (phase === "void") {
    timerLine = <>Voided — stakes refunded to pots</>;
  } else if (phase === "cancelled") {
    timerLine = <>Cancelled before any stake</>;
  }

  return (
    <button type="button" className="mcard" onClick={() => onOpen(market.id)}>
      <span className="mcard-top">
        <span className="mcard-id num">#{market.id}</span>
        <StateChip phase={phase} outcome={market.outcome || null} />
      </span>
      <span className="mcard-q">{market.q}</span>
      <OddsBar oddsYesBps={oddsYesBps(market)} size="sm" />
      <span className="mcard-meta">
        <span className="mcard-pool"><Gen wei={total} short /> pool</span>
        <span className="mcard-timer">{timerLine}</span>
      </span>
      {market.cbond_st ? (
        <span className="mcard-bond">
          Creator bond <Gen wei={cbondWei(market)} short /> · {cbondStateLabel(market)}
        </span>
      ) : null}
      {myStake ? (
        <span className="mcard-mine">
          You: {myStake.y > 0n ? <span className="side-y">YES <Gen wei={myStake.y} short /></span> : null}
          {myStake.y > 0n && myStake.n > 0n ? " · " : null}
          {myStake.n > 0n ? <span className="side-n">NO <Gen wei={myStake.n} short /></span> : null}
        </span>
      ) : null}
    </button>
  );
}
