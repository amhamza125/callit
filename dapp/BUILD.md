# CallIt dApp — build record (v2)

A Vite + React market board for the CallIt parimutuel prediction-market
contract on GenLayer Bradbury (chain 4221). Premium trading-terminal
theme: dark glass over near-black, cyan (#22d3ee) as the single brand
accent and the YES colour, rose for NO, Space Grotesk display type,
Inter body, IBM Plex Mono tabular numerals for every amount, odds
figure and countdown. No serif anywhere (that is Heirloom's voice).

Deployments wired in `src/lib/config.js` (v2 contracts):

- Production `0xD09a048eD5c411B75855e1B016044ab139083A00`
- Proof twin `0x767E4E02ae17367F613c412bd84A6190ca6a6f8E` (identical
  source, minute-scale windows)

What v2 changed in the contract, and where the dApp wires it:

- `create_market` is payable: exactly 0.005 GEN creator bond
  (`CREATOR_BOND`, else `BAD_BOND`). The create form attaches it, shows
  the bond terms next to the submit button, and blocks client-side
  when the wallet cannot cover the bond.
- The market record carries `cbond` (wei) and `cbond_st`
  (`HELD` / `RETURNED` / `SPLIT` / `ADMIN`). Board cards and the market
  panel show the bond amount + state from the record.
- New `get_pending(address, market_id)` view → `{"amt", "since"}`:
  the purse is driven by it (amount + first-emission time from chain).
  The device journal is retired as the pending source; it now only
  supplies the claim transaction's hash for the explorer link.
- `restore_pending` gained an age gate (`RESTORE_DELAY`, else
  `PENDING_TOO_YOUNG`) in front of the physical-backing gate
  (`INSUFFICIENT_BACKING`). The purse counts the restore delay down
  and lets the contract answer verbatim if raced.
- New `write_off_pending(market_id, payee)` (payee or admin, after
  `WRITEOFF_DELAY`, else `PENDING_TOO_YOUNG` / `NOT_PAYEE`):
  extinguishes a stale pending without paying out, never re-credits.
  Wired in the purse (own pending, once old enough) and in Settings'
  admin panel (any payee, with a get_pending lookup first).
- `get_overview` gained `written_off` — shown in the board's totals
  strip; the solvency note explains the balance gap with it.
- `friendlyError` keeps contract codes verbatim and adds plain-words
  notes for `PENDING_TOO_YOUNG`, `INSUFFICIENT_BACKING`, `BAD_BOND`.

## Pages → contract methods

Reads are walletless (genlayer-js against the node RPC). Writes go
through the connected EIP-1193 wallet on Bradbury; the store's
`runWrite` journals every hash, tracks consensus stages via the
explorer API, and surfaces contract error codes verbatim.

### Board (`#/`)
- `get_overview` — protocol totals strip (markets, lockw, tcw, tpw,
  written_off, contract balance + a solvency line comparing balance to
  the accounted total, worded for the v2 gap: a landed-but-unconfirmed
  withdrawal legitimately drops the balance below the accounted total
  until it is confirmed, and the written-off counter keeps the rest of
  the gap auditable).
- `get_market` × 1..nmarket (bounded concurrency 6, session SWR cache)
  — the card grid: question, live implied-odds bar from the record's
  pools, total pool, creator bond amount + state (`cbond_st`),
  close/resolution countdown, state chip.
- `get_position` × markets for the connected wallet — the "Your
  positions" strip across the top plus per-card stake badges.
- `get_pending` × markets for the connected wallet — the strip's
  pending-withdrawal rows (chain-read since v2, not journaled).
- Filters: All / Live / Resolving / Settled / Mine (client-side over
  chain records; phases derived in `lib/data.js`).

### Market panel (`#/market/<id>`)
- `get_market` — header, odds hero (big glowing odds bar, YES/NO/total
  pools, trader count, close time, creator bond amount + state),
  committed standard (criteria verbatim, the 3 source links, deadlines,
  creator, and the bond row with its disposition rules).
- `get_position` — your YES/NO stakes + first-stake `seq`; settlement
  preview while RESOLVED (mirrors the contract's finalize math:
  refund branch for UNRESOLVED/one-sided, floor pro-rata share,
  fee, appeal-bond disposition; labelled an estimate). The creator
  bond is not part of the preview: it returns to the creator's pot in
  full at finalize on any outcome, and the panel states that.
- `buy` — the stake ticket: YES/NO toggle with live implied odds,
  amount with quick chips, minimum-stake and MARKET_FULL gating with
  reasons in words, and the implied payout preview computed from the
  current pools as `(your existing same-side stake + new stake) /
  (side pool + new stake) × projected total pool`, labelled an
  estimate that later stakes, the settlement fee and the remainder
  rule will move.
- `resolve` — offered to anyone when resolution is open (OPEN past
  `resolve_after`), and again as the blind re-resolution while an
  appeal is pending. Failed rounds return `EVIDENCE_UNAVAILABLE` /
  `JURY_MALFORMED` strings from the contract; the store turns those
  into a warning toast and the panel shows the recorded attempt count.
- `appeal` — position holders only, inside the appeal window; the
  panel shows the exact 0.0001 GEN bond, the deadline computed from
  `resolved_at`, and warns in bold that the re-resolution is blind
  (the first verdict is never shown to the second jury) and replaces
  the verdict wholesale.
- `finalize` — anyone, enabled only in the finalizable phase (appeal
  window passed with no appeal, or an appeal re-resolved); disabled
  with the reason otherwise (window deadline, or APPEAL_PENDING).
  The panel notes the creator bond returns in full on any outcome.
- `void_market` — anyone, shown with its gate: enabled once the
  mirrored void span has passed for a stuck market, otherwise the
  opening time is stated (the contract answers TOO_EARLY before it).
  The panel states the v2 disposition: stakes refund in full, and the
  creator bond is split among the traders pro-rata (or goes to the
  admin's pot when there were no traders — `cbond_st` ADMIN).
- `cancel_market` — creator only, zero stakes, before close; the
  panel states the creator bond returns in full to the creator's pot.
  With stakes present it can never be cancelled (POOL_NOT_EMPTY).
- `claim_payout` / `confirm_withdrawal` / `restore_pending` /
  `write_off_pending` — the purse (below).

### Create market (`#/create`)
- `create_market` — question (≤280), criteria (≤1000), exactly 3
  source URLs, close and resolve_after pickers, and exactly
  0.005 GEN attached as the creator bond (`value = CREATOR_BOND_WEI`;
  any other amount is `BAD_BOND` on chain). The form mirrors the
  contract's validation: https-only, ≤500 chars, distinct registrable
  domains computed with the same last-two-labels rule as the
  contract's `_domain` (localhost / IP-literal / single-label hosts
  rejected), close within [now + closeMin, now + 90 days],
  resolve_after ≥ close + gap. The immutability notice and the bond
  notice sit directly above the submit button (bond returned in full
  on finalize on any outcome or on a pre-stake cancel; split among
  traders only on a void). The submit is blocked client-side, with
  the reason stated, when the connected wallet's balance is below
  the bond. On success the app navigates to the new market using the
  returned id.

### Settings (`#/settings`)
- The contract switcher (below), the wallet section, and the admin
  panel: `transfer_ownership` (admin only), `accept_ownership`
  (offered to any connected wallet — the contract exposes no pending-
  admin view, so the panel says the contract answers NO_PENDING_ADMIN
  unless you were named), and the admin `write_off_pending` tool:
  market id + payee address, a `get_pending` lookup showing the
  amount and emission time, then the write-off call itself.

### The purse (on every market panel)
- `get_claimable` and `get_pending` — always fresh reads.
- `claim_payout` carries the payout fee allocation (the only
  `_pay`-emitting write); `confirm_withdrawal` is driven in the same
  session flow; `restore_pending` is offered with the age-gate
  countdown (RESTORE_DELAY from the mirrored windows) and the
  INSUFFICIENT_BACKING explanation; `write_off_pending` appears once
  the pending is older than WRITEOFF_DELAY, labelled plainly: it
  removes the record without paying out — only for a payment that
  already arrived but was never confirmed — and never re-credits.
  If the `get_pending` read itself fails, a manual confirm / restore /
  write-off row is offered and the contract answers NO_PENDING when
  there is nothing pending.

## Switcher design

- The active address lives in the store, initialised from
  `localStorage["callit:contract"]` (or `VITE_CONTRACT_ADDRESS`, or
  production). Production / proof-twin cards switch instantly; the
  choice persists on the device and production is the implicit value
  (selecting it clears the key).
- A custom address is accepted only after a probe: `get_overview`
  must answer with a CallIt-shaped record (`owner` address +
  `nmarket`/`lockw`/`tcw`/`tpw`). A refusal changes nothing.
- Switching clears the in-memory record cache (cache keys are also
  contract-scoped) and every page remounts on the new address; a
  banner on every page names a non-production binding.
- Window lengths are bare constants in the contract source with no
  view, so `config.js` mirrors them per known deployment
  (production: close lead 3600 s, resolve gap 3600 s, appeal 24 h,
  voids 30 d / 7 d, restore delay 24 h, write-off delay 30 d;
  twin: 60 s / 60 s / 120 s / 900 s / 600 s / 300 s / 1200 s) and the
  UI derives phases, countdowns and form minimums from the mirror.
  Custom deployments fall back to the production values; the contract
  remains the final judge of every gate.

## Caching / perf

- `lib/cache.js`: sessionStorage + memory SWR cache for market and
  overview records (pots, positions and pendings are never cached —
  money reads are always fresh).
- Bounded-concurrency fan-out (`mapLimit`, 6) for the board list, the
  positions sweep and the pendings sweep.
- The tx/activity trail merges this device's journal (hashes recorded
  at signature time) with explorer txs whose decoded calldata targets
  the market — the contract stores no hashes, and nothing is invented.

## Flagged ambiguities (surfaced, not silently resolved)

1. **The claim tx hash is not chain-readable** — `get_pending` gives
   amount + emission time but no hash, so the purse's explorer link
   for a pending comes from this device's journal (recorded from
   `claim_payout`'s return string at claim time). A payout claimed on
   another device shows in the purse from chain, without the link.
2. **`pown` is not exposed by any view** — Settings cannot show a
   pending admin successor; the accept button is offered to all
   wallets with the limitation stated.
3. **Window lengths are not readable on-chain** — appeal/void/create
   minimums and the restore/write-off delays are mirrored per known
   deployment in `config.js` (see Switcher design). A custom
   deployment with different constants would show production-based
   countdowns while the contract enforces its own; every action still
   surfaces the contract's verdict.
4. **Settlement preview vs. the remainder rule** — the contract adds
   the floor-division remainder to the largest winning position
   (ties → smallest `seq`). The position panel shows the viewer's
   floor share and states the credited amount can be slightly higher;
   it does not try to predict remainder ownership across all traders.
5. **Appeal-pending previews** — while an appeal awaits re-resolution
   the bond's disposition (`bond_back`) is not yet determined, so the
   settlement preview assumes the bond joins the pool and labels
   itself an estimate whose verdict can change.
6. **`bond_back` on the market record** — the deployed record carries
   an internal `bond_back` field inside the appeal object beyond the
   spec's `{by, bond_held}` sketch; the panel reads it (after
   re-resolution) to state whether the bond returns or joins the pool.
   (This is the APPEAL bond — not the creator bond, whose state is
   the record's own `cbond_st` field.)
7. **create_market explorer matching** — its first calldata argument
   is the question text, not a market id, so creations appear in a
   market's activity trail only via this device's journal, never via
   explorer matching. Stated in `lib/journal.js`.

## Build

`npm install` then `npm run build` (Vite 5):

```
dist/index.html                   1.03 kB │ gzip:   0.55 kB
dist/assets/index-BV4dXrIX.css   18.39 kB │ gzip:   4.37 kB
dist/assets/ccip-TqrsEyXl.js      4.63 kB │ gzip:   2.05 kB
dist/assets/index-Bt4qfqy8.js   880.65 kB │ gzip: 211.57 kB
(!) Some chunks are larger than 500 kB after minification. …
✓ built in 6.10s
```

The >500 kB chunk note is the same one the reference dApps ship with.
A live read smoke test against both v2 deployments returned exactly
the shapes the app parses (`get_overview` JSON including
`written_off`, `get_pending` → `{"amt":"0","since":"0"}`; both
contracts fresh at `nmarket` 0). Deploy with `deploy.mjs`
(DepositCourt pattern; needs `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID`
for the CallIt project).
