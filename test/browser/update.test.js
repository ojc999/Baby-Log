// Does a deploy actually reach a phone?
//
// Serves the app with the headers GitHub Pages really sends (max-age=600), then changes
// the file and navigates back to it. The service worker said "network first", but a plain
// fetch() goes through the browser's own HTTP cache, so for ten minutes it returned the
// cached copy without touching the network and the new build never arrived. Verified: with
// `fetch(req)` this test fails on "the new build is what is running"; with
// `fetch(req.url, {cache:'no-cache'})` it passes.
//
// Note it must be a navigation, not page.reload(): Chromium's reload forces revalidation
// and hides the HTTP cache entirely, which made the first version of this test pass
// against the broken worker.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
let MARKER = 'BUILD-ONE';
let BUILT = Date.now() - 86400000;
let netHits = 0;
const srv=http.createServer((q,r)=>{
  let p=decodeURIComponent(url.parse(q.url).pathname); if(p==='/')p='/index.html';
  const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  let body=fs.readFileSync(f);
  if (p==='/index.html') { netHits++; body = Buffer.from(String(body).replace('<title>Baby Log</title>','<title>Baby Log '+MARKER+'</title>')); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream',
                   'Cache-Control':'max-age=600',       // exactly what GitHub Pages sends,
                   'Last-Modified':new Date(BUILT).toUTCString()});   // including this

  r.end(body);
});
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
(async()=>{
  await new Promise(r=>srv.listen(8880,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,timezoneId:'Asia/Singapore'});
  const page=await ctx.newPage();
  await page.goto('http://localhost:8880/',{waitUntil:'load'});
  await page.waitForTimeout(1200);                       // let the worker install and claim
  t('first load is build one', /BUILD-ONE/.test(await page.title()), true);
  const swOk = await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(r=>r.length>0));
  t('a service worker is controlling the page', swOk, true);

  // deploy a change, exactly as pushing to Pages would
  MARKER = 'BUILD-TWO';
  BUILT = Date.now();
  const hitsBefore = netHits;
  // Not page.reload(): Chromium's reload forces revalidation and so hides the HTTP cache
  // entirely. A home-screen app being reopened is an ordinary navigation, which does use
  // it - so navigate away and back, which is what that actually looks like.
  await page.goto('http://localhost:8880/manifest.webmanifest',{waitUntil:'load'}).catch(()=>{});
  await page.goto('http://localhost:8880/',{waitUntil:'load'});
  await page.waitForTimeout(1200);
  console.log('   origin was asked for index.html', netHits-hitsBefore, 'time(s) on reload');
  t('the reload actually reached the server', netHits > hitsBefore, true);
  t('and the new build is what is running', /BUILD-TWO/.test(await page.title()), true);

  // and it still works with no network at all
  await ctx.setOffline(true);
  await page.reload({waitUntil:'load'}).catch(()=>{});
  await page.waitForTimeout(800);
  const offlineTitle = await page.title().catch(()=>'');
  t('offline still opens from the cache', /Baby Log/.test(offlineTitle), true);
  await ctx.setOffline(false);

  // and the app can say which build it is on, so this is answerable without guesswork
  await page.goto('http://localhost:8880/',{waitUntil:'load'});
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ localStorage.setItem('babylog.cfg.v2', JSON.stringify(
    {who:'S',device:'d',repo:'me/d',branch:'main',token:'t'})); });
  await page.reload({waitUntil:'load'}); await page.waitForTimeout(900);
  await page.click('#tab-set'); await page.waitForTimeout(900);
  const diag = (await page.textContent('#diag'))||'';
  t('diagnostics names the build this phone is running', /app build/.test(diag), true);
  t('and it is not "unknown"', /app build\s+unknown/.test(diag), false);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
