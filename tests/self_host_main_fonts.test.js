'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { ASSETS, INLINE_MARKER } = require('../scripts/postprocess-self-host-main-fonts');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');

function buildArtifact() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const script of [
    'scripts/build-netlify-dist.js',
    'scripts/postprocess-lazy-heic.js',
    'scripts/postprocess-deferred-media.js',
    'scripts/postprocess-vendor-allowlist.js',
    'scripts/postprocess-deferred-runtime.js',
    'scripts/postprocess-material-symbols-subset.js',
    'scripts/postprocess-logo-delivery.js',
    'scripts/postprocess-inline-critical-css.js',
    'scripts/postprocess-self-host-main-fonts.js'
  ]) execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'pipe' });
}

function verifyArtifact() {
  const css = fs.readFileSync(path.join(OUT, 'fonts/main-fonts.css'), 'utf8');
  assert.strictEqual((css.match(/@font-face/g) || []).length, 83, 'must preserve all 83 Google font-face declarations');
  assert.strictEqual((css.match(/font-display:\s*swap/g) || []).length, 83, 'must preserve font-display swap on every face');
  assert(!/fonts\.(googleapis|gstatic)\.com/.test(css), 'local main-font CSS must have no external Google host');
  assert.strictEqual(new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, ''))).size, 20, 'must preserve 20 unique WOFF2 subsets');

  const release = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  for (const rel of Object.keys(ASSETS)) {
    assert(fs.existsSync(path.join(OUT, rel)), `artifact must include ${rel}`);
    assert(release.files[rel], `release manifest must hash ${rel}`);
  }
  for (const page of ['index.html', 'app.html']) {
    const html = fs.readFileSync(path.join(OUT, page), 'utf8');
    assert.strictEqual((html.match(new RegExp(INLINE_MARKER, 'g')) || []).length, 1, `${page} must inline main-font CSS exactly once`);
    assert(!html.includes('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans'), `${page} must remove external main font stylesheet`);
    assert(html.includes('Material+Symbols+Outlined'), `${page} must preserve Material Symbols Google stylesheet`);
  }
  for (const lic of ['geist-OFL.txt','inter-OFL.txt','plus-jakarta-sans-OFL.txt']) {
    const text=fs.readFileSync(path.join(OUT,'fonts/licenses',lic),'utf8');
    assert(text.includes('SIL OPEN FONT LICENSE Version 1.1'), `${lic} must retain OFL license`);
  }
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/.test(file)) return 'image/jpeg';
  return 'application/octet-stream';
}

async function verifyBrowser() {
  const server=http.createServer((req,res)=>{
    let p=new URL(req.url,'http://localhost').pathname;if(p==='/')p='/index.html';if(p==='/app')p='/app.html';
    const rel=decodeURIComponent(p).replace(/^\/+/,''),file=path.resolve(OUT,rel);
    if(!file.startsWith(OUT+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end('not found');}
    res.writeHead(200,{'Content-Type':contentType(file),'Cache-Control':'no-store'});res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  try {
    for(const route of ['/','/app']){
      const c=await browser.newContext({viewport:{width:1440,height:900}}),page=await c.newPage(),requests=[];
      page.on('request',r=>requests.push(r.url()));
      await page.route('https://fonts.googleapis.com/**', routeObj => {
        if(routeObj.request().url().includes('Material+Symbols+Outlined')) return routeObj.fulfill({status:200,contentType:'text/css',body:''});
        throw new Error(`Unexpected external Google font CSS request: ${routeObj.request().url()}`);
      });
      await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:15000});
      await page.evaluate(async()=>{await Promise.all([document.fonts.load('400 16px Geist','Hello'),document.fonts.load('400 16px "Plus Jakarta Sans"','Hello')]);});
      await page.waitForTimeout(150);
      assert(!requests.some(u=>u.includes('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans')), `${route} must not request Google main font CSS`);
      assert(!requests.some(u=>/fonts\.gstatic\.com\/(?:s\/geist|s\/inter|s\/plusjakartasans)/.test(u)), `${route} must not request external main WOFF2`);
      assert(requests.some(u=>/\/fonts\/geist-normal-latin\.woff2(?:\?|$)/.test(u)), `${route} must load local Geist Latin WOFF2`);
      assert(requests.some(u=>/\/fonts\/plus-jakarta-sans-normal-latin\.woff2(?:\?|$)/.test(u)), `${route} must load local Plus Jakarta Sans Latin WOFF2`);
      const faces=await page.evaluate(()=>[...document.fonts].filter(f=>['Geist','Plus Jakarta Sans'].includes(f.family)).map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status})));
      assert(faces.some(f=>f.family==='Geist'&&f.weight==='400'&&f.status==='loaded'), `${route} Geist 400 must load`);
      assert(faces.some(f=>f.family==='Plus Jakarta Sans'&&f.weight==='400'&&f.status==='loaded'), `${route} Plus Jakarta Sans 400 must load`);
      await c.close();
    }
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
}

(async()=>{try{buildArtifact();verifyArtifact();await verifyBrowser();console.log('✅ Exact main typography is self-hosted locally with pinned subsets, licenses, and zero external main-font requests.');}finally{fs.rmSync(OUT,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exit(1)});
