// Editing a record after the fact, and adding one for a day gone by. Three things that
// were not possible: moving an entry to another day, giving an entry a number it was
// logged without, and recording a full pump session from the Book tab.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const NOW=new Date('2026-11-01T06:00:00Z');   // 14:00 Singapore, 1 Nov
const repoFiles={}; let sha=0;
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
const rowsIn=p=>{const f=repoFiles[p];return f?Buffer.from(f.content,'base64').toString('utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse):[];};

(async()=>{
  await new Promise(r=>srv.listen(8934,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
  await ctx.route('https://api.github.com/**', async route=>{
    const req=route.request(); const u=new URL(req.url());
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/d/contents/','').split('?')[0]);
    if(req.method()==='PUT'){ const bd=JSON.parse(req.postData()); const cur=repoFiles[p];
      if(cur&&bd.sha!==cur.sha) return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'sha'})});
      repoFiles[p]={content:bd.content,sha:'s'+(++sha)};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:{sha:repoFiles[p].sha,path:p}})}); }
    const kids=Object.keys(repoFiles).filter(k=>k.startsWith(p+'/'));
    if(p==='data/events'){
      const days=[...new Set(Object.keys(repoFiles).map(k=>k.split('/')[2]))];
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify(days.map(d=>({type:'dir',name:d,path:'data/events/'+d})))}); }
    if(kids.length&&!repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify(kids.map(k=>({type:'file',name:k.split('/').pop(),path:k,sha:repoFiles[k].sha})))});
    if(repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({sha:repoFiles[p].sha,content:repoFiles[p].content,path:p})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
  });
  // a feed logged on the wrong day, and a tummy time logged without its minutes
  await ctx.addInitScript(()=>{
    localStorage.setItem('babylog.cfg.v2',JSON.stringify(
      {who:'Simon',device:'simon',repo:'me/d',branch:'main',token:'t'}));
    const mk=(ts,type,subtype,value,unit,raw,id)=>({ms:Date.parse(ts),ts,sender:'Simon',type,
      subtype,value,unit,note:'',raw,msg_id:id,dur_min:null,ml_l:null,ml_r:null,
      own:true,device:'simon'});
    localStorage.setItem('babylog.entries.v2',JSON.stringify([
      mk('2026-11-01T09:00:00+08:00','feed','bottle',90,'ml','bottle 90 ml','seed-feed'),
      mk('2026-11-01T10:00:00+08:00','tummy','',null,'','tummy time','seed-tummy')
    ]));
  });
  const page=await ctx.newPage();
  await page.clock.install({time:NOW});
  await page.goto('http://localhost:8934/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);
  await page.click('#tab-sum'); await page.waitForTimeout(500);

  console.log('--- an entry logged on the wrong day can be moved to the right one ---');
  await page.evaluate(()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Bottle 90/.test(r.textContent)) { r.querySelector('[data-fix]').click(); return; }});
  await page.waitForTimeout(300);
  t('the correction box has a date', await page.isVisible('#fix-date'), true);
  t('opened on the day the entry belongs to, not today',
     await page.inputValue('#fix-date'), '2026-11-01');
  t('and it says which day that is', /1 Nov 2026/.test(await page.textContent('#fix-was')), true);
  await page.fill('#fix-date','2026-10-31');
  await page.fill('#fix-time','23:40');
  await page.click('#fix-save'); await page.waitForTimeout(1500);

  const moved = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
    .filter(r=>r.type==='feed'||r.type==='deleted')
    .map(r=>r.type+'@'+r.ts.slice(0,10)));
  t('the original is struck where it was', moved.includes('deleted@2026-11-01'), true);
  t('and the correction sits on the new day', moved.includes('feed@2026-10-31'), true);
  t('nothing was edited in place', moved.length, 2);

  const oldDay = rowsIn('data/events/2026-11-01/simon.jsonl');
  const newDay = rowsIn('data/events/2026-10-31/simon.jsonl');
  t('the old day was pushed, carrying the strike',
     oldDay.filter(r=>r.type==='deleted').length, 1);
  t('the new day was pushed too, carrying the correction',
     newDay.filter(r=>r.type==='feed'&&r.value===90).length, 1);
  t('the moved row kept its time', newDay.find(r=>r.type==='feed').ts, '2026-10-31T23:40:00+08:00');
  t('and the old day no longer holds a live feed',
     oldDay.filter(r=>r.type==='feed').length, 0);

  console.log('--- an entry logged without its number can be given one afterwards ---');
  await page.evaluate(()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Tummy time/.test(r.textContent)) { r.querySelector('[data-fix]').click(); return; }});
  await page.waitForTimeout(300);
  t('the amount box is offered although the row has no amount',
     await page.isVisible('#fix-amt-row'), true);
  t('with the unit that kind takes', await page.textContent('#fix-unit'), 'min');
  await page.fill('#fix-amt','12');
  await page.click('#fix-save'); await page.waitForTimeout(1200);
  const tt = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
    .filter(r=>r.type==='tummy'));
  t('the minutes are now on the record', tt[0].value, 12);
  t('and it gained the unit, so it does not read "Tummy time 12"', tt[0].unit, 'min');
  t('an entry that takes no amount still has no box', await page.evaluate(async()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Undone/.test(r.textContent)) return !!r.querySelector('[data-fix]');
    return false; }), false);

  console.log('--- a dose forgotten at the time can be added afterwards ---');
  await page.click('#tab-sum'); await page.waitForTimeout(500);
  await page.evaluate(()=>{
    add('feed','formula',110,'ml','','formula 110',
        Date.parse('2026-11-01T07:00:00+08:00'));
    render();});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Formula 110/.test(r.textContent)) { r.querySelector('[data-fix]').click(); return; }});
  await page.waitForTimeout(300);
  t('the correction box offers what can go into a bottle',
     await page.isVisible('#fix-adds-row'), true);
  t('and offers only what is still given with a feed', await page.evaluate(()=>
     [...document.querySelectorAll('#fix-adds [data-fixadd]')]
       .map(b=>b.dataset.fixadd).join(',')), 'simeticone,vitd');
  await page.click('#fix-adds [data-fixadd="simeticone"]');
  await page.click('#fix-save'); await page.waitForTimeout(900);
  const dosed = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
    .filter(r=>r.type==='feed'&&r.subtype==='formula'&&r.value===110));
  t('the correction carries the dose', dosed.map(r=>r.added).join('|'), 'simeticone');
  // two earlier corrections in this file, plus this one
  t('and the original is kept, struck out', await page.evaluate(()=>
     JSON.parse(localStorage.getItem('babylog.entries.v2'))
       .filter(r=>r.type==='deleted').length), 3);

  console.log('--- correcting an old feed does not strip an addition we no longer offer ---');
  // BioGaia left the pickers, so there is no chip to re-tick it with. If the correction
  // rebuilt `added` from the chips alone, fixing the volume on a feed logged back when it
  // was offered would quietly drop the dose - a silent repair of real data.
  await page.evaluate(()=>{
    add('feed','formula',null,'ml','','formula',
        Date.parse('2026-11-01T09:00:00+08:00'), {added:'biogaia+simeticone'});
    render();});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Formula/.test(r.textContent) && /09:00/.test(r.textContent))
        { r.querySelector('[data-fix]').click(); return; }});
  await page.waitForTimeout(300);
  t('the chip for the option still offered comes up already ticked',
     await page.getAttribute('#fix-adds [data-fixadd="simeticone"]','aria-pressed'), 'true');
  await page.fill('#fix-amt','95');
  await page.click('#fix-save'); await page.waitForTimeout(900);
  const kept = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
    .filter(r=>r.type==='feed'&&r.value===95));
  t('the retired dose survives the correction', kept.map(r=>r.added).join('|'),
    'biogaia+simeticone');

  console.log('--- but not on a breastfeed, which has nothing to stir it into ---');
  await page.evaluate(()=>{
    for(const r of document.querySelectorAll('#sum-timeline .row'))
      if(/Tummy time/.test(r.textContent)) { r.querySelector('[data-fix]').click(); return; }});
  await page.waitForTimeout(300);
  t('no additions row on a kind that cannot take one',
     await page.isVisible('#fix-adds-row'), false);
  await page.click('#fix-cancel'); await page.waitForTimeout(200);

  console.log('--- a full pump session can be added for a day gone by ---');
  await page.click('#tab-book'); await page.waitForTimeout(800);
  const kinds = await page.evaluate(()=>[...document.querySelectorAll('#bk-kind option')].map(o=>o.value));
  t('hand expression can be chosen', kinds.includes('pump/hand'), true);
  t('so can a power pump', kinds.includes('pump/power'), true);
  await page.selectOption('#bk-kind','pump/hand'); await page.waitForTimeout(250);
  t('the left/right boxes appear for it', await page.isVisible('#bk-lr-row'), true);
  t('and no box asking how long she pumped for',
     await page.isVisible('#bk-min-row').catch(()=>false), false);
  await page.fill('#bk-date','2026-10-28');
  await page.fill('#bk-time','04:30');
  await page.fill('#bk-amt','55');
  await page.fill('#bk-l','25'); await page.fill('#bk-r','20');
  await page.waitForTimeout(200);
  t('the sides take over the total, rather than being refused for disagreeing',
     await page.inputValue('#bk-amt'), '45');
  t('and the total box locks, so the two cannot drift apart',
     await page.evaluate(()=>document.querySelector('#bk-amt').readOnly), true);
  await page.fill('#bk-r','30'); await page.waitForTimeout(200);
  t('changing a side moves the total with it', await page.inputValue('#bk-amt'), '55');
  await page.click('#bk-add'); await page.waitForTimeout(1500);
  const pumped = rowsIn('data/events/2026-10-28/simon.jsonl');
  t('the day four days ago was pushed', pumped.length, 1);
  t('as a hand expression', pumped[0].type+'/'+pumped[0].subtype, 'pump/hand');
  t('with its total', pumped[0].value, 55);
  t('and its split', pumped[0].ml_l+'/'+pumped[0].ml_r, '25/30');
  t('no pump duration is invented', pumped[0].dur_min, null);
  t('at the time given', pumped[0].ts, '2026-10-28T04:30:00+08:00');
  t('and the form was cleared', await page.inputValue('#bk-l'), '');
  t('with the total box handed back', await page.evaluate(()=>
     document.querySelector('#bk-amt').readOnly), false);

  console.log('--- and it reaches the Pump tab ---');
  await page.click('#tab-pump'); await page.waitForTimeout(500);
  const row = await page.evaluate(()=>{
    const tr=[...document.querySelectorAll('#pump-week tr')].find(r=>(r.cells[0]||{}).textContent==='28 Oct');
    return tr?[...tr.cells].map(c=>c.textContent):null;});
  t('the back-dated session is in the day-by-day table',
     JSON.stringify(row), JSON.stringify(['28 Oct','55','1','—','—']));

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
