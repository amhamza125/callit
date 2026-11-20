"""Offline pure tests for CallIt v2 (stubbed GenVM). Run: python3 test_pure.py

t01..t37 implement the numbered test list of SPEC-v2.md (frozen 2026-11-17)
in the spec's own numbering: t01..t23 are v1's tests 1-23 as amended by the
bond and the restore fix; t24..t37 are the v2 additions (the scripted 1.1
attack, the timestamp/write-off suite, and the creator-bond suite). t38 and
t39 preserve v1's two extra controls (happy lifecycle with jury-prompt
hygiene; appeal re-resolution failure) after the spec numbering.

Conservation (balance == lockw + tcw + tpw + dust) is asserted after every
scenario. "dust" is the harness's model of call value that landed in the
contract balance before a gate rejected the call (the chain would refund it;
the accounted totals are what the assertions pin).

One staging note (t25): every real credit to a (market, payee) pot lands in
that market's single settlement call, so a pot credit arriving WHILE a
pending exists cannot be produced through the public method graph — the
contract's compounding rule for that state is defensive. t25 stages the
second credit directly (backed, tcw and balance moved together, exactly as a
settlement credit is backed) to exercise the rule through the public
claim/restore methods.
"""
import sys, json, calendar
sys.path.insert(0, "/home/hatch/workspace/callit/tests-v2")
import harness
from harness import fresh, call, expect_err, conserve, A, B, C, D, OUT, DAY
import genlayer as gl

T0 = calendar.timegm((2026, 11, 16, 0, 0, 0))
GEN = 10 ** 18
MIN = 10 ** 15              # MIN_STAKE 0.001 GEN
BOND = 10 ** 14             # appeal bond 0.0001 GEN
CBOND = 5 * 10 ** 15        # creator bond 0.005 GEN
FEE = 10 ** 14              # protocol fee 0.0001 GEN
APPEAL_WIN = 24 * 3600
RESTORE_DELAY = 86400
WRITEOFF_DELAY = 2592000
ADMIN = A
PASS = []
FAIL = []

def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print("PASS", name)
    except Exception as e:
        FAIL.append((name, repr(e)))
        print("FAIL", name, "->", repr(e))

Q = "Will the studio announce a sequel before the premiere?"
CRIT = "Met if at least two of the three named sources report, before the premiere, that the studio has officially announced a sequel."
S1 = "https://news.example.com/story"
S2 = "https://daily.sample.org/item"
S3 = "https://press.test.net/announcement"
SRCS = json.dumps([S1, S2, S3])
PAGE = ("<html><head><title>News</title></head><body>"
        "<p>The studio announced the sequel before the premiere.</p></body></html>").encode()

def serve_all():
    harness.WEB[S1] = PAGE
    harness.WEB[S2] = PAGE
    harness.WEB[S3] = PAGE

def mkmarket(c, creator=B, q=Q, crit=CRIT, srcs=SRCS):
    now = harness.now_unix()
    r = call(c, creator, c.create_market, q, crit, srcs, now + 7200, now + 10800, value=CBOND)
    return int(r)

def market(c, mid):
    return json.loads(c.get_market(mid))

def pot(c, addr, mid):
    return int(c.get_claimable(addr, mid))

def pos(c, addr, mid):
    return json.loads(c.get_position(addr, mid))

def pend(c, addr, mid):
    return json.loads(c.get_pending(addr, mid))

def verdict_stub(outcome, reason, capture=None):
    def fn(prompt, images):
        if capture is not None:
            capture["prompt"] = prompt
        return {"outcome": outcome, "reason_code": reason}
    return fn

def resolve_now(c, mid, outcome="YES", reason="CRITERIA_MET", capture=None):
    m = market(c, mid)
    harness.set_time(int(m["resolve_after"]))
    serve_all()
    harness.PROMPT_FN = verdict_stub(outcome, reason, capture)
    return call(c, OUT, c.resolve, mid)

def resolved_market(c, stakes, outcome="YES", reason="CRITERIA_MET", creator=B):
    mid = mkmarket(c, creator=creator)
    for who, side, amt in stakes:
        call(c, who, c.buy, mid, side, value=amt)
    r = resolve_now(c, mid, outcome, reason)
    assert "MARKET_RESOLVED" in r, r
    return mid

def finalize_after_window(c, mid):
    m = market(c, mid)
    harness.set_time(int(m["resolved_at"]) + APPEAL_WIN + 1)
    return call(c, OUT, c.finalize, mid)

# ---------------------------------------------------------------- spec test 1
def t01_create_text_lengths():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    close, ra = T0 + 7200, T0 + 10800
    expect_err(c, B, c.create_market, "", CRIT, SRCS, close, ra, code="BAD_QUESTION", value=CBOND)
    expect_err(c, B, c.create_market, "x" * 281, CRIT, SRCS, close, ra, code="BAD_QUESTION", value=CBOND)
    expect_err(c, B, c.create_market, Q, "", SRCS, close, ra, code="BAD_CRITERIA", value=CBOND)
    expect_err(c, B, c.create_market, Q, "y" * 1001, SRCS, close, ra, code="BAD_CRITERIA", value=CBOND)
    r = call(c, B, c.create_market, "x" * 280, "y" * 1000, SRCS, close, ra, value=CBOND)  # boundary control
    assert r == "1", r
    conserve(c, dust=4 * CBOND)

# ---------------------------------------------------------------- spec test 2
def t02_create_sources():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    close, ra = T0 + 7200, T0 + 10800
    bad = ["[]",
           json.dumps([S1, S2]),
           json.dumps([S1, S2, S3, "https://extra.other.io/x"]),
           json.dumps(["http://news.example.com/story", S2, S3]),
           json.dumps(["https://news.example.com/a", "https://blog.example.com/b", S3]),
           json.dumps(["https://localhost:8080/x", S2, S3]),
           json.dumps(["https://127.0.0.1/x", S2, S3]),
           json.dumps(["https://" + "a" * 490 + ".com/x", S2, S3])]
    for s in bad:
        expect_err(c, B, c.create_market, Q, CRIT, s, close, ra, code="BAD_SOURCES", value=CBOND)
    expect_err(c, B, c.create_market, Q, CRIT, "not json", close, ra, code="BAD_SOURCES", value=CBOND)
    conserve(c, dust=9 * CBOND)

# ---------------------------------------------------------------- spec test 3
def t03_create_windows():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, T0 + 3599, T0 + 10800, code="BAD_CLOSE", value=CBOND)
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, T0 + 90 * DAY + 1, T0 + 90 * DAY + 7201, code="BAD_CLOSE", value=CBOND)
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, T0 + 7200, T0 + 7200 + 3599, code="BAD_RESOLVE_TIME", value=CBOND)
    r = call(c, B, c.create_market, Q, CRIT, SRCS, T0 + 3600, T0 + 7200, value=CBOND)  # boundary control
    assert r == "1", r
    conserve(c, dust=3 * CBOND)

# ---------------------------------------------------------------- spec test 4
def t04_buy_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    m = market(c, mid)
    expect_err(c, C, c.buy, mid, "YES", code="STAKE_TOO_SMALL", value=MIN - 1)
    expect_err(c, C, c.buy, mid, "MAYBE", code="BAD_SIDE", value=MIN)
    harness.set_time(int(m["close"]))
    expect_err(c, C, c.buy, mid, "YES", code="TRADING_CLOSED", value=MIN)
    conserve(c, dust=3 * MIN - 1)
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = mkmarket(c2)
    call(c2, B, c2.cancel_market, mid2)
    expect_err(c2, C, c2.buy, mid2, "YES", code="BAD_STATE", value=MIN)
    conserve(c2, dust=MIN)
    c3 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid3 = resolved_market(c3, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    finalize_after_window(c3, mid3)
    expect_err(c3, C, c3.buy, mid3, "YES", code="BAD_STATE", value=MIN)
    conserve(c3, dust=MIN)

# ---------------------------------------------------------------- spec test 5
def t05_both_sides_position():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    call(c, C, c.buy, mid, "NO", value=3 * MIN)
    call(c, C, c.buy, mid, "YES", value=MIN)
    p = pos(c, C, mid)
    assert int(p["y"]) == 3 * MIN and int(p["n"]) == 3 * MIN and p["seq"] == 0, p
    call(c, B, c.buy, mid, "NO", value=MIN)
    assert pos(c, B, mid)["seq"] == 1
    m = market(c, mid)
    assert int(m["pool_y"]) == 3 * MIN and int(m["pool_n"]) == 4 * MIN
    assert m["traders"] == [C, B] and m["nseq"] == 2
    assert int(json.loads(c.get_overview())["lockw"]) == 7 * MIN + CBOND  # stakes + held creator bond
    conserve(c)

# ---------------------------------------------------------------- spec test 6
def t06_cancel_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    expect_err(c, C, c.cancel_market, mid, code="NOT_CREATOR")
    call(c, C, c.buy, mid, "YES", value=MIN)
    expect_err(c, B, c.cancel_market, mid, code="POOL_NOT_EMPTY")
    mid2 = mkmarket(c)
    harness.set_time(int(market(c, mid2)["close"]))
    expect_err(c, B, c.cancel_market, mid2, code="BAD_STATE")
    harness.set_time(T0)
    mid3 = mkmarket(c)
    r = call(c, B, c.cancel_market, mid3)
    assert "MARKET_CANCELLED" in r, r
    assert market(c, mid3)["st"] == "CANCELLED"
    # lockw: mid's stake + the two still-held creator bonds (mid, mid2);
    # mid3's bond left lockw when it returned to the creator's pot (test 36).
    assert int(json.loads(c.get_overview())["lockw"]) == MIN + 2 * CBOND
    conserve(c)

# ---------------------------------------------------------------- spec test 7
def t07_resolve_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    harness.set_time(int(market(c, mid)["resolve_after"]) - 1)
    expect_err(c, OUT, c.resolve, mid, code="TOO_EARLY")
    harness.set_time(T0)
    mid2 = mkmarket(c)
    call(c, B, c.cancel_market, mid2)
    expect_err(c, OUT, c.resolve, mid2, code="BAD_STATE")
    conserve(c)

# ---------------------------------------------------------------- spec test 8
def t08_evidence_unavailable():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    harness.set_time(int(market(c, mid)["resolve_after"]))
    harness.WEB.clear()
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET")  # never reached
    r = call(c, OUT, c.resolve, mid)
    assert r.startswith("EVIDENCE_UNAVAILABLE"), r
    m = market(c, mid)
    assert m["attempts"] == 1 and m["st"] == "OPEN" and m["outcome"] == "", m
    assert int(m["pool_y"]) == 2 * MIN and pot(c, C, mid) == 0
    harness.WEB[S1] = PAGE; harness.WEB[S2] = PAGE      # one source still down
    r = call(c, OUT, c.resolve, mid)
    assert r.startswith("EVIDENCE_UNAVAILABLE"), r
    assert market(c, mid)["attempts"] == 2 and market(c, mid)["st"] == "OPEN"
    harness.WEB[S3] = PAGE
    r = call(c, OUT, c.resolve, mid)                    # retry lands the verdict
    assert "MARKET_RESOLVED" in r, r
    assert market(c, mid)["attempts"] == 2 and market(c, mid)["outcome"] == "YES"
    conserve(c)

# ---------------------------------------------------------------- spec test 9
def t09_malformed_verdict():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    harness.set_time(int(market(c, mid)["resolve_after"]))
    serve_all()
    harness.PROMPT_FN = verdict_stub("MAYBE", "CRITERIA_MET")
    r = call(c, OUT, c.resolve, mid)
    assert r.startswith("JURY_MALFORMED"), r
    harness.PROMPT_FN = verdict_stub("YES", "BECAUSE")
    r = call(c, OUT, c.resolve, mid)
    assert r.startswith("JURY_MALFORMED"), r
    m = market(c, mid)
    assert m["attempts"] == 2 and m["st"] == "OPEN" and m["outcome"] == "", m
    assert int(m["pool_y"]) == 2 * MIN and pot(c, C, mid) == 0
    harness.PROMPT_FN = verdict_stub("UNRESOLVED", "SOURCES_CONFLICT")  # alias -> canonical
    r = call(c, OUT, c.resolve, mid)
    assert "MARKET_RESOLVED" in r, r
    m = market(c, mid)
    assert m["outcome"] == "UNRESOLVED" and m["reason"] == "INSUFFICIENT_EVIDENCE", m
    conserve(c)

# --------------------------------------------------------------- spec test 10
def t10_appeal_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", 2 * MIN)])
    expect_err(c, OUT, c.appeal, mid, code="NO_POSITION", value=BOND)
    expect_err(c, C, c.appeal, mid, code="BAD_BOND", value=BOND - 1)
    expect_err(c, C, c.appeal, mid, code="BAD_BOND", value=BOND + 1)
    r = call(c, C, c.appeal, mid, value=BOND)
    assert "APPEAL_FILED" in r, r
    expect_err(c, B, c.appeal, mid, code="APPEAL_ALREADY_FILED", value=BOND)
    conserve(c, dust=4 * BOND)
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    harness.set_time(int(market(c2, mid2)["resolved_at"]) + APPEAL_WIN + 1)
    expect_err(c2, C, c2.appeal, mid2, code="APPEAL_WINDOW_CLOSED", value=BOND)
    conserve(c2, dust=BOND)

# --------------------------------------------------------------- spec test 11
def t11_finalize_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    expect_err(c, OUT, c.finalize, mid, code="BAD_STATE")   # appeal window still open
    call(c, C, c.appeal, mid, value=BOND)
    expect_err(c, OUT, c.finalize, mid, code="APPEAL_PENDING")
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET")
    r = call(c, OUT, c.resolve, mid)                        # re-resolution lands
    assert "MARKET_RERESOLVED" in r, r
    r = call(c, OUT, c.finalize, mid)                       # now finalizable at once
    assert "MARKET_FINAL" in r, r
    assert market(c, mid)["st"] == "FINAL"
    conserve(c)

# --------------------------------------------------------------- spec test 12
# Split arithmetic isolated from the bond: the creator (OUT) holds no stake,
# so every figure below is the pure pool split; the bond's return to OUT's
# pot is asserted separately, and test 32 re-runs this exact pool shape with
# the creator inside the market.
def t12_decisive_split():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 10 ** 16), (D, "YES", 2 * 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    r = finalize_after_window(c, mid)
    assert "MARKET_FINAL" in r, r
    pool = 5 * 10 ** 16
    dist = pool - FEE
    win_total = 3 * 10 ** 16
    share_c = dist * 10 ** 16 // win_total
    share_d = dist * 2 * 10 ** 16 // win_total
    share_d += dist - share_c - share_d                     # remainder -> largest YES (D)
    assert pot(c, C, mid) == share_c, (pot(c, C, mid), share_c)
    assert pot(c, D, mid) == share_d, (pot(c, D, mid), share_d)
    assert pot(c, B, mid) == 0
    assert pot(c, ADMIN, mid) == FEE
    assert share_c + share_d + FEE == pool
    assert pot(c, OUT, mid) == CBOND                        # creator bond back, outside the split
    m = market(c, mid)
    assert m["win_total"] == str(win_total) and int(m["pool_y"]) == 0 and int(m["pool_n"]) == 0
    conserve(c)

# --------------------------------------------------------------- spec test 13
def t13_unresolved_refund():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c, creator=OUT)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    call(c, C, c.buy, mid, "NO", value=MIN)                 # both-sides trader
    call(c, B, c.buy, mid, "NO", value=4 * MIN)
    call(c, D, c.buy, mid, "YES", value=MIN)
    r = resolve_now(c, mid, "UNRESOLVED", "INSUFFICIENT_EVIDENCE")
    assert "MARKET_RESOLVED" in r, r
    finalize_after_window(c, mid)
    assert pot(c, C, mid) == 3 * MIN
    assert pot(c, B, mid) == 4 * MIN
    assert pot(c, D, mid) == MIN
    assert pot(c, ADMIN, mid) == 0                          # no fee on a refund
    assert 3 * MIN + 4 * MIN + MIN == 8 * MIN               # Sigma credits == pool
    assert pot(c, OUT, mid) == CBOND                        # bond back on top, not in the pool math
    conserve(c)

# --------------------------------------------------------------- spec test 14
def t14_bond_stands():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * 10 ** 16), (D, "YES", 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    call(c, C, c.appeal, mid, value=BOND)
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET")
    r = call(c, OUT, c.resolve, mid)
    assert "MARKET_RERESOLVED" in r, r
    assert market(c, mid)["appeal"]["bond_back"] is False
    call(c, OUT, c.finalize, mid)
    pool = 5 * 10 ** 16 + BOND                              # appeal bond joined the pool
    dist = pool - FEE
    win_total = 3 * 10 ** 16
    share_c = dist * 2 * 10 ** 16 // win_total
    share_d = dist * 10 ** 16 // win_total
    share_c += dist - share_c - share_d                     # remainder -> largest YES (C)
    assert pot(c, C, mid) == share_c, (pot(c, C, mid), share_c)   # no separate bond back
    assert pot(c, D, mid) == share_d
    assert pot(c, B, mid) == 0
    assert pot(c, ADMIN, mid) == FEE
    assert share_c + share_d + FEE == pool
    assert pot(c, OUT, mid) == CBOND                        # creator bond is a different object: back in full
    conserve(c)

# --------------------------------------------------------------- spec test 15
def t15_bond_flips():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * 10 ** 16), (D, "YES", 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    call(c, B, c.appeal, mid, value=BOND)
    harness.PROMPT_FN = verdict_stub("NO", "CRITERIA_NOT_MET")
    call(c, OUT, c.resolve, mid)
    assert market(c, mid)["appeal"]["bond_back"] is True
    call(c, OUT, c.finalize, mid)
    dist = 5 * 10 ** 16 - FEE                               # split on the pool WITHOUT the bond
    assert pot(c, B, mid) == dist + BOND                    # sole NO winner + bond back on top
    assert pot(c, C, mid) == 0 and pot(c, D, mid) == 0
    assert pot(c, ADMIN, mid) == FEE
    assert pot(c, OUT, mid) == CBOND
    conserve(c)
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * MIN), (B, "NO", 2 * MIN)], creator=OUT)
    call(c2, C, c2.appeal, mid2, value=BOND)
    harness.PROMPT_FN = verdict_stub("UNRESOLVED", "INSUFFICIENT_EVIDENCE")
    call(c2, OUT, c2.resolve, mid2)
    call(c2, OUT, c2.finalize, mid2)                        # turns UNRESOLVED -> refund path
    assert pot(c2, C, mid2) == 2 * MIN + BOND               # stake back + bond back on top
    assert pot(c2, B, mid2) == 2 * MIN
    assert pot(c2, ADMIN, mid2) == 0
    assert pot(c2, OUT, mid2) == CBOND
    conserve(c2)

# --------------------------------------------------------------- spec test 16
# Stake refunds are asserted exactly; the void's creator-bond split lands in
# the same pots, so the expected split shares (floor + remainder to the
# largest total stake) are computed here and asserted as part of each pot.
# The dedicated exact-figure split test is t34.
def _void_share(stake, total):
    return CBOND * stake // total

def t16_void_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    call(c, B, c.buy, mid, "NO", value=MIN)
    total = 3 * MIN
    sh_c = _void_share(2 * MIN, total)
    sh_b = _void_share(MIN, total)
    sh_c += CBOND - sh_c - sh_b                             # remainder -> largest total stake (C)
    ra = int(market(c, mid)["resolve_after"])
    harness.set_time(ra + 30 * DAY)
    expect_err(c, OUT, c.void_market, mid, code="TOO_EARLY")
    harness.set_time(ra + 30 * DAY + 1)
    r = call(c, OUT, c.void_market, mid)                    # outsider voids a stuck market
    assert "MARKET_VOID" in r, r
    assert market(c, mid)["st"] == "VOID"
    assert pot(c, C, mid) == 2 * MIN + sh_c
    assert pot(c, B, mid) == MIN + sh_b
    conserve(c)
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    rat2 = int(market(c2, mid2)["resolved_at"])
    harness.set_time(rat2 + 30 * DAY + 1)
    expect_err(c2, OUT, c2.void_market, mid2, code="BAD_STATE")   # RESOLVED, no appeal: never voidable
    finalize_after_window(c2, mid2)
    expect_err(c2, OUT, c2.void_market, mid2, code="BAD_STATE")   # FINAL: never voidable
    conserve(c2)
    c3 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid3 = resolved_market(c3, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    rat3 = int(market(c3, mid3)["resolved_at"])
    call(c3, C, c3.appeal, mid3, value=BOND)
    harness.set_time(rat3 + 7 * DAY)
    expect_err(c3, OUT, c3.void_market, mid3, code="TOO_EARLY")
    harness.set_time(rat3 + 7 * DAY + 1)
    r = call(c3, OUT, c3.void_market, mid3)                 # stuck appeal voids
    assert "MARKET_VOID" in r, r
    assert market(c3, mid3)["st"] == "VOID"
    assert pot(c3, C, mid3) == 2 * MIN + BOND + sh_c        # stake + held appeal bond + bond split share
    assert pot(c3, B, mid3) == MIN + sh_b
    conserve(c3)

# --------------------------------------------------------------- spec test 17
def t17_payout_cycle():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE")
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    assert amt == 2 * MIN
    expect_err(c, OUT, c.claim_payout, mid, code="NOTHING_CLAIMABLE")
    expect_err(c, C, c.confirm_withdrawal, mid, code="NO_PENDING")
    r = call(c, C, c.claim_payout, mid)
    assert "WITHDRAWAL_PENDING" in r and harness.TRANSFERS[-1] == (C, amt)
    assert pot(c, C, mid) == 0
    expect_err(c, C, c.claim_payout, mid, code="NOTHING_CLAIMABLE")
    r = call(c, C, c.confirm_withdrawal, mid)
    assert "WITHDRAWAL_CONFIRMED" in r
    expect_err(c, C, c.confirm_withdrawal, mid, code="NO_PENDING")
    conserve(c)

# --------------------------------------------------------------- spec test 18
# Restore gate order in v2: the age gate stands in front of the backing gate,
# so this scenario ages its pending past RESTORE_DELAY in setup; the backing
# gate then decides (the full two-gate form is test 28).
def t18_restore_backing():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE")
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)                         # harness lands the transfer: balance drops
    harness.set_time(t_claim + RESTORE_DELAY + 1)           # pending aged past the age gate
    expect_err(c, C, c.restore_pending, mid, code="INSUFFICIENT_BACKING")
    assert pend(c, C, mid) == {"amt": str(amt), "since": str(t_claim)}   # record unchanged
    c.balance += amt                                        # stranded emission: funds never left
    r = call(c, C, c.restore_pending, mid)
    assert "PENDING_RESTORED" in r, r
    assert pot(c, C, mid) == amt
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}
    conserve(c)

# --------------------------------------------------------------- spec test 19
def t19_admin_transfer():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, OUT, c.accept_ownership, code="NO_PENDING_ADMIN")
    expect_err(c, B, c.transfer_ownership, OUT, code="NOT_ADMIN")
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)])
    finalize_after_window(c, mid)
    assert pot(c, ADMIN, mid) == FEE                        # fee credited at finalize time
    call(c, ADMIN, c.transfer_ownership, OUT)
    expect_err(c, B, c.accept_ownership, code="NO_PENDING_ADMIN")
    call(c, OUT, c.accept_ownership)
    assert c.own == OUT
    assert pot(c, ADMIN, mid) == FEE                        # fee pot stays with the finalize-time admin
    assert pot(c, OUT, mid) == 0
    conserve(c)

# --------------------------------------------------------------- spec test 20
def t20_implied_odds():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    m = market(c, mid)
    assert m["odds_y_bps"] == 0 and m["total_pool"] == "0", m
    call(c, C, c.buy, mid, "YES", value=3 * 10 ** 16)
    call(c, B, c.buy, mid, "NO", value=10 ** 16)
    m = market(c, mid)
    assert m["odds_y_bps"] == 7500, m
    assert m["total_pool"] == str(4 * 10 ** 16)
    assert c.get_market(999) == "NOT_FOUND"
    conserve(c)

# --------------------------------------------------------------- spec test 21
def t21_one_sided_finalize():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (D, "YES", 3 * MIN)], "NO", "CRITERIA_NOT_MET")
    r = finalize_after_window(c, mid)                       # verdict names the EMPTY side
    assert "MARKET_FINAL" in r, r
    assert pot(c, C, mid) == 2 * MIN and pot(c, D, mid) == 3 * MIN   # full refunds, no split
    assert pot(c, ADMIN, mid) == 0                                   # fee 0
    assert market(c, mid)["win_total"] == str(5 * MIN)               # total pool on refund paths
    conserve(c)
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * MIN), (D, "YES", 3 * MIN)])
    call(c2, C, c2.appeal, mid2, value=BOND)
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET")
    call(c2, OUT, c2.resolve, mid2)
    call(c2, OUT, c2.finalize, mid2)                        # one-sided even after an appeal
    assert pot(c2, C, mid2) == 2 * MIN + BOND               # stake + held bond returned
    assert pot(c2, D, mid2) == 3 * MIN
    assert pot(c2, ADMIN, mid2) == 0
    conserve(c2)

# --------------------------------------------------------------- spec test 22
def t22_market_full():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    traders = [f"0x{i + 2:040x}" for i in range(100)]
    for t in traders:
        call(c, t, c.buy, mid, "YES", value=MIN)
    assert len(market(c, mid)["traders"]) == 100
    expect_err(c, f"0x{102:040x}", c.buy, mid, "NO", code="MARKET_FULL", value=MIN)
    r = call(c, traders[0], c.buy, mid, "NO", value=MIN)    # existing trader may top up
    assert "STAKE_PLACED" in r, r
    assert int(json.loads(c.get_overview())["lockw"]) == 101 * MIN + CBOND
    conserve(c, dust=MIN)

# --------------------------------------------------------------- spec test 23
def t23_admin_largest_winner():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(ADMIN, "YES", 2 * 10 ** 16), (C, "YES", 10 ** 16), (B, "NO", 10 ** 16)], creator=OUT)
    finalize_after_window(c, mid)
    dist = 4 * 10 ** 16 - FEE
    win_total = 3 * 10 ** 16
    share_a = dist * 2 * 10 ** 16 // win_total
    share_c = dist * 10 ** 16 // win_total
    share_a += dist - share_a - share_c                     # remainder -> largest (the admin)
    assert pot(c, ADMIN, mid) == share_a + FEE              # fee + winnings summed in ONE pot
    assert pot(c, C, mid) == share_c
    assert pot(c, B, mid) == 0
    assert pot(c, OUT, mid) == CBOND
    conserve(c)

# --------------------------------------------------------------- spec test 24
# The audit-1.1 attack, scripted: claim, then restore in the same instant
# while the emission is still in flight (the harness balance is topped back
# up so the balance still equals the accounted total — the exact state the
# v1 gate passed at equality). The age gate must shut the loop, and the
# second door (a fresh claim) must be shut too.
def t24_attack_scripted():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    assert amt == 2 * MIN
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)                         # emission emitted...
    c.balance += amt                                        # ...but NOT landed: still in flight
    assert pend(c, C, mid) == {"amt": str(amt), "since": str(t_claim)}
    expect_err(c, C, c.restore_pending, mid, code="PENDING_TOO_YOUNG")
    assert pend(c, C, mid) == {"amt": str(amt), "since": str(t_claim)}   # record untouched
    expect_err(c, C, c.claim_payout, mid, code="NOTHING_CLAIMABLE")      # loop dead at both doors
    assert pot(c, C, mid) == 0
    conserve(c)

# --------------------------------------------------------------- spec test 25
# Earliest-since retention across an accumulating pending (the second credit
# is staged directly — see the suite docstring for why the public method
# graph cannot produce this state and why the rule is defensive).
def t25_earliest_since_kept():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", 2 * MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    t0 = harness.now_unix()
    amt1 = pot(c, C, mid)
    assert amt1 == 2 * MIN
    call(c, C, c.claim_payout, mid)                         # pending amt1, ps = t0
    c.balance += amt1                                       # stranded: funds never left
    key = f"{mid}:{C}"
    c.claimable[key] = str(MIN)                             # staged second credit into the same pot
    c.tcw += MIN
    c.balance += MIN
    harness.set_time(t0 + 3600)
    call(c, C, c.claim_payout, mid)                         # second claim at t1 > t0
    c.balance += MIN                                        # second emission stranded too
    p = pend(c, C, mid)
    assert p == {"amt": str(amt1 + MIN), "since": str(t0)}, p   # earliest stamp kept
    harness.set_time(t0 + RESTORE_DELAY - 1)
    expect_err(c, C, c.restore_pending, mid, code="PENDING_TOO_YOUNG")
    harness.set_time(t0 + RESTORE_DELAY)
    r = call(c, C, c.restore_pending, mid)                  # age gate passes; backing intact (stranded)
    assert "PENDING_RESTORED" in r, r
    assert pot(c, C, mid) == amt1 + MIN                     # whole accumulated pot restored at once
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}
    conserve(c)

# --------------------------------------------------------------- spec test 26
def t26_stranded_aged_restore():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)
    c.balance += amt                                        # stranded emission: funds never left
    harness.set_time(t_claim + RESTORE_DELAY + 1)
    r = call(c, C, c.restore_pending, mid)
    assert "PENDING_RESTORED" in r, r
    assert pot(c, C, mid) == amt                            # restored in full
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}    # ps cleared with the pending
    conserve(c)

# --------------------------------------------------------------- spec test 27
def t27_landed_aged_restore():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)                         # harness lands the transfer: balance drops
    harness.set_time(t_claim + RESTORE_DELAY + 1)
    expect_err(c, C, c.restore_pending, mid, code="INSUFFICIENT_BACKING")
    assert pend(c, C, mid) == {"amt": str(amt), "since": str(t_claim)}   # pending and ps unchanged
    call(c, C, c.confirm_withdrawal, mid)                   # landed pending resolved by confirm
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}
    conserve(c)

# --------------------------------------------------------------- spec test 28
# Test 18's interleave in its full v2 form: un-aged calls stop at
# PENDING_TOO_YOUNG; aged, the tpw-inclusive backing gate decides — LANDED
# (D) cannot restore while its landed pending is unconfirmed, STRANDED (C)
# cannot restore against the shortfall either; once D confirms, C restores.
def t28_two_payee_interleave():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 3 * 10 ** 16), (D, "YES", 2 * 10 ** 16), (B, "NO", 10 ** 16)])
    finalize_after_window(c, mid)
    s_big, s_small = pot(c, C, mid), pot(c, D, mid)
    assert 0 < s_small < s_big
    t_claim = harness.now_unix()
    call(c, D, c.claim_payout, mid)                         # D's transfer lands (harness), no confirm
    call(c, C, c.claim_payout, mid)                         # C's emitted...
    c.balance += s_big                                      # ...but stranded: funds never left
    expect_err(c, D, c.restore_pending, mid, code="PENDING_TOO_YOUNG")
    expect_err(c, C, c.restore_pending, mid, code="PENDING_TOO_YOUNG")
    harness.set_time(t_claim + RESTORE_DELAY + 1)
    expect_err(c, D, c.restore_pending, mid, code="INSUFFICIENT_BACKING")
    expect_err(c, C, c.restore_pending, mid, code="INSUFFICIENT_BACKING")
    assert pend(c, C, mid)["amt"] == str(s_big) and pend(c, D, mid)["amt"] == str(s_small)
    call(c, D, c.confirm_withdrawal, mid)                   # landed pending resolved by confirm
    r = call(c, C, c.restore_pending, mid)                  # restores resume
    assert "PENDING_RESTORED" in r, r
    assert pot(c, C, mid) == s_big
    conserve(c)

# --------------------------------------------------------------- spec test 29
def t29_write_off_gates():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)                         # landed, never confirmed
    expect_err(c, C, c.write_off_pending, mid, C, code="PENDING_TOO_YOUNG")
    expect_err(c, ADMIN, c.write_off_pending, mid, D, code="NO_PENDING")
    harness.set_time(t_claim + WRITEOFF_DELAY + 1)
    expect_err(c, OUT, c.write_off_pending, mid, C, code="NOT_PAYEE")
    assert pend(c, C, mid)["amt"] == str(2 * MIN)           # untouched by all three failures
    call(c, C, c.confirm_withdrawal, mid)                   # cleanup: landed pending confirmed
    conserve(c)

# --------------------------------------------------------------- spec test 30
def _write_off_effect_run(by_admin):
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * MIN), (B, "NO", MIN)], "UNRESOLVED", "INSUFFICIENT_EVIDENCE", creator=OUT)
    finalize_after_window(c, mid)
    amt = pot(c, C, mid)
    t_claim = harness.now_unix()
    call(c, C, c.claim_payout, mid)                         # lands, never confirmed
    ov = json.loads(c.get_overview())
    assert int(ov["contract_balance_wei"]) == int(ov["lockw"]) + int(ov["tcw"]) + int(ov["tpw"]) - amt, ov
    harness.set_time(t_claim + WRITEOFF_DELAY + 1)
    r = call(c, ADMIN if by_admin else C, c.write_off_pending, mid, C)
    assert "PENDING_WRITTEN_OFF" in r, r
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}
    assert pot(c, C, mid) == 0                              # claimable unchanged: nothing re-credited, ever
    ov = json.loads(c.get_overview())
    assert ov["written_off"] == str(amt), ov
    assert ov["tpw"] == "0", ov
    assert int(ov["contract_balance_wei"]) == int(ov["lockw"]) + int(ov["tcw"]) + int(ov["tpw"]), ov
    conserve(c)

def t30_write_off_effect():
    _write_off_effect_run(by_admin=False)                   # by the payee
    _write_off_effect_run(by_admin=True)                    # by the admin

# --------------------------------------------------------------- spec test 31
def t31_create_bond_amount():
    harness.set_time(T0)
    close, ra = T0 + 7200, T0 + 10800
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, close, ra, code="BAD_BOND", value=0)
    ov = json.loads(c.get_overview())
    assert ov["nmarket"] == "0" and ov["lockw"] == "0"
    conserve(c)
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, close, ra, code="BAD_BOND", value=CBOND - 1)
    assert json.loads(c.get_overview())["nmarket"] == "0"
    conserve(c, dust=CBOND - 1)
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, B, c.create_market, Q, CRIT, SRCS, close, ra, code="BAD_BOND", value=CBOND + 1)
    assert json.loads(c.get_overview())["nmarket"] == "0"
    conserve(c, dust=CBOND + 1)
    c = fresh(); gl.message.sender_address = ADMIN
    expect_err(c, B, c.create_market, "", CRIT, SRCS, close, ra, code="BAD_QUESTION", value=CBOND)
    ov = json.loads(c.get_overview())
    assert ov["nmarket"] == "0" and ov["lockw"] == "0"      # exact bond + bad question: no bond retained
    conserve(c, dust=CBOND)

# --------------------------------------------------------------- spec test 32
def t32_bond_return_decisive():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 10 ** 16), (D, "YES", 2 * 10 ** 16), (B, "NO", 2 * 10 ** 16)])
    r = finalize_after_window(c, mid)
    assert "MARKET_FINAL" in r, r
    pool = 5 * 10 ** 16                                     # test 12's pool shape, byte-identical split
    dist = pool - FEE
    win_total = 3 * 10 ** 16
    share_c = dist * 10 ** 16 // win_total
    share_d = dist * 2 * 10 ** 16 // win_total
    share_d += dist - share_c - share_d
    assert pot(c, C, mid) == share_c, (pot(c, C, mid), share_c)
    assert pot(c, D, mid) == share_d, (pot(c, D, mid), share_d)
    assert pot(c, ADMIN, mid) == FEE
    assert pot(c, B, mid) == CBOND, pot(c, B, mid)          # creator lost: pot is EXACTLY the returned bond
    m = market(c, mid)
    assert m["cbond"] == str(CBOND) and m["cbond_st"] == "RETURNED", m
    conserve(c)

# --------------------------------------------------------------- spec test 33
def t33_bond_return_refund_paths():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)                                       # (a) UNRESOLVED finalize
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    call(c, C, c.buy, mid, "NO", value=MIN)
    call(c, B, c.buy, mid, "NO", value=4 * MIN)
    call(c, D, c.buy, mid, "YES", value=MIN)
    r = resolve_now(c, mid, "UNRESOLVED", "INSUFFICIENT_EVIDENCE")
    assert "MARKET_RESOLVED" in r, r
    finalize_after_window(c, mid)
    assert pot(c, C, mid) == 3 * MIN                        # stakes refunded exactly (test 13)
    assert pot(c, B, mid) == 4 * MIN + CBOND                # creator's refund + bond in one pot
    assert pot(c, D, mid) == MIN
    assert pot(c, ADMIN, mid) == 0                          # fee 0
    assert market(c, mid)["cbond_st"] == "RETURNED"
    conserve(c)
    c2 = fresh(); gl.message.sender_address = ADMIN         # (b) one-sided finalize
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * MIN), (D, "YES", 3 * MIN)], "NO", "CRITERIA_NOT_MET")
    finalize_after_window(c2, mid2)
    assert pot(c2, C, mid2) == 2 * MIN and pot(c2, D, mid2) == 3 * MIN   # refund branch (test 21)
    assert pot(c2, B, mid2) == CBOND                        # creator held no stake: pot is the bond alone
    assert pot(c2, ADMIN, mid2) == 0
    assert market(c2, mid2)["cbond_st"] == "RETURNED"
    conserve(c2)

# --------------------------------------------------------------- spec test 34
def t34_void_split_worked_example():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c, creator=OUT)
    call(c, B, c.buy, mid, "YES", value=2 * 10 ** 16)       # X: total stake 0.02 GEN
    call(c, C, c.buy, mid, "NO", value=10 ** 16)            # Y: total stake 0.01 GEN
    call(c, D, c.buy, mid, "YES", value=5 * 10 ** 15)       # Z: total stake 0.005 GEN
    ra = int(market(c, mid)["resolve_after"])
    harness.set_time(ra + 30 * DAY + 1)
    r = call(c, OUT, c.void_market, mid)
    assert "MARKET_VOID" in r, r
    # Stakes refunded in full; the bond split lands on top — the exact wei
    # figures of SPEC-v2's worked example (remainder wei to X, largest stake).
    assert pot(c, B, mid) == 2 * 10 ** 16 + 2857142857142858, pot(c, B, mid)
    assert pot(c, C, mid) == 10 ** 16 + 1428571428571428, pot(c, C, mid)
    assert pot(c, D, mid) == 5 * 10 ** 15 + 714285714285714, pot(c, D, mid)
    assert market(c, mid)["cbond_st"] == "SPLIT"
    conserve(c)

# --------------------------------------------------------------- spec test 35
def t35_void_zero_traders():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = mkmarket(c)
    ra = int(market(c, mid)["resolve_after"])
    harness.set_time(ra + 30 * DAY + 1)
    r = call(c, OUT, c.void_market, mid)
    assert "MARKET_VOID" in r, r
    assert market(c, mid)["st"] == "VOID"
    assert pot(c, ADMIN, mid) == CBOND                      # full bond to the admin's pot on this market
    assert market(c, mid)["cbond_st"] == "ADMIN"
    assert json.loads(c.get_overview())["lockw"] == "0"
    conserve(c)

# --------------------------------------------------------------- spec test 36
def t36_cancel_returns_bond():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    assert json.loads(c.get_overview())["lockw"] == "0"
    mid = mkmarket(c)
    assert json.loads(c.get_overview())["lockw"] == str(CBOND)   # bond held inside lockw
    r = call(c, B, c.cancel_market, mid)
    assert "MARKET_CANCELLED" in r, r
    assert pot(c, B, mid) == CBOND
    m = market(c, mid)
    assert m["st"] == "CANCELLED" and m["cbond_st"] == "RETURNED", m
    assert json.loads(c.get_overview())["lockw"] == "0"          # back to its pre-create value
    conserve(c)

# --------------------------------------------------------------- spec test 37
def t37_bond_coexistence():
    # (a) Outcome stands: the appeal bond joins the pool (test 14 math) AND
    #     the creator bond returns to the creator in full.
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * 10 ** 16), (D, "YES", 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    call(c, C, c.appeal, mid, value=BOND)
    ov = json.loads(c.get_overview())
    assert int(ov["lockw"]) == 5 * 10 ** 16 + BOND + CBOND, ov   # both bonds held at once
    m = market(c, mid)
    assert m["cbond_st"] == "HELD" and int(m["appeal"]["bond_held"]) == BOND, m
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET")
    call(c, OUT, c.resolve, mid)
    call(c, OUT, c.finalize, mid)
    pool = 5 * 10 ** 16 + BOND
    dist = pool - FEE
    win_total = 3 * 10 ** 16
    share_c = dist * 2 * 10 ** 16 // win_total
    share_d = dist * 10 ** 16 // win_total
    share_c += dist - share_c - share_d
    assert pot(c, C, mid) == share_c
    assert pot(c, D, mid) == share_d
    assert pot(c, B, mid) == 0
    assert pot(c, OUT, mid) == CBOND                        # creator bond back in full
    assert pot(c, ADMIN, mid) == FEE
    conserve(c)
    # (b) Outcome flips: the appeal bond returns to the appellant (test 15
    #     math) AND the creator bond returns to the creator in full.
    c2 = fresh(); gl.message.sender_address = ADMIN
    harness.set_time(T0)
    mid2 = resolved_market(c2, [(C, "YES", 2 * 10 ** 16), (D, "YES", 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    call(c2, B, c2.appeal, mid2, value=BOND)
    harness.PROMPT_FN = verdict_stub("NO", "CRITERIA_NOT_MET")
    call(c2, OUT, c2.resolve, mid2)
    call(c2, OUT, c2.finalize, mid2)
    dist2 = 5 * 10 ** 16 - FEE
    assert pot(c2, B, mid2) == dist2 + BOND                 # winnings + appeal bond back
    assert pot(c2, OUT, mid2) == CBOND                      # creator bond back in full
    assert pot(c2, C, mid2) == 0 and pot(c2, D, mid2) == 0
    assert pot(c2, ADMIN, mid2) == FEE
    conserve(c2)

# ------------------------------------------- extra controls (v1 t24 / t25)
def t38_happy_lifecycle():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    junk = ("<html><head><title>BOILERPLATE</title><script>var BOILERPLATE = 1;</script>"
            "<style>.BOILERPLATE { color: red; }</style></head><body>"
            "<p>The studio announced the sequel before the premiere.</p></body></html>").encode()
    harness.WEB[S1] = junk
    harness.WEB[S2] = junk
    harness.WEB[S3] = ("<html><body><p>" + "alpha " * 2000 + "</p></body></html>").encode()
    mid = mkmarket(c)
    call(c, C, c.buy, mid, "YES", value=2 * MIN)
    call(c, B, c.buy, mid, "NO", value=MIN)
    cap = {}
    m = market(c, mid)
    harness.set_time(int(m["resolve_after"]))
    harness.PROMPT_FN = verdict_stub("YES", "CRITERIA_MET", cap)
    r = call(c, OUT, c.resolve, mid)
    assert "MARKET_RESOLVED" in r, r
    prompt = cap["prompt"]
    assert "<script" not in prompt and "<head" not in prompt and "BOILERPLATE" not in prompt
    assert "announced the sequel" in prompt                 # body text survives cleaning
    assert prompt.count("alpha") <= 1100                    # 6,000-char slice after cleaning
    m = market(c, mid)
    assert m["st"] == "RESOLVED" and m["outcome"] == "YES" and m["reason"] == "CRITERIA_MET"
    conserve(c)
    harness.set_time(int(m["resolved_at"]) + APPEAL_WIN)    # window over exactly
    r = call(c, OUT, c.finalize, mid)
    assert "MARKET_FINAL" in r, r
    dist = 3 * MIN - FEE
    assert pot(c, C, mid) == dist and pot(c, ADMIN, mid) == FEE
    assert pot(c, B, mid) == CBOND                          # loser stake gone; creator bond back
    t_claim = harness.now_unix()
    r = call(c, C, c.claim_payout, mid)                     # withdraw + confirm in one flow
    assert harness.TRANSFERS[-1] == (C, dist)
    assert pend(c, C, mid) == {"amt": str(dist), "since": str(t_claim)}
    call(c, C, c.confirm_withdrawal, mid)
    assert pend(c, C, mid) == {"amt": "0", "since": "0"}
    assert pot(c, C, mid) == 0
    ov = json.loads(c.get_overview())
    assert ov["lockw"] == "0" and ov["tcw"] == str(FEE + CBOND) and ov["tpw"] == "0"
    assert ov["written_off"] == "0"
    assert int(ov["contract_balance_wei"]) == FEE + CBOND
    conserve(c)

def t39_reresolution_failure_keeps_appeal():
    harness.set_time(T0)
    c = fresh(); gl.message.sender_address = ADMIN
    mid = resolved_market(c, [(C, "YES", 2 * 10 ** 16), (B, "NO", 2 * 10 ** 16)], creator=OUT)
    call(c, B, c.appeal, mid, value=BOND)
    del harness.WEB[S2]                                     # a source drops mid-appeal
    r = call(c, OUT, c.resolve, mid)
    assert r.startswith("EVIDENCE_UNAVAILABLE"), r
    m = market(c, mid)
    assert m["attempts"] == 1 and m["appeal_done"] is False and m["outcome"] == "YES", m
    expect_err(c, OUT, c.finalize, mid, code="APPEAL_PENDING")
    cap = {}
    harness.WEB[S2] = PAGE
    harness.PROMPT_FN = verdict_stub("NO", "CRITERIA_NOT_MET", cap)
    r = call(c, OUT, c.resolve, mid)
    assert "MARKET_RERESOLVED" in r, r
    assert "appealed" in cap["prompt"] and "verdict was" not in cap["prompt"].lower()  # blind
    call(c, OUT, c.finalize, mid)
    dist = 4 * 10 ** 16 - FEE
    assert pot(c, B, mid) == dist + BOND                    # flipped: winnings + bond back
    assert pot(c, C, mid) == 0
    assert pot(c, OUT, mid) == CBOND
    conserve(c)

ALL = [v for k, v in sorted(list(globals().items())) if k.startswith("t") and k[1:3].isdigit()]
for fn in ALL:
    check(fn.__name__, fn)
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
for n, e in FAIL:
    print("FAILED:", n, e)
sys.exit(1 if FAIL else 0)
