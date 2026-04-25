"""Python-side exception classes for the Minerva RPC bridge (#242).

The TS RPC server tags each error with a string code; the client maps
that code onto the matching exception class so user code can catch
`minerva.NotFoundError` rather than parsing strings.
"""


class RpcError(Exception):
    """Generic RPC failure — base class for all minerva-* exceptions.

    Catch this if you don't care about the specific failure mode (e.g.
    the kernel can't reach the main process at all).
    """
    def __init__(self, message, code='RpcError'):
        super().__init__(message)
        self.code = code


class NotFoundError(RpcError):
    """Requested resource — note, source, excerpt — does not exist."""
    def __init__(self, message):
        super().__init__(message, code='NotFoundError')


class QueryError(RpcError):
    """SPARQL parse / runtime error or SQL parse / runtime error.

    Use this for any query that the engine couldn't execute as written;
    the message carries the engine's diagnostic.
    """
    def __init__(self, message):
        super().__init__(message, code='QueryError')


# Map a server-side code string onto a client-side exception class.
_CODE_TO_EXCEPTION = {
    'NotFoundError': NotFoundError,
    'QueryError': QueryError,
}


def from_server_error(error):
    """Turn an `{code, message}` dict from the server into the right
    Python exception instance."""
    code = error.get('code', 'RpcError')
    message = error.get('message', '<no message>')
    cls = _CODE_TO_EXCEPTION.get(code, RpcError)
    if cls is RpcError:
        return RpcError(message, code=code)
    return cls(message)
