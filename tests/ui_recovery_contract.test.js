const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

const heroStart = landing.indexOf('<!-- High-Status Hero Headline -->');
const heroEnd = landing.indexOf('<!-- Social Proof Indicator -->', heroStart);
assert(heroStart >= 0 && heroEnd > heroStart, 'landing hero section must remain discoverable');
const hero = landing.slice(heroStart, heroEnd);

assert.match(
    hero,
    /onclick="window\.openAuthRequiredModal\(event\)"[\s\S]*?<span>Sign In<\/span>/,
    'landing hero must expose the canonical Sign In modal trigger'
);
assert.match(
    styles,
    /@media \(min-width: 768px\)[\s\S]*?body\.landing-page #hero-reveal-container h1[\s\S]*?font-size: 4\.5rem !important[\s\S]*?line-height: 1\.1 !important/,
    'desktop landing hero must retain the reference 72px typography despite the locked global h1 rule'
);
assert.match(
    styles,
    /@media \(min-width: 640px\)[\s\S]*?body\.landing-page > nav[\s\S]*?display: inline-flex !important/,
    'desktop landing header must restore the reference Sign In and Launch App visibility'
);

console.log('UI recovery contract passed.');
