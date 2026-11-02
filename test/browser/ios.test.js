// iOS. Everything else in here runs on Chromium; iPhones run WebKit, and the two differ
// on exactly the things a phone app lives on - native form controls, safe areas, rubber
// band scrolling. This file runs the real engine where it is installed, and the same
// checks on Chromium so an iOS fix cannot quietly break Android.
//
// The safe areas are the point. env(safe-area-inset-*) cannot be set from a stylesheet
// or a test, so a notch is something only a real iPhone can show you - and the bug it
// causes, content hidden under the notch or the home indicator, is invisible everywhere
// else. index.html reads them through --sat/--sar/--sab/--sal, which this file sets to a
// real iPhone's numbers before measuring.
const pw = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'baby-log-ios');
fs.mkdirSync(SHOTS,{recursive:true});
// iPhone 15 Pro, portrait: 59pt under the clock, 34pt over the home indicator.
const INSETS = {top:59, right:0, bottom:34, left:0};
const LANDSCAPE = {top:0, right:59, bottom:21, left:59};
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};

const seed=()=>{
  const iso=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
  const now=Date.now(), rows=[]; let n=0;
  for(let d=0;d<10;d++){
    const ms=now-d*86400000-5*3600000;
    rows.push({ms,ts:iso(ms),sender:'Des',type:'pump',subtype:'',value:60+d*8,unit:'ml',note:'',
      raw:'pump',msg_id:'p'+(n++),dur_min:null,ml_l:null,ml_r:null,pump_dev:'spectra',own:true,device:'des'});
    const m2=now-d*86400000-7*3600000;
    rows.push({ms:m2,ts:iso(m2),sender:'Des',type:'feed',subtype:'breast',value:20,unit:'min',note:'left',
      raw:'bf',msg_id:'f'+(n++),dur_min:null,ml_l:null,ml_r:null,pump_dev:'',own:true,device:'des'});
  }
  localStorage.setItem('babylog.entries.v2',JSON.stringify(rows));
  localStorage.setItem('babylog.cfg.v2',JSON.stringify({who:'Des',device:'des',repo:'me/d',branch:'main',token:''}));
};

async function run(engineName, deviceName, label, insets) {
  const engine = pw[engineName];
  const ctx = await engine.launch().then(b=>b.newContext({...pw.devices[deviceName], timezoneId:'Asia/Singapore'}).then(c=>({b,c})));
  const {b, c} = ctx;
  await c.addInitScript(seed);
  // the notch, forced on. index.html reads the insets through variables precisely so this
  // is possible; set them before first paint so nothing is measured pre-notch.
  await c.addInitScript(i=>{
    addEventListener('DOMContentLoaded',()=>{
      const r=document.documentElement.style;
      r.setProperty('--sat',i.top+'px'); r.setProperty('--sar',i.right+'px');
      r.setProperty('--sab',i.bottom+'px'); r.setProperty('--sal',i.left+'px');
    });
  }, insets);
  const page = await c.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await page.goto('http://localhost:8947/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(700);

  console.log('\n--- '+label+' ---');
  const top = await page.evaluate(()=>{
    const app=document.querySelector('.app');
    const first=document.querySelector('.state').getBoundingClientRect();
    return {pad:getComputedStyle(app).paddingTop, headerTop:Math.round(first.top)};
  });
  t(label+': the app is padded clear of the status bar', top.pad, insets.top+'px');
  t(label+': so nothing is drawn under it', top.headerTop >= insets.top, true);

  await page.click('#tab-pump'); await page.waitForTimeout(600);
  const geom = await page.evaluate(i=>{
    const pane=document.querySelector('#pane-pump'), tabs=document.querySelector('.tabs');
    const cs=getComputedStyle(pane), tb=tabs.getBoundingClientRect();
    // the narrowest thing on the tab: does any content start left of the inset?
    let minLeft=Infinity, maxRight=-Infinity;
    for(const el of pane.querySelectorAll('.lcard,.brow,.btn,.chip,table'))
      {const r=el.getBoundingClientRect(); if(r.width<2)continue;
       minLeft=Math.min(minLeft,r.left); maxRight=Math.max(maxRight,r.right);}
    return {padL:cs.paddingLeft, padR:cs.paddingRight,
            overscroll:cs.overscrollBehaviorY,
            tabsPadB:getComputedStyle(tabs).paddingBottom,
            tabsBottom:Math.round(tb.bottom), vpH:innerHeight, vpW:innerWidth,
            minLeft:Math.round(minLeft), maxRight:Math.round(maxRight)};
  }, insets);
  t(label+': the pane clears the notch on the left', parseFloat(geom.padL) >= insets.left, true);
  t(label+': and on the right', parseFloat(geom.padR) >= insets.right, true);
  t(label+': no content starts left of the inset', geom.minLeft >= insets.left, true);
  t(label+': none runs past it on the right', geom.maxRight <= geom.vpW - insets.right, true);
  t(label+': the tab bar clears the home indicator', geom.tabsPadB, insets.bottom+'px');
  t(label+': a pull at the top of a pane does not become pull-to-refresh',
     geom.overscroll, 'contain');

  // native control styling: Safari overrides these unless appearance is stripped
  await page.click('#tab-book'); await page.waitForTimeout(500);
  const ctrl = await page.evaluate(()=>{
    const g=id=>{const e=document.getElementById(id); if(!e) return null;
      const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
      return {app:cs.webkitAppearance||cs.appearance, radius:cs.borderTopLeftRadius,
              fs:parseFloat(cs.fontSize), w:Math.round(r.width), h:Math.round(r.height)};};
    return {sel:g('bk-kind'), date:g('bk-date'), time:g('bk-time'), amt:g('bk-amt')};
  });
  t(label+': the kind dropdown is not left as a native iOS control', ctrl.sel.app, 'none');
  t(label+': and keeps the radius the rest of the form uses', ctrl.sel.radius, '10px');
  t(label+': the date box is a full-width row, not its intrinsic width', ctrl.date.w > 120, true);
  t(label+': the time box too', ctrl.time.w > 120, true);
  [['date',ctrl.date],['time',ctrl.time],['amount',ctrl.amt]].forEach(([n,c])=>{
    t(label+': the '+n+' box is a 44px target', c.h >= 44, true);
    t(label+': and 16px or more, so focusing it does not zoom the page', c.fs >= 16, true);
  });

  // the one thing that is only wrong on a phone: a tap flashing a grey box
  const tap = await page.evaluate(()=>getComputedStyle(document.body).webkitTapHighlightColor);
  if (tap) t(label+': no grey tap flash over the controls', /rgba\(0, 0, 0, 0\)|transparent/.test(tap), true);

  await page.screenshot({path:`${SHOTS}/${label.replace(/[^a-z0-9]+/gi,'-')}.png`, fullPage:false});
  t(label+': no JS errors', errs.join('|') || 'none', 'none');
  await b.close();
}

(async()=>{
  await new Promise(r=>srv.listen(8947,r));
  let webkitOk = true;
  try { const b = await pw.webkit.launch(); await b.close(); } catch (e) { webkitOk = false; }
  if (webkitOk) {
    await run('webkit','iPhone 15 Pro','webkit iPhone 15 Pro', INSETS);
    await run('webkit','iPhone SE','webkit iPhone SE', INSETS);
    await run('webkit','iPhone 15 Pro landscape','webkit iPhone landscape', LANDSCAPE);
  } else {
    console.log('\n!! WebKit is not installed, so the iOS engine was NOT exercised.');
    console.log('   npx playwright install webkit && npx playwright install-deps webkit');
    console.log('   Running the same checks on Chromium only, which cannot see a Safari-only fault.');
  }
  // Android, with the same insets forced: an iOS fix must not cost anything here
  await run('chromium','Pixel 7','chromium Pixel 7', INSETS);
  await run('chromium','Galaxy S9+','chromium Galaxy S9+', INSETS);
  srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
