// The Book tab: every day on record, opening any of them, and adding a record at a date
// and time of your choosing - the workflow of checking the app against the paper book.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const NOW=new Date('2026-10-26T06:00:00Z');   // 14:00 Singapore, 26 Oct
const iso=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
// a repo with days scattered back three weeks, including gaps
const repoFiles={}; let sha=0; const calls=[];
['2026-10-05','2026-10-06','2026-10-12','2026-10-20','2026-10-26'].forEach((d,i)=>{
  repoFiles['data/events/'+d+'/des.jsonl']={sha:'r'+i, content:Buffer.from(
    JSON.stringify({ts:d+'T09:0'+i+':00+08:00',sender:'Des',type:'feed',subtype:'breast',
      value:20+i,unit:'min',note:'left',raw:'bf',msg_id:'old-'+i})+'\n').toString('base64')};
});
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
(async()=>{
  await new Promise(r=>srv.listen(8920,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
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
  await ctx.addInitScript(()=>localStorage.setItem('babylog.cfg.v2',JSON.stringify(
    {who:'Simon',device:'simon',repo:'me/d',branch:'main',token:'t'})));
  const page=await ctx.newPage();
  await page.clock.install({time:NOW});
  await page.goto('http://localhost:8920/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);

  console.log('--- the tab exists and is out of the daily way ---');
  t('there is a Book tab', await page.isVisible('#tab-book'), true);
  t('the Log tab is still the one you land on', await page.getAttribute('#tab-log','aria-selected'), 'true');

  await page.click('#tab-book'); await page.waitForTimeout(1500);

  console.log('--- every day on record, from one request ---');
  const days = await page.evaluate(()=>[...document.querySelectorAll('[data-bookday]')].map(e=>e.dataset.bookday));
  console.log('   days listed:', JSON.stringify(days));
  t('all five days in the repo are listed', days.length >= 5, true);
  t('the oldest reaches back three weeks', days[days.length-1], '2026-10-05');
  t('newest first', days[0] >= days[1], true);
  t('it took one listing of data/events', calls.filter(c=>c==='GET data/events').length, 1);

  console.log('--- opening a day from three weeks ago ---');
  await page.click('[data-bookday="2026-10-05"]'); await page.waitForTimeout(1500);
  const rows = ((await page.textContent('#book-rows'))||'').replace(/\s+/g,' ');
  t('its entries are fetched and shown', /Breastfeed 20 min/.test(rows), true);
  t('with who logged it', /Des/i.test(rows), true);
  t('the heading names the day', /5 Oct 2026/.test(await page.textContent('#book-day-head')), true);

  console.log('--- adding a record on a date of my choosing ---');
  t('it opens on Bottle, not whatever is alphabetically first',
     await page.inputValue('#bk-kind'), 'feed/bottle');
  await page.selectOption('#bk-kind','feed/bottle');
  await page.waitForTimeout(200);
  t('an amount box appears for a kind that has one', await page.isVisible('#bk-amt-row'), true);
  t('with its unit', (await page.textContent('#bk-unit')).trim(), 'ml');
  await page.fill('#bk-date','2026-10-05');
  await page.fill('#bk-time','03:20');
  await page.fill('#bk-amt','45');
  await page.click('#bk-add'); await page.waitForTimeout(1500);
  const added = await page.evaluate(()=>{
    const r = entries.filter(x=>x.type==='feed'&&x.subtype==='bottle').pop();
    return r ? {ts:r.ts, v:r.value, u:r.unit, own:r.own, sender:r.sender} : null;});
  console.log('   stored as:', JSON.stringify(added));
  t('it lands on the date given, three weeks back', added.ts.slice(0,16), '2026-10-05T03:20');
  t('with the amount', added.v, 45);
  t('and it is ours', added.own, true);
  const put = calls.filter(c=>c.startsWith('PUT')).pop();
  t('and it was pushed to that day\'s file', put, 'PUT data/events/2026-10-05/simon.jsonl');
  const file = Buffer.from(JSON.parse('{}')&&repoFiles['data/events/2026-10-05/simon.jsonl'].content,'base64').toString('utf8');
  t('the pushed row has the right timestamp', /2026-10-05T03:20/.test(file), true);
  t("and the other phone's row for that day was not touched",
     Buffer.from(repoFiles['data/events/2026-10-05/des.jsonl'].content,'base64').toString('utf8').includes('old-0'), true);

  console.log('--- it refuses the future ---');
  const before = await page.evaluate(()=>entries.length);
  await page.fill('#bk-date','2027-01-01'); await page.fill('#bk-time','10:00');
  await page.click('#bk-add'); await page.waitForTimeout(400);
  t('nothing was added', await page.evaluate(()=>entries.length), before);
  t('and it says why', /cannot have happened yet/.test((await page.textContent('#toast-txt'))||''), true);

  console.log('--- a day with nothing at all can still be written to ---');
  await page.selectOption('#bk-kind','nappy/wet'); await page.waitForTimeout(150);
  await page.fill('#bk-date','2026-10-09');          // no folder for this day
  await page.fill('#bk-time','11:00');
  await page.click('#bk-add'); await page.waitForTimeout(1500);
  t('the day now exists in the repo', !!repoFiles['data/events/2026-10-09/simon.jsonl'], true);
  const listed = await page.evaluate(()=>[...document.querySelectorAll('[data-bookday]')].map(e=>e.dataset.bookday));
  t('and it has appeared in the index', listed.indexOf('2026-10-09') > -1, true);

  console.log('--- a note in my own words ---');
  await page.selectOption('#bk-kind','note/'); await page.waitForTimeout(200);
  t('no amount box for a note', await page.isHidden('#bk-amt-row'), true);
  await page.fill('#bk-date','2026-10-06'); await page.fill('#bk-time','22:15');
  await page.click('#bk-add'); await page.waitForTimeout(300);
  t('it insists on the words', await page.evaluate(()=>entries.filter(r=>r.type==='note').length), 0);
  await page.fill('#bk-note','very unsettled all evening, from the book');
  await page.click('#bk-add'); await page.waitForTimeout(1200);
  const note = await page.evaluate(()=>entries.filter(r=>r.type==='note').pop());
  t('the note is kept word for word', note.raw, 'very unsettled all evening, from the book');
  t('on the date given', note.ts.slice(0,10), '2026-10-06');

  await page.screenshot({path:path.join(process.env.SHOTS||require('os').tmpdir(),'book.png'), fullPage:false});
  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
