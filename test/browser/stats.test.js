// The whole story: every entry added up, for fun. The thing most worth testing is not the
// arithmetic - logic.test.js does that - but that it stays out of the way. It is not a
// tab, it does not change the tab bar, and nothing on the daily screens depends on it.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const NOW=new Date('2026-11-05T06:00:00Z');   // 14:00 Singapore, 5 Nov
const repoFiles={}; let sha=0; const calls=[];
// Four days in the repo. Only the most recent is on the phone to begin with, so the
// screen has something to be missing - which is the honesty case worth testing.
[['2026-10-02',120],['2026-10-03',140],['2026-10-04',160]].forEach(([d,ml],i)=>{
  repoFiles['data/events/'+d+'/des.jsonl']={sha:'r'+i,content:Buffer.from(
    [JSON.stringify({ts:d+'T09:00:00+08:00',sender:'Des',type:'feed',subtype:'bottle',
      value:ml,unit:'ml',note:'',raw:'b',msg_id:'old-f'+i,dur_min:null,ml_l:null,ml_r:null,pump_dev:''}),
     JSON.stringify({ts:d+'T10:00:00+08:00',sender:'Des',type:'nappy',subtype:'wet',
      value:null,unit:'',note:'',raw:'n',msg_id:'old-n'+i,dur_min:null,ml_l:null,ml_r:null,pump_dev:''})
    ].join('\n')+'\n').toString('base64')};
});
// The other phone's file, on a day that already has this phone's. A day is only complete
// once both have been read, and totalling one of them is the failure worth testing for.
repoFiles['data/events/2026-10-03/simon.jsonl']={sha:'rs',content:Buffer.from(
  [JSON.stringify({ts:'2026-10-03T22:00:00+08:00',sender:'Simon',type:'feed',subtype:'bottle',
    value:75,unit:'ml',note:'',raw:'b',msg_id:'his-f',dur_min:null,ml_l:null,ml_r:null,pump_dev:''}),
   JSON.stringify({ts:'2026-10-03T23:00:00+08:00',sender:'Simon',type:'nappy',subtype:'dirty',
    value:null,unit:'',note:'',raw:'n',msg_id:'his-n',dur_min:null,ml_l:null,ml_r:null,pump_dev:''})
  ].join('\n')+'\n').toString('base64')};
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
const card=(page,label)=>page.evaluate(l=>{
  for(const c of document.querySelectorAll('#stats-big .lcard')){
    if(c.querySelector('dt').textContent===l){
      const dd=c.querySelector('dd'), sm=c.querySelector('small');
      return [dd.textContent.replace(sm.textContent,''), sm.textContent];}}
  return null;}, label);

(async()=>{
  await new Promise(r=>srv.listen(8958,r));
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
  await ctx.addInitScript(()=>{
    const mk=(ts,type,subtype,value,unit,sender,note)=>({ms:Date.parse(ts),ts,sender:sender||'Des',
      type,subtype,value:value===undefined?null:value,unit:unit||'',note:note||'',raw:type,
      msg_id:ts+type+subtype,dur_min:null,ml_l:null,ml_r:null,pump_dev:'',own:true,device:'des'});
    localStorage.setItem('babylog.cfg.v2',JSON.stringify(
      {who:'Des',device:'des',repo:'me/d',branch:'main',token:'t'}));
    localStorage.setItem('babylog.entries.v2',JSON.stringify([
      mk('2026-11-05T08:00:00+08:00','feed','bottle',100,'ml'),
      mk('2026-11-05T09:00:00+08:00','nappy','both'),
      mk('2026-11-05T10:00:00+08:00','nappy','dirty','','', 'Simon'),
      mk('2026-11-05T11:00:00+08:00','measure','weight',3.9,'kg','Simon'),
      mk('2026-11-05T12:00:00+08:00','sleep','start'),
      mk('2026-11-05T13:30:00+08:00','sleep','end')
    ]));
  });
  const page=await ctx.newPage();
  await page.clock.install({time:NOW});
  await page.goto('http://localhost:8958/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(700);

  console.log('--- it does not intrude on the daily screens ---');
  t('still five tabs', (await page.$$('.tabs .tab')).length, 5);
  t('no tab of its own', await page.evaluate(()=>
    [...document.querySelectorAll('.tabs .tab')].map(e=>e.textContent.trim()).join(',')),
    'Log,Summary,Pump,Book,Setup');
  t('the app still opens on the Log tab', await page.getAttribute('#tab-log','aria-selected'), 'true');
  t('and the story is not on it', await page.isVisible('#pane-stats'), false);
  t('nor is the way in', await page.isVisible('#go-stats'), false);

  console.log('--- the way in is on the Summary tab, and findable without scrolling ---');
  await page.click('#tab-sum'); await page.waitForTimeout(500);
  t('the summary itself is what you land on', await page.isVisible('#pane-sum'), true);
  const where = await page.evaluate(()=>{
    const b=document.getElementById('go-stats');
    const r=b.getBoundingClientRect();
    return {top:Math.round(r.top), h:Math.round(r.height), w:Math.round(r.width),
            vh:window.innerHeight};});
  t('the way in is on screen the moment the tab opens', where.top < where.vh, true);
  t('and is a 44px target like everything else', where.h >= 44, true);
  t('but small enough to read as a side door, not a feature',
     where.w < 200, true);

  await page.click('#go-stats');
  await page.waitForTimeout(3000);
  t('tapping it opens the story', await page.isVisible('#pane-stats'), true);
  t('and hides the summary behind it', await page.isVisible('#pane-sum'), false);
  t('the Summary tab stays the selected one', await page.getAttribute('#tab-sum','aria-selected'), 'true');
  t('no horizontal overflow', await page.evaluate(()=>{
    const p=document.querySelector('#pane-stats'); return p.scrollWidth<=p.clientWidth+1;}), true);

  console.log('--- opening it pulls the repo, both phones, without being asked ---');
  t('it listed the day folders by itself', calls.filter(c=>c==='GET data/events').length, 1);
  t('and read the days it did not hold',
     calls.filter(c=>/^GET data\/events\/2026-10-0/.test(c)).length >= 3, true);
  t('the other phone\u2019s entries are in the totals too',
     await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
       .some(r=>r.msg_id==='his-f')), true);
  t('nappies, from both phones and every day', (await card(page,'Nappies'))[0], '6');
  t('with the wet and dirty split, counting "both" as each',
     (await card(page,'Nappies'))[1], '4 wet · 3 dirty');
  t('milk drunk, his 75 ml included', (await card(page,'Milk drunk'))[1], '595 ml in 5 feeds');
  t('sleep, singular when there is one', (await card(page,'Asleep'))[1], '1 complete sleep');
  const odd = (await page.textContent('#stats-odd')).replace(/\s+/g,' ');
  t('the longest sleep is named with its day', /Longest unbroken sleep: 1h 30m/.test(odd), true);
  t('the biggest feed too, which is one of hers', /Biggest single feed: 160 ml/.test(odd), true);
  t('one weight shows, and says it needs a second',
     /second one is where this gets interesting/.test(await page.textContent('#stats-weight')), true);
  const who = await page.evaluate(()=>[...document.querySelectorAll('#stats-who .brow')]
    .map(r=>r.querySelector('.bd').textContent+'='+r.querySelector('.bn').textContent));
  t('both people are on the scoreboard, most first',
     JSON.stringify(who), JSON.stringify(['Des=10','Simon=4']));

  console.log('--- and says so, rather than leaving you to wonder ---');
  const note = (await page.textContent('#stats-note')).replace(/\s+/g,' ');
  console.log('   note:', note);
  t('it says both phones are counted', /both phones\u2019 entries included/.test(note), true);
  t('and that nothing is missing', /That is every day in the repo/.test(note), true);
  t('the re-read button stays, for when the other phone has logged since',
     await page.isVisible('#stats-load'), true);

  const before = calls.length;
  await page.click('#stats-load'); await page.waitForTimeout(3000);
  t('it reads every day again on request', calls.length > before + 3, true);
  t('and the totals do not double', (await card(page,'Nappies'))[0], '6');
  // read the live queue, not the saved one: a day marked dirty in memory would be pushed
  // by the next flush even though nothing had written it to storage yet
  t('nothing was marked as owing a push', await page.evaluate(()=>
     Object.keys(dirty).filter(d=>dirty[d]).length), 0);
  t('and nothing is queued on disk either', await page.evaluate(()=>
     Object.keys(JSON.parse(localStorage.getItem('babylog.dirty.v2')||'{}')).length), 0);
  t('fetching wrote nothing to the repo', calls.filter(c=>c.startsWith('PUT')).length, 0);
  // one on opening, one for the re-read just above
  t('each pass took a single listing of data/events',
     calls.filter(c=>c==='GET data/events').length, 2);

  console.log('--- getting back out ---');
  await page.click('#stats-back'); await page.waitForTimeout(400);
  t('Back returns to the summary', await page.isVisible('#pane-sum'), true);
  t('and the story is closed', await page.isVisible('#pane-stats'), false);
  await page.evaluate(()=>document.getElementById('go-stats').click());
  await page.waitForTimeout(400);
  await page.click('#tab-sum'); await page.waitForTimeout(400);
  t('tapping Summary while it is open also closes it', await page.isVisible('#pane-sum'), true);
  await page.evaluate(()=>document.getElementById('go-stats').click());
  await page.waitForTimeout(400);
  await page.click('#tab-log'); await page.waitForTimeout(400);
  t('leaving for the Log tab works', await page.isVisible('#pane-home'), true);
  await page.click('#tab-sum'); await page.waitForTimeout(400);
  t('and coming back lands on the summary, not the story',
     await page.isVisible('#pane-sum'), true);

  console.log('--- logging still works with the story open ---');
  await page.evaluate(()=>document.getElementById('go-stats').click());
  await page.waitForTimeout(300);
  await page.click('#tab-log'); await page.waitForTimeout(300);
  await page.click('[data-go="nappy"]'); await page.waitForTimeout(300);
  await page.evaluate(()=>{const x=[...document.querySelectorAll('#cat-body button')]
    .find(e=>/^wet/i.test(e.textContent.trim())); x&&x.click();});
  await page.waitForTimeout(900);
  // 2 seeded + 3 of hers + 1 of his pulled from the repo + this one
  t('a nappy still logs in three taps', await page.evaluate(()=>
     JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='nappy').length), 7);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
