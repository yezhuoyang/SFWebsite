"""Test what vscoqtop sends for a Compute command."""
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
                if i < 0: break
                e = buf.find(b"\r\n\r\n", i)
                if e < 0: break
                ln = int(buf[i:e].split(b":")[1])
                s = e + 4
                if len(buf) < s + ln: break
                collected.append(json.loads(buf[s:s+ln]))
                buf = buf[s+ln:]
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
    uri = make_uri(CWD + "/test_compute.v")

    await send(proc, {"jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"processId": None, "capabilities": {}, "rootUri": make_uri(CWD)}})
    await asyncio.sleep(2)
    await send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
    await asyncio.sleep(1)
    for m in list(msgs):
        if m.get("method") == "workspace/configuration":
            await send(proc, {"jsonrpc": "2.0", "id": m["id"], "result": [FULL_CONFIG]})
    await asyncio.sleep(1)

    content = (
        "Inductive day : Type := | monday | tuesday.\n"
        "\n"
        "Definition f (d:day) : day := monday.\n"
        "\n"
        "Compute (f tuesday).\n"
    )
    await send(proc, {"jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": {"textDocument": {"uri": uri, "languageId": "rocq", "version": 1, "text": content}}})
    await asyncio.sleep(3)

    # Step 3 times: Inductive, Definition, Compute
    for i in range(3):
        n = len(msgs)
        await send(proc, {"jsonrpc": "2.0", "method": "vscoq/stepForward",
            "params": {"textDocument": {"uri": uri, "version": 1}}})
        await asyncio.sleep(3)

        for m in msgs[n:]:
            mt = m.get("method", "")
            if "proofView" in mt:
                pv = m["params"]
                proof = pv.get("proof")
                messages = pv.get("messages", [])
                pp_messages = pv.get("pp_messages", [])
                print(f"\nStep {i+1} proofView:")
                print(f"  proof: {json.dumps(proof)[:200] if proof else 'null'}")
                print(f"  messages ({len(messages)}):")
                for msg in messages:
                    print(f"    severity={msg[0]} pp={json.dumps(msg[1])[:200]}")
                print(f"  pp_messages ({len(pp_messages)}):")
                for pm in pp_messages:
                    print(f"    {json.dumps(pm)[:200]}")

    stop.set()
    proc.kill()
    await proc.wait()

asyncio.run(test())
