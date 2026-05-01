/**
 * Client-side search for the static-site exporter (#252).
 *
 * Bundled inline as `search.js` at the site root. Loads `search.json`
 * lazily on the first keystroke, then filters by case-insensitive
 * substring match against title + snippet. Naive — fine up to ~10k
 * notes; the day someone needs better, swap in lunr/MiniSearch.
 *
 * No build step, no framework — vanilla JS that works straight off
 * `python -m http.server` or any other static host.
 */

export const SITE_SEARCH_SCRIPT = `(function() {
  'use strict';
  var input = document.querySelector('input.site-search');
  var results = document.getElementById('search-results');
  if (!input || !results) return;

  var indexPromise = null;
  function loadIndex() {
    if (indexPromise) return indexPromise;
    // search.json sits at the site root; relative path computed from
    // the page's data-search-root attribute on <body>.
    var root = document.body.dataset.searchRoot || '';
    indexPromise = fetch(root + 'search.json')
      .then(function(r) { return r.json(); })
      .catch(function() { return []; });
    return indexPromise;
  }

  var lastQuery = '';
  function render(query) {
    if (query === lastQuery) return;
    lastQuery = query;
    if (!query) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }
    loadIndex().then(function(records) {
      var q = query.toLowerCase();
      var hits = [];
      for (var i = 0; i < records.length && hits.length < 30; i++) {
        var rec = records[i];
        var hay = (rec.title + ' ' + rec.snippet).toLowerCase();
        if (hay.indexOf(q) !== -1) hits.push(rec);
      }
      results.classList.remove('hidden');
      if (hits.length === 0) {
        results.innerHTML = '<p class="empty">No matches for "' + escapeHtml(query) + '".</p>';
        return;
      }
      var html = '';
      var root = document.body.dataset.searchRoot || '';
      for (var j = 0; j < hits.length; j++) {
        var h = hits[j];
        html += '<a class="hit-link" href="' + root + escapeAttr(h.url) + '"><div class="hit"><h4>' + escapeHtml(h.title) + '</h4><p>' + escapeHtml(h.snippet) + '</p></div></a>';
      }
      results.innerHTML = html;
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  input.addEventListener('input', function(e) { render(e.target.value.trim()); });
})();`;
