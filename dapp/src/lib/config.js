// CallIt — Bradbury configuration.
// Two known deployments of the v2 source: production (real windows:
// 1 h minimum close lead, 24 h appeal window, 30 d / 7 d void spans,
// 24 h restore delay, 30 d write-off delay) and the proof twin
// (identical except minute-scale windows: close lead 60 s, resolve
// gap 60 s, appeal window 120 s, void spans 900 s / 600 s, restore
// delay 300 s, write-off delay 1200 s).

export const PRODUCTION_ADDRESS = "0xD09a048eD5c411B75855e1B016044ab139083A00";
export const TWIN_ADDRESS = "0x767E4E02ae17367F613c412bd84A6190ca6a6f8E";

export const CHAIN_ID = 4221;
export const CHAIN_ID_HEX = "0x107d"; // 4221
export const CHAIN_NAME = "GenLayer Bradbury Testnet";
export const NODE_RPC_URL = "https://rpc-bradbury.genlayer.com"; // gen_call lives here
export const EXPLORER_URL = "https://scan.bradbury.genlayer.com";
export const EXPLORER_WEB_URL = "https://explorer-bradbury.genlayer.com";

// Protocol constants from the contract source (identical on both
// deployments): minimum stake, appeal bond, creator bond, fee.
export const MIN_STAKE_WEI = 1000000000000000n; // 0.001 GEN
export const BOND_WEI = 100000000000000n; // 0.0001 GEN
export const CREATOR_BOND_WEI = 5000000000000000n; // 0.005 GEN — attached to create_market, exactly
export const FEE_WEI = 100000000000000n; // 0.0001 GEN
export const MAX_TRADERS = 100;
export const MAX_QUESTION = 280;
export const MAX_CRITERIA = 1000;
export const MAX_SOURCE_URL = 500;
export const CLOSE_MAX_SECONDS = 90 * 86400; // 90 days, both deployments

// Per-deployment window constants. The market record carries the
// deadlines themselves (close, resolve_after, resolved_at), but the
// window LENGTHS are bare constants in the source and no view exposes
// them, so they are mirrored here per known deployment — the same
// approach the Heirloom dApp takes for its evidence-lost span. A custom
// contract falls back to the production values; the contract remains
// the final judge of every gate either way.
export const WINDOWS = {
  production: { closeMinSeconds: 3600, resolveGapSeconds: 3600, appealWindowSeconds: 24 * 3600, voidOpenSpanSeconds: 30 * 86400, voidAppealSpanSeconds: 7 * 86400, restoreDelaySeconds: 86400, writeoffDelaySeconds: 30 * 86400 },
  twin: { closeMinSeconds: 60, resolveGapSeconds: 60, appealWindowSeconds: 120, voidOpenSpanSeconds: 900, voidAppealSpanSeconds: 600, restoreDelaySeconds: 300, writeoffDelaySeconds: 1200 },
};
export function windowsFor(kind) {
  return WINDOWS[kind] || WINDOWS.production;
}

const CONTRACT_KEY = "callit:contract";

export function kindOfAddress(address) {
  const a = String(address || "").toLowerCase();
  if (a === PRODUCTION_ADDRESS.toLowerCase()) return "production";
  if (a === TWIN_ADDRESS.toLowerCase()) return "twin";
  return "custom";
}

export function loadContractAddress() {
  try {
    const saved = localStorage.getItem(CONTRACT_KEY);
    if (saved && /^0x[0-9a-fA-F]{40}$/.test(saved.trim())) return saved.trim();
  } catch { /* storage unavailable — default applies */ }
  return import.meta.env.VITE_CONTRACT_ADDRESS || PRODUCTION_ADDRESS;
}

export function saveContractAddress(address) {
  try {
    if (!address || address.toLowerCase() === PRODUCTION_ADDRESS.toLowerCase()) {
      localStorage.removeItem(CONTRACT_KEY);
    } else {
      localStorage.setItem(CONTRACT_KEY, address);
    }
  } catch { /* ignore */ }
}

export const explorerAddressUrl = (addr) => `${EXPLORER_URL}/address/${addr}`;
export const explorerTxUrl = (hash) => `${EXPLORER_URL}/tx/${hash}`;
