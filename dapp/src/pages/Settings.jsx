import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { Addr, Btn, Field, Gen } from "../components/bits.jsx";
import { PRODUCTION_ADDRESS, TWIN_ADDRESS, FEE_WEI, explorerAddressUrl, windowsFor } from "../lib/config.js";
import { isValidAddress, formatDateTime, formatDuration } from "../lib/genlayer.js";
import { fetchPending } from "../lib/data.js";

/**
 * Settings — the only home of the contract identity and switcher
 * (production / proof twin / a probed custom deployment, persisted in
 * localStorage), the wallet section, and the contract-admin panel
 * (two-step ownership transfer).
 */
export function Settings() {
  const {
    contractAddr, contractKind, switchContract, resetContract, probeContract,
    account, setChooserOpen, disconnect, overview, loadOverview,
    runWrite, activeTx,
  } = useStore();
  const busy = !!activeTx;
  const [candidate, setCandidate] = useState("");
  const [switchState, setSwitchState] = useState({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [newAdmin, setNewAdmin] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [woMarket, setWoMarket] = useState("");
  const [woPayee, setWoPayee] = useState("");
  const [woInfo, setWoInfo] = useState(null); // { amt, since } | "none" | "error"
  const [woBusy, setWoBusy] = useState(false);

  useEffect(() => { loadOverview(); }, [loadOverview, contractAddr]);

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(contractAddr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };

  const pickKnown = (addr) => {
    if (addr.toLowerCase() === contractAddr.toLowerCase()) return;
    switchContract(addr);
    setSwitchState({ kind: "done", text: "Switched. Every page now reads from the selected contract." });
  };

  const replaceCustom = async () => {
    const value = candidate.trim();
    if (!isValidAddress(value)) {
      setSwitchState({ kind: "error", text: "That doesn't look like a contract address — addresses are 0x followed by 40 hex characters. Nothing was checked on chain." });
      return;
    }
    if (value.toLowerCase() === contractAddr.toLowerCase()) {
      setSwitchState({ kind: "error", text: "That is the contract this app is already using." });
      return;
    }
    setSwitchState({ kind: "checking" });
    const result = await probeContract(value);
    if (!result.ok) {
      setSwitchState({ kind: "error", text: `${result.reason || "That address didn't answer as a CallIt contract."} It wasn't accepted — the app is still using the contract above.` });
      return;
    }
    switchContract(value);
    setCandidate("");
    setSwitchState({ kind: "done", text: "Switched. The address answered get_overview as a CallIt contract, and a note at the top of every page says a non-production contract is in use until you switch back." });
  };

  const admin = overview?.owner || null;
  const isAdmin = account && admin && account.toLowerCase() === admin.toLowerCase();

  const woWindows = windowsFor(contractKind);
  const woMarketId = /^\d+$/.test(woMarket.trim()) ? Number(woMarket.trim()) : null;
  const woPayeeValid = isValidAddress(woPayee.trim());

  const lookupPending = async () => {
    if (woMarketId === null || !woPayeeValid) return;
    setWoBusy(true);
    try {
      const p = await fetchPending(woPayee.trim(), woMarketId);
      if (p === null) setWoInfo("error");
      else if (p.amt <= 0n) setWoInfo("none");
      else setWoInfo(p);
    } finally {
      setWoBusy(false);
    }
  };

  const doWriteOff = () => {
    if (woMarketId === null || !woPayeeValid) return;
    runWrite("Write off pending", "write_off_pending", [BigInt(woMarketId), woPayee.trim().toLowerCase()], { marketId: woMarketId });
    setWoInfo(null);
  };

  const doTransfer = () => {
    const target = newAdmin.trim().toLowerCase();
    if (!isValidAddress(target) || target === "0x0000000000000000000000000000000000000000") {
      setAdminErr("Enter a valid new admin address.");
      return;
    }
    setAdminErr("");
    runWrite("Name the next admin", "transfer_ownership", [target]);
  };

  return (
    <div className="page narrow">
      <h1 className="display">Settings</h1>
      <p className="lede">The contract this board is bound to, your wallet, and the contract's administration.</p>

      <section className="panel form-panel">
        <h2 className="panel-title">The contract</h2>
        <dl className="meta-list">
          <div><dt>Network</dt><dd>GenLayer Bradbury testnet (chain 4221)</dd></div>
          <div><dt>In use</dt><dd>{contractKind === "production" ? "Production deployment" : contractKind === "twin" ? "Proof twin" : "A custom deployment"}</dd></div>
          <div>
            <dt>Address</dt>
            <dd className="mono break-all">{contractAddr}</dd>
          </div>
        </dl>
        <div className="btn-row">
          <Btn variant="ghost" className="btn-sm" onClick={copyAddr}>{copied ? "Copied" : "Copy address"}</Btn>
          <a className="btn btn-ghost btn-sm link-btn" href={explorerAddressUrl(contractAddr)} target="_blank" rel="noreferrer">
            View on the explorer ↗
          </a>
        </div>

        <h3 className="sub-title">Known deployments</h3>
        <div className="deploy-cards">
          <button
            type="button"
            className={`deploy-card ${contractKind === "production" ? "on" : ""}`}
            onClick={() => pickKnown(PRODUCTION_ADDRESS)}
          >
            <span className="deploy-name">Production</span>
            <span className="mono deploy-addr">{PRODUCTION_ADDRESS}</span>
            <span className="hint">Real windows: trading closes at least 1 h out, appeals run a full 24 h, expiry voids at 30 days / 7 days.</span>
            {contractKind === "production" ? <span className="deploy-on">In use</span> : null}
          </button>
          <button
            type="button"
            className={`deploy-card ${contractKind === "twin" ? "on" : ""}`}
            onClick={() => pickKnown(TWIN_ADDRESS)}
          >
            <span className="deploy-name">Proof twin</span>
            <span className="mono deploy-addr">{TWIN_ADDRESS}</span>
            <span className="hint">The same source on a fast clock: 60-second close lead and resolution gap, a 2-minute appeal window, voids in minutes — a whole market lifecycle rehearses end to end.</span>
            {contractKind === "twin" ? <span className="deploy-on">In use</span> : null}
          </button>
        </div>

        <h3 className="sub-title">Use a different deployment</h3>
        <p className="hint">
          Paste another CallIt contract address to bind the board to it. The app first asks the address
          to identify itself with get_overview — a wrong or unrelated address is refused, and nothing
          changes until the check passes. Your choice is kept on this device. Window lengths (appeal,
          voids, creation minimums) are mirrored for the two known deployments; a custom deployment is
          assumed to carry the production windows, and the contract remains the final judge either way.
        </p>
        <Field label="Contract address">
          <input
            className="textinput mono"
            placeholder="0x…"
            value={candidate}
            onChange={(e) => { setCandidate(e.target.value); setSwitchState({ kind: "idle" }); }}
          />
        </Field>
        <div className="btn-row">
          <Btn disabled={!candidate.trim() || switchState.kind === "checking"} onClick={replaceCustom}>
            {switchState.kind === "checking" ? "Asking the contract…" : "Check and switch"}
          </Btn>
          <Btn variant="ghost" disabled={contractKind === "production"} onClick={() => { resetContract(); setSwitchState({ kind: "idle" }); }}>
            Reset to production
          </Btn>
        </div>
        {switchState.kind === "error" && <p className="msg err" role="alert"><b>Not switched.</b> {switchState.text}</p>}
        {switchState.kind === "done" && <p className="msg warn" role="status"><b>Switched.</b> {switchState.text}</p>}
      </section>

      <section className="panel form-panel">
        <h2 className="panel-title">Wallet</h2>
        {account ? (
          <>
            <dl className="meta-list">
              <div><dt>Connected</dt><dd><Addr address={account} full /></dd></div>
              <div><dt>Network</dt><dd>GenLayer Bradbury testnet</dd></div>
              <div>
                <dt>Standing</dt>
                <dd>
                  {isAdmin
                    ? "You are the contract admin of the deployment in use."
                    : "A reader and actor — your roles are per market (creator, position holder) and are named on each market's page."}
                </dd>
              </div>
            </dl>
            <Btn variant="ghost" onClick={disconnect}>Disconnect</Btn>
          </>
        ) : (
          <>
            <p className="hint">No wallet connected. Reading works without one; writing needs a wallet on Bradbury.</p>
            <Btn onClick={() => setChooserOpen(true)}>Connect wallet</Btn>
          </>
        )}
      </section>

      <section className="panel form-panel">
        <h2 className="panel-title">Contract administration</h2>
        <p className="hint">
          The admin receives the settlement fee and holds no power over any market, outcome, or
          position. Administration moves in two steps: the current admin names a successor, and the
          successor accepts. The contract does not expose the pending successor through any view, so
          the accept button is offered to every connected wallet — the contract answers
          NO_PENDING_ADMIN unless you were named.
        </p>
        <dl className="meta-list">
          <div><dt>Admin of this deployment</dt><dd>{admin ? <Addr address={admin} full /> : "Reading…"}</dd></div>
          <div><dt>Settlement fee</dt><dd><Gen wei={FEE_WEI} /> per decisive settlement (only when the pool exceeds it), credited to the admin's claimable pot on that market</dd></div>
        </dl>
        {isAdmin ? (
          <>
            <Field label="Successor's address" error={adminErr || undefined}>
              <input
                className="textinput mono"
                placeholder="0x…"
                value={newAdmin}
                disabled={busy}
                onChange={(e) => setNewAdmin(e.target.value)}
              />
            </Field>
            <Btn disabled={busy || !newAdmin.trim()} onClick={doTransfer}>
              Name the successor
            </Btn>
            <p className="hint">Nothing changes until the named address accepts, below or from their own visit here.</p>
          </>
        ) : (
          <p className="hint">Only the current admin can name a successor.</p>
        )}
        {account ? (
          <div className="btn-row top-gap">
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() => runWrite("Accept administration", "accept_ownership", [])}
            >
              Accept administration (if you were named)
            </Btn>
          </div>
        ) : null}

        {isAdmin ? (
          <>
            <h3 className="sub-title">Write off a stale pending (admin)</h3>
            <p className="hint">
              A withdrawal that landed in the payee's wallet but was never confirmed leaves a stale
              pending record that blocks every restore behind the backing check. Once the pending is
              older than {formatDuration(woWindows.writeoffDelaySeconds)} on this deployment, the payee
              or the admin can write it off: the record is extinguished without paying out — it never
              re-credits the amount — and the total stays visible in the board's written-off figure.
              The payee can also do this from their own purse on the market's page.
            </p>
            <Field label="Market id">
              <input
                className="textinput mono"
                inputMode="numeric"
                placeholder="1"
                value={woMarket}
                disabled={busy}
                onChange={(e) => { setWoMarket(e.target.value); setWoInfo(null); }}
              />
            </Field>
            <Field label="Payee address">
              <input
                className="textinput mono"
                placeholder="0x…"
                value={woPayee}
                disabled={busy}
                onChange={(e) => { setWoPayee(e.target.value); setWoInfo(null); }}
              />
            </Field>
            <div className="btn-row">
              <Btn variant="ghost" disabled={busy || woBusy || woMarketId === null || !woPayeeValid} onClick={lookupPending}>
                {woBusy ? "Reading…" : "Look up the pending"}
              </Btn>
              {woInfo && woInfo !== "none" && woInfo !== "error" ? (
                <Btn disabled={busy} onClick={doWriteOff}>
                  Write off <Gen wei={woInfo.amt} short />
                </Btn>
              ) : null}
            </div>
            {woInfo === "none" ? (
              <p className="hint">That payee has no pending withdrawal on that market — the contract would answer NO_PENDING.</p>
            ) : woInfo === "error" ? (
              <p className="hint">The pending could not be read just now — try the lookup again.</p>
            ) : woInfo ? (
              <p className="hint">
                Pending: <Gen wei={woInfo.amt} />, emitted {formatDateTime(woInfo.since)}. Write-off
                opens {formatDateTime(woInfo.since + woWindows.writeoffDelaySeconds)} on this deployment —
                before that the contract answers PENDING_TOO_YOUNG.
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
