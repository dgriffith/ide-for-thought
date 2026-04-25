"""Excerpt-level operations (#242).

An excerpt is a verbatim quotation lifted from a Source, stored at
`.minerva/excerpts/<id>.ttl`.
"""

from ._rpc import call


def for_source(source_id):
    """List the excerpt ids that belong to a given source.

    Returns a list of strings — the excerpt ids — in indexing order.
    """
    return call('excerpts.for_source', sourceId=source_id)
