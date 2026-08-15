import re
import subprocess

ASSIGN = re.compile(r'''(?i)\b(AICREDITS_API_KEY(?:_VISION)?|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|JWT_SECRET)\b\s*[:=]\s*["']?([^\s"'`,;}]{16,})''')
KEYISH = re.compile(r'''(?i)\b(sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b''')
ALLOW = ('your_', 'example', 'dummy', 'test_', 'process.env', '${{')

commits = subprocess.check_output(['git', 'rev-list', '--all'], text=True).splitlines()
findings = []
for sha in commits:
    try:
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', sha], text=True, stderr=subprocess.DEVNULL).splitlines()
    except subprocess.CalledProcessError:
        continue
    for path in paths:
        if path.startswith(('node_modules/', 'vendor/')):
            continue
        try:
            blob = subprocess.check_output(['git', 'show', f'{sha}:{path}'], stderr=subprocess.DEVNULL)
            if len(blob) > 2_000_000 or b'\x00' in blob[:1000]:
                continue
            text = blob.decode('utf-8', 'ignore')
        except Exception:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            candidates = []
            m = ASSIGN.search(line)
            if m:
                candidates.append(('named_assignment', m.group(2)))
            candidates.extend(('key_pattern', val) for val in KEYISH.findall(line))
            for kind, value in candidates:
                low = value.lower()
                if any(fragment.lower() in low for fragment in ALLOW):
                    continue
                findings.append((sha[:12], path, lineno, kind, len(value)))

unique = []
seen = set()
for finding in findings:
    identity = finding[1:]
    if identity in seen:
        continue
    seen.add(identity)
    unique.append(finding)

print('HISTORY_SECRET_FINDING_COUNT=' + str(len(unique)))
for sha, path, lineno, kind, length in unique[:100]:
    print(f'REDACTED_SECRET_LOCATION commit={sha} file={path} line={lineno} kind={kind} length={length}')
if len(unique) > 100:
    print('OUTPUT_TRUNCATED=true')
