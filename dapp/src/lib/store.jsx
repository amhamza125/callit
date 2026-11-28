import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { sendWrite, payoutFees, friendlyError, setContractAddress, readJsonView, readViewAt, parseJson } from "./genlayer.js";
import {
  recordTx, fetchTxStatus, stageIndexFor, isTerminalBadStatus, TX_STAGES,
  parsePendingReturn, recordPending, clearPending,
} from "./journal.js";
import {
  loadContractAddress, saveContractAddress, kindOfAddress, explorerTxUrl, PRODUCTION_ADDRESS,
} from "./config.js";
import { clearMemoryCache } from "./cache.js";

const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);

const initialContract = loadContractAddress();
setContractAddress(initialContract);

export function StoreProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [contractAddr, setContractAddr] = useState(initialContract);
  const [toasts, setToasts] = useState([]);
  const [activeTx, setActiveTx] = useState(null); // { label, hash, stage, fn, failed, status }
  const [overview, setOverview] = useState(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const refreshRef = useRef(null);
  const toastId = useRef(0);

  const pushToast = useCallback((t) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, ...t }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.sticky ? 15000 : 9000);
  }, []);

  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  const registerRefresh = useCallback((fn) => { refreshRef.current = fn; }, []);
  const refresh = useCallback(() => { if (refreshRef.current) refreshRef.current(); }, []);

  const loadOverview = useCallback(async () => {
    try {
      const ov = await readJsonView("get_overview", []);
      if (ov && typeof ov === "object") setOverview(ov);
      return ov;
    } catch {
      return null;
    }
  }, []);

  const switchContract = useCallback((address) => {
    setContractAddress(address);
    saveContractAddress(address);
    clearMemoryCache();
    setContractAddr(address);
    setOverview(null);
  }, []);

  const resetContract = useCallback(() => {
    switchContract(PRODUCTION_ADDRESS);
  }, [switchContract]);

  /**
   * Probe a candidate address: it must answer get_overview with a
   * CallIt-shaped record. Used by Settings before any switch.
   */
  const probeContract = useCallback(async (address) => {
    try {
      const raw = await readViewAt(address, "get_overview", []);
      const ov = parseJson(raw);
      if (
        ov && typeof ov === "object" &&
        typeof ov.owner === "string" && /^0x[0-9a-fA-F]{40}$/.test(ov.owner) &&
        "nmarket" in ov && "lockw" in ov && "tcw" in ov && "tpw" in ov
      ) {
        return { ok: true, overview: ov };
      }
      return { ok: false, reason: "That address answered, but not as a CallIt contract." };
    } catch {
      return { ok: false, reason: "That address did not answer get_overview on Bradbury." };
    }
  }, []);

  /**
   * Run one contract write with journaling + live stage progress.
   * opts: { value, payee (=> payoutFees), marketId }
   * Resolves the sendWrite result, or null on failure (toast already shown).
   */
  const runWrite = useCallback(async (label, functionName, args = [], opts = {}) => {
    if (!account) {
      pushToast({ kind: "error", title: "Wallet not connected", body: "Connect your wallet first — writes need your signature." });
      return null;
    }
    let fees = null;
    if (opts.payee) fees = await payoutFees(opts.payee);
    let hash = null;
    const tracker = { label, hash: null, stage: 0, fn: functionName };
    setActiveTx(tracker);
    let poller = null;
    try {
      const res = await sendWrite(account, functionName, args, opts.value || 0n, fees, {
        onHash: (h) => {
          hash = h;
          recordTx(contractAddr, { hash: h, fn: functionName, marketId: opts.marketId ?? null, label, account });
          setActiveTx({ ...tracker, hash: h });
          poller = setInterval(async () => {
            const st = await fetchTxStatus(h);
            if (!st) return;
            if (isTerminalBadStatus(st)) {
              setActiveTx((cur) => (cur && cur.hash === h ? { ...cur, failed: true, status: st } : cur));
              return;
            }
            const idx = stageIndexFor(st);
            if (idx >= 0) setActiveTx((cur) => (cur && cur.hash === h ? { ...cur, stage: idx, status: st } : cur));
          }, 4000);
        },
      });
      const rv = typeof res.returnValue === "string" ? res.returnValue : null;
      const execOk = !res.receipt || !res.receipt.execName || res.receipt.execName === "FINISHED_WITH_RETURN";

      // Pending-withdrawal journal: pending amounts are chain-readable
      // via get_pending (v2); the journal keeps the claim tx's hash,
      // parsed from claim_payout's return string, for the explorer link.
      if (execOk && functionName === "claim_payout") {
        const p = parsePendingReturn(rv);
        if (p) recordPending(contractAddr, { account: p.account, marketId: p.marketId, amountWei: p.amountWei, hash: res.hash });
      }
      if (execOk && (functionName === "confirm_withdrawal" || functionName === "restore_pending" || functionName === "write_off_pending")) {
        clearPending(contractAddr, account, args[0]);
      }

      if (rv && (rv.startsWith("EVIDENCE_UNAVAILABLE") || rv.startsWith("JURY_MALFORMED"))) {
        pushToast({
          kind: "warn",
          title: `${label} — the jury round did not land`,
          body: `${rv} The attempt was recorded on the market; resolution stays open and anyone can retry.`,
          txUrl: res.hash ? explorerTxUrl(res.hash) : null,
        });
      } else if (res.receipt && res.receipt.execName && res.receipt.execName !== "FINISHED_WITH_RETURN") {
        pushToast({
          kind: "warn",
          title: `${label} — ${res.receipt.execName}`,
          body: rv || "The transaction finalized without a return value. State was re-read from chain.",
          txUrl: res.hash ? explorerTxUrl(res.hash) : null,
        });
      } else {
        pushToast({
          kind: "ok",
          title: label,
          body: rv || "Finalized on chain.",
          txUrl: res.hash ? explorerTxUrl(res.hash) : null,
        });
      }
      loadOverview();
      refresh();
      return res;
    } catch (err) {
      pushToast({ kind: "error", title: `${label} failed`, body: friendlyError(err), txUrl: hash ? explorerTxUrl(hash) : null });
      return null;
    } finally {
      if (poller) clearInterval(poller);
      setActiveTx(null);
    }
  }, [account, pushToast, refresh, contractAddr, loadOverview]);

  const disconnect = useCallback(() => setAccount(null), []);

  const value = {
    account, setAccount, disconnect,
    contractAddr, contractKind: kindOfAddress(contractAddr),
    switchContract, resetContract, probeContract,
    overview, loadOverview,
    chooserOpen, setChooserOpen,
    toasts, pushToast, dismissToast,
    activeTx, runWrite, registerRefresh, refresh,
    TX_STAGES,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
