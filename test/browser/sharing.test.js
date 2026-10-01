// The two-phone story end to end: his phone makes a setup link, her phone opens it and
// is configured with nothing typed, she gets his history rather than an empty week, and
// an entry he makes afterwards reaches her phone while she does not touch it.
//
// The stub sends a sha on every directory entry, as GitHub does. That matters: the
// poll skips files whose sha has not moved, and a stub that omitted them would hide
// both the saving and a bug in the skip itself.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const TZ='Asia/Singapore';
const dayOf=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const isoOf=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
const repoFiles={}; let sha=0, reqs=0;
// five past days already in the repo, written by his phone
for(let d=5; d>=1; d--){
  const ms=Date.now()-d*86400000-3600000, day=dayOf(ms);
  repoFiles['data/events/'+day+'/simon-phone.jsonl']={sha:'h'+d,
    content:Buffer.from(JSON.stringify({ts:isoOf(ms),sender:'Simon',type:'feed',subtype:'bottle',
      value:60,unit:'ml',note:'',raw:'bottle',msg_id:'hist-'+d})+'\n').toString('base64')};
}
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
async function phone(b){
  const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,timezoneId:TZ});
  await ctx.route('https://api.github.com/**', async route=>{
    const req=route.request(); const u=new URL(req.url()); reqs++;
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/baby-data/contents/','').split('?')[0]);
    if(req.method()==='PUT'){ const bd=JSON.parse(req.postData()); const cur=repoFiles[p];
      if(cur&&bd.sha!==cur.sha) return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'sha'})});
      repoFiles[p]={content:bd.content,sha:'s'+(++sha)};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:{sha:repoFiles[p].sha,path:p}})}); }
    const kids=Object.keys(repoFiles).filter(k=>k.startsWith(p+'/'));
    if(kids.length&&!repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify(kids.map(k=>({type:'file',name:k.split('/').pop(),path:k,sha:repoFiles[k].sha})))});
    if(repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({sha:repoFiles[p].sha,content:repoFiles[p].content,path:p})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
  });
  return ctx;
}
(async()=>{
  await new Promise(r=>srv.listen(8800,r));
  const b=await chromium.launch();

  console.log('--- his phone: set up, then make a link for hers ---');
  const hc=await phone(b); const H=await hc.newPage();
  await H.goto('http://localhost:8800/',{waitUntil:'domcontentloaded'}); await H.waitForTimeout(300);
  await H.click('#tab-set');
  await H.fill('#in-who','Simon'); await H.fill('#in-device','simon-phone');
  await H.fill('#in-repo','me/baby-data'); await H.fill('#in-branch','main');
  await H.fill('#in-token','github_pat_SHARED');
  await H.click('#set-test'); await H.waitForTimeout(2500);
  t('his phone backfilled the past days', await H.evaluate(()=>entries.length) >= 5, true);

  await H.fill('#in-other','simon-phone');       // the dangerous mistake
  await H.click('#link-make'); await H.waitForTimeout(250);
  t('it refuses to reuse this phone\'s own name',
     /different one/.test((await H.textContent('#toast-txt'))||''), true);
  t('and makes no link', await H.isHidden('#link-out'), true);

  await H.fill('#in-other','Wife Phone');
  await H.click('#link-make'); await H.waitForTimeout(250);
  const link = (await H.textContent('#link-out'))||'';
  t('the name is tidied into the link', /#s=/.test(link) && (await H.inputValue('#in-other'))==='wife-phone', true);
  t('the secret is after the hash, not in the path', link.split('#')[0].indexOf('github_pat'), -1);

  console.log('\n--- her phone: opens the link, nothing typed ---');
  const wc=await phone(b); const W=await wc.newPage();
  // the link is built from the page's own origin, so it already points at the test server
  await W.goto(link, {waitUntil:'domcontentloaded'});
  await W.waitForTimeout(3000);
  const wcfg = await W.evaluate(()=>({repo:cfg.repo,branch:cfg.branch,device:cfg.device,tok:(cfg.token||'').length,ok:configured()}));
  console.log('   her config:', wcfg);
  t('her phone is configured from the link alone', wcfg.ok, true);
  t('with her own device name', wcfg.device, 'wife-phone');
  t('and the right repo', wcfg.repo, 'me/baby-data');
  t('the token is gone from the address bar', (await W.evaluate(()=>location.hash)), '');
  t('and from the whole URL', (await W.evaluate(()=>location.href)).indexOf('github_pat'), -1);
  t('she sees his history, not an empty week', await W.evaluate(()=>entries.length) >= 5, true);

  console.log('\n--- live: he logs, she sees it without touching her phone ---');
  const before = await W.evaluate(()=>entries.length);
  await H.click('#tab-log');
  await H.evaluate(()=>{const b=document.querySelector('#cat-back');b&&b.click();});
  await H.click('[data-go="nappy"]');
  await H.evaluate(()=>{const x=[...document.querySelectorAll('#cat-body button')].find(e=>/^wet/i.test(e.textContent.trim()));x&&x.click();});
  await H.waitForTimeout(1200);
  console.log('   waiting for her phone to notice, untouched…');
  let sawAt=null;
  for(let i=0;i<20;i++){
    await W.waitForTimeout(1000);
    if(await W.evaluate(n=>entries.length>n, before)){ sawAt=i+1; break; }
  }
  t('her phone picked it up on its own', sawAt!==null, true);
  console.log('   it took about', sawAt, 'seconds');

  console.log('\n--- a quiet minute is cheap ---');
  const r0=reqs; await W.waitForTimeout(12000);
  console.log('   requests in ~12s of nothing happening:', reqs-r0, '(listings only, files skipped by sha)');
  t('an idle poll costs one request, not three', (reqs-r0) <= 2, true);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
