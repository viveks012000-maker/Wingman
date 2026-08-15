const fs = require('fs');

const replacements = [
  {
    file: 'tests/final_hardening_pass.test.js',
    marker: 'delete-account fails safe if auth deletion fails',
    line: `assert.strictEqual(serverFile.includes("if (authDelErr) {") && serverFile.includes("Failed to delete authentication account: ' + authDelErr.message"), true, 'delete-account fails safe if auth deletion fails');`
  },
  {
    file: 'tests/codex_audit_verification.test.js',
    marker: 'delete-account must fail-safe if auth deletion fails',
    line: `assert.strictEqual(serverFile.includes("if (authDelErr) {") && serverFile.includes("Failed to delete authentication account: ' + authDelErr.message"), true, 'delete-account must fail-safe if auth deletion fails');`
  },
  {
    file: 'tests/security_hardening_audit.test.js',
    marker: "serverContent.includes(\"if (authDelErr) {",
    line: `assert.strictEqual(serverContent.includes("if (authDelErr) {") && serverContent.includes("Failed to delete authentication account: ' + authDelErr.message"), true);`
  }
];

for (const { file, marker, line } of replacements) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = 0;
  const out = lines.map(existing => {
    if (existing.includes(marker)) {
      changed++;
      return line;
    }
    return existing;
  });
  if (changed !== 1) throw new Error(`${file}: expected one legacy assertion, changed ${changed}`);
  fs.writeFileSync(file, out.join('\n'));
}

console.log('Updated three legacy account-deletion assertions to semantic fail-safe checks.');
