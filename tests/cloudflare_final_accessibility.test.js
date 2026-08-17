'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'app.html'),'utf8');
const js=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');

function luminance(hex){
  const n=hex.replace('#','');
  const rgb=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4));
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}

assert.ok(html.includes('id="chatbox-messages-container" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Practice conversation messages" tabindex="0"'), 'Maeve scrollable message log must be keyboard-focusable and named');
assert.ok(html.includes('id="chatbox-credit-notice" style="display: flex; justify-content: space-between; align-items: center; padding: 2px 16px 8px 16px; font-size: 11px; color: #c084fc;'), 'Maeve credit notice must use the accessible purple');
assert.ok(js.includes("chatCounter.style.color = len > 5000 ? '#ef4444' : (len > 4500 ? '#f59e0b' : '#c084fc');"), 'Character counter default color must not regress to translucent low contrast');
assert.ok(contrast('#c084fc','#0c0918')>=4.5, `Maeve helper contrast must meet WCAG AA; got ${contrast('#c084fc','#0c0918').toFixed(2)}`);
assert.ok(contrast('#ef4444','#0c0918')>=4.5, 'Over-limit red counter state must meet AA');
assert.ok(contrast('#f59e0b','#0c0918')>=4.5, 'Near-limit amber counter state must meet AA');

for(const [id,label] of [
  ['settingLinguisticShorthand','Use linguistic shorthand'],
  ['settingEmojiDensity','Emoji density'],
  ['settingPlexusToggle','Show background plexus canvas']
]){
  const re=new RegExp(`<input[^>]*id=["']${id}["'][^>]*aria-label=["']${label}["']|<input[^>]*aria-label=["']${label}["'][^>]*id=["']${id}["']`);
  assert.ok(re.test(html), `${id} must have accessible name: ${label}`);
}
console.log(`✔ Cloudflare final accessibility guard passed; helper contrast ${contrast('#c084fc','#0c0918').toFixed(2)}:1.`);
