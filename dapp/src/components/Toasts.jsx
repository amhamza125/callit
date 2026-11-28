import React from "react";
import { useStore } from "../lib/store.jsx";

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div className="toast-head">
            <strong>{t.title}</strong>
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>✕</button>
          </div>
          {t.body ? <p className="toast-body">{t.body}</p> : null}
          {t.txUrl ? (
            <a className="toast-link" href={t.txUrl} target="_blank" rel="noreferrer">View transaction ↗</a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TxBanner() {
  const { activeTx, TX_STAGES } = useStore();
  if (!activeTx) return null;
  const stageLabel = activeTx.failed
    ? `Ended as ${activeTx.status || "failed"} — check the explorer`
    : activeTx.hash
      ? `Consensus: ${TX_STAGES[Math.min(activeTx.stage, TX_STAGES.length - 1)]}…`
      : "Waiting for your wallet signature…";
  return (
    <div className={`txbanner ${activeTx.failed ? "txbanner-failed" : ""}`} role="status">
      <span className="txbanner-label">{activeTx.label}</span>
      <span className="txbanner-stage">{stageLabel}</span>
      {activeTx.hash ? <span className="txbanner-hash mono">{activeTx.hash.slice(0, 10)}…{activeTx.hash.slice(-6)}</span> : null}
    </div>
  );
}
