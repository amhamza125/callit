import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { Addr, Btn, Field, Gen, OddsBar, RoleTags, StateChip, Timer, pct } from "../components/bits.jsx";
import { WithdrawPanel } from "../components/WithdrawPanel.jsx";
import { ActivityLog } from "../components/ActivityLog.jsx";
import {
  fetchMarketBundle, fetchPosition, phaseOf, appealPhase, voidAvailable,
  poolY, poolN, totalPool, oddsYesBps, previewStake, previewSettlement,
  rolesOf, hasPosition, REASON_LABEL, cbondWei, cbondStateLabel,
} from "../lib/data.js";
import { getRecordCache } from "../lib/cache.js";
import { windowsFor, MIN_STAKE_WEI, BOND_WEI, MAX_TRADERS } from "../lib/config.js";
import { genToWei, formatDateTime, friendlyError } from "../lib/genlayer.js";
import { safeHref } from "../lib/journal.js";
import { useNow } from "../lib/hooks.js";

/**
 * One market as a trading panel: the big odds bar, the stake ticket,
 * your position, the resolution panel (committed criteria + sources,
 * resolve / appeal / finalize / void by state), the settlement
 * preview, and the purse. Every number is read from chain; action
 * availability follows the market's state and the connected role,
 * with the reason for a disabled action stated in words.
 */
export function MarketPanel({ id, navigate }) {
  const { account, contractAddr, contractKind, overview, runWrite, activeTx, registerRefresh } = useStore();
  const windows = windowsFor(contractKind);
  const now = useNow();
  const busy = !!activeTx;
  const [market, setMarket] = useState(() => getRecordCache(contractAddr, "market", String(id))?.record || null);
  const [loadError, setLoadError] = useState("");
  const [pos, setPos] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const { market: m } = await fetchMarketBundle(contractAddr, id);
      if (!m) {
        setLoadError(`Market #${id} does not exist on this contract (get_market answered NOT_FOUND).`);
        setMarket(null);
        return;
      }
      setMarket(m);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message || "The market could not be read.");
    }
  }, [contractAddr, id]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { registerRefresh(() => setTick((t) => t + 1)); }, [registerRefresh]);

  useEffect(() => {
    let dead = false;
    if (!account) { setPos(null); return; }
    fetchPosition(account, id).then((p) => { if (!dead) setPos(p); }).catch(() => {});
    return () => { dead = true; };
  }, [account, id, contractAddr, tick, market?.st]);

  if (loadError) {
    return (
      <div className="page">
        <p className="msg err" role="alert">{loadError}</p>
        <button type="button" className="textbtn" onClick={() => navigate("board")}>← Back to the board</button>
      </div>
    );
  }
  if (!market) return <div className="page"><p className="hint">Reading market #{id} from chain…</p></div>;

  const phase = phaseOf(market, now, windows);
  const roles = rolesOf(market, account, overview?.owner);
  const holder = hasPosition(pos);
  const admin = overview?.owner || null;

  return (
    <div className="page">
      <button type="button" className="textbtn back-link" onClick={() => navigate("board")}>← The board</button>

      <header className="market-head">
        <div className="market-head-top">
          <span className="mcard-id num">MARKET #{market.id}</span>
          <StateChip phase={phase} outcome={market.outcome || null} />
          <RoleTags roles={roles} isHolder={holder} />
        </div>
        <h1 className="market-q">{market.q}</h1>
        <p className="market-creator">
          Created by <Addr address={market.creator} /> · committed on-chain at creation and never editable
        </p>
      </header>

      <section className="odds-hero panel">
        <OddsBar oddsYesBps={oddsYesBps(market)} size="lg" />
        <div className="pool-stats">
          <div className="pool-stat">
            <span className="pool-label side-y">YES pool</span>
            <span className="pool-value"><Gen wei={poolY(market)} short /></span>
          </div>
          <div className="pool-stat">
            <span className="pool-label side-n">NO pool</span>
            <span className="pool-value"><Gen wei={poolN(market)} short /></span>
          </div>
          <div className="pool-stat">
            <span className="pool-label">Total pool</span>
            <span className="pool-value"><Gen wei={totalPool(market)} short /></span>
          </div>
          <div className="pool-stat">
            <span className="pool-label">Traders</span>
            <span className="pool-value num">{(market.traders || []).length} / {MAX_TRADERS}</span>
          </div>
          {market.cbond_st ? (
            <div className="pool-stat">
              <span className="pool-label">Creator bond</span>
              <span className="pool-value"><Gen wei={cbondWei(market)} short /></span>
              <span className="pool-sub">{cbondStateLabel(market)}</span>
            </div>
          ) : null}
          <div className="pool-stat">
            <span className="pool-label">Trading closes</span>
            <span className="pool-value num">{formatDateTime(market.close)}</span>
            {phase === "trading" ? <span className="pool-sub">in <Timer until={market.close} now={now} /></span> : null}
          </div>
        </div>
      </section>

      <div className="panel-grid">
        <div className="panel-col">
          <StakeTicket market={market} pos={pos} phase={phase} tick={tick} />
          <ResolutionPanel market={market} phase={phase} pos={pos} holder={holder} roles={roles} now={now} windows={windows} />
          <CommittedStandard market={market} />
        </div>
        <div className="panel-col">
          <PositionPanel market={market} pos={pos} phase={phase} admin={admin} />
          <WithdrawPanel market={market} tick={tick} />
          <section className="panel">
            <ActivityLog marketId={id} tick={tick} />
          </section>
        </div>
      </div>
    </div>
  );
}

// --- stake ticket -----------------------------------------------------------------

function StakeTicket({ market, pos, phase }) {
  const { account, runWrite, activeTx, setChooserOpen } = useStore();
  const busy = !!activeTx;
  const [side, setSide] = useState("YES");
  const [amount, setAmount] = useState("0.01");
  const [err, setErr] = useState("");

  let stakeWei = null;
  try { stakeWei = amount.trim() ? genToWei(amount) : null; } catch { stakeWei = null; }
  const amountValid = stakeWei !== null && stakeWei >= MIN_STAKE_WEI;
  const preview = amountValid && phase === "trading" ? previewStake(market, pos, side, stakeWei) : null;
  const isNewTrader = !!account && !hasPosition(pos) && pos !== null;
  const marketFull = (market.traders || []).length >= MAX_TRADERS;

  const disabledReason = !account
    ? "Connect a wallet to stake."
    : phase !== "trading"
      ? phase === "closed" || phase === "resolvable"
        ? `Trading closed at ${formatDateTime(market.close)} — stakes no longer join this market.`
        : "This market is no longer trading."
      : !amountValid
        ? stakeWei === null
          ? "Enter a stake amount."
          : `The minimum stake is 0.001 GEN (STAKE_TOO_SMALL).`
        : isNewTrader && marketFull
          ? `This market already has ${MAX_TRADERS} traders — the contract rejects a new one (MARKET_FULL). Existing traders can still add.`
          : null;

  const submit = async () => {
    setErr("");
    try {
      await runWrite(`Stake ${side}`, "buy", [BigInt(market.id), side], { value: stakeWei, marketId: market.id });
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  return (
    <section className="panel ticket">
      <h2 className="panel-title">Stake ticket</h2>
      <div className="side-toggle" role="group" aria-label="Choose a side">
        <button type="button" className={`side-btn side-y-btn ${side === "YES" ? "on" : ""}`} onClick={() => setSide("YES")}>
          YES <span className="num">{pct(oddsYesBps(market))}</span>
        </button>
        <button type="button" className={`side-btn side-n-btn ${side === "NO" ? "on" : ""}`} onClick={() => setSide("NO")}>
          NO <span className="num">{pct(10000 - oddsYesBps(market))}</span>
        </button>
      </div>
      <Field label="Stake (GEN)" hint="Minimum 0.001 GEN. Your stake joins the pool immediately and cannot be withdrawn — it settles with the market." error={err || undefined}>
        <input
          className="textinput mono"
          inputMode="decimal"
          placeholder="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <div className="quick-row">
        {["0.001", "0.01", "0.05", "0.1"].map((v) => (
          <button key={v} type="button" className="quick-chip num" onClick={() => setAmount(v)}>{v}</button>
        ))}
      </div>
      {preview ? (
        <div className="preview-box">
          <p>
            If <b className={side === "YES" ? "side-y" : "side-n"}>{side}</b> wins, your projected credit is{" "}
            <Gen wei={preview.gross} /> — your stake back plus <Gen wei={preview.profit} /> of winnings.
          </p>
          <p className="hint">
            Estimate only, computed from the current pools: later stakes move the odds, the settlement
            fee (0.0001 GEN, when the pool exceeds it) and the floor-division remainder are applied at
            finalize, and an UNRESOLVED or one-sided settlement refunds stakes instead.
          </p>
        </div>
      ) : null}
      {!account ? (
        <Btn onClick={() => setChooserOpen(true)}>Connect a wallet to stake</Btn>
      ) : (
        <Btn variant={side === "YES" ? "yes" : "no"} disabled={busy || !!disabledReason} onClick={submit}>
          Stake <Gen wei={stakeWei ?? 0n} short /> on {side}
        </Btn>
      )}
      {account && disabledReason ? <p className="disabled-reason">{disabledReason}</p> : null}
    </section>
  );
}

// --- your position ------------------------------------------------------------------

function PositionPanel({ market, pos, phase, admin }) {
  const { account } = useStore();
  const preview = useMemo(
    () => (market.st === "RESOLVED" ? previewSettlement(market, pos) : null),
    [market, pos]
  );
  const isAppellant = !!account && !!market.appeal && market.appeal.by?.toLowerCase() === account.toLowerCase();
  const isAdmin = !!account && !!admin && admin.toLowerCase() === account.toLowerCase();

  return (
    <section className="panel">
      <h2 className="panel-title">Your position</h2>
      {!account ? (
        <p className="hint">Connect your wallet to read your position on this market.</p>
      ) : pos === null ? (
        <p className="hint">Reading your position…</p>
      ) : !hasPosition(pos) ? (
        <p className="hint">You hold no stake in this market.</p>
      ) : (
        <>
          <dl className="meta-list">
            <div><dt className="side-y">YES stake</dt><dd><Gen wei={pos.y} /></dd></div>
            <div><dt className="side-n">NO stake</dt><dd><Gen wei={pos.n} /></dd></div>
            <div><dt>First-stake order</dt><dd className="num">seq {String(pos.seq)}</dd></div>
          </dl>
          {phase === "final" ? (
            <p className="hint">
              Settlement is final. Whatever this market owes you sits in your claimable pot — see your
              purse below. (The pools are zeroed in the settled record, so no live preview applies.)
            </p>
          ) : preview ? (
            <div className="preview-box">
              <p className="preview-title">If the standing verdict settles now</p>
              {preview.kind === "refund" ? (
                <p>
                  You would be credited <Gen wei={preview.credit + (isAppellant ? (preview.bondToAppellant || 0n) : 0n)} /> —
                  your full stake back{isAppellant && preview.bondToAppellant ? ", plus your returned appeal bond" : ""}.
                </p>
              ) : preview.isWinner ? (
                <p>
                  You would be credited about <Gen wei={preview.credit + (isAppellant ? (preview.bondToAppellant || 0n) : 0n)} />
                  {isAppellant && preview.bondToAppellant ? " (including your returned appeal bond)" : ""}.
                </p>
              ) : (
                <p>
                  Your stake sits on the losing side of the standing verdict — you would be credited{" "}
                  <Gen wei={isAppellant ? (preview.bondToAppellant || 0n) : 0n} />
                  {isAppellant && preview.bondToAppellant ? " (your returned appeal bond only)" : ""}.
                </p>
              )}
              <p className="hint">
                {preview.note} Estimate from the current chain record
                {market.appeal && !market.appeal_done ? " — an appeal is still pending, so the verdict itself can change" : ""}.
                {isAdmin && preview.kind === "decisive" ? " The settlement fee is credited to the admin's pot on this market — that's you, on top of any winnings." : ""}
              </p>
            </div>
          ) : (
            <p className="hint">No verdict yet — your entitlement is computed at finalize, from the pools and the verdict.</p>
          )}
        </>
      )}
    </section>
  );
}

// --- resolution ----------------------------------------------------------------------

function ResolutionPanel({ market, phase, holder, roles, now, windows }) {
  const { account, runWrite, activeTx, setChooserOpen } = useStore();
  const busy = !!activeTx;
  const ap = appealPhase(market);
  const appealDeadline = market.resolved_at ? Number(market.resolved_at) + windows.appealWindowSeconds : 0;
  const voidOpen = voidAvailable(market, now, windows);
  const voidAt = market.st === "OPEN"
    ? Number(market.resolve_after) + windows.voidOpenSpanSeconds
    : Number(market.resolved_at) + windows.voidAppealSpanSeconds;

  const needWallet = (
    <p className="disabled-reason">
      Connect a wallet — these are signed writes. <button type="button" className="textbtn" onClick={() => setChooserOpen(true)}>Connect</button>
    </p>
  );

  return (
    <section className="panel">
      <h2 className="panel-title">Resolution</h2>

      {market.st === "OPEN" && phase === "closed" ? (
        <p className="hint">
          Trading is closed. Resolution opens at {formatDateTime(market.resolve_after)} — in{" "}
          <Timer until={market.resolve_after} now={now} /> — when anyone can call the jury.
        </p>
      ) : null}

      {market.st === "OPEN" && phase === "resolvable" ? (
        <>
          <p className="hint">
            Resolution is open. Anyone can run the jury now: it fetches the three committed sources and
            judges them against the committed criteria — a majority of sources decides, and if they do
            not decide it, the verdict is UNRESOLVED and every stake refunds.
          </p>
          {account ? (
            <Btn disabled={busy} onClick={() => runWrite("Resolve market", "resolve", [BigInt(market.id)], { marketId: market.id })}>
              Resolve — call the jury
            </Btn>
          ) : needWallet}
        </>
      ) : null}

      {market.st === "RESOLVED" || market.st === "FINAL" ? (
        <div className="verdict-box">
          <span className={`verdict verdict-${String(market.outcome).toLowerCase()}`}>{market.outcome}</span>
          <span className="verdict-reason">{REASON_LABEL[market.reason] || market.reason}</span>
          <span className="verdict-meta num">
            Resolved {formatDateTime(market.resolved_at)}
            {market.st === "FINAL" ? <> · winning pool <Gen wei={market.win_total} short /></> : null}
          </span>
        </div>
      ) : null}

      {Number(market.attempts) > 0 && market.st !== "FINAL" ? (
        <p className="hint">
          {market.attempts} resolution attempt{Number(market.attempts) === 1 ? "" : "s"} recorded without a
          verdict (a source unreachable or a malformed jury round — EVIDENCE_UNAVAILABLE / JURY_MALFORMED).
          No verdict was stored; anyone can retry.
        </p>
      ) : null}

      {/* appeal */}
      {phase === "appeal-open" ? (
        <div className="action-block">
          <h3 className="sub-title">Appeal this verdict</h3>
          <p className="hint">
            A position holder can appeal once, within the window, for a bond of <Gen wei={BOND_WEI} />.
            The appeal buys one fresh re-resolution: the new jury judges the sources alone —{" "}
            <b>the first verdict is not shown to it</b> (blind re-resolution) — and its verdict replaces
            this one wholesale, including flipping it to UNRESOLVED. If the outcome changes, the bond
            returns to you at finalize; if it stands, the bond joins the winners' pool.
          </p>
          <p className="hint num">Appeal window closes {formatDateTime(appealDeadline)} — in <Timer until={appealDeadline} now={now} />.</p>
          {account ? (
            <>
              <Btn
                variant="warn"
                disabled={busy || !holder}
                onClick={() => runWrite("Appeal verdict", "appeal", [BigInt(market.id)], { value: BOND_WEI, marketId: market.id })}
              >
                Appeal — bond <Gen wei={BOND_WEI} short />
              </Btn>
              {!holder ? (
                <p className="disabled-reason">Only position holders can appeal — you hold no stake in this market (the contract answers NO_POSITION).</p>
              ) : null}
            </>
          ) : needWallet}
        </div>
      ) : null}

      {ap === "pending" ? (
        <div className="action-block">
          <h3 className="sub-title">Appeal filed — awaiting re-resolution</h3>
          <p className="hint">
            <Addr address={market.appeal.by} /> appealed with a <Gen wei={market.appeal.bond_held} /> bond held by
            the contract. The re-resolution is blind: the jury sees the question, the criteria and the
            sources — never the first verdict. Anyone can run it.
          </p>
          {account ? (
            <Btn disabled={busy} onClick={() => runWrite("Re-resolve market", "resolve", [BigInt(market.id)], { marketId: market.id })}>
              Re-resolve — call the jury again
            </Btn>
          ) : needWallet}
        </div>
      ) : null}

      {ap === "done" ? (
        <p className="hint">
          The appeal was re-resolved and the standing verdict above is final.{" "}
          {market.appeal.bond_back
            ? "The outcome changed, so the appellant's bond returns to them at finalize."
            : "The outcome stood, so the appellant's bond joins the winners' pool at finalize."}
        </p>
      ) : null}

      {/* finalize */}
      {market.st === "RESOLVED" ? (
        <div className="action-block">
          <h3 className="sub-title">Finalize</h3>
          {phase === "finalizable" ? (
            <>
              <p className="hint">
                Settlement can run now: winners split the pool pro-rata (the 0.0001 GEN fee applies when
                the pool exceeds it; UNRESOLVED and one-sided markets refund every stake exactly), and the
                creator bond returns to the creator in full on any outcome. Anyone can call it —
                entitlements land in claimable pots.
              </p>
              {account ? (
                <Btn disabled={busy} onClick={() => runWrite("Finalize market", "finalize", [BigInt(market.id)], { marketId: market.id })}>
                  Finalize settlement
                </Btn>
              ) : needWallet}
            </>
          ) : phase === "appeal-pending" ? (
            <p className="disabled-reason">
              Finalize is blocked while the appeal awaits re-resolution (the contract answers APPEAL_PENDING).
            </p>
          ) : (
            <p className="disabled-reason">
              The appeal window closes {formatDateTime(appealDeadline)} — finalize opens then, or as soon
              as an appeal is re-resolved.
            </p>
          )}
        </div>
      ) : null}

      {/* void */}
      {market.st === "OPEN" || ap === "pending" ? (
        <div className="action-block">
          <h3 className="sub-title">Expiry void</h3>
          {voidOpen ? (
            <>
              <p className="hint">
                This market is stuck past its exit window. Anyone can void it: every stake refunds in
                full{ap === "pending" ? " and the held appeal bond returns to the appellant" : ""} — no fee.
                Because the market never settled, the creator bond is split among the traders pro-rata by
                stake instead of returning to the creator.
              </p>
              {account ? (
                <Btn variant="ghost" disabled={busy} onClick={() => runWrite("Void market", "void_market", [BigInt(market.id)], { marketId: market.id })}>
                  Void market — refund everyone
                </Btn>
              ) : needWallet}
            </>
          ) : (
            <p className="disabled-reason">
              The void opens {formatDateTime(voidAt)} if the market is still stuck — before that the
              contract answers TOO_EARLY.
            </p>
          )}
        </div>
      ) : null}

      {/* cancel */}
      {market.st === "OPEN" && roles.creator ? (
        <div className="action-block">
          <h3 className="sub-title">Cancel (creator)</h3>
          {totalPool(market) > 0n ? (
            <p className="disabled-reason">
              This market holds stakes, so it can never be cancelled (POOL_NOT_EMPTY) — it ends by
              resolution or by the expiry void.
            </p>
          ) : now >= Number(market.close) ? (
            <p className="disabled-reason">Cancel is only possible before trading closes.</p>
          ) : account ? (
            <>
              <p className="hint">No stakes yet — as creator you can cancel this market. There is nothing to refund, and your creator bond returns in full to your claimable pot on this market.</p>
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => runWrite("Cancel market", "cancel_market", [BigInt(market.id)], { marketId: market.id })}
              >
                Cancel market
              </Btn>
            </>
          ) : needWallet}
        </div>
      ) : null}

      {market.st === "VOID" ? (
        <p className="hint">
          This market was voided — every stake (and any held appeal bond) was refunded into claimable pots,
          and the creator bond was {market.cbond_st === "ADMIN" ? "sent to the admin's pot, as there were no traders to split it among" : "split among the traders pro-rata by stake"}. See your purse.
        </p>
      ) : null}
      {market.st === "CANCELLED" ? (
        <p className="hint">This market was cancelled by its creator before any stake was placed — the creator bond returned to the creator's pot in full.</p>
      ) : null}
    </section>
  );
}

// --- committed standard -----------------------------------------------------------------

function CommittedStandard({ market }) {
  return (
    <section className="panel">
      <h2 className="panel-title">The committed standard</h2>
      <p className="hint">
        Fixed on-chain at creation — the jury judges against exactly this text and these sources, and
        nothing here can be edited by anyone, including the creator.
      </p>
      <h3 className="sub-title">Resolution criteria</h3>
      <blockquote className="criteria">{market.crit}</blockquote>
      <h3 className="sub-title">Named sources (all three must answer; a majority decides)</h3>
      <ol className="source-list">
        {(market.srcs || []).map((u, i) => {
          const href = safeHref(u);
          return (
            <li key={i}>
              <span className="source-idx num">SOURCE {i + 1}</span>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="mono break-all">{u}</a>
              ) : (
                <span className="mono break-all">{u}</span>
              )}
            </li>
          );
        })}
      </ol>
      <dl className="meta-list">
        <div><dt>Trading closes</dt><dd className="num">{formatDateTime(market.close)}</dd></div>
        <div><dt>Resolution opens</dt><dd className="num">{formatDateTime(market.resolve_after)}</dd></div>
        <div><dt>Creator</dt><dd><Addr address={market.creator} /></dd></div>
        {market.cbond_st ? (
          <div>
            <dt>Creator bond</dt>
            <dd><Gen wei={cbondWei(market)} /> — {cbondStateLabel(market)}. It returns in full when the
              market finalizes on any outcome, or on a pre-stake cancel; only a void splits it among the traders.</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
