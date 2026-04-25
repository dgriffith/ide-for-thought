"""Note-level operations against the project's notebase (#242).

Mirrors the renderer's API: `read` returns the full content + parsed
frontmatter + tags + title; `by_tag` returns the same shape the right-
sidebar uses; `search` is the project's MiniSearch index.
"""

from ._rpc import call


def read(relative_path):
    """Read a note by its project-relative path.

    Returns a dict::

        {'relativePath': 'notes/x.md',
         'title': 'X' | None,
         'frontmatter': {...},
         'tags': ['a', 'b', ...],
         'body': '<full markdown source>'}

    Raises `minerva.NotFoundError` if the path doesn't exist.
    """
    return call('notes.read', relativePath=relative_path)


def by_tag(tag):
    """Notes carrying `#tag` (in body or frontmatter).

    Returns a list of `{relativePath, title}` dicts in the order the
    main-side `notesByTag` returns them.
    """
    return call('notes.by_tag', tag=tag)


def search(query, limit=20):
    """Full-text search via the project's MiniSearch index.

    Returns a list of `{relativePath, title, snippet, score}` dicts.
    """
    return call('notes.search', query=query, limit=limit)
