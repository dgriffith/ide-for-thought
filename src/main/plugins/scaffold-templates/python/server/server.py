"""The __PLUGIN_ID__ MCP server: newline-delimited JSON-RPC on stdin/stdout,
using only the standard library. Minerva starts it with
`python3 server/server.py` in the plugin folder, once you switch it on in
Settings -> MCP Servers.

Two tools, one of each kind Minerva treats differently:
- list_memos is marked readOnlyHint, so the assistant may call it freely;
- add_memo writes, so Minerva asks in the conversation before each call.

Replace them with your own. The protocol code below can stay as it is, or you
can move to the MCP SDK (the `mcp` package) once you need more.
"""
import datetime
import json
import os
import sys

SERVER = {"name": "__PLUGIN_ID__", "version": "0.1.0"}
PROTOCOL_VERSION = "2025-06-18"


def memo_file():
    # The plugin's "memoFile" setting arrives as MEMO_FILE (see plugin.json).
    return os.environ.get("MEMO_FILE") or os.path.join(
        os.path.expanduser("~"), ".__PLUGIN_ID__", "memos.jsonl"
    )


def read_memos():
    try:
        with open(memo_file(), encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def list_memos(_args):
    memos = read_memos()
    if not memos:
        return "No memos yet."
    return "\n".join(f"- {m['text']} ({m['at']})" for m in memos)


def add_memo(args):
    text = args.get("text")
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise ValueError('"text" must be a non-empty string.')
    path = memo_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"text": text, "at": at}) + "\n")
    return f"Saved: {text}"


TOOLS = [
    {
        "name": "list_memos",
        "description": "List the saved memos, newest last.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True},
        "run": list_memos,
    },
    {
        "name": "add_memo",
        "description": "Save a short memo.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "The memo."}},
            "required": ["text"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "run": add_memo,
    },
]


def send(message):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
    sys.stdout.flush()


def call_tool(name, args):
    tool = next((t for t in TOOLS if t["name"] == name), None)
    if tool is None:
        return {"content": [{"type": "text", "text": f'No tool "{name}".'}], "isError": True}
    try:
        return {"content": [{"type": "text", "text": tool["run"](args or {})}]}
    except Exception as e:  # a tool's failure is a result the model reads
        return {"content": [{"type": "text", "text": str(e)}], "isError": True}


def handle(msg):
    method = msg.get("method")
    params = msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": SERVER}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{k: v for k, v in t.items() if k != "run"} for t in TOOLS]}
    if method == "tools/call":
        return call_tool(params.get("name"), params.get("arguments"))
    return None


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            send({"id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        if msg.get("id") is None:
            continue  # a notification
        result = handle(msg)
        if result is None:
            send({"id": msg["id"], "error": {"code": -32601, "message": f"Unknown method {msg.get('method')}"}})
        else:
            send({"id": msg["id"], "result": result})


if __name__ == "__main__":
    main()
