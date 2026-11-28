import React from "react";
import { weiToGen, weiToGenShort, shortAddress, formatDuration } from "../lib/genlayer.js";
import { explorerAddressUrl } from "../lib/config.js";
import { STATE_LABEL } from "../lib/data.js";

/** GEN amount in tabular mono, exact to the wei in the title. */
export function Gen({ wei, short = false, className = "" }) {
  if (wei === null || wei === undefined) return <span className={className}>—</span>;
  const text = short ? weiToGenShort(wei) : weiToGen(wei);
  return (
    <span className={`gen ${className}`} title={`${weiToGen(wei)} GEN (${String(wei)} wei)`}>
      {text} <span className="gen-unit">GEN</span>
    </span>
  );
}

/** Address with explorer link. */
export function Addr({ address, full = false, className = "" }) {
  if (!address) return <span className={className}>—</span>;
  return (
    <a
      className={`addr ${className}`}
      href={explorerAddressUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {full ? address : shortAddress(address)}
    </a>
  );
}

export function Btn({ children, variant = "accent", className = "", ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children, error }) {
  return (
    <div className="field">
      {label ? <label className="flabel">{label}</label> : null}
      {children}
      {hint ? <p className="fhint">{hint}</p> : null}
      {error ? <p className="ferror" role="alert">{error}</p> : null}
    </div>
  );
}

/** Basis points -> "62.5%". */
export function pct(bps) {
  const v = Number(bps) / 100;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/**
 * The live implied-odds bar: YES share of the pool as a glowing cyan
 * segment against the rose NO segment. Widths animate (CSS transition)
 * as fresh pool reads land. An empty pool renders an unlit track.
 */
export function OddsBar({ oddsYesBps, size = "md" }) {
  const y = Math.max(0, Math.min(10000, Number(oddsYesBps) || 0));
  const empty = y === 0;
  return (
    <div className={`oddsbar oddsbar-${size}`} role="img" aria-label={`Implied odds: YES ${pct(y)}, NO ${pct(10000 - y)}`}>
      <div className="oddsbar-track">
        <div className="oddsbar-yes" style={{ width: `${y / 100}%` }} />
        <div className="oddsbar-no" style={{ width: `${(10000 - y) / 100}%` }} />
      </div>
      <div className="oddsbar-ends">
        <span className="odds-yes-num num">YES {empty ? "—" : pct(y)}</span>
        <span className="odds-no-num num">NO {empty ? "—" : pct(10000 - y)}</span>
      </div>
    </div>
  );
}

/** Market state chip, coloured by phase; resolved chips carry the outcome. */
export function StateChip({ phase, outcome }) {
  const label = STATE_LABEL[phase] || phase;
  let text = label;
  if ((phase === "appeal-open" || phase === "appeal-pending" || phase === "finalizable") && outcome) {
    text = `${label.split("·")[0].trim()} · ${outcome}`;
  }
  if (phase === "final" && outcome) text = `Settled · ${outcome}`;
  return <span className={`chip chip-${phase}`}>{text}</span>;
}

/** Live countdown / elapsed label for a unix-second deadline. */
export function Timer({ until, now, futurePrefix = "", pastText = null }) {
  const t = Number(until);
  if (!t) return <span className="num">—</span>;
  const diff = t - now;
  if (diff > 0) return <span className="num">{futurePrefix}{formatDuration(diff)}</span>;
  return <span className="num">{pastText ?? `${formatDuration(-diff)} ago`}</span>;
}

export function RoleTags({ roles, isHolder }) {
  const tags = [
    roles.creator && "Creator",
    isHolder && "Position holder",
    roles.admin && "Contract admin",
  ].filter(Boolean);
  if (!tags.length) return <span className="roletag roletag-none">Reader</span>;
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="roletag">{t}</span>
      ))}
    </>
  );
}
