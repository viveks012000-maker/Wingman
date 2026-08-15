const fs = require('fs');

// 1) Landing-page toast: never interpolate arbitrary message text into innerHTML.
const indexPath = 'index.html';
let index = fs.readFileSync(indexPath, 'utf8');
const unsafeToast = `                toast.innerHTML = '<span class="material-symbols-outlined text-[18px] shrink-0">' + icon + '</span><span class="leading-snug">' + msg + '</span>';`;
const safeToast = `                var iconSpan = document.createElement("span");
                iconSpan.className = "material-symbols-outlined text-[18px] shrink-0";
                iconSpan.textContent = icon;
                var messageSpan = document.createElement("span");
                messageSpan.className = "leading-snug";
                messageSpan.textContent = String(msg == null ? "" : msg);
                toast.appendChild(iconSpan);
                toast.appendChild(messageSpan);`;
if (!index.includes(unsafeToast)) throw new Error('Expected unsafe landing toast sink not found');
index = index.replace(unsafeToast, safeToast);
if (index.includes("+ msg + '</span>'")) throw new Error('Raw landing toast message interpolation still present');
fs.writeFileSync(indexPath, index);

// 2) Remove the dead duplicate CSRF-token route. Keep the first route, which reuses the
// existing cookie token rather than generating a divergent second implementation.
const serverPath = 'server.js';
let server = fs.readFileSync(serverPath, 'utf8');
const duplicateCsrf = `// PUBLIC ENDPOINT FOR CSRF SECURITY TOKEN ISSUANCE
app.get('/api/csrf-token', (req, res) => {
    const token = generateCsrfToken();
    setHttpOnlyCookie(res, 'wingman_csrf', token, 3600);
    res.json({ success: true, csrfToken: token });
});

`;
if (!server.includes(duplicateCsrf)) throw new Error('Expected duplicate CSRF route not found');
server = server.replace(duplicateCsrf, '');
const csrfCount = (server.match(/app\.get\('\/api\/csrf-token'/g) || []).length;
if (csrfCount !== 1) throw new Error(`Expected exactly one CSRF token route after cleanup, found ${csrfCount}`);
fs.writeFileSync(serverPath, server);

// 3) Add a focused regression suite for the independent findings from this forensic pass.
const testPath = 'tests/post_audit_correctness.test.js';
const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(!app.includes('title.textContent = creditMap[tier] + " Credits Added"'),
  'A tier query parameter must never claim credits were minted while purchases are unavailable');
assert.ok(app.includes('cleanUrl.searchParams.delete("tier")'),
  'Stale tier checkout parameters must be removed after the unavailable-purchase notice');

assert.ok(!index.includes("+ msg + '</span>'"),
  'Landing-page toast must not interpolate arbitrary message text into innerHTML');
assert.ok(index.includes('messageSpan.textContent = String(msg == null ? "" : msg);'),
  'Landing-page toast must render message text through textContent');

assert.strictEqual((server.match(/app\\.get\\('\\/api\\/csrf-token'/g) || []).length, 1,
  'Exactly one CSRF token issuance route must exist');
assert.ok(server.includes("let csrfToken = cookies['wingman_csrf'];"),
  'The retained CSRF route must reuse an existing token cookie when available');

console.log('✔ Post-audit correctness and DOM-sink regression guard passed.');
`;
fs.writeFileSync(testPath, test);

const runnerPath = 'tests/run_all_tests.js';
let runner = fs.readFileSync(runnerPath, 'utf8');
if (!runner.includes("post_audit_correctness.test.js")) {
  const anchor = "    { name: '25. Headless Browser Live Viewport Overflow QA', file: 'browser_viewport_live_qa.js' }\n";
  if (!runner.includes(anchor)) throw new Error('Test runner anchor not found');
  runner = runner.replace(anchor,
    "    { name: '25. Headless Browser Live Viewport Overflow QA', file: 'browser_viewport_live_qa.js' },\n" +
    "    { name: '26. Post-Audit Correctness & DOM Sink Guard', file: 'post_audit_correctness.test.js' }\n");
}
fs.writeFileSync(runnerPath, runner);

console.log('Patched landing toast, duplicate CSRF route, and added regression coverage.');
