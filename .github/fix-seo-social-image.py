from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = 'https://mywingman.pages.dev/logo.png'
new = 'https://mywingman.pages.dev/logo-384.webp'

index = root / 'index.html'
text = index.read_text(encoding='utf-8')
if text.count(old) != 2:
    raise SystemExit(f'index.html: expected exactly 2 social logo references, found {text.count(old)}')
index.write_text(text.replace(old, new), encoding='utf-8')

test = root / 'tests' / 'seo_indexing_metadata.test.js'
text = test.read_text(encoding='utf-8')
if text.count(old) != 2:
    raise SystemExit(f'seo test: expected exactly 2 old social logo expectations, found {text.count(old)}')
test.write_text(text.replace(old, new), encoding='utf-8')

print('Corrected social image metadata to optimized production logo.')
