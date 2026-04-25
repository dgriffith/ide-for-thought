#!/usr/bin/env python3
"""
Minerva compute kernel (#241).

Long-running Python subprocess that reads exec requests as JSON-line
messages on stdin and writes streamed events back on stdout. One process
per project; per-notebook namespace dicts so cells in the same notebook
share state but cells in different notebooks don't.

Protocol — request:
  {"op": "exec", "cellId": "<uuid>", "notebookPath": "notes/x.md", "code": "..."}
  {"op": "reset", "notebookPath": "notes/x.md"}      # drop one notebook's namespace
  {"op": "reset"}                                     # drop everything

Protocol — events:
  {"type": "ready"}                                   # once at startup
  {"cellId": ..., "type": "stdout",  "payload": "..."}
  {"cellId": ..., "type": "stderr",  "payload": "..."}
  {"cellId": ..., "type": "result",  "payload": <json-or-repr>}
  {"cellId": ..., "type": "error",   "payload": {"ename","evalue","traceback"}}
  {"cellId": ..., "type": "done",    "executionTimeMs": <int>}
  {"type": "reset-ack"}
  {"type": "protocol-error", "message": "..."}        # malformed request
"""

import sys
import json
import io
import time
import ast
import traceback

namespaces = {}


def get_ns(notebook_path):
    if notebook_path not in namespaces:
        # Fresh module-style globals — __name__ matters for `if __name__ == '__main__'`
        # (cells running this idiom should behave like __main__).
        namespaces[notebook_path] = {
            '__name__': '__main__',
            '__builtins__': __builtins__,
        }
    return namespaces[notebook_path]


def emit(event):
    sys.stdout.write(json.dumps(event) + '\n')
    sys.stdout.flush()


def reset_namespaces(notebook_path):
    if notebook_path is None:
        namespaces.clear()
    else:
        namespaces.pop(notebook_path, None)


def serialize_value(value):
    """Best-effort: prefer JSON-roundtrippable, fall back to repr.

    The renderer renders 'json' outputs richly and 'text' outputs as
    monospace. Whatever we send under 'result' goes into the json branch,
    so unrepresentable types fall back to a string repr to keep the
    output legible rather than dropping it on the floor.
    """
    try:
        # Round-trip test — JSON.dumps catches most opaque types.
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


def set_current_notebook(notebook_path):
    """Tell the bundled `minerva` library which notebook the cell is
    running in (#242). The library reads this for `minerva.ctx()`."""
    try:
        import minerva
        minerva._set_current_notebook(notebook_path)
    except Exception:
        # Library not on path / not importable — ignore; user code will
        # surface a clearer error if they actually try to use it.
        pass


def exec_cell(req):
    cell_id = req.get('cellId')
    code = req.get('code', '')
    notebook = req.get('notebookPath') or '__default__'
    ns = get_ns(notebook)
    set_current_notebook(notebook)

    started = time.monotonic()
    out = io.StringIO()
    err = io.StringIO()
    last_value = None
    has_last_value = False
    error_payload = None

    saved_stdout, saved_stderr = sys.stdout, sys.stderr
    try:
        sys.stdout = out
        sys.stderr = err
        try:
            tree = ast.parse(code, mode='exec')
            # Jupyter-style: if the last statement is a bare expression,
            # exec everything before it then eval the last separately so
            # we can capture its value as `result`.
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last_expr = tree.body[-1]
                exec_module = ast.Module(body=tree.body[:-1], type_ignores=[])
                exec(compile(exec_module, '<cell>', 'exec'), ns)
                last_value = eval(
                    compile(ast.Expression(body=last_expr.value), '<cell>', 'eval'),
                    ns,
                )
                # `None` is the typical "no value" sentinel for statements
                # like `print(...)` whose return is None — skip in that case
                # to avoid noisy `null` results.
                if last_value is not None:
                    has_last_value = True
            else:
                exec(compile(tree, '<cell>', 'exec'), ns)
        except SystemExit:
            # exit() / sys.exit() — surface as an error rather than killing
            # the whole kernel.
            error_payload = {
                'ename': 'SystemExit',
                'evalue': 'Cell called sys.exit()',
                'traceback': traceback.format_exc().splitlines(),
            }
        except BaseException as e:
            error_payload = {
                'ename': type(e).__name__,
                'evalue': str(e),
                'traceback': traceback.format_exc().splitlines(),
            }
    finally:
        sys.stdout = saved_stdout
        sys.stderr = saved_stderr

    if out.getvalue():
        emit({'cellId': cell_id, 'type': 'stdout', 'payload': out.getvalue()})
    if err.getvalue():
        emit({'cellId': cell_id, 'type': 'stderr', 'payload': err.getvalue()})
    if error_payload:
        emit({'cellId': cell_id, 'type': 'error', 'payload': error_payload})
    elif has_last_value:
        emit({'cellId': cell_id, 'type': 'result', 'payload': serialize_value(last_value)})

    elapsed_ms = int((time.monotonic() - started) * 1000)
    emit({'cellId': cell_id, 'type': 'done', 'executionTimeMs': elapsed_ms})


def main():
    emit({'type': 'ready'})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({'type': 'protocol-error', 'message': f'JSON parse: {e}'})
            continue
        op = req.get('op', 'exec')
        if op == 'exec':
            try:
                exec_cell(req)
            except Exception as e:
                # exec_cell catches everything inside the user code path;
                # this is a kernel-side bug if reached.
                emit({
                    'cellId': req.get('cellId'),
                    'type': 'error',
                    'payload': {
                        'ename': 'KernelError',
                        'evalue': str(e),
                        'traceback': traceback.format_exc().splitlines(),
                    },
                })
                emit({'cellId': req.get('cellId'), 'type': 'done', 'executionTimeMs': 0})
        elif op == 'reset':
            reset_namespaces(req.get('notebookPath'))
            emit({'type': 'reset-ack'})
        else:
            emit({'type': 'protocol-error', 'message': f'Unknown op: {op}'})


if __name__ == '__main__':
    main()
