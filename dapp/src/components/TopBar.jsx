import React, { useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { discoverInjectedWallets, connectInjected } from "../lib/wallet.js";
import { friendlyError, shortAddress } from "../lib/genlayer.js";

function WalletChooser() {
  const { chooserOpen, setChooserOpen, setAccount, pushToast } = useStore();
  const [wallets, setWallets] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!chooserOpen) return;
    let dead = false;
    setWallets(null);
    discoverInjectedWallets().then((w) => { if (!dead) setWallets(w); });
    return () => { dead = true; };
  }, [chooserOpen]);

  if (!chooserOpen) return null;

  const pick = async (w) => {
    setBusy(true);
    try {
      const addr = await connectInjected(w.provider);
      setAccount(addr);
      setChooserOpen(false);
      pushToast({ kind: "ok", title: "Wallet connected", body: addr });
    } catch (e) {
      pushToast({ kind: "error", title: "Connection failed", body: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && setChooserOpen(false)}>
      <div className="modal" role="dialog" aria-label="Choose a wallet" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Connect a wallet</h2>
        <p className="hint">
          Reading the board needs no wallet. Writing — staking, resolving, appealing, withdrawing —
          is signed by your wallet on GenLayer Bradbury.
        </p>
        {wallets === null ? (
          <p className="hint">Looking for wallets…</p>
        ) : wallets.length === 0 ? (
          <p className="hint">
            No EVM wallet was found in this browser. Open this page inside a wallet browser
            (OKX, MetaMask, Rabby…) or install one, then try again.
          </p>
        ) : (
          <div className="wallet-list">
            {wallets.map((w) => (
              <button key={w.id} type="button" className="wallet-option" disabled={busy} onClick={() => pick(w)}>
                {w.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="textbtn" disabled={busy} onClick={() => setChooserOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function TopBar({ route, navigate }) {
  const { account, setChooserOpen, disconnect, contractAddr, contractKind } = useStore();
  const kindLabel = contractKind === "production" ? "Production" : contractKind === "twin" ? "Proof twin" : "Custom";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="#/" onClick={(e) => { e.preventDefault(); navigate("board"); }}>
          <span className="wordmark-bars" aria-hidden="true"><i className="wb-y" /><i className="wb-n" /></span>
          CALL<span className="wordmark-accent">IT</span>
          <span className="wordmark-sub">the market board · Bradbury</span>
        </a>
        <nav className="topnav">
          <a href="#/" className={route.name === "board" || route.name === "market" ? "on" : ""} onClick={(e) => { e.preventDefault(); navigate("board"); }}>
            Board
          </a>
          <a href="#/create" className={route.name === "create" ? "on" : ""} onClick={(e) => { e.preventDefault(); navigate("create"); }}>
            Create market
          </a>
          <a href="#/settings" className={route.name === "settings" ? "on" : ""} onClick={(e) => { e.preventDefault(); navigate("settings"); }}>
            Settings
          </a>
        </nav>
        <div className="topbar-right">
          <button
            type="button"
            className={`contract-chip ${contractKind !== "production" ? "chip-warn" : ""}`}
            title={contractAddr}
            onClick={() => navigate("settings")}
          >
            {kindLabel} · {shortAddress(contractAddr)}
          </button>
          {account ? (
            <span className="account-box">
              <span className="account-addr mono" title={account}>{shortAddress(account)}</span>
              <button type="button" className="textbtn" onClick={disconnect}>Disconnect</button>
            </span>
          ) : (
            <button type="button" className="btn btn-accent btn-sm" onClick={() => setChooserOpen(true)}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
      <WalletChooser />
    </header>
  );
}
