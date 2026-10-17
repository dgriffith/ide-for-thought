"""Drives the server over stdio, the way Minerva does. Run with
`python3 -m unittest` in the plugin folder."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SERVER = os.path.join(os.path.dirname(__file__), "..", "server", "server.py")


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        env = {**os.environ, "MEMO_FILE": os.path.join(self.dir.name, "memos.jsonl")}
        self.proc = subprocess.Popen(
            [sys.executable, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env
        )
        self.next_id = 1

    def tearDown(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)
        self.proc.stdout.close()
        self.dir.cleanup()

    def request(self, method, params=None):
        msg_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        self.assertEqual(reply["id"], msg_id)
        return reply

    def notify(self, method):
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}) + "\n")
        self.proc.stdin.flush()

    def test_lists_its_tools_and_runs_them(self):
        init = self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}})
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.notify("notifications/initialized")

        tools = self.request("tools/list")["result"]["tools"]
        self.assertEqual(
            [(t["name"], t["annotations"]["readOnlyHint"]) for t in tools],
            [("list_memos", True), ("add_memo", False)],
        )

        empty = self.request("tools/call", {"name": "list_memos", "arguments": {}})
        self.assertEqual(empty["result"]["content"][0]["text"], "No memos yet.")

        saved = self.request("tools/call", {"name": "add_memo", "arguments": {"text": "Buy milk"}})
        self.assertEqual(saved["result"]["content"][0]["text"], "Saved: Buy milk")

        listed = self.request("tools/call", {"name": "list_memos", "arguments": {}})
        self.assertTrue(listed["result"]["content"][0]["text"].startswith("- Buy milk ("))

        bad = self.request("tools/call", {"name": "add_memo", "arguments": {"text": "  "}})
        self.assertTrue(bad["result"]["isError"])

        unknown = self.request("nope")
        self.assertEqual(unknown["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()
