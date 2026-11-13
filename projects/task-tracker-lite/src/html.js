'use strict';

// Small HTML helpers for the web UI (ISS-009 onward). Plain server-rendered HTML that
// works in any standard browser without client-side JavaScript (FR-017, NFR-002).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
});

// signedInAs: display name of the signed-in member, or null on public pages.
// A signed-in page always shows the sign-out control.
function page({ title, body, signedInAs = null }) {
  const header = signedInAs === null
    ? ''
    : `<header>
  <span>Signed in as ${escapeHtml(signedInAs)}</span>
  <form method="post" action="/logout" class="inline"><button type="submit" id="sign-out">Sign out</button></form>
</header>
`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Task Tracker Lite</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: .5rem; }
form.inline { display: inline; }
label { display: block; margin-top: .75rem; }
.error { color: #a00; }
</style>
</head>
<body>
${header}<main>
${body}
</main>
</body>
</html>
`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(html);
}

module.exports = { escapeHtml, page, sendHtml, SECURITY_HEADERS };
