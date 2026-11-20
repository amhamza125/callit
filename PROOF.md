# CallIt — live proof record

Everything below was executed on chain and can be checked on the Bradbury
explorer (https://scan.bradbury.genlayer.com). Amounts are wei unless a
GEN figure is named (1 GEN = 1,000,000,000,000,000,000 wei).

## Deployments

| Deployment | Address | Deploy tx |
|---|---|---|
| Production | `0xD09a048eD5c411B75855e1B016044ab139083A00` | `0x531d907675a338ff9411355a9f3191eaabb329b938afa9dde23bfc48b2809c63` |
| Proof twin (fast clock) | `0x767E4E02ae17367F613c412bd84A6190ca6a6f8E` | `0x6166fa85323d39e78fb633cf16fa6f16549d0b04fc475cbecd9bae0b0736573b` |

Both deploys finalized with MAJORITY_AGREE / FINISHED_WITH_RETURN. The
production source is `CallIt.py` in this repo, sha256
`1a3aadd47c5273e17daf40fd403df1bf393dad4525a6fe1d9e97d5dc12d8f2e5`.
The twin runs the same logic with shortened time constants (appeal
window 120 s, restore delay 300 s, write-off delay 1,200 s, void spans
900 s / 600 s, close minimum 60 s) so the full lifecycle fits in one
session.

## Offline suite

`tests/test_pure.py` (stubbed GenVM, run locally): **39 passed,
0 failed** — creation and bond validation, trading gates, decisive /
refund / one-sided settlement arithmetic, the appeal bond in both
dispositions, the creator bond across finalize, void-split and cancel,
the restore age gate, the write-off path, plus the v1 lifecycle
controls. Conservation is asserted after every scenario.

## Live proof — proof twin, driven through the dApp

Run 2026-11-17 through https://callit-ameer-hamza-s-projects2.vercel.app
with three test wallets (A creator/admin, B and C traders). All ten
proof beats passed; eight purses were claimed and confirmed; fund
conservation held at all 37 checkpoints; the twin ended at exactly
zero (locked 0, claimable 0, pending 0, written off 0, balance 0).

### Market 1 — decisive YES, creator bond returned

Created with the 0.005 GEN bond (bond state HELD). Stakes: B YES
0.01 GEN, C NO 0.005 GEN, A YES 0.005 GEN. The jury resolved **YES /
CRITERIA_MET on attempt 1** — tx
`0x990e24313544e6a1451e68726b6407daa021c2eec7c377d844775ec09b208a72`.
At finalize: B's pot **29,900,000,000,000,000** wei, C 0, and A's pot
**5,100,000,000,000,000** wei — the 0.005 GEN creator bond returned in
full plus the 100,000,000,000,000 wei protocol fee (A is both creator
and admin). Bond state: RETURNED.

### The restore age gate, attacked live

B claimed the 29,900,000,000,000,000 wei pot (claim tx
`0xe8673aeb51c14aa75ac0a928135aff1e9279fcc2d191a86dd2b1e0895749b9ba`)
and immediately tried `restore_pending` while the transfer was still in
flight — pending age 121 s against the twin's 300 s gate. The
transaction is on chain rejected with **PENDING_TOO_YOUNG** — tx
`0x9c9da2e1c7c65961f302fc1a2bd72b539c5a89a432239b4b1df1254093a06c25` —
and the pending record stood unchanged. The transfer then landed and B
confirmed normally. The same money can never be paid twice.

### Market 2 — voided, creator bond split pro-rata

Stakes: B YES 0.02 GEN, C YES 0.01 GEN, plus a third stake of
0.005 GEN. Voided after its resolution time plus the twin's void span.
Pots came out exact to the wei: **B 23,333,333,333,333,334** wei
(0.02 GEN stake back + 3,333,333,333,333,333 wei bond share + the
1-wei floor-division remainder, B holding the largest total stake) and
**C 11,666,666,666,666,666** wei (stake back + bond share). No fee.
Bond state: SPLIT.

### Market 3 — cancelled before any stake

The creator cancelled the market while it held no stakes; the 0.005 GEN
bond returned in full. Bond state: RETURNED.

### Market 4 — UNRESOLVED, exact refunds

The jury returned **UNRESOLVED / INSUFFICIENT_EVIDENCE on attempt 1**.
Every stake was refunded exactly, no fee was taken, and the creator
bond returned in full.

### A note on the appeal

No live appeal was run in this proof: the twin's 120-second appeal
window is shorter than Bradbury's finality lag (~106–122 s, measured in
this project's earlier proof work), so a live appeal cannot be
exercised honestly on a fast clock. The appeal logic is unchanged
apart from the creator-bond crediting at finalize, which Market 1
asserts directly, and appeal-plus-bond coexistence is covered by
offline test t37.

### A note on read rounding

The JavaScript client's bare-string views can round by a wei or two at
magnitudes above 10^16 (float53): during this proof, `get_claimable`
read one pot as 23,333,333,333,333,336 wei against the exact
23,333,333,333,333,334. The contract's accounting is exact — the
string views (`get_pending`) and the overview counters agree to the
wei, and every payout above was verified against them.

## Production staging

Two markets are open on production, questions, criteria and sources as
committed at creation, each with its 0.005 GEN creator bond HELD:

- Market 1 — "Is GEN listed with a live price page on both
  CoinMarketCap and CoinGecko?" Create tx
  `0x3abb060785aacbc10502f9e361973db206b977a638a0231305dcf96bd49734f5`;
  stakes B YES 0.01 GEN (`0x8655a49518b8cddb3544a346b1ba1f97874bae93d6fc6b301fb239f7fa10357c`),
  C NO 0.005 GEN (`0x6e2e89ba964bb17d2ee83a014d966105941499679bca3ed097954f6096ad1ea7`),
  A YES 0.005 GEN (`0x2fa1eab7f053e491a6ed264ae23857da865abd17aca608082ba7c3643ef3b05e`).
  Pools: YES 15,000,000,000,000,000 wei, NO 5,000,000,000,000,000 wei.
- Market 2 — an example-domains question. Create tx
  `0xd17f69aedc96417b34962c7b9d44a1c2d61c0b14c41893d01ff5159d4da9d310`;
  stakes B YES 0.01 GEN (`0x4d416f030af4fe2e20f87424b0fb9876125724072b1f83fb2d7d1de56f05b3cf`),
  C YES 0.005 GEN (`0x6b0f0b407a9b9e195de81a6c5d7bb067420918b2e0157d8b8ac92270bf30a83f`).
  Pools: YES 15,000,000,000,000,000 wei, NO 0.

Both markets close 18 November 2026 (~11:19 PKT) and open for
resolution 19 November 2026 (~11:19 PKT). Overview after staging:
locked 45,000,000,000,000,000 wei, claimable 0, pending 0, contract
balance 45,000,000,000,000,000 wei — stakes (0.035 GEN) plus both
creator bonds (0.010 GEN), exact.
