// Either phone changing the other's entries, without either writing the other's file.
//
// The one-writer-per-file rule is what stops a push losing an entry, so an undo of her row
// is a `deleted` row carrying her msg_id written into HIS file. Her file is never touched.
// Both copies then reach compact.py, where a deleted row always wins.
//
// Verified to fail before the change: his screen offered no undo on her row, his file
// carried no strike, and her entry stayed live on both phones.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const repoFiles={}; let sha=0;
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
const rows = p => repoFiles[p] ? Buffer.from(repoFiles[p].content,'base64').toString('utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse) : [];

async function phone(b, device, who){
  const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,timezoneId:'Asia/Singapore'});
  await ctx.route('https://api.github.com/**', async route=>{
    const req=route.request(); const u=new URL(req.url());
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/d/contents/','').split('?')[0]);
    if(req.method()==='PUT'){ const bd=JSON.parse(req.postData()); const cur=repoFiles[p];
      if(cur&&bd.sha!==cur.sha) return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'sha'})});
      repoFiles[p]={content:bd.content,sha:'s'+(++sha)};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:{sha:repoFiles[p].sha,path:p}})}); }
    const kids=Object.keys(repoFiles).filter(k=>k.startsWith(p+'/'));
    if(p==='data/events'){const days=[...new Set(Object.keys(repoFiles).map(k=>k.split('/')[2]))];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(days.map(d=>({type:'dir',name:d,path:'data/events/'+d})))});}
    if(kids.length&&!repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify(kids.map(k=>({type:'file',name:k.split('/').pop(),path:k,sha:repoFiles[k].sha})))});
    if(repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({sha:repoFiles[p].sha,content:repoFiles[p].content,path:p})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
  });
  const page=await ctx.newPage();
  await page.goto('http://localhost:8930/',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(300);
  await page.click('#tab-set');
  await page.fill('#in-who',who); await page.fill('#in-device',device);
  await page.fill('#in-repo','me/d'); await page.fill('#in-branch','main'); await page.fill('#in-token','t');
  await page.click('#set-test'); await page.waitForTimeout(1200);
  await page.click('#tab-log');
  return {ctx,page};
}
const pull = async P => { await P.page.evaluate(()=>{lastPullMs=0;}); await P.page.evaluate(()=>pullToday()); await P.page.waitForTimeout(900); };

(async()=>{
  await new Promise(r=>srv.listen(8930,r));
  const b=await chromium.launch();
  const DES=await phone(b,'des','Des');
  const SIM=await phone(b,'simon','Simon');
  const day = await SIM.page.evaluate(()=>daySG(Date.now()));
  const herFile = 'data/events/'+day+'/des.jsonl', hisFile = 'data/events/'+day+'/simon.jsonl';

  console.log('--- she logs a feed ---');
  await DES.page.click('[data-go="feed"]');
  await DES.page.click('[data-sheet="bottle"]'); await DES.page.waitForTimeout(200);
  await DES.page.click('#sheet-save'); await DES.page.waitForTimeout(1200);
  const herId = await DES.page.evaluate(()=>entries[entries.length-1].msg_id);
  t('her file has it', rows(herFile).length, 1);

  console.log('--- he sees it, and now has controls on it ---');
  await pull(SIM);
  const ctrls = await SIM.page.evaluate(id=>{
    const r=[...document.querySelectorAll('#home-recent .row')].find(x=>x.querySelector(`[data-del="${id}"]`));
    return !!r; }, herId);
  t('his screen offers undo on her row', ctrls, true);

  console.log('--- he undoes her entry ---');
  const herFileBefore = JSON.stringify(rows(herFile));
  await SIM.page.evaluate(id=>undo(id), herId);
  await SIM.page.waitForTimeout(1500);
  t('HER FILE IS UNTOUCHED', JSON.stringify(rows(herFile)), herFileBefore);
  const his = rows(hisFile);
  const marker = his.find(r=>r.msg_id===herId);
  t('his file carries a strike with her msg_id', !!marker, true);
  t('and it is a deleted row', marker && marker.type, 'deleted');
  t('keeping her original words', marker && marker.raw, rows(herFile)[0].raw);
  t('his screen shows exactly one row for it',
     await SIM.page.evaluate(id=>entries.filter(r=>r.msg_id===id).length, herId), 1);
  t('and it reads as undone',
     await SIM.page.evaluate(id=>entries.find(r=>r.msg_id===id).type, herId), 'deleted');

  console.log('--- a later poll must not resurrect it ---');
  await pull(SIM); await pull(SIM);
  t('still one row', await SIM.page.evaluate(id=>entries.filter(r=>r.msg_id===id).length, herId), 1);
  t('still undone', await SIM.page.evaluate(id=>entries.find(r=>r.msg_id===id).type, herId), 'deleted');

  console.log('--- and HER phone catches up from his file ---');
  await pull(DES);
  t('her own copy now reads undone',
     await DES.page.evaluate(id=>entries.find(r=>r.msg_id===id).type, herId), 'deleted');
  t('without a second row appearing',
     await DES.page.evaluate(id=>entries.filter(r=>r.msg_id===id).length, herId), 1);
  t('and nothing was forced into a push',
     await DES.page.evaluate(()=>Object.keys(dirty).filter(d=>dirty[d]).length), 0);

  console.log('--- he corrects another of her entries ---');
  await DES.page.evaluate(()=>{const b=document.querySelector('#cat-back');b&&b.click();});
  // 90 minutes before now, in Singapore, clamped to the start of the day. A hard-coded
  // early-morning time made this fail every night between midnight and that time: the app
  // correctly refuses a correction into the future, and 04:30 "today" is the future at
  // 00:27. Derived from the page's own clock so it is always a time that has happened.
  const earlier = async p => p.evaluate(() => {
    const q = sgParts(Date.now());
    const m = Math.max(0, Number(q.hour) * 60 + Number(q.minute) - 90);
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  });
  await DES.page.click('[data-go="nappy"]');
  await DES.page.evaluate(()=>{const x=[...document.querySelectorAll('#cat-body button')].find(e=>/^wet/i.test(e.textContent.trim()));x&&x.click();});
  await DES.page.waitForTimeout(1200);
  const herId2 = await DES.page.evaluate(()=>entries.filter(r=>r.type==='nappy').pop().msg_id);
  await pull(SIM);
  const herBefore2 = JSON.stringify(rows(herFile));
  await SIM.page.evaluate(id=>openFix(id), herId2);
  await SIM.page.waitForTimeout(300);
  t('the correction box opens on her row', await SIM.page.isVisible('#fix'), true);
  const back = await earlier(SIM.page);
  await SIM.page.fill('#fix-time', back);
  await SIM.page.click('#fix-save'); await SIM.page.waitForTimeout(1500);
  t('HER FILE IS STILL UNTOUCHED', JSON.stringify(rows(herFile)), herBefore2);
  const his2 = rows(hisFile);
  t('his file strikes her original', (his2.find(r=>r.msg_id===herId2)||{}).type, 'deleted');
  const corrected = his2.find(r=>r.type==='nappy'&&r.ts.slice(11,16)===back);
  t('and carries the correction as a new row', !!corrected, true);
  t('with its own msg_id', corrected && corrected.msg_id !== herId2, true);
  t('recorded as his', corrected && corrected.sender, 'Simon');

  console.log('--- what compaction makes of it ---');
  const all = [].concat(rows(herFile), rows(hisFile));
  const byId = {};
  for (const r of all) { const p=byId[r.msg_id];
    if (p && p.type==='deleted' && r.type!=='deleted') continue; byId[r.msg_id]=r; }
  const liveRows = Object.values(byId).filter(r=>r.type!=='deleted');
  console.log('   rows across both files:', all.length, '-> after merge:', Object.keys(byId).length,
              '-> live:', liveRows.length);
  t('both of her originals end up struck out',
     Object.values(byId).filter(r=>r.type==='deleted').length, 2);
  t('and only the correction survives live', liveRows.length, 1);
  t('which is the corrected nappy', liveRows[0].type, 'nappy');

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
