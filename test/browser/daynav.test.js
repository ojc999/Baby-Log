// Scrolling back through the log: it opens on today, loads earlier days as you reach the
// bottom, fetches a day that exists only in the repo on the way past, stops after a run of
// empty days rather than scrolling back forever, and - the one that would make it
// unusable - does not throw away your scroll position when the ten-second poll redraws.
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

  const body  = async () => ((await page.textContent('#sum-timeline'))||'').replace(/\s+/g,' ').trim();
  const heads = async () => page.evaluate(()=>[...document.querySelectorAll('.logday b')].map(e=>e.textContent.trim()));
  const pane  = () => page.locator('#pane-sum');

  console.log('--- it opens on today ---');
  let h = await heads();
  t('one day heading to start with', h.length, 1);
  t('and it is today', /12 Oct 2026 · today/.test(h[0]), true);
  t("today's entries are there", /Tummy time 10 min/.test(await body()), true);
  t('and it invites you to keep going', /Keep scrolling/.test(await body()), true);

  console.log('--- scrolling down loads earlier days ---');
  for (let i=0;i<6;i++){
    await page.evaluate(()=>{const p=document.getElementById('pane-sum');p.scrollTop=p.scrollHeight;});
    await page.waitForTimeout(700);
  }
  h = await heads();
  console.log('   day headings now:', JSON.stringify(h));
  t('more days have loaded', h.length > 1, true);
  t('yesterday appears, with its entries', /11 Oct 2026/.test(h.join('|')), true);
  t("yesterday's rows are shown", /Bottle 70 ml/.test(await body()), true);
  t('days are in order, newest first', h[0].indexOf('12 Oct') > -1 && h[1].indexOf('11 Oct') > -1, true);

  console.log('--- a day that exists only in the repo is fetched on the way past ---');
  for (let i=0;i<8;i++){
    await page.evaluate(()=>{const p=document.getElementById('pane-sum');p.scrollTop=p.scrollHeight;});
    await page.waitForTimeout(800);
  }
  t('we reached it', /7 Oct 2026/.test((await heads()).join('|')), true);
  t('and it was pulled from the repo', /Breastfeed 25 min/.test(await body()), true);
  t('with the other person named', /Des/.test(await body()), true);

  console.log('--- it stops rather than scrolling back forever ---');
  for (let i=0;i<12;i++){
    await page.evaluate(()=>{const p=document.getElementById('pane-sum');p.scrollTop=p.scrollHeight;});
    await page.waitForTimeout(400);
  }
  const atFloor = await page.evaluate(()=>({days:logDays, floor:logAtFloor}));
  console.log('   days loaded:', atFloor.days, ' hit the floor:', atFloor.floor);
  t('it stopped after a run of empty days', atFloor.floor, true);
  t('well short of the hard cap', atFloor.days < 120, true);
  t('and says so', /as far back as the log goes/.test(await body()), true);

  console.log('--- a poll redraw must not throw away where you were reading ---');
  await page.evaluate(()=>{const p=document.getElementById('pane-sum');p.scrollTop=400;});
  await page.waitForTimeout(200);
  const before = await page.evaluate(()=>document.getElementById('pane-sum').scrollTop);
  await page.evaluate(()=>{ render(); render(); });        // what the 10s poll does
  await page.waitForTimeout(300);
  const after = await page.evaluate(()=>document.getElementById('pane-sum').scrollTop);
  t('an unchanged redraw leaves the scroll alone', after, before);
  await page.evaluate(()=>{ add('nappy','wet','','','','wet'); render(); });
  await page.waitForTimeout(300);
  const after2 = await page.evaluate(()=>document.getElementById('pane-sum').scrollTop);
  t('and a redraw that does change keeps it too', Math.abs(after2 - before) < 80, true);

  await page.screenshot({path:path.join(process.env.SHOTS||require('os').tmpdir(),'daynav.png')});
  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
