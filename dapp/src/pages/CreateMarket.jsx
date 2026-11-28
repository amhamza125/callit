import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { Btn, Field, Gen } from "../components/bits.jsx";
import { sourceUrlError, sourceSetError, registrableDomain } from "../lib/data.js";
import {
  windowsFor, MAX_QUESTION, MAX_CRITERIA, CLOSE_MAX_SECONDS, CREATOR_BOND_WEI,
} from "../lib/config.js";
import { formatDateTime, formatDuration, ethBalance } from "../lib/genlayer.js";

/** datetime-local value (local time) for a unix-second timestamp. */
function toLocalInput(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

/**
 * Create a market. The form mirrors the contract's creation validation
 * exactly — question/criteria lengths, exactly 3 https sources on
 * distinct registrable domains, close within [now + closeMin, now +
 * 90 days], resolve_after at least one resolution-gap past close —
 * so a bad market is caught before signing. The window minimums follow
 * the deployment in use (production: 1 h; proof twin: 60 s). The submit
 * attaches exactly the 0.005 GEN creator bond (v2) and is blocked
 * client-side when the wallet cannot cover the bond. The contract
 * stays the final judge.
 */
export function CreateMarket({ navigate }) {
  const { account, contractKind, runWrite, activeTx, setChooserOpen } = useStore();
  const windows = windowsFor(contractKind);
  const busy = !!activeTx;
  const nowS = Math.floor(Date.now() / 1000);

  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [sources, setSources] = useState(["", "", ""]);
  const [closeTs, setCloseTs] = useState(() => nowS + windows.closeMinSeconds + 3600);
  const [resolveTs, setResolveTs] = useState(() => nowS + windows.closeMinSeconds + 3600 + windows.resolveGapSeconds + 86400);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState(null);

  // The create call attaches the creator bond, so the wallet must hold
  // it (plus network fees) before signing — checked client-side with
  // the reason stated, per the v2 spec. A failed balance read does not
  // block: the wallet and the contract stay the judges.
  useEffect(() => {
    let dead = false;
    if (!account) { setBalance(null); return; }
    ethBalance(account).then((b) => { if (!dead) setBalance(b); }).catch(() => {});
    return () => { dead = true; };
  }, [account]);

  const bondShort = balance !== null && balance < CREATOR_BOND_WEI;

  const setSource = (i, v) => setSources((prev) => prev.map((s, j) => (j === i ? v : s)));

  const errors = useMemo(() => {
    const e = {};
    const q = question.trim();
    if (q.length < 1 || q.length > MAX_QUESTION) e.question = `1–${MAX_QUESTION} characters (the contract answers BAD_QUESTION). Now: ${q.length}.`;
    const c = criteria.trim();
    if (c.length < 1 || c.length > MAX_CRITERIA) e.criteria = `1–${MAX_CRITERIA} characters (BAD_CRITERIA). Now: ${c.length}.`;
    const perSource = sources.map((s) => (s.trim() ? sourceUrlError(s) : null));
    e.sources = perSource;
    e.sourceSet = sources.every((s) => s.trim()) ? sourceSetError(sources.map((s) => s.trim())) : null;
    if (!(closeTs >= nowS + windows.closeMinSeconds)) {
      e.close = `Close must be at least ${formatDuration(windows.closeMinSeconds)} in the future on this deployment (BAD_CLOSE).`;
    } else if (closeTs > nowS + CLOSE_MAX_SECONDS) {
      e.close = "Close must be at most 90 days in the future (BAD_CLOSE).";
    }
    if (!(resolveTs >= closeTs + windows.resolveGapSeconds)) {
      e.resolve = `Resolution must open at least ${formatDuration(windows.resolveGapSeconds)} after close (BAD_RESOLVE_TIME).`;
    }
    return e;
  }, [question, criteria, sources, closeTs, resolveTs, windows, nowS]);

  const formValid =
    !errors.question && !errors.criteria && !errors.sourceSet &&
    errors.sources.every((s) => !s) && sources.every((s) => s.trim()) &&
    !errors.close && !errors.resolve;

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await runWrite("Create market", "create_market", [
        question.trim(),
        criteria.trim(),
        JSON.stringify(sources.map((s) => s.trim())),
        BigInt(closeTs),
        BigInt(resolveTs),
      ], { value: CREATOR_BOND_WEI, marketId: null });
      const newId = res && typeof res.returnValue === "string" ? Number(res.returnValue) : NaN;
      if (Number.isInteger(newId) && newId > 0) navigate("market", { id: newId });
      else navigate("board");
    } finally {
      setSubmitting(false);
    }
  };

  const closeChips = [
    { label: `Minimum (+${formatDuration(windows.closeMinSeconds)})`, ts: nowS + windows.closeMinSeconds + 120 },
    { label: "+1 day", ts: nowS + 86400 },
    { label: "+7 days", ts: nowS + 7 * 86400 },
    { label: "+30 days", ts: nowS + 30 * 86400 },
  ];
  const resolveChips = [
    { label: `Minimum (+${formatDuration(windows.resolveGapSeconds)} after close)`, ts: closeTs + windows.resolveGapSeconds + 120 },
    { label: "Close + 1 day", ts: closeTs + 86400 },
    { label: "Close + 7 days", ts: closeTs + 7 * 86400 },
  ];

  return (
    <div className="page narrow">
      <h1 className="display">Create a market</h1>
      <p className="lede">
        Ask a question only judgment can settle. You commit the question, the exact resolution criteria
        and three named sources — the jury will judge against precisely that standard.
      </p>

      <section className="panel form-panel">
        <Field label={`Question (${question.trim().length}/${MAX_QUESTION})`} error={errors.question}>
          <input
            className="textinput"
            placeholder="Will the studio announce a sequel before the premiere?"
            value={question}
            maxLength={MAX_QUESTION + 40}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </Field>

        <Field
          label={`Resolution criteria (${criteria.trim().length}/${MAX_CRITERIA})`}
          hint="Write the standard the jury applies: what counts as YES, what counts as NO, and what the sources must show. Verbatim, complete, unambiguous — it can never be edited."
          error={errors.criteria}
        >
          <textarea
            className="textinput textarea"
            rows={5}
            placeholder="YES if at least two of the three named sources report, before the resolution time, that the studio has officially announced a sequel. NO if the premiere passes with no such announcement reported by at least two sources."
            value={criteria}
            maxLength={MAX_CRITERIA + 60}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </Field>

        <div className="field">
          <label className="flabel">Named sources — exactly 3, on 3 distinct domains</label>
          {sources.map((s, i) => {
            const dom = s.trim() ? registrableDomain(s.trim()) : null;
            return (
              <div key={i} className="source-row">
                <span className="source-idx num">SOURCE {i + 1}</span>
                <input
                  className="textinput mono"
                  placeholder="https://example.com/the-page-the-jury-will-read"
                  value={s}
                  onChange={(e) => setSource(i, e.target.value)}
                />
                <span className="source-dom num">{dom ? `domain: ${dom}` : ""}</span>
                {errors.sources[i] ? <p className="ferror" role="alert">{errors.sources[i]}</p> : null}
              </div>
            );
          })}
          <p className="fhint">
            All three must be https pages the jury can fetch at resolution time. If any one is
            unreachable or non-200 when the jury runs, the round records EVIDENCE_UNAVAILABLE and no
            verdict is stored — resolution retries, it never guesses from fewer sources.
          </p>
          {errors.sourceSet ? <p className="ferror" role="alert">{errors.sourceSet}</p> : null}
        </div>

        <div className="dt-grid">
          <Field label="Trading closes" error={errors.close}>
            <input
              type="datetime-local"
              className="textinput mono"
              value={toLocalInput(closeTs)}
              onChange={(e) => setCloseTs(fromLocalInput(e.target.value))}
            />
            <div className="quick-row">
              {closeChips.map((c) => (
                <button key={c.label} type="button" className="quick-chip" onClick={() => setCloseTs(c.ts)}>{c.label}</button>
              ))}
            </div>
            <p className="fhint num">{formatDateTime(closeTs)}</p>
          </Field>
          <Field label="Resolution opens" error={errors.resolve}>
            <input
              type="datetime-local"
              className="textinput mono"
              value={toLocalInput(resolveTs)}
              onChange={(e) => setResolveTs(fromLocalInput(e.target.value))}
            />
            <div className="quick-row">
              {resolveChips.map((c) => (
                <button key={c.label} type="button" className="quick-chip" onClick={() => setResolveTs(c.ts)}>{c.label}</button>
              ))}
            </div>
            <p className="fhint num">{formatDateTime(resolveTs)}</p>
          </Field>
        </div>

        <div className="immutable-note" role="note">
          <strong>These can never be edited.</strong> The question, the criteria, the three sources and
          both deadlines are committed on-chain the moment this transaction finalizes. A market with
          stakes can never be cancelled; it ends by resolution (an UNRESOLVED verdict refunds everyone)
          or by the expiry void.
        </div>

        <div className="immutable-note" role="note">
          <strong><Gen wei={CREATOR_BOND_WEI} short /> creator bond.</strong> Creating a market attaches
          a bond of exactly <Gen wei={CREATOR_BOND_WEI} /> — the contract refuses any other amount
          (BAD_BOND). The bond is returned in full when the market finalizes on any outcome, and also
          if you cancel the market before any stake is placed. It is split among the traders only if
          the market never settles and is voided.
        </div>

        {!account ? (
          <>
            <Btn onClick={() => setChooserOpen(true)}>Connect a wallet to create the market</Btn>
            <p className="disabled-reason">Creating a market is a signed, bonded write — reading this form needs no wallet.</p>
          </>
        ) : (
          <>
            <Btn disabled={busy || submitting || !formValid || bondShort} onClick={submit}>
              Commit the market — bond <Gen wei={CREATOR_BOND_WEI} short />
            </Btn>
            {bondShort ? (
              <p className="disabled-reason">
                Your wallet holds <Gen wei={balance} /> — creating a market attaches the <Gen wei={CREATOR_BOND_WEI} short /> creator
                bond, and the transaction needs network fees on top of it. Top up the wallet first.
              </p>
            ) : !formValid ? (
              <p className="disabled-reason">Fix the fields marked above — the form mirrors the contract's creation checks, so what passes here passes on chain.</p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
