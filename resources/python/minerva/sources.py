"""Source-level operations (#242).

A source is a citable external work (Article, Book, …). Identified by
`sourceId` — the directory name under `.minerva/sources/`.
"""

from ._rpc import call


def get(source_id):
    """Full source metadata + excerpts + backlinks.

    Returns the same `SourceDetail` shape the renderer's source panel
    uses. Raises `minerva.NotFoundError` if the source isn't indexed.
    """
    return call('sources.get', sourceId=source_id)


def citing(source_id):
    """Notes that wiki-link to this source via `[[cite::id]]`.

    Returns a list of `{relativePath, sourceTitle, kind: 'cite'}` dicts.
    """
    return call('sources.citing', sourceId=source_id)
