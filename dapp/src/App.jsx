import React, { useCallback, useEffect, useState } from "react";
import { StoreProvider, useStore } from "./lib/store.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { Toasts, TxBanner } from "./components/Toasts.jsx";
import { Board } from "./pages/Board.jsx";
import { MarketPanel } from "./pages/MarketPanel.jsx";
import { CreateMarket } from "./pages/CreateMarket.jsx";
import { Settings } from "./pages/Settings.jsx";
import { explorerAddressUrl } from "./lib/config.js";

function parseHash() {
  const h = window.location.hash.replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "market" && parts[1] && /^\d+$/.test(parts[1])) return { name: "market", id: Number(parts[1]) };
  if (parts[0] === "create") return { name: "create" };
  if (parts[0] === "settings") return { name: "settings" };
  return { name: "board" };
}

function hashFor(route, params) {
  if (route === "market") return `#/market/${params.id}`;
  if (route === "create") return "#/create";
  if (route === "settings") return "#/settings";
  return "#/";
}

function Shell() {
  const { contractKind, contractAddr, loadOverview } = useStore();
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview, contractAddr]);

  const navigate = useCallback((name, params = {}) => {
    const target = hashFor(name, params);
    if (window.location.hash === target) {
      setRoute(parseHash());
    } else {
      window.location.hash = target;
    }
  }, []);

  return (
    <div className="app">
      <TopBar route={route} navigate={navigate} />
      <TxBanner />
      {contractKind !== "production" && (
        <div className="contract-banner" role="status">
          {contractKind === "twin"
            ? "This board is bound to the proof twin — the same rules on a fast clock: minute-scale windows instead of days."
            : "This board is bound to a custom contract, not the production deployment."}{" "}
          <button type="button" className="textbtn" onClick={() => navigate("settings")}>Manage in Settings</button>
        </div>
      )}
      <main className="main">
        {route.name === "board" && <Board key={contractAddr} navigate={navigate} />}
        {route.name === "market" && <MarketPanel key={`${contractAddr}:${route.id}`} id={route.id} navigate={navigate} />}
        {route.name === "create" && <CreateMarket key={contractAddr} navigate={navigate} />}
        {route.name === "settings" && <Settings />}
      </main>
      <footer className="footer">
        <span>
          CallIt · GenLayer Bradbury (chain 4221) · contract{" "}
          <a className="mono" href={explorerAddressUrl(contractAddr)} target="_blank" rel="noreferrer">{contractAddr}</a>
        </span>
        <span>Committed criteria · an AI jury · parimutuel pools · UNRESOLVED refunds</span>
      </footer>
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
