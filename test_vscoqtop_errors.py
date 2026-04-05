"""Test vscoqtop behavior when code has errors."""
import asyncio
import json


VSCOQTOP = "C:/Coq-Platform~8.20~2025.01/bin/vscoqtop.exe"
CWD = "C:/Users/yezhu/Documents/SFWebsite/lf"


def make_uri(p):
    p = p.replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = p[0].lower() + "%3A" + p[2:]
    return "file:///" + p


async def send(proc, msg):
    body = json.dumps(msg)
    proc.stdin.write(f"Content-Length: {len(body.encode())}\r\n\r\n".encode() + body.encode())
    await proc.stdin.drain()


async def reader(proc, collected, stop):
    buf = b""
    while not stop.is_set():
        try:
            chunk = await asyncio.wait_for(proc.stdout.read(8192), timeout=1)
            if not chunk:
                break
            buf += chunk
            while True:
                i = buf.find(b"Content-Length:")
                if i < 0:
                    break
                e = buf.find(b"\r\n\r\n", i)
                if e < 0:
                    break
                ln = int(buf[i:e].split(b":")[1])
                s = e + 4
                if len(buf) < s + ln:
                    break
                collected.append(json.loads(buf[s : s + ln]))
                buf = buf[s + ln :]
        except asyncio.TimeoutError:
            continue
        except:
            break


FULL_CONFIG = {
    "proof": {"mode": 0, "delegation": "None", "workers": 1, "block": False, "pointInterpretationMode": 0},
    "goals": {"diff": {"mode": "off"}, "messages": {"full": True}},
    "completion": {"enable": False, "algorithm": 0, "unificationLimit": 100, "atomicFactor": 5.0, "sizeFactor": 5.0},
    "diagnostics": {"enable": True, "full": True},
    "memory": {"limit": 4000000000},
}


async def test():
    proc = await asyncio.create_subprocess_exec(
        VSCOQTOP, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, cwd=CWD)
    msgs = []
    stop = asyncio.Event()
    asyncio.create_task(reader(proc, msgs, stop))
    uri = make_uri(CWD + "/test.v")

    await send(proc, {"jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"processId": None, "capabilities": {}, "rootUri": make_uri(CWD)}})
    await asyncio.sleep(2)
    await send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
    await asyncio.sleep(1)
    for m in list(msgs):
        if m.get("method") == "workspace/configuration":
            await send(proc, {"jsonrpc": "2.0", "id": m["id"], "result": [FULL_CONFIG]})
    await asyncio.sleep(1)

    # Open with good code, step it
    good = "Inductive day : Type :=\n| monday | tuesday | sunday.\n"
    await send(proc, {"jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": {"textDocument": {"uri": uri, "languageId": "rocq", "version": 1, "text": good}}})
    await asyncio.sleep(2)
    await send(proc, {"jsonrpc": "2.0", "method": "vscoq/stepForward",
        "params": {"textDocument": {"uri": uri, "version": 1}}})
    await asyncio.sleep(2)
    print(f"After good step: process alive={proc.returncode is None}")

    # Send BAD code (delete chars) — use INCREMENTAL change with range
    n = len(msgs)
    bad = "Inductive day : Type :=\n| monday | tuesday | sunda\n"
    good_lines = good.split("\n")
    old_last_line = len(good_lines) - 1
    old_last_char = len(good_lines[-1])
    await send(proc, {"jsonrpc": "2.0", "method": "textDocument/didChange",
        "params": {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{
            "range": {"start": {"line": 0, "character": 0}, "end": {"line": old_last_line, "character": old_last_char}},
            "text": bad,
        }]}})
    await asyncio.sleep(3)

    print(f"\nAfter bad didChange: {len(msgs) - n} new msgs, alive={proc.returncode is None}")
    for m in msgs[n:]:
        mt = m.get("method", "")
        if "Diagnostic" in mt:
            for d in m["params"].get("diagnostics", []):
                print(f"  DIAG: severity={d.get('severity')} msg={d.get('message', '')[:100]}")
        elif "Highlight" in mt:
            h = m["params"]
            print(f"  highlights: processed={len(h.get('processedRange', []))}")
        elif "proofView" in mt:
            print(f"  proofView: {json.dumps(m['params'])[:100]}")

    # Try to step with bad code
    n2 = len(msgs)
    await send(proc, {"jsonrpc": "2.0", "method": "vscoq/stepForward",
        "params": {"textDocument": {"uri": uri, "version": 2}}})
    await asyncio.sleep(3)
    print(f"\nAfter step on bad: {len(msgs) - n2} new msgs, alive={proc.returncode is None}")
    for m in msgs[n2:]:
        mt = m.get("method", "")
        print(f"  {mt}: {json.dumps(m.get('params', {}))[:150]}")

    # NOW FIX the code — send good code back
    n3 = len(msgs)
    bad_lines = bad.split("\n")
    bad_last_line = len(bad_lines) - 1
    bad_last_char = len(bad_lines[-1])
    fixed = "Inductive day : Type :=\n| monday | tuesday | sunday.\n"
    await send(proc, {"jsonrpc": "2.0", "method": "textDocument/didChange",
        "params": {"textDocument": {"uri": uri, "version": 3}, "contentChanges": [{
            "range": {"start": {"line": 0, "character": 0}, "end": {"line": bad_last_line, "character": bad_last_char}},
            "text": fixed,
        }]}})
    await asyncio.sleep(3)
    print(f"\nAfter fix didChange: {len(msgs) - n3} new msgs, alive={proc.returncode is None}")
    for m in msgs[n3:]:
        mt = m.get("method", "")
        if "Diagnostic" in mt:
            ds = m["params"].get("diagnostics", [])
            print(f"  DIAG: {len(ds)} items")
            for d in ds:
                print(f"    severity={d.get('severity')} msg={d.get('message', '')[:80]}")
        elif "Highlight" in mt:
            h = m["params"]
            print(f"  highlights: processed={len(h.get('processedRange', []))}")
        else:
            print(f"  {mt}: {json.dumps(m.get('params', {}))[:120]}")

    # Try stepping after fix
    n4 = len(msgs)
    await send(proc, {"jsonrpc": "2.0", "method": "vscoq/stepForward",
        "params": {"textDocument": {"uri": uri, "version": 3}}})
    await asyncio.sleep(3)
    print(f"\nAfter step on fixed: {len(msgs) - n4} new msgs, alive={proc.returncode is None}")
    for m in msgs[n4:]:
        mt = m.get("method", "")
        if "proofView" in mt:
            print(f"  proofView: goals={len(m['params'].get('proof', {}).get('goals', []))}")
        elif "Highlight" in mt:
            pr = m["params"].get("processedRange", [])
            if pr:
                print(f"  PROCESSED: L{pr[-1]['end']['line']}:{pr[-1]['end']['character']}")
            else:
                print(f"  highlights: processed=0")
        elif "Diagnostic" in mt:
            ds = m["params"].get("diagnostics", [])
            print(f"  DIAG: {len(ds)} items")
        else:
            print(f"  {mt}: {json.dumps(m.get('params', {}))[:120]}")

    stop.set()
    proc.kill()
    await proc.wait()

asyncio.run(test())
