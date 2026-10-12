// Paging back through the log: a day held locally, a day only in the repo, and the edges.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const TZ='Asia/Singapore';
const NOW = new Date('2026-10-12T06:00:00Z');   // 14:00 Singapore, 12 Oct
const dayOf=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const isoOf=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
// a day that exists ONLY in the repo, five days back
const repoFiles={};
(function(){
  const ms = NOW.getTime() - 5*86400000;
  const day = dayOf(ms);
  repoFiles['data/events/'+day+'/des.jsonl']={sha:'r1', content:Buffer.from(
    JSON.stringify({ts:isoOf(ms),sender:'Des',type:'feed',subtype:'breast',value:25,unit:'min',note:'left',raw:'bf 25',msg_id:'old-1'})+'\n'
  ).toString('base64')};
  global.REPO_DAY = day;
})();
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
(async()=>{
  await new Promise(r=>srv.listen(8860,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:TZ});
  await ctx.route('https://api.github.com/**', async route=>{
    const u=new URL(route.request().url());
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/d/contents/','').split('?')[0]);
    const kids=Object.keys(repoFiles).filter(k=>k.startsWith(p+'/'));
    if(kids.length&&!repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify(kids.map(k=>({type:'file',name:k.split('/').pop(),path:k,sha:repoFiles[k].sha})))});
    if(repoFiles[p]) return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({sha:repoFiles[p].sha,content:repoFiles[p].content,path:p})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
  });
  // local entries: today and the day before
  await ctx.addInitScript(([nowMs])=>{
    const TZ='Asia/Singapore';
    const iso=ms=>{const f=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const o={};f.formatToParts(new Date(ms)).forEach(p=>o[p.type]=p.value);
      return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+08:00`;};
    const mk=(ms,ty,su,v,u,raw,id)=>({ms,ts:iso(ms),sender:'Simon',type:ty,subtype:su,value:v,unit:u,note:'',raw,msg_id:id,own:true,device:'simon'});
    localStorage.setItem('babylog.entries.v2',JSON.stringify([
      mk(nowMs-26*3600000,'feed','bottle',70,'ml','b','y1'),
      mk(nowMs-25*3600000,'nappy','wet',null,'','w','y2'),
      mk(nowMs-3*3600000,'feed','bottle',80,'ml','b','t1'),
      mk(nowMs-1*3600000,'tummy','',10,'min','tt','t2'),
    ]));
    localStorage.setItem('babylog.cfg.v2',JSON.stringify({who:'Simon',device:'simon',repo:'me/d',branch:'main',token:'t'}));
  }, [NOW.getTime()]);
  const page=await ctx.newPage();
  await page.clock.install({ time: NOW });
  await page.goto('http://localhost:8860/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
  await page.click('#tab-sum'); await page.waitForTimeout(400);

  const label = async () => (await page.textContent('#day-label')).trim();
  const sub   = async () => (await page.textContent('#day-sub')).trim();
  const body  = async () => ((await page.textContent('#sum-timeline'))||'').replace(/\s+/g,' ').trim();

  console.log('--- opens on today ---');
  t('labelled today', /today/.test(await label()), true);
  t('and counts today only', await sub(), '2 entries');
  t('forward is disabled on today', await page.isDisabled('#day-next'), true);
  t('no "back to today" button while on today', await page.isHidden('#day-today'), true);

  console.log('\n--- one step back ---');
  await page.click('#day-prev'); await page.waitForTimeout(300);
  t('shows the day before', /11 Oct 2026/.test(await label()), true);
  t('not marked today', /today/.test(await label()), false);
  t('counts that day', await sub(), '2 entries');
  t('forward is enabled again', await page.isDisabled('#day-next'), false);
  t('and a way back appears', await page.isVisible('#day-today'), true);

  console.log('\n--- a day with nothing on it ---');
  await page.click('#day-prev'); await page.waitForTimeout(900);
  t('says so plainly', /Nothing logged on this day/.test(await body()), true);

  console.log('\n--- a day that exists only in the repo ---');
  for (let i=0;i<3;i++){ await page.click('#day-prev'); await page.waitForTimeout(1200); }
  t('we reached it', /7 Oct 2026/.test(await label()), true);
  t('it was fetched and shown', /Breastfeed 25 min/.test(await body()), true);
  t('with the other person named', /Des/.test(await body()), true);

  console.log('\n--- back to today ---');
  await page.click('#day-today'); await page.waitForTimeout(300);
  t('returns to today', /today/.test(await label()), true);
  t('with today\'s entries', /Tummy time 10 min/.test(await body()), true);

  console.log('\n--- forward never runs past today ---');
  await page.click('#day-prev'); await page.waitForTimeout(200);
  await page.click('#day-next'); await page.waitForTimeout(200);
  await page.evaluate(()=>{ document.getElementById('day-next').disabled = false; });
  await page.click('#day-next'); await page.waitForTimeout(200);
  t('still today, never tomorrow', /today/.test(await label()), true);

  await page.screenshot({path:path.join(process.env.SHOTS||require('os').tmpdir(),'daynav.png')});
  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
