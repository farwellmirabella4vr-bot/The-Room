// THE ROOM — shared vanilla-JS utilities.
// Plain script, no build step, no module system -- consistent with every
// room being a single self-contained HTML page. Loaded via a plain
// <script src="design-system/utils.js"></script>, so everything here
// attaches to the global scope (no export/import).

// Escape user-entered text before concatenating it into innerHTML.
// Originally lived only in language-hub.html; pulled out here so every
// room that builds HTML strings from saved data (transaction
// descriptions, journal entries, pinned note titles, etc.) can use the
// same one instead of copy-pasting or, worse, not escaping at all.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
