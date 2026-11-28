import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { Btn, Gen } from "./bits.jsx";
import { fetchClaimable, fetchPending } from "../lib/data.js";
import { pendingFor } from "../lib/journal.js";
import { ethBalance, formatDateTime, formatDuration } from "../lib/genlayer.js";
import { explorerTxUrl, windowsFor } from "../lib/config.js";
import { useNow } from "../lib/hooks.js";

/**
 * The pull-withdrawal machine for the connected wallet on ONE market:
 * claimable pot -> claim_payout (emits the transfer, records a pending)
 * -> confirm_withdrawal once the GEN has landed, or restore_pending if
 * it never did. Both the claimable pot and the pending are read fresh
 * from chain (get_claimable / the v2 get_pending view — amount plus the
 * emission time of the pending's first unconfirmed transfer). The
 * device journal now only supplies the claim transaction's hash for
 * the explorer link; a payout claimed on another device shows here
 * from chain alone.
 *
 * v2 timing rules, mirrored per deployment in config.js: a restore is
 * refused (PENDING_TOO_YOUNG) until the pending is RESTORE_DELAY old —
 * the panel counts that down and lets the contract answer verbatim if
 * raced — and a pending older than WRITEOFF_DELAY can be written off:
 * the record is extinguished without paying out, for a payment that
 * already arrived but was never confirmed. It never re-credits.
 */
export function WithdrawPanel({ market, tick = 0 }) {
  const { account, contractAddr, contractKind, runWrite, activeTx } = useStore();
  const windows = windowsFor(contractKind);
  const now = useNow();
  const [claimable, setClaimable] = useState(null);
  const [pending, setPending] = useState(undefined); // undefined = not read yet / read failed
  const [balance, setBalance] = useState(null);
  const [manual, setManual] = useState(false);
  const busy = !!activeTx;
  const id = market.id;

  const journaled = account ? pendingFor(contractAddr, account, id) : null;
  const hasPending = !!pending && pending.amt > 0n;

  useEffect(() => {
    let dead = false;
    if (!account) { setClaimable(null); setPending(undefined); return; }
    const read = async () => {
      try {
        const c = await fetchClaimable(account, id);
        if (!dead) setClaimable(c);
      } catch { /* retried on next refresh */ }
      const p = await fetchPending(account, id);
      if (!dead && p !== null) setPending(p);
    };
    read();
    const t = setInterval(read, 20000);
    return () => { dead = true; clearInterval(t); };
  }, [account, id, contractAddr, tick]);

  useEffect(() => {
    let dead = false;
    if (!account || !hasPending) { setBalance(null); return; }
    const read = async () => {
      try {
        const b = await ethBalance(account);
        if (!dead) setBalance(b);
      } catch { /* ignore */ }
    };
    read();
    const t = setInterval(read, 20000);
    return () => { dead = true; clearInterval(t); };
  }, [account, hasPending, tick]);

  if (!account) {
    return (
      <div className="purse">
        <h3 className="panel-title">Your purse</h3>
        <p className="hint">Connect your wallet to see and withdraw anything this market owes you.</p>
      </div>
    );
  }

  const age = hasPending ? now - pending.since : 0;
  const restoreIn = hasPending ? pending.since + windows.restoreDelaySeconds - now : 0;
  const writeoffReady = hasPending && age >= windows.writeoffDelaySeconds;

  return (
    <div className="purse">
      <h3 className="panel-title">Your purse on this market</h3>

      {claimable === null ? (
        <p className="hint">Reading your pot from chain…</p>
      ) : claimable > 0n && !hasPending ? (
        <>
          <p className="purse-amount"><Gen wei={claimable} /></p>
          <p className="hint">
            This sits in your claimable pot on this market. Claiming emits the transfer to your
            wallet; you then confirm once it lands — nothing is final until you do.
          </p>
          <Btn
            disabled={busy}
            onClick={() => runWrite("Claim payout", "claim_payout", [BigInt(id)], { payee: account, marketId: id })}
          >
            Claim <Gen wei={claimable} short />
          </Btn>
        </>
      ) : claimable > 0n && hasPending ? (
        <p className="hint">
          A withdrawal of <Gen wei={pending.amt} /> is already pending below. Confirm, restore or
          write it off first — a second claim opens only after that settles.
        </p>
      ) : !hasPending ? (
        <p className="hint">Your claimable pot on this market is empty right now.</p>
      ) : null}

      {hasPending ? (
        <div className="pending-box">
          <p className="pending-amount">
            Withdrawal pending: <Gen wei={pending.amt} />
          </p>
          <p className="hint">
            The contract emitted this transfer on {formatDateTime(pending.since)}
            {journaled && journaled.hash ? (
              <>
                {" "}in <a href={explorerTxUrl(journaled.hash)} target="_blank" rel="noreferrer">this transaction ↗</a>
              </>
            ) : null}
            . Bradbury transfers can take a while to land.
            {balance !== null ? <> Your wallet balance now reads <Gen wei={balance} />.</> : null}
          </p>
          <p className="hint">
            If the GEN has arrived in your wallet, confirm. If it never arrives, restore returns the
            amount to your pot — a restore opens {formatDuration(windows.restoreDelaySeconds)} after
            the payout was emitted
            {restoreIn > 0 ? (
              <> (in <b className="num">{formatDuration(restoreIn)}</b> — restoring earlier is refused with PENDING_TOO_YOUNG)</>
            ) : (
              <> (that time has passed)</>
            )}
            , and the contract allows it only while it physically backs the whole pending pool, so a
            restore can also be refused with INSUFFICIENT_BACKING until other payees confirm theirs.
          </p>
          <div className="btn-row">
            <Btn
              variant="yes"
              disabled={busy}
              onClick={() => runWrite("Confirm withdrawal", "confirm_withdrawal", [BigInt(id)], { marketId: id })}
            >
              It landed — confirm
            </Btn>
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() => runWrite("Restore pending", "restore_pending", [BigInt(id)], { marketId: id })}
            >
              It never landed — restore
            </Btn>
          </div>
          {writeoffReady ? (
            <>
              <p className="hint">
                This pending is over {formatDuration(windows.writeoffDelaySeconds)} old. If the GEN did
                arrive long ago but was never confirmed, the stale record keeps blocking restores
                behind the backing check. Writing it off removes the record without paying out — only
                for a payment that already arrived but was never confirmed. It never re-credits the
                amount to anyone's pot.
              </p>
              <div className="btn-row">
                <Btn
                  variant="ghost"
                  disabled={busy}
                  onClick={() => runWrite("Write off pending", "write_off_pending", [BigInt(id), account], { marketId: id })}
                >
                  Write off this pending
                </Btn>
              </div>
            </>
          ) : null}
        </div>
      ) : pending === undefined && claimable !== null ? (
        <p className="purse-manual">
          <button type="button" className="textbtn" onClick={() => setManual((m) => !m)}>
            {manual ? "Hide" : "Claimed a payout for this market from another device?"}
          </button>
          {manual && (
            <span className="manual-row">
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => runWrite("Confirm withdrawal", "confirm_withdrawal", [BigInt(id)], { marketId: id })}
              >
                Confirm withdrawal
              </Btn>
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => runWrite("Restore pending", "restore_pending", [BigInt(id)], { marketId: id })}
              >
                Restore pending
              </Btn>
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => runWrite("Write off pending", "write_off_pending", [BigInt(id), account], { marketId: id })}
              >
                Write off pending
              </Btn>
              <span className="hint">The pending read did not answer — if nothing is pending, the contract answers NO_PENDING.</span>
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}
