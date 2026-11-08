// The Pump tab: Mum's own production, counted separately from what he drinks. Also the
// box that reads up a page of handwritten notes, which is the only part of this app that
// turns prose into entries - so what it refuses to guess at is tested as hard as what it
// reads. Every note in here is synthetic.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const NOW=new Date('2026-11-01T06:00:00Z');   // 14:00 Singapore, 1 Nov
const repoFiles={}; let sha=0; const puts=[];
// A day inside the chart's three weeks, written by something other than this phone - the
// other parent, or a notebook typed up straight into the repo. The poll only ever reaches
// today and yesterday, so nothing on this tab fetched a day like this.
repoFiles['data/events/2026-10-20/notebook.jsonl']={sha:'nb1',content:Buffer.from(
  JSON.stringify({ts:'2026-10-20T09:00:00+08:00',sender:'Des',type:'pump',subtype:'',
    value:10,unit:'ml',note:'',raw:'pump 10',msg_id:'nb-1',
    dur_min:null,ml_l:4,ml_r:6,pump_dev:'spectra'})+'\n').toString('base64')};
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
// the cards render <dt>label</dt><dd>main<small>sub</small></dd> with no whitespace
// between them, so they are read as fields rather than matched as prose
const cards=page=>page.evaluate(()=>{const o={};
  document.querySelectorAll('#pump-today .lcard').forEach(c=>{
    const dd=c.querySelector('dd'),sm=c.querySelector('small');
    o[c.querySelector('dt').textContent]=[dd.textContent.replace(sm.textContent,''),sm.textContent];});
  return o;});
const pvDay=(page,label)=>page.evaluate(l=>{
  for(const d of document.querySelectorAll('#pm-preview .pvd'))
    if(d.textContent.indexOf(l)===0) return (d.querySelector('em')||{}).textContent;
  return null;},label);
const tableRow=(page,day)=>page.evaluate(d=>{
  for(const tr of document.querySelectorAll('#pump-week tr'))
    if((tr.cells[0]||{}).textContent===d) return [...tr.cells].map(c=>c.textContent);
  return null;},day);
const rowsIn=p=>{const f=repoFiles[p];return f?Buffer.from(f.content,'base64').toString('utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse):[];};

(async()=>{
  await new Promise(r=>srv.listen(8926,r));
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
  await ctx.route('https://api.github.com/**', async route=>{
    const req=route.request(); const u=new URL(req.url());
    if(/\/branches\//.test(u.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'main'})});
    const p=decodeURIComponent(u.pathname.replace('/repos/me/d/contents/','').split('?')[0]);
    if(req.method()==='PUT'){ const bd=JSON.parse(req.postData()); const cur=repoFiles[p];
      // as strict as the real API: an existing file needs its sha, or 422
      if(cur&&bd.sha!==cur.sha) return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'sha'})});
      repoFiles[p]={content:bd.content,sha:'s'+(++sha)}; puts.push(p);
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
  // Des's phone, with a latch and a bottle of expressed milk already logged today, so the
  // tab has to tell production from consumption rather than being given only one of them.
  await ctx.addInitScript(()=>{
    localStorage.setItem('babylog.cfg.v2',JSON.stringify(
      {who:'Des',device:'des',repo:'me/d',branch:'main',token:'t'}));
    const d='2026-11-01';
    localStorage.setItem('babylog.entries.v2',JSON.stringify([
      {ms:Date.parse(d+'T08:00:00+08:00'),ts:d+'T08:00:00+08:00',sender:'Des',type:'feed',
       subtype:'breast',value:25,unit:'min',note:'left',raw:'bf 25',msg_id:'seed-latch',
       dur_min:null,ml_l:null,ml_r:null,own:true,device:'des'},
      {ms:Date.parse(d+'T09:00:00+08:00'),ts:d+'T09:00:00+08:00',sender:'Des',type:'feed',
       subtype:'expressed',value:80,unit:'ml',note:'',raw:'ebm 80',msg_id:'seed-ebm',
       dur_min:null,ml_l:null,ml_r:null,own:true,device:'des'}
    ]));
  });
  const page=await ctx.newPage();
  await page.clock.install({time:NOW});
  await page.goto('http://localhost:8926/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);

  console.log('--- a tab of her own, and the Log tab is still the one you land on ---');
  t('there is a Pump tab', await page.isVisible('#tab-pump'), true);
  t('Log is still selected on arrival', await page.getAttribute('#tab-log','aria-selected'), 'true');
  t('five tabs now', (await page.$$('.tabs .tab')).length, 5);
  const tabBox = await page.evaluate(()=>{const n=document.querySelector('#tab-pump').getBoundingClientRect();
    return Math.round(n.width)+'x'+Math.round(n.height);});
  t('the new tab is still a 44px target', (()=>{const [w,h]=tabBox.split('x').map(Number);return w>=44&&h>=44;})(), true);

  t('a day three weeks back, written by another device, is not held before the tab opens',
     await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2')||'[]')
       .some(r=>r.msg_id==='nb-1')), false);
  await page.click('#tab-pump'); await page.waitForTimeout(400);
  t('no horizontal overflow on the pane', await page.evaluate(()=>
    document.documentElement.scrollWidth<=document.documentElement.clientWidth+1), true);
  t('the date box opens on today', await page.inputValue('#pm-date'), '2026-11-01');
  t('and the time box on now', await page.inputValue('#pm-time'), '14:00');

  console.log('--- the tab fetches the days it is about to draw ---');
  await page.waitForTimeout(2500);
  t('opening the tab pulls it in', await page.evaluate(()=>
     JSON.parse(localStorage.getItem('babylog.entries.v2')).some(r=>r.msg_id==='nb-1')), true);
  t('and it lands in the day-by-day table without visiting any other tab',
     JSON.stringify(await tableRow(page,'20 Oct')),
     JSON.stringify(['20 Oct','10','1','—','—']));
  t('it was not marked as owing a push', await page.evaluate(()=>
     !!JSON.parse(localStorage.getItem('babylog.dirty.v2')||'{}')['2026-10-20']), false);

  console.log('--- which machine ---');
  t('the kit row is on screen', await page.isVisible('#pm-kit-row'), true);
  t('with the Spectra already chosen', await page.evaluate(()=>
    document.querySelector('#pm-kit [data-kit="spectra"]').getAttribute('aria-pressed')), 'true');
  await page.click('#pm-how [data-how="hand"]'); await page.waitForTimeout(200);
  t('hand expression hides it, since it uses no machine',
     await page.isVisible('#pm-kit-row'), false);
  await page.click('#pm-how [data-how="power"]'); await page.waitForTimeout(200);
  t('a power pump brings it back, because you power pump on a machine',
     await page.isVisible('#pm-kit-row'), true);
  await page.click('#pm-kit [data-kit="imani"]'); await page.waitForTimeout(200);
  t('and the other one can be chosen', await page.evaluate(()=>
    document.querySelector('#pm-kit [data-kit="imani"]').getAttribute('aria-pressed')), 'true');
  await page.click('#pm-how [data-how=""]');
  await page.click('#pm-kit [data-kit="spectra"]'); await page.waitForTimeout(200);

  console.log('--- logging a session, with both its numbers and the split ---');
  await page.click('#pm-presets [data-pmset="60"]');
  t('a preset fills the total', await page.inputValue('#pm-ml'), '60');
  t('there is no box asking how long she pumped for',
     await page.isVisible('#pm-min').catch(()=>false), false);
  await page.fill('#pm-l','25'); await page.fill('#pm-r','30');
  await page.waitForTimeout(150);
  t('the total becomes left plus right on its own', await page.inputValue('#pm-ml'), '55');
  t('and the box is locked, so the two can never disagree',
     await page.evaluate(()=>document.querySelector('#pm-ml').readOnly), true);
  t('with a line saying where the figure came from',
     /Total is left \+ right: 55 ml/.test((await page.textContent('#pm-sum')).replace(/\s+/g,' ')), true);
  await page.fill('#pm-r','35'); await page.waitForTimeout(150);
  t('changing a side moves the total with it', await page.inputValue('#pm-ml'), '60');
  await page.fill('#pm-l',''); await page.fill('#pm-r',''); await page.waitForTimeout(150);
  t('clearing both sides hands the box back',
     await page.evaluate(()=>document.querySelector('#pm-ml').readOnly), false);
  await page.fill('#pm-l','25'); await page.fill('#pm-r','35'); await page.waitForTimeout(150);
  await page.click('#pm-add'); await page.waitForTimeout(1200);
  const saved = await page.evaluate(()=>
    JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='pump'&&r.msg_id!=='nb-1'));
  t('one pump entry saved', saved.length, 1);
  t('the volume is the value', saved[0].value, 60);
  t('each side has its own field', saved[0].ml_l+'/'+saved[0].ml_r, '25/35');
  t('the machine is recorded, defaulting to the Spectra', saved[0].pump_dev, 'spectra');
  t('and no pump duration is invented', saved[0].dur_min, null);
  t('it is a pump, never a feed', saved[0].type, 'pump');
  t('the form is cleared for the next one', await page.inputValue('#pm-ml'), '');
  t('and the total box is unlocked again',
     await page.evaluate(()=>document.querySelector('#pm-ml').readOnly), false);

  console.log('--- what reached the repo ---');
  const todayRows = rowsIn('data/events/2026-11-01/des.jsonl');
  const pushed = todayRows.find(r=>r.type==='pump'&&r.msg_id!=='nb-1');
  t('the day was pushed', !!pushed, true);
  t('with the nine original fields first, in order',
     JSON.stringify(Object.keys(pushed).slice(0,9)),
     JSON.stringify(['ts','sender','type','subtype','value','unit','note','raw','msg_id']));
  t('and the five new ones after', JSON.stringify(Object.keys(pushed).slice(9)),
     JSON.stringify(['dur_min','ml_l','ml_r','pump_dev','added']));
  t('the latch entry it did not touch carries them empty',
     JSON.stringify([todayRows[0].dur_min,todayRows[0].ml_l,todayRows[0].ml_r,
                     todayRows[0].pump_dev,todayRows[0].added]),
     JSON.stringify([null,null,null,'','']));
  t('no internal fields leaked', ['own','ms','device'].some(k=>k in pushed), false);

  console.log('--- production is not consumption ---');
  const c1 = await cards(page);
  console.log('   cards:', JSON.stringify(c1));
  t('expressed today is 60, not the 140 that adding the bottle would give', c1['Expressed'][0], '60');
  t('counted as one session', c1['Expressed'][1], '1 session');
  t('time at the breast comes from the breastfeeds', c1['At the breast'][0], '25 min');
  t('and names how many of them', c1['At the breast'][1], '1 latch');
  t('there is no card for time at the pump', 'Pumping' in c1, false);
  t('nor one adding the two together', 'Lactation time' in c1, false);
  t('yesterday sits beside today for comparison', c1['Yesterday'][0], '—');
  t('and the week behind it', c1['Last 7 days'][0], '60');
  await page.click('#tab-sum'); await page.waitForTimeout(300);
  const sum2 = (await page.textContent('#sum-today')).replace(/\s+/g,' ');
  t('the summary still counts the 80 ml as a feed', /80 ml/.test(sum2), true);
  await page.click('#tab-pump'); await page.waitForTimeout(300);

  console.log('--- the trend ---');
  const bars = await page.evaluate(()=>[...document.querySelectorAll('#pump-bars .brow')].map(e=>{
    const tr=[...e.querySelectorAll('.btrack')];
    const w=i=>{const f=tr[i].querySelector('.bfill');
      if(!f) return 0;
      const fb=f.getBoundingClientRect(), tb=tr[i].getBoundingClientRect();
      return tb.width?Math.round(fb.width/tb.width*100):0;};
    return {day:(e.querySelector('.bd')||{}).textContent, ml:w(0), mins:w(1),
            trackW:Math.round(tr[0].getBoundingClientRect().width),
            today:e.classList.contains('today')};}));
  t('three weeks of rows', bars.length, 21);
  t('oldest at the top, newest at the bottom', bars[0].day+' -> '+bars[20].day, '12 Oct -> 1 Nov');
  t('today is the last row', bars[20].today, true);
  t('the tracks are actually laid out, not collapsed', bars[0].trackW > 100, true);
  t('and its milk bar is painted full width, being the only day with any', bars[20].ml, 100);
  t('a day with nothing paints no bar at all', bars[0].ml, 0);
  t('the minutes bar is scaled on its own', bars[20].mins, 100);

  t('the table row for today reads ml, sessions, latch minutes and feeds',
     JSON.stringify(await tableRow(page,'1 Nov')),
     JSON.stringify(['1 Nov','60','1','25','1']));

  console.log('--- a second session adds to the day ---');
  await page.fill('#pm-ml','30'); await page.fill('#pm-time','13:00');
  await page.click('#pm-add'); await page.waitForTimeout(900);
  const c2 = await cards(page);
  t('both sessions are in the volume', c2['Expressed'][0], '90');
  t('and counted', c2['Expressed'][1], '2 sessions');

  console.log('--- a breastfeed logged without its minutes is flagged, not filled in ---');
  await page.evaluate(()=>{
    add('feed','breast',null,'','','bf',Date.parse('2026-11-01T11:00:00+08:00'));
    render(); renderPump(); });
  await page.waitForTimeout(400);
  const c2b = await cards(page);
  t('it still counts as a feed', c2b['At the breast'][1], '2 latches, 1 untimed');
  t('but adds no minutes', c2b['At the breast'][0], '25 min');
  t('the day is starred in the table', (await tableRow(page,'1 Nov'))[3], '25*');
  t('with the reason said out loud, and where to fix it',
     /undercount/.test(await page.textContent('#pump-hint')), true);

  console.log('--- Fix corrects a session after the event ---');
  const picked = await page.evaluate(()=>{
    for(const row of document.querySelectorAll('#pump-rows .row'))
      if(/30 ml/.test(row.textContent)){
        row.querySelector('[data-fix]').click(); return row.textContent; }
    return null;});
  t('the 30 ml session is the one being corrected', /30 ml/.test(picked||''), true);
  await page.waitForTimeout(300);
  t('the correction box offers no pump-duration field',
     await page.isVisible('#fix-min-row').catch(()=>false), false);
  t('but does offer the left/right boxes', await page.isVisible('#fix-lr-row'), true);
  await page.fill('#fix-amt','45');
  await page.click('#fix-save'); await page.waitForTimeout(900);
  const c3 = await cards(page);
  t('the corrected volume is counted', c3['Expressed'][0], '105');
  const afterFix = await page.evaluate(()=>
    JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='pump'&&r.msg_id!=='nb-1'||r.type==='deleted'));
  t('the original is kept, struck out', afterFix.filter(r=>r.type==='deleted').length, 1);
  t('and the correction is a new row',
     afterFix.filter(r=>r.type==='pump'&&r.msg_id!=='nb-1'&&r.value===45).length, 1);

  console.log('--- reading up a page of notes ---');
  const NOTES = ['Breastfeeding',
    '12 Oct: 11mL hand expression',
    '13 Oct: 22mL pump (no overnight latch), 33mL (power pump after latching)',
    '14 Oct: 44mL (2h after feed, 7mL from hand expression)',
    '15 Oct: 21mL + 13mL + 6mL (2h after latching, 11/10mL, 6/7mL, 3/3mL)',
    '16 Oct: 23/41mL (2h after latch, 11/30mL)',
    '17 Oct: 51mL (3h after pump at 4am),',
    '27mL pump (power pump after latch)'].join('\n');
  await page.fill('#pm-imp', NOTES);
  await page.click('#pm-imp-read'); await page.waitForTimeout(400);
  const pv = (await page.textContent('#pm-preview')).replace(/\s+/g,' ');
  console.log('   preview:', pv.slice(0,300));
  t('nothing is saved by reading', await page.evaluate(()=>
    JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='pump'&&r.msg_id!=='nb-1').length), 2);
  t('the save button appears', await page.isVisible('#pm-imp-save'), true);
  t('six days read', (await page.$$('#pm-preview .pvd:not(.skip)')).length, 6);
  t('the day whose only session was unreadable says so', /nothing read/.test(pv), true);
  t('the heading is reported as not a day', /Not a day/.test(pv), true);
  t('hand expression is named', /Hand expressed 11 ml/.test(pv), true);
  t('a power pump is named', /Power pumped 33 ml/.test(pv), true);
  t('a volume inside the bracket is not added in', /Mum expressed 44 ml/.test(pv), true);
  t('a sitting of three pumps is one session', /3 pumps in the sitting/.test(pv), true);
  t('the ambiguous reading is refused by name', /not read: 23\/41mL/.test(pv), true);
  t('a stated time is used', /04:00/.test(pv), true);
  t('a placed time says so', /time not recorded/.test(pv), true);
  t('the wrapped line joined the day above it', await pvDay(page,'17 Oct 2026'), '78 ml in 2 sessions');
  t('and the total it will save is stated, counting only the days that gain something',
     /7 sessions across 5 days/.test(pv), true);

  await page.click('#pm-imp-save'); await page.waitForTimeout(4000);
  const all = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2')));
  const imported = all.filter(r=>r.type==='pump'&&r.msg_id!=='nb-1'&&r.ms<Date.parse('2026-10-20T00:00:00+08:00'));
  t('seven sessions saved', imported.length, 7);
  t('every one is a pump entry', imported.every(r=>r.type==='pump'&&r.msg_id!=='nb-1'), true);
  t('none of them invented a duration', imported.every(r=>r.dur_min===null), true);
  t('the one sitting whose split accounts for it got its sides',
     imported.filter(r=>r.ml_l===20&&r.ml_r===20).length, 1);
  t('and the rest, whose splits do not, got none',
     imported.filter(r=>r.ml_l===null).length, 6);
  t('everything but the hand expression is recorded as the Spectra',
     imported.filter(r=>r.pump_dev==='spectra').length, 6);
  t('and the hand expression names no machine',
     imported.filter(r=>r.subtype==='hand'&&r.pump_dev==='').length, 1);
  t('the whole line is kept in raw',
     imported.some(r=>r.raw==='44mL (2h after feed, 7mL from hand expression)'), true);
  t('a placed time is marked in the note',
     imported.filter(r=>/time not recorded/.test(r.note)).length, 6);
  t('the one with a stated time is not',
     imported.filter(r=>!/time not recorded/.test(r.note)).length, 1);
  t('the box is emptied', await page.inputValue('#pm-imp'), '');

  console.log('--- each imported day is its own file in the repo ---');
  for (const d of ['12','13','14','15','17'])
    t('2026-10-'+d+' was pushed', !!repoFiles['data/events/2026-10-'+d+'/des.jsonl'], true);
  t('the unread day was not invented', !!repoFiles['data/events/2026-10-16/des.jsonl'], false);
  t('13 Oct holds both of its sessions', rowsIn('data/events/2026-10-13/des.jsonl').length, 2);
  t('and they total 55 ml',
     rowsIn('data/events/2026-10-13/des.jsonl').reduce((a,r)=>a+r.value,0), 55);

  console.log('--- pasting the same page twice does not double the month ---');
  await page.fill('#pm-imp', NOTES);
  await page.click('#pm-imp-read'); await page.waitForTimeout(400);
  const pv2 = (await page.textContent('#pm-preview')).replace(/\s+/g,' ');
  t('every day already held is marked skipped', (await page.$$('#pm-preview .pvd.skip')).length >= 5, true);
  t('and says why', /already has/.test(pv2), true);
  t('there is nothing to save', await page.isVisible('#pm-imp-save'), false);
  t('so the count is unchanged', await page.evaluate(()=>
    JSON.parse(localStorage.getItem('babylog.entries.v2')).filter(r=>r.type==='pump'&&r.msg_id!=='nb-1').length), 9);

  console.log('--- stepping back through the days ---');
  await page.click('#pm-prev'); await page.waitForTimeout(300);
  t('the heading names the day', /31 Oct 2026/.test(await page.textContent('#pump-rowday')), true);
  t('and says there is nothing on it',
     /No sessions logged/.test(await page.textContent('#pump-rows')), true);
  await page.click('#pm-today'); await page.waitForTimeout(300);
  t('today comes back', await page.textContent('#pump-rowday'), 'today');
  t('with its two live sessions, the struck one gone from the list',
     (await page.$$('#pump-rows .row')).length, 2);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
