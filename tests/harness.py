"""Offline harness: stub genlayer runtime, load CallIt.v2.py, drive it."""
import sys, types, json, hashlib

TRANSFERS = []          # (recipient, amount) emitted via _Recipient.emit_transfer
WEB = {}                # url -> bytes (missing key = fetch failure)
PROMPT_FN = None        # callable(prompt, images) -> dict (jury verdict stub)
CLOCK = {"iso": "2026-11-16T00:00:00"}

class UserError(Exception):
    pass

class _Msg:
    sender_address = "0x" + "a" * 40
    value = 0
    @property
    def datetime(self):
        return CLOCK["iso"]

class _Resp:
    def __init__(self, body):
        self.body = body
        self.status = 200

class _Web:
    @staticmethod
    def get(url):
        if url not in WEB:
            raise Exception("unreachable: " + str(url))
        return _Resp(WEB[url])

class _Nondet:
    web = _Web()
    @staticmethod
    def exec_prompt(prompt, response_format=None, images=None):
        assert PROMPT_FN is not None, "no jury stub set"
        return PROMPT_FN(prompt, images)

class _Eq:
    @staticmethod
    def strict_eq(fn):
        return fn()

class _Public:
    def write(self, fn):
        return fn
    write.payable = staticmethod(lambda fn: fn)
    def view(self, fn):
        return fn

class _Recipient:
    def __init__(self, addr):
        self.addr = str(addr)
    def emit_transfer(self, value=None):
        TRANSFERS.append((self.addr, int(value)))

def _contract_interface(cls):
    return _Recipient

class _Contract:
    balance = 0

gl = types.ModuleType("genlayer")
gl.contract = types.SimpleNamespace(Contract=_Contract)
gl.public = _Public()
gl.vm = types.SimpleNamespace(UserError=UserError)
gl.message = _Msg()
gl.nondet = _Nondet()
gl.eq_principle = _Eq()
gl.evm = types.SimpleNamespace(contract_interface=_contract_interface)
storage = types.ModuleType("genlayer.storage")
class TreeMap(dict):
    pass
storage.TreeMap = TreeMap
gtypes = types.ModuleType("genlayer.types")
gtypes.Address = lambda a: str(a)
gtypes.u256 = int
gtypes.bigint = int
sys.modules["genlayer"] = gl
sys.modules["genlayer.storage"] = storage
sys.modules["genlayer.types"] = gtypes

SRC = open("/home/hatch/workspace/callit/CallIt.v2.py").read()
ns = {}
exec(compile(SRC, "CallIt.v2.py", "exec"), ns)
CallIt = ns["CallIt"]

A = "0xd2af69bb67d446526661a80a280820599c601ed3"   # contract admin (deployer)
B = "0x0bba411375d7074178980e610b5311dd6ed34d74"   # trader / usual creator
C = "0x6fa23bd191266a8680c195ec6a618d2d9d584cab"   # trader
D = "0x" + "d" * 40                                # trader
OUT = "0x" + "1" * 40                              # outsider
DAY = 86400

def set_time(unix):
    import datetime as _dt
    CLOCK["iso"] = _dt.datetime.utcfromtimestamp(unix).strftime("%Y-%m-%dT%H:%M:%S")

def now_unix():
    import calendar as _cal
    s = CLOCK["iso"]
    return _cal.timegm((int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19])))

def fresh(balance=0):
    gl.message.sender_address = A
    c = CallIt.__new__(CallIt)
    c.markets = TreeMap(); c.positions = TreeMap(); c.claimable = TreeMap(); c.pendings = TreeMap()
    c.pstamps = TreeMap()
    CallIt.__init__(c)
    c.balance = balance
    return c

def call(c, sender, fn, *args, value=0):
    """Run one top-level call the way the chain would: value lands first,
    transfers emitted during the call leave the contract balance."""
    gl.message.sender_address = sender
    gl.message.value = value
    if value:
        c.balance += value
    before = len(TRANSFERS)
    try:
        out = fn(*args)
    finally:
        for (_r, amt) in TRANSFERS[before:]:
            c.balance -= amt
    return out

def _snap(c):
    return (json.dumps({k: v for k, v in c.markets.items()}, sort_keys=True),
            json.dumps({k: v for k, v in c.positions.items()}, sort_keys=True),
            json.dumps({k: v for k, v in c.claimable.items()}, sort_keys=True),
            json.dumps({k: v for k, v in c.pendings.items()}, sort_keys=True),
            json.dumps({k: v for k, v in c.pstamps.items()}, sort_keys=True),
            int(c.lockw), int(c.tcw), int(c.tpw), int(c.wo), len(TRANSFERS))

def expect_err(c, sender, fn, *args, code, value=0):
    snap = _snap(c)
    try:
        call(c, sender, fn, *args, value=value)
    except UserError as e:
        assert str(e) == code, f"expected {code}, got {e}"
        # NOTE: harness cannot roll back in-place dict edits on raise; the
        # contract only mutates after all gates pass, so snapshots must match.
        assert _snap(c) == snap, f"state changed on {code}"
        return
    raise AssertionError(f"expected UserError {code}, call succeeded")

def conserve(c, dust=0):
    excess = int(c.balance) - int(c.lockw) - int(c.tcw) - int(c.tpw)
    assert excess == dust, f"conservation broken: excess={excess} expected dust={dust} " \
        f"(bal={c.balance} lock={c.lockw} tcw={c.tcw} tpw={c.tpw})"
    assert excess >= 0

def sha(b):
    return hashlib.sha256(b).hexdigest()
