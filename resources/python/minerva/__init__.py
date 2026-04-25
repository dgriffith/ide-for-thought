"""
Minerva Python library (#242).

Exposes the project's graph, tables, notes, sources, and excerpts to
Python cells running inside the Minerva compute kernel. Methods marshal
calls over a Unix domain socket to the main process — so a SPARQL
query in a Python cell hits exactly the same code path as the same
query in the Query Panel, with no separate engine or auth layer.

Public API:

    minerva.sparql(query)             -> pandas.DataFrame
    minerva.sql(query)                -> pandas.DataFrame
    minerva.notes.read(rel_path)      -> Note
    minerva.notes.by_tag(tag)         -> list[TaggedNote]
    minerva.notes.search(query)       -> list[SearchResult]
    minerva.sources.get(source_id)    -> SourceDetail
    minerva.sources.citing(source_id) -> list[Backlink]
    minerva.excerpts.for_source(id)   -> list[str]
    minerva.ctx()                     -> {'project_root': str, 'notebook_path': str|None}

Errors are translated into proper Python exceptions:
    minerva.NotFoundError, minerva.QueryError, minerva.RpcError.
"""

from . import notes, sources, excerpts
from ._exceptions import NotFoundError, QueryError, RpcError
from ._rpc import call as _call

import os as _os

# The kernel sets this before each cell exec via _set_current_notebook.
_current_notebook = None


def _set_current_notebook(path):
    """Internal — the kernel calls this before executing a cell."""
    global _current_notebook
    _current_notebook = path


def ctx():
    """Return the current project + notebook context.

    `notebook_path` is None outside a cell exec — e.g. if the library
    is imported from an interactive session against the kernel
    without a containing notebook.
    """
    return {
        'project_root': _os.environ.get('MINERVA_PROJECT_ROOT'),
        'notebook_path': _current_notebook,
    }


def _import_pandas(fn_name):
    """Lazy pandas import with an actionable error.

    The default `python3` on macOS (Homebrew) is PEP 668-locked, so a
    naked `pip install pandas` fails. Point users at the venv pattern
    Minerva supports via $MINERVA_PYTHON.
    """
    try:
        import pandas as pd
        return pd
    except ImportError as exc:
        import sys
        raise ImportError(
            f"minerva.{fn_name}() returns a pandas DataFrame, but pandas "
            f"is not installed in {sys.executable}.\n"
            "Recommended: create a venv and point Minerva at it.\n"
            "  python3 -m venv ~/.minerva-venv\n"
            "  ~/.minerva-venv/bin/pip install pandas\n"
            "Then relaunch Minerva with:\n"
            "  MINERVA_PYTHON=~/.minerva-venv/bin/python\n"
            "(set in your shell or ~/.zshrc before `pnpm dev`; a kernel "
            "restart alone won't pick up env var changes.)"
        ) from exc


def sparql(query):
    """Run a SPARQL SELECT and return a pandas DataFrame.

    Empty results return an empty DataFrame (not None). Column order
    matches the SELECT variable order. Pandas is imported lazily so
    the rest of the library remains usable in environments without
    pandas installed.
    """
    pd = _import_pandas('sparql')
    res = _call('sparql', query=query)
    rows = res.get('rows', [])
    if not rows:
        return pd.DataFrame()
    # Preserve key order from the first row — Comunica + the graph
    # layer return rows in SELECT-projection order, which `dict`
    # iteration preserves in Python 3.7+.
    columns = list(rows[0].keys())
    return pd.DataFrame(rows, columns=columns)


def sql(query):
    """Run a SQL query against the project's DuckDB and return a DataFrame.

    Same lazy-pandas dance as `sparql`.
    """
    pd = _import_pandas('sql')
    res = _call('sql', query=query)
    columns = res.get('columns', [])
    rows = res.get('rows', [])
    if not rows:
        return pd.DataFrame(columns=columns)
    return pd.DataFrame(rows, columns=columns)


__all__ = [
    'sparql',
    'sql',
    'notes',
    'sources',
    'excerpts',
    'ctx',
    'NotFoundError',
    'QueryError',
    'RpcError',
]
