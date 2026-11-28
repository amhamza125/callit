// GenLayer client for CallIt on Bradbury (genlayer-js 2.0.0-rc.2).
// Reads are walletless against the node RPC (the only endpoint serving
// gen_call). Writes go through the user's injected wallet on Bradbury.
// The active contract address is switchable (Settings): production, the
// proof twin, or a probed custom deployment of the same source.
//
// FEE POLICY (proven pattern from GrantFlow / DepositCourt / Heirloom):
// - Only claim_payout emits an external transfer (_pay), so only it
//   carries the payout allocation: recipient = the payee, budget =
//   0.0012 GEN = exactly 20x (gasLimit 200000 x maxGasPrice 300000000).
//   A FINISHED_WITH_RETURN receipt does NOT prove a payout — the
//   contract's pending record does; the dApp journals the emitted
//   amount from claim_payout's return string (see journal.js).
// - Every other write only mutates contract state or credits the pull
//   machine, so it uses baseFees().
// - The payable writes are buy (attaches exactly the stake entered)
//   and appeal (attaches exactly the 0.0001 GEN bond).

import { createClient, encodeExternalMessageFeeParams, MessageType, CALL_KEY_UNNAMED } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN_ID_HEX, CHAIN_NAME, NODE_RPC_URL, EXPLORER_URL } from "./config.js";
import { fetchTxReturnValue } from "./journal.js";

const FEE_DISTRIBUTION = {
  leaderTimeunitsAllocation: 100n,
  validatorTimeunitsAllocation: 200n,
  appealRounds: 0n,
  executionBudgetPerRound: 25000000000000000n,
  executionConsumed: 0n,
  totalMessageFees: 0n,
  rotations: [3n],
  maxPriceGenPerTimeUnit: 2n,
  storageFeeMaxGasPrice: 300000000n,
  receiptFeeMaxGasPrice: 300000000n,
};
const BASE_FEE_VALUE = 100000000000010352n;

const PAYOUT_GAS_LIMIT = 200000n;
const PAYOUT_MAX_GAS_PRICE = 300000000n;
export const PAYOUT_BUDGET = 1200000000000000n; // 0.0012 GEN

const FEE_MANAGER_ABI = parseAbi([
  "function calculateRoundFees((uint256 leaderTimeunitsAllocation, uint256 validatorTimeunitsAllocation, uint256 appealRounds, uint256 executionBudgetPerRound, uint256 executionConsumed, uint256 totalMessageFees, uint256[] rotations, uint256 maxPriceGenPerTimeUnit, uint256 storageFeeMaxGasPrice, uint256 receiptFeeMaxGasPrice) _feesDistribution, uint256 _numOfValidators, uint256 round) view returns (uint256 totalFeesToPay)",
]);

export function baseFees() {
  return {
    distribution: { ...FEE_DISTRIBUTION, rotations: [...FEE_DISTRIBUTION.rotations] },
    messageAllocations: [],
    feeValue: BASE_FEE_VALUE,
  };
}

async function liveRoundFees(totalMessageFees) {
  try {
    const pc = createPublicClient({ chain: testnetBradbury, transport: http(NODE_RPC_URL) });
    const distribution = { ...FEE_DISTRIBUTION, rotations: [...FEE_DISTRIBUTION.rotations], totalMessageFees };
    const roundFees = await pc.readContract({
      address: testnetBradbury.feeManagerContract.address,
      abi: FEE_MANAGER_ABI,
      functionName: "calculateRoundFees",
      args: [distribution, 5n, 0n],
    });
    return BigInt(roundFees);
  } catch {
    return BASE_FEE_VALUE;
  }
}

/** Fees for the one _pay-emitting call (claim_payout -> the caller). */
export async function payoutFees(payee) {
  const roundFees = await liveRoundFees(PAYOUT_BUDGET);
  const feeParams = encodeExternalMessageFeeParams({ gasLimit: PAYOUT_GAS_LIMIT, maxGasPrice: PAYOUT_MAX_GAS_PRICE });
  return {
    distribution: { ...FEE_DISTRIBUTION, rotations: [...FEE_DISTRIBUTION.rotations], totalMessageFees: PAYOUT_BUDGET },
    messageAllocations: [
      {
        messageType: MessageType.External,
        onAcceptance: false,
        parentIndex: (1n << 256n) - 1n,
        recipient: payee,
        callKey: CALL_KEY_UNNAMED,
        budget: PAYOUT_BUDGET,
        feeParams,
      },
    ],
    feeValue: roundFees + PAYOUT_BUDGET,
  };
}

// --- active contract --------------------------------------------------------
let activeContract = null;
export function setContractAddress(addr) { activeContract = addr; }
export function contractAddress() {
  if (!activeContract) throw new Error("Contract address not initialised.");
  return activeContract;
}

// --- wallet provider ---------------------------------------------------------
let activeProvider = null;
export function setWalletProvider(p) { activeProvider = p || null; }
export function walletProvider() {
  return activeProvider || (typeof window !== "undefined" ? window.ethereum : null);
}

function requestWithTimeout(provider, method, params, stepLabel, timeoutMs = 15000) {
  return Promise.race([
    provider.request(params ? { method, params } : { method }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`The wallet did not answer the ${stepLabel} request. It may be locked, or the request was blocked. Try again.`)), timeoutMs)
    ),
  ]);
}

/**
 * Connect: accounts FIRST, chain switch second. OKX and other in-app wallet
 * browsers silently drop a chain-switch from an unauthorised site — the
 * request never prompts and never settles (the GrantFlow OKX lesson).
 */
export async function connectWallet(provider) {
  const eth = provider || walletProvider();
  if (!eth) throw new Error("No EVM wallet detected. Open this page inside a wallet browser or install MetaMask / Rabby.");
  const accounts = await requestWithTimeout(eth, "eth_requestAccounts", null, "accounts");
  if (!accounts || accounts.length === 0) throw new Error("No accounts authorized in wallet.");
  try {
    await requestWithTimeout(eth, "wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }], "chain switch");
  } catch (err) {
    const code = err && err.code;
    const nestedCode = err && err.data && err.data.originalError && err.data.originalError.code;
    const msg = (err && err.message) || "";
    const chainNotAdded =
      code === 4902 || code === -32603 || nestedCode === 4902 ||
      /unrecognized chain|chain.*not added|4902/i.test(msg);
    if (chainNotAdded) {
      await requestWithTimeout(eth, "wallet_addEthereumChain", [{
        chainId: CHAIN_ID_HEX,
        chainName: CHAIN_NAME,
        rpcUrls: [NODE_RPC_URL],
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        blockExplorerUrls: [EXPLORER_URL],
      }], "add chain");
    } else {
      throw err;
    }
  }
  return accounts[0];
}

// --- clients -------------------------------------------------------------------
export function readClient() {
  return createClient({ chain: testnetBradbury, endpoint: NODE_RPC_URL });
}
export function writeClient(account) {
  return createClient({ chain: testnetBradbury, account, provider: walletProvider() });
}

// --- result parsing --------------------------------------------------------------
export function parseResult(raw) {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
}
export function parseJson(raw) {
  const s = parseResult(raw);
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return null; }
}

export async function readViewAt(address, functionName, args = []) {
  const client = readClient();
  return client.readContract({ address, functionName, args });
}
export async function readView(functionName, args = []) {
  return readViewAt(contractAddress(), functionName, args);
}
export async function readJsonView(functionName, args = []) {
  return parseJson(await readView(functionName, args));
}
/** Raw string view (get_claimable returns a bare wei string). */
export async function readStringView(functionName, args = []) {
  const raw = await readView(functionName, args);
  const s = parseResult(raw);
  return typeof s === "string" ? s : String(s ?? "0");
}

export async function ethBalance(address) {
  const r = await fetch(NODE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const j = await r.json();
  if (typeof j.result !== "string") throw new Error("eth_getBalance failed");
  return BigInt(j.result);
}

// --- writes ----------------------------------------------------------------------
/**
 * Send a write and wait for FINALIZED consensus. `opts.onHash` fires with
 * the tx hash as soon as the wallet returns it, so the caller can journal
 * the hash and start live progress tracking while consensus runs.
 * Resolves { hash, receipt, returnValue }.
 */
export async function sendWrite(account, functionName, args = [], value = 0n, fees = null, opts = {}) {
  const client = writeClient(account);
  const hash = await client.writeContract({
    address: contractAddress(),
    functionName,
    args,
    value,
    fees: fees || baseFees(),
  });
  if (typeof opts.onHash === "function") {
    try { opts.onHash(hash); } catch { /* a progress hook must never break the write */ }
  }
  let receipt = null;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, waitUntil: "finalized", retries: 360, interval: 5000 });
  } catch {
    // Slow consensus can outlast polling; the hash stays usable in the explorer.
  }
  if (receipt) {
    receipt.execName = receipt.txExecutionResultName || receipt.execName || null;
  }
  let returnValue = receipt ? parseResult(receipt.returnValue ?? receipt.result ?? null) : null;
  if (receipt && receipt.execName === "FINISHED_WITH_RETURN") {
    // The genlayer-js receipt carries no return value — its `result` is the
    // numeric consensus code, not the contract's string. Recover the real
    // return string from the explorer's execution trace (see journal.js);
    // the legacy expression above stays as the fallback when the trace is
    // unavailable or undecodable.
    const traced = await fetchTxReturnValue(hash);
    if (typeof traced === "string") returnValue = traced;
  }
  return { hash, receipt, returnValue };
}

// --- formatting --------------------------------------------------------------------
export function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function isValidAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

export function genToWei(gen) {
  const s = String(gen).trim();
  if (!s || Number.isNaN(Number(s)) || Number(s) < 0) throw new Error("Enter a GEN amount of 0 or more.");
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

/** Exact GEN rendering of a wei value: full precision, trailing zeros trimmed. */
export function weiToGen(wei) {
  try {
    const w = BigInt(wei);
    const neg = w < 0n;
    const a = neg ? -w : w;
    const whole = a / 10n ** 18n;
    const frac = a % 10n ** 18n;
    const body = frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
    return neg ? "-" + body : body;
  } catch {
    return "0";
  }
}

/** Compact GEN for board rows: up to 6dp. The wei-exact figure lives in the market panel. */
export function weiToGenShort(wei) {
  try {
    const w = BigInt(wei);
    const whole = w / 10n ** 18n;
    const frac = w % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return "0";
  }
}

/** Human duration for a seconds count: "6d 23h", "2 min 20 s", "45 s". */
export function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export function formatDateTime(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Plain-words readings of the contract codes a user is most likely to
// meet. The code itself always stays verbatim in front — these notes
// only translate it.
const ERROR_NOTES = {
  PENDING_TOO_YOUNG:
    "This withdrawal is too recent to restore or write off: a restore opens 24 hours after the payout was emitted, a write-off after 30 days (the proof twin uses 5 and 20 minutes).",
  INSUFFICIENT_BACKING:
    "The contract does not currently hold enough to back the whole pending pool — a withdrawal that already landed must be confirmed before restores can resume.",
  BAD_BOND:
    "The attached bond amount was wrong: creating a market takes exactly 0.005 GEN, and an appeal takes exactly 0.0001 GEN.",
};

export function friendlyError(err) {
  const msg = (err && (err.shortMessage || err.message)) || "Transaction failed.";
  // Surface the contract's own error code when the revert carries one.
  const m = /([A-Z][A-Z_]{3,})/.exec(msg);
  const code = m && /_/.test(m[1]) ? m[1] : null;
  if (code && ERROR_NOTES[code]) return `${code} — ${ERROR_NOTES[code]}`;
  const clean = msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
  return code ? `${code} — ${clean}` : clean;
}
