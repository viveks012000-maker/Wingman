const { chromium } = require('playwright');
const axeSource = require('axe-core').source;
const SITE = 'https://soft-sawine-30785c.netlify.app';
const EXPECTED = '261d7a3060ba5868541b653e0697a4667e4fe321';

async function waitRelease() {
  for (let i=0;i<30;i++) {
    try {
      const r=await fetch(`${SITE}/release.json?audit=${Date.now()}-${i}`,{headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
      const j=await r.json();
      console.log(`release_attempt=${i+1} actual=${j.sourceCommit}`);
      if(j.sourceCommit===EXPECTED)return;
    } catch(e) { console.warn(`release_attempt=${i+1} error=${String(e)}`); }
    await new Promise(r=>setTimeout(r,3000));
  }
  throw new Error('release mismatch');
}

async function scan(page, scope, path) {
  await page.goto(SITE+path,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(500);
  await page.addScriptTag({content:axeSource});
  const v=await page.evaluate(async()=>{
    const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
    return r.violations.filter(x=>x.impact==='serious'||x.impact==='critical').map(x=>({
      id:x.id,impact:x.impact,help:x.help,helpUrl:x.helpUrl,
      nodes:x.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary,any:n.any?.map(c=>c.message),all:n.all?.map(c=>c.message),none:n.none?.map(c=>c.message)}))
    }));
  });
  if(!v.length){console.log(`AXE_PASS scope=${scope}`);return 0;}
  for(const rule of v){
    for(const node of rule.nodes){
      console.log('AXE_FAIL '+JSON.stringify({scope,rule:rule.id,impact:rule.impact,help:rule.help,selector:node.target,html:node.html,summary:node.summary,any:node.any,all:node.all,none:node.none}));
    }
  }
  return v.reduce((n,x)=>n+x.nodes.length,0);
}

(async()=>{
  await waitRelease();
  const b=await chromium.launch({headless:true});
  let count=0;
  try{
    const desktop=await b.newContext({viewport:{width:1366,height:768}}); const dp=await desktop.newPage();
    for(const p of ['/','/terms.html','/privacy.html','/refund.html']) count+=await scan(dp,'desktop'+p,p);
    await desktop.close();
    for(const [w,h] of [[320,568],[390,844]]){
      const c=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true});const p=await c.newPage();
      count+=await scan(p,`mobile-${w}/`,'/');await c.close();
    }
  } finally {await b.close();}
  console.log(`AXE_DETAIL_TOTAL_NODES=${count}`);
  if(count)process.exit(2);
})().catch(e=>{console.error('AXE_DETAIL_FATAL '+String(e));process.exit(3);});
