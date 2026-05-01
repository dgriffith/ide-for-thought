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
    """Pick the richest MIME representation we can produce for `value`.

    Returns a `{'mime': str, 'data': any}` bundle. The main-process side
    decodes the bundle into a typed CellOutput (#243). The order of
    detection runs richest → fallback, so a pandas DataFrame doesn't
    accidentally fall through to its text repr just because it also
    has a `_repr_html_`.
    """
    bundle = (
        try_dataframe(value)
        or try_matplotlib(value)
        or try_pil_image(value)
        or try_repr_html(value)
        or try_repr_png(value)
        or try_repr_svg(value)
        or try_json_value(value)
    )
    if bundle is not None:
        return bundle
    return {'mime': 'text/plain', 'data': repr(value)}


# ── Detector helpers ──────────────────────────────────────────────────
#
# Each helper returns either a {mime, data} bundle or None. We avoid
# hard-importing the user-side libraries (pandas, matplotlib, PIL) at
# kernel start — only check the type when the library is actually loaded
# in the user's namespace, so kernel boot stays cheap and a project that
# never touches pandas doesn't pay its import cost.


# Cap rows the kernel emits inline. Matches the issue's 1000-row cap;
# the renderer surfaces "Showing 1000 of N" when truncated.
DATAFRAME_MAX_ROWS = 1000

# Cap on the size of any one image bundle (raw bytes). Anything bigger
# falls through to a text/plain marker so we don't stuff a 50MB PNG
# through stdio (#243).
IMAGE_MAX_BYTES = 5 * 1024 * 1024


def try_dataframe(value):
    if 'pandas' not in sys.modules:
        return None
    pd = sys.modules['pandas']
    if not isinstance(value, getattr(pd, 'DataFrame', tuple())):
        return None
    total = int(len(value))
    truncated = total > DATAFRAME_MAX_ROWS
    df = value.head(DATAFRAME_MAX_ROWS) if truncated else value
    columns = [str(c) for c in df.columns]
    rows = []
    for tup in df.itertuples(index=False, name=None):
        rows.append([_cell_value(v) for v in tup])
    return {
        'mime': 'application/vnd.minerva.dataframe+json',
        'data': {
            'columns': columns,
            'rows': rows,
            'totalRows': total,
            'truncated': truncated,
        },
    }


def try_matplotlib(value):
    """Trailing-figure path: a cell whose last expression is a Figure
    (or `plt.gcf()`, or a sequence-of-axes that resolves back to one)
    renders as an inline PNG. The matplotlib backend hook for explicit
    `plt.show()` capture is a separate ticket — this covers the
    common case."""
    if 'matplotlib' not in sys.modules:
        return None
    figure_module = sys.modules.get('matplotlib.figure')
    if figure_module is None:
        return None
    Figure = getattr(figure_module, 'Figure', None)
    if Figure is None:
        return None
    fig = None
    if isinstance(value, Figure):
        fig = value
    elif hasattr(value, 'figure') and isinstance(getattr(value, 'figure', None), Figure):
        # An Axes (or AxesSubplot) — pull the parent figure.
        fig = value.figure
    if fig is None:
        return None
    import io as _io
    import base64 as _b64
    buf = _io.BytesIO()
    try:
        fig.savefig(buf, format='png', bbox_inches='tight')
    except Exception:
        return None
    raw = buf.getvalue()
    if len(raw) > IMAGE_MAX_BYTES:
        return {
            'mime': 'text/plain',
            'data': '[Figure too large to render inline (>{} bytes)]'.format(IMAGE_MAX_BYTES),
        }
    return {'mime': 'image/png', 'data': _b64.b64encode(raw).decode('ascii')}


def try_pil_image(value):
    if 'PIL.Image' not in sys.modules and 'PIL' not in sys.modules:
        return None
    try:
        from PIL import Image as _PILImage
    except Exception:
        return None
    if not isinstance(value, _PILImage.Image):
        return None
    import io as _io
    import base64 as _b64
    buf = _io.BytesIO()
    try:
        # PIL Images often default to RGBA / palette modes; PNG handles
        # all of them. Fixed format keeps the renderer-side mime stable.
        save_kwargs = {}
        fmt = 'PNG'
        value.save(buf, fmt, **save_kwargs)
    except Exception:
        return None
    raw = buf.getvalue()
    if len(raw) > IMAGE_MAX_BYTES:
        return {
            'mime': 'text/plain',
            'data': '[Image too large to render inline (>{} bytes)]'.format(IMAGE_MAX_BYTES),
        }
    return {'mime': 'image/png', 'data': _b64.b64encode(raw).decode('ascii')}


def try_repr_html(value):
    fn = getattr(value, '_repr_html_', None)
    if not callable(fn):
        return None
    try:
        html = fn()
    except Exception:
        return None
    if not isinstance(html, str) or not html.strip():
        return None
    return {'mime': 'text/html', 'data': html}


def try_repr_png(value):
    fn = getattr(value, '_repr_png_', None)
    if not callable(fn):
        return None
    try:
        png = fn()
    except Exception:
        return None
    if not isinstance(png, (bytes, bytearray)):
        return None
    if len(png) > IMAGE_MAX_BYTES:
        return None
    import base64 as _b64
    return {'mime': 'image/png', 'data': _b64.b64encode(bytes(png)).decode('ascii')}


def try_repr_svg(value):
    fn = getattr(value, '_repr_svg_', None)
    if not callable(fn):
        return None
    try:
        svg = fn()
    except Exception:
        return None
    if not isinstance(svg, str) or not svg.strip():
        return None
    return {'mime': 'image/svg+xml', 'data': svg}


def try_json_value(value):
    """JSON-roundtrippable scalars / lists / dicts pass through as a
    JSON bundle. Renderer treats this as a structured value; falls back
    to text/plain repr if not roundtrippable."""
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return None
    return {'mime': 'application/json', 'data': value}


def _cell_value(v):
    """Coerce a DataFrame cell into a JSON-emittable scalar.

    Pandas hands us numpy scalars (`int64`, `float64`, `Timestamp`, …)
    that don't survive `json.dumps`. We coerce on the way out so the
    renderer doesn't have to know about pandas types.
    """
    if v is None:
        return None
    # Pandas / numpy scalar — `.item()` unwraps to a native Python type.
    item = getattr(v, 'item', None)
    if callable(item):
        try:
            v = item()
        except Exception:
            pass
    if isinstance(v, (str, bool, int, float)) or v is None:
        # Filter out NaN — JSON has no representation; emit null.
        if isinstance(v, float) and v != v:  # NaN check
            return None
        return v
    return str(v)


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
        except KeyboardInterrupt:
            # Cell was interrupted via "Compute: Interrupt Cell" (#372)
            # — SIGINT on POSIX, _thread.interrupt_main() on Windows.
            # Surface as a structured error so any partial stdout
            # captured up to the interrupt still rides through to the
            # renderer below.
            error_payload = {
                'ename': 'KeyboardInterrupt',
                'evalue': 'Cell interrupted',
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
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            # SIGINT delivered between cells — i.e. the user mashed
            # Interrupt Cell after the previous cell already finished
            # but before the next request arrives. Swallow and keep
            # serving; killing the kernel here would lose every
            # notebook's namespace, exactly the failure mode the
            # interrupt was supposed to avoid (#372).
            continue
        if not line:
            # EOF — parent process closed stdin.
            break
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
