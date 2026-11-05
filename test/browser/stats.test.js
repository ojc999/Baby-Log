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

  console.log('--- the way in is on the Summary tab, below the fold ---');
  await page.click('#tab-sum'); await page.waitForTimeout(500);
  t('the summary itself is what you land on', await page.isVisible('#pane-sum'), true);
  const where = await page.evaluate(()=>{
    const b=document.getElementById('go-stats'), p=document.getElementById('pane-sum');
    return {top:Math.round(b.getBoundingClientRect().top), vh:window.innerHeight,
            paneTop:Math.round(p.getBoundingClientRect().top)};});
  t('the button is below the fold, so it is not the first thing you meet',
     where.top > where.vh, true);

  await page.evaluate(()=>document.getElementById('go-stats').click());
  await page.waitForTimeout(700);
  t('tapping it opens the story', await page.isVisible('#pane-stats'), true);
  t('and hides the summary behind it', await page.isVisible('#pane-sum'), false);
  t('the Summary tab stays the selected one', await page.getAttribute('#tab-sum','aria-selected'), 'true');
  t('no horizontal overflow', await page.evaluate(()=>{
    const p=document.querySelector('#pane-stats'); return p.scrollWidth<=p.clientWidth+1;}), true);

  console.log('--- what it counts, from what the phone holds ---');
  t('nappies', (await card(page,'Nappies'))[0], '2');
  t('with the wet and dirty split, counting "both" as each',
     (await card(page,'Nappies'))[1], '1 wet · 2 dirty');
  t('milk drunk, singular when there is one', (await card(page,'Milk drunk'))[1], '100 ml in 1 feed');
  t('sleep, likewise', (await card(page,'Asleep'))[1], '1 complete sleep');
  const odd = (await page.textContent('#stats-odd')).replace(/\s+/g,' ');
  t('the longest sleep is named with its day', /Longest unbroken sleep: 1h 30m/.test(odd), true);
  t('the biggest feed too', /Biggest single feed: 100 ml/.test(odd), true);
  t('one weight shows, and says it needs a second',
     /second one is where this gets interesting/.test(await page.textContent('#stats-weight')), true);
  const who = await page.evaluate(()=>[...document.querySelectorAll('#stats-who .brow')]
    .map(r=>r.querySelector('.bd').textContent+'='+r.querySelector('.bn').textContent));
  t('both people are on the scoreboard, most first', JSON.stringify(who), JSON.stringify(['Des=4','Simon=2']));

  console.log('--- it says what it has not counted, rather than totalling a subset ---');
  const note = (await page.textContent('#stats-note')).replace(/\s+/g,' ');
  console.log('   note:', note);
  t('it names the days it holds', /Counted from the 1 day this phone holds/.test(note), true);
  t('and says how many it is missing', /3 more days are in the repo and not counted/.test(note), true);
  t('so the offer to fetch them is there', await page.isVisible('#stats-load'), true);

  await page.click('#stats-load'); await page.waitForTimeout(2500);
  t('fetching brings the older days in', (await card(page,'Nappies'))[0], '5');
  t('and their milk, plural now', (await card(page,'Milk drunk'))[1], '520 ml in 4 feeds');
  const note2 = (await page.textContent('#stats-note')).replace(/\s+/g,' ');
  t('the note now says nothing is missing', /That is every day in the repo/.test(note2), true);
  t('and the offer is gone', await page.isVisible('#stats-load'), false);
  // read the live queue, not the saved one: a day marked dirty in memory would be pushed
  // by the next flush even though nothing had written it to storage yet
  t('nothing was marked as owing a push', await page.evaluate(()=>
     Object.keys(dirty).filter(d=>dirty[d]).length), 0);
  t('and nothing is queued on disk either', await page.evaluate(()=>
     Object.keys(JSON.parse(localStorage.getItem('babylog.dirty.v2')||'{}')).length), 0);
  t('fetching wrote nothing to the repo', calls.filter(c=>c.startsWith('PUT')).length, 0);
  t('it took one listing of data/events', calls.filter(c=>c==='GET data/events').length, 1);

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
  // 2 seeded + 3 pulled from the repo above + this one
  t('a nappy still logs in three taps', await page.evaluate(()=>
     JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='nappy').length), 6);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
