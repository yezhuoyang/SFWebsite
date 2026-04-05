"""Test script to verify vscoqtop communication."""
import asyncio
import json
import sys


VSCOQTOP = "C:/Coq-Platform~8.20~2025.01/bin/vscoqtop.exe"
CWD = "C:/Users/yezhu/Documents/SFWebsite/lf"


def make_uri(path):
    p = path.replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = p[0].lower() + "%3A" + p[2:]
    return "file:///" + p


async def send(proc, msg):
    body = json.dumps(msg)
    h = f"Content-Length: {len(body.encode())}\r\n\r\n"
    proc.stdin.write(h.encode() + body.encode())
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
        except Exception as ex:
            print(f"Reader error: {ex}")
            break


async def test():
    proc = await asyncio.create_subprocess_exec(
        VSCOQTOP,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=CWD,
    )
    msgs = []
    stop = asyncio.Event()
    asyncio.create_task(reader(proc, msgs, stop))

    root_uri = make_uri(CWD)
    uri = make_uri(CWD + "/test.v")
    print(f"root_uri: {root_uri}")
    print(f"doc_uri:  {uri}")

    # Initialize
    await send(proc, {
        "jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"processId": None, "capabilities": {}, "rootUri": root_uri},
    })
    await asyncio.sleep(2)

    # Initialized
    await send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
    await asyncio.sleep(1)

    # Respond to workspace/configuration with COMPLETE settings
    for m in list(msgs):
        if m.get("method") == "workspace/configuration":
            await send(proc, {"jsonrpc": "2.0", "id": m["id"], "result": [{
                "proof": {
                    "mode": 0,  # Manual
                    "delegation": "None",
                    "workers": 1,
                    "block": False,
                    "pointInterpretationMode": 0,  # Cursor
                },
                "goals": {
                    "diff": {"mode": "off"},
                    "messages": {"full": True},
                },
                "completion": {
                    "enable": False,
                    "algorithm": 0,
                    "unificationLimit": 100,
                    "atomicFactor": 5.0,
                    "sizeFactor": 5.0,
                },
                "diagnostics": {
                    "enable": True,
                    "full": True,
                },
                "memory": {
                    "limit": 4000000000,
                },
            }]})
            print("Responded to workspace/configuration")
    await asyncio.sleep(1)

    # Open document
    content = "Lemma test : 1 + 1 = 2.\nProof. simpl. reflexivity. Qed.\n"
    await send(proc, {
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": {"textDocument": {"uri": uri, "languageId": "rocq", "version": 1, "text": content}},
    })
    await asyncio.sleep(3)

    # Check notifications received
    print(f"\nAfter didOpen: {len(msgs)} messages")

    # Step forward 4 times
    for i in range(4):
        n = len(msgs)
        await send(proc, {
            "jsonrpc": "2.0", "method": "vscoq/stepForward",
            "params": {"textDocument": {"uri": uri, "version": 1}},
        })
        await asyncio.sleep(2)

        new_msgs = msgs[n:]
        print(f"\n--- Step {i+1}: {len(new_msgs)} new messages ---")
        for m in new_msgs:
            mt = m.get("method", "")
            if "Highlight" in mt:
                h = m["params"]
                pr = h.get("processedRange", [])
                pg = h.get("processingRange", [])
                if pr:
                    for r in pr:
                        print(f"  PROCESSED: L{r['start']['line']}:{r['start']['character']}-L{r['end']['line']}:{r['end']['character']}")
                if pg:
                    for r in pg:
                        print(f"  PROCESSING: L{r['start']['line']}:{r['start']['character']}-L{r['end']['line']}:{r['end']['character']}")
            elif "proofView" in mt.lower() or "proof_view" in mt:
                pv = m.get("params", {})
                proof = pv.get("proof")
                if proof:
                    goals = proof.get("goals", [])
                    print(f"  PROOF: {len(goals)} goals")
                    for g in goals[:2]:
                        print(f"    goal: {json.dumps(g['goal'])[:200]}")
                        for hyp in g.get("hypotheses", [])[:3]:
                            print(f"    hyp: {json.dumps(hyp)[:150]}")
                msgs_list = pv.get("messages", [])
                if msgs_list:
                    print(f"  MESSAGES: {len(msgs_list)}")
                    for msg_item in msgs_list[:2]:
                        print(f"    {json.dumps(msg_item)[:150]}")
            elif mt == "textDocument/publishDiagnostics":
                ds = m["params"].get("diagnostics", [])
                if ds:
                    for d in ds[:2]:
                        print(f"  DIAG: {d.get('message', '')[:100]}")
            else:
                print(f"  {mt}: {json.dumps(m.get('params', m.get('result', {})))[:100]}")

    # Check stderr
    try:
        err = await asyncio.wait_for(proc.stderr.read(8192), timeout=2)
        if err:
            print(f"\nSTDERR: {err.decode('utf-8', errors='replace')[:500]}")
    except asyncio.TimeoutError:
        print("\nNo stderr")

    # Also dump ALL messages
    print(f"\nALL {len(msgs)} messages:")
    for i, m in enumerate(msgs):
        mt = m.get("method", f"resp({m.get('id')})")
        print(f"  {i}: {mt}")

    stop.set()
    await asyncio.sleep(0.5)
    proc.kill()
    await proc.wait()
    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(test())
