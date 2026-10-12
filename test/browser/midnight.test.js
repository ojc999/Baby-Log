// Logging an entry for last night, after midnight. The clock is pinned to 00:30
// Singapore on 12 Oct, so "yesterday" is 11 Oct.
//
// The timestamp side was already right. What was not: the live poll only ever read
// today's folder, so an entry keyed at 00:30 for 23:40 went into yesterday's file and
// the other phone never saw it - it only arrived if that phone was set up afresh. The
// poll now reaches yesterday as well, one tick in six.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const repoFiles={}; let sha=0; const calls=[];
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};

async function phone(b, device){
  const ctx=await b.newContext({viewport:{width:393,height:852},isMobile:true,timezoneId:'Asia/Singapore'});
  await ctx.route('https://api.github.com/**', async route=>{
    const req=route.request(); const u=new URL(req.url());
    calls.push(req.method()+' '+u.pathname.replace('/repos/me/d/contents/',''));
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/d/contents/','').split('?')[0]);
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
  const page=await ctx.newPage();
  // 12 Oct 2026, 00:30 Singapore  =  11 Oct 16:30 UTC
  await page.clock.install({ time: new Date('2026-10-11T16:30:00Z') });
  await page.goto('http://localhost:8850/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(300);
  await page.click('#tab-set');
  await page.fill('#in-who', device==='simon'?'Simon':'Des');
  await page.fill('#in-device',device);
  await page.fill('#in-repo','me/d'); await page.fill('#in-branch','main');
  await page.fill('#in-token','github_pat_X');
  await page.click('#set-test'); await page.waitForTimeout(1200);
  return {ctx,page};
}
const decode = p => Buffer.from(repoFiles[p].content,'base64').toString('utf8').trim().split('\n').map(JSON.parse);

(async()=>{
  await new Promise(r=>srv.listen(8850,r));
  const b=await chromium.launch();
  const A=await phone(b,'simon');

  console.log('--- the clock the app thinks it is ---');
  console.log('   today per app  :', await A.page.evaluate(()=>daySG(Date.now())));
  console.log('   now per app    :', await A.page.evaluate(()=>hhmm(Date.now())));

  console.log('\n--- A. the time picker: a 23:40 feed, keyed at 00:30 the next day ---');
  await A.page.click('#tab-log');
  await A.page.click('[data-go="feed"]');
  await A.page.fill('#when-time','23:40');
  await A.page.waitForTimeout(150);
  await A.page.click('[data-sheet="bottle"]'); await A.page.waitForTimeout(200);
  await A.page.click('#sheet-save'); await A.page.waitForTimeout(1500);
  const got = await A.page.evaluate(()=>{const r=entries[entries.length-1];return {ts:r.ts, day:daySG(r.ms)};});
  console.log('   stored as      :', got.ts);
  t('it lands on yesterday, not today', got.day, '2026-10-11');
  t('at the time typed', got.ts.slice(11,16), '23:40');
  t('and a file for yesterday was written',
     Object.keys(repoFiles).some(k=>k.includes('2026-10-11')), true);

  console.log('\n--- B. the "-60" chip at 00:30 ---');
  await A.page.click('#cat-back');
  await A.page.click('[data-go="nappy"]');
  await A.page.click('[data-off="60"]');
  await A.page.evaluate(()=>{const x=[...document.querySelectorAll('#cat-body button')].find(e=>/^wet/i.test(e.textContent.trim()));x&&x.click();});
  await A.page.waitForTimeout(1500);
  const got2 = await A.page.evaluate(()=>{const r=entries.filter(x=>x.type==='nappy').pop();return {ts:r.ts, day:daySG(r.ms)};});
  console.log('   stored as      :', got2.ts);
  t('an hour before 00:30 is yesterday 23:30', got2.ts.slice(0,16), '2026-10-11T23:30');

  console.log('\n--- C. how far back can you reach at all? ---');
  const reach = await A.page.evaluate(()=>{
    setAbs(''); setOff(0);
    const probe = hm => { setAbs(hm); const ms = stamp(); setAbs(''); return isoSG(ms); };
    return { at0001: probe('00:01'), at2359: probe('23:59') };
  }).catch(async()=>await A.page.evaluate(()=>{
    absTime='00:01'; const a=isoSG(stamp()); absTime='23:59'; const b=isoSG(stamp()); absTime='';
    return {at0001:a, at2359:b};
  }));
  console.log('   picking 00:01  ->', reach.at0001);
  console.log('   picking 23:59  ->', reach.at2359);
  t('the picker can never reach further back than 24h',
     reach.at2359.slice(0,10) === '2026-10-11' && reach.at0001.slice(0,10) === '2026-10-12', true);

  console.log('\n--- D. does the OTHER phone ever see a backdated entry? ---');
  const B=await phone(b,'des');
  await B.page.waitForTimeout(2500);               // let it set up, poll and backfill
  const sees = await B.page.evaluate(()=>entries.filter(r=>!r.own).map(r=>r.ts));
  console.log('   other phone holds foreign rows at:', JSON.stringify(sees));
  t('the other phone picks up yesterday too (via the 7-day backfill on setup)',
     sees.some(x=>x.startsWith('2026-10-11')), true);

  console.log('\n--- E. ...but on an ALREADY set-up phone, with only the live poll? ---');
  const before = await B.page.evaluate(()=>entries.filter(r=>!r.own).length);
  // A backdates another entry into yesterday, long after B was set up
  await A.page.click('#cat-back');
  await A.page.click('[data-go="feed"]');
  await A.page.fill('#when-time','22:10');
  await A.page.waitForTimeout(150);
  await A.page.click('[data-sheet="bottle"]'); await A.page.waitForTimeout(200);
  await A.page.click('#sheet-save'); await A.page.waitForTimeout(1500);
  // B polls for a while
  // Yesterday is polled one tick in six - about once a minute - so this has to run for
  // more than six ticks or it proves nothing. Ten.
  const c0 = calls.length;
  for (let i=0;i<10;i++){ await B.page.clock.runFor(11000); await B.page.waitForTimeout(400); }
  const yestCalls = calls.slice(c0).filter(c=>c.includes('2026-10-11'));
  console.log('   yesterday was polled', yestCalls.length, 'times in ~10 ticks');
  t('the poll reaches yesterday without being asked', yestCalls.length > 0, true);
  const after = await B.page.evaluate(()=>entries.filter(r=>!r.own).length);
  console.log('   foreign rows before:', before, ' after polling:', after);
  t('a NEW backdated entry reaches the other phone by polling alone', after > before, true);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
