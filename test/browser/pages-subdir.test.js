// Serve the app under a subdirectory exactly as GitHub project Pages does (it serves a
// project repo at /<repo>/, not at the domain root), and check that every
// relative path, the manifest, the icons and the service worker all resolve.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..'), PREFIX='/'+path.basename(ROOT);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const asked=[];
const server=http.createServer((q,r)=>{
  let p=decodeURIComponent(url.parse(q.url).pathname);
  asked.push(p);
  if(!p.startsWith(PREFIX)){r.writeHead(404);return r.end('outside the pages path');}
  p=p.slice(PREFIX.length)||'/'; if(p==='/')p='/index.html';
  const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));
});
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
(async()=>{
  await new Promise(r=>server.listen(8770,r));
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true});
  const page=await ctx.newPage();
  const bad=[]; page.on('response',res=>{const u=new URL(res.url());
    if(u.port==='8770'&&res.status()>=400) bad.push(res.status()+' '+u.pathname);});
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto('http://localhost:8770'+PREFIX+'/',{waitUntil:'networkidle'});
  await page.waitForTimeout(1200);
  t('page loads from the subdirectory', await page.title(), 'Baby Log');
  t('no 404 on any same-origin file', JSON.stringify(bad), '[]');
  t('the manifest was fetched', asked.some(p=>p.endsWith('manifest.webmanifest')), true);
  t('an icon was fetched', asked.some(p=>/icons\/.*\.png$/.test(p)), true);
  t('nothing was requested above the app directory', asked.every(p=>p.startsWith(PREFIX)||p==='/favicon.ico'), true);
  const sw = await page.evaluate(async()=>{ const rs=await navigator.serviceWorker.getRegistrations(); return rs.map(r=>r.scope); });
  t('service worker registered', sw.length>0, true);
  t('and its scope is the app subdirectory', new RegExp(PREFIX+'/$').test(sw[0]||''), true);
  t('the tiles are on screen', await page.isVisible('[data-go="feed"]'), true);
  t('no page errors', JSON.stringify([...new Set(errs)]), '[]');
  await b.close(); server.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
