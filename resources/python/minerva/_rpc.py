"""Line-delimited JSON-RPC client over the per-kernel Unix socket (#242).

The kernel adapter spawns the Python child with `MINERVA_IPC_SOCKET`
pointing at a per-project listening socket. We open a single connection
per Python process, lazily, on first call — no pool, no reconnect logic
in v1; if the kernel dies the whole process is going down anyway.

Wire format (one JSON object per line, both directions):
    request:  {"id": <int>, "method": "...", "params": {...}}
    response: {"id": <int>, "result": <any>}
            | {"id": <int>, "error": {"code": "...", "message": "..."}}

This client is synchronous — the goal is to make `minerva.sparql(...)`
look like a function call. The TS server processes requests sequentially
per connection, so we don't need request multiplexing.
"""

import json
import os
import socket
import threading
import itertools

from ._exceptions import RpcError, from_server_error


_lock = threading.Lock()
_conn = None
_buf = b''
_id_seq = itertools.count(1)


def _connect():
    socket_path = os.environ.get('MINERVA_IPC_SOCKET')
    if not socket_path:
        raise RpcError(
            'MINERVA_IPC_SOCKET is not set — this Python process is not '
            'running inside a Minerva compute kernel.',
            code='NoTransport',
        )
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(socket_path)
    return s


def _read_line():
    """Read until the next \\n. The socket guarantees byte-stream
    semantics, so we buffer between reads."""
    global _buf
    while b'\n' not in _buf:
        chunk = _conn.recv(8192)
        if not chunk:
            raise RpcError('RPC socket closed by main process', code='ConnectionClosed')
        _buf += chunk
    line, _, _buf = _buf.partition(b'\n')
    return line


def call(method, **params):
    """Send a request and block until the matching response arrives.

    The TS server processes requests in arrival order on a connection,
    so the response we read back is always for the request we sent —
    no id-matching loop needed.
    """
    global _conn
    with _lock:
        if _conn is None:
            _conn = _connect()
        request_id = next(_id_seq)
        msg = json.dumps({'id': request_id, 'method': method, 'params': params})
        _conn.sendall(msg.encode('utf-8') + b'\n')
        line = _read_line()
        try:
            response = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RpcError(f'Malformed RPC reply: {line!r}') from exc
        if 'error' in response:
            raise from_server_error(response['error'])
        return response.get('result')
