// Wallet discovery: EIP-6963 announcements plus the legacy window.ethereum
// fallback (which also catches window.okxwallet-style single-provider
// browsers that never announce). Connect itself lives in genlayer.js and
// always requests accounts BEFORE any chain switch (the OKX lesson).
import { connectWallet, setWalletProvider } from "./genlayer.js";

export function discoverInjectedWallets(timeoutMs = 700) {
  return new Promise((resolve) => {
    const found = new Map();
    const guessName = (eth) => {
      if (!eth) return "Injected wallet";
      if (eth.isOkxWallet || eth.isOKExWallet) return "OKX Wallet";
      if (eth.isMetaMask) return "MetaMask";
      if (eth.isRabby) return "Rabby";
      if (eth.isBraveWallet) return "Brave Wallet";
      if (eth.isCoinbaseWallet) return "Coinbase Wallet";
      if (eth.isTrust) return "Trust Wallet";
      return "Browser wallet";
    };
    const add = (provider, name, id) => {
      if (!provider || typeof provider.request !== "function") return;
      if (found.has(provider)) return;
      found.set(provider, { id: id || `injected-${found.size}`, name, provider });
    };
    const onAnnounce = (event) => {
      const detail = event?.detail || {};
      if (detail.provider) add(detail.provider, detail.info?.name || "Injected wallet", detail.info?.rdns || detail.info?.uuid);
    };
    try {
      window.addEventListener("eip6963:announceProvider", onAnnounce);
      window.dispatchEvent(new window.Event("eip6963:requestProvider"));
    } catch { /* EIP-6963 unsupported — fallback below still runs */ }
    setTimeout(() => {
      try { window.removeEventListener("eip6963:announceProvider", onAnnounce); } catch {}
      if (typeof window !== "undefined") {
        if (window.ethereum) add(window.ethereum, guessName(window.ethereum), "legacy-ethereum");
        if (window.okxwallet && window.okxwallet !== window.ethereum) add(window.okxwallet, "OKX Wallet", "okxwallet");
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export async function connectInjected(provider) {
  setWalletProvider(provider);
  return connectWallet(provider);
}
