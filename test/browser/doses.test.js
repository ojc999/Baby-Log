// Doses of simeticone, vitamin D and BioGaia, counted per day. The question behind this
// screen is "how many has he had today", so the number has to be on the Summary tab where
// the day's figures are, not buried on a tab you open once a week.
//
// Vitamin D is a daily: its card shows from midnight, amber, because a day without it is a
// missed dose rather than a quiet day. Simeticone is as-needed, so its card appears only
// once a dose has gone in. The seven-day table gains a column per addition the week
// actually had, which is also the width risk this file watches - two extra columns on a
// 320px phone is the narrowest this screen has ever had to be.
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const ROOT=path.resolve(__dirname,'..','..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(url.parse(q.url).pathname);if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
const NOW=new Date('2026-11-11T06:00:00Z');   // 14:00 Singapore, 11 Nov
let fail=0;
const t=(n,got,want)=>{const ok=String(got)===String(want);if(!ok)fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want));};
// A missing card must read as a clean failure, not a TypeError that kills the run before
// anything else is checked - a crash reports nothing about the other twenty assertions.
const cards=async page=>{
  const o = await page.evaluate(()=>{const o={};
    document.querySelectorAll('#sum-today .lcard').forEach(c=>{
      const dd=c.querySelector('dd'),sm=c.querySelector('small');
      o[c.querySelector('dt').textContent]=[dd.textContent.replace(sm.textContent,''),sm.textContent];});
    return o;});
  return new Proxy(o, {get:(t,k)=> k in t ? t[k] : ['(no such card)','(no such card)']});
};
const weekRow=(page,day)=>page.evaluate(d=>{
  for(const tr of document.querySelectorAll('#sum-week tr'))
    if((tr.cells[0]||{}).textContent===d) return [...tr.cells].map(c=>c.textContent);
  return null;},day);
const weekHead=page=>page.evaluate(()=>
  [...document.querySelectorAll('#sum-week tr:first-child th')].map(h=>h.textContent));

// addInitScript serialises the function, so it cannot see anything from this scope:
// the rows have to travel as an argument or they arrive as an empty page.
const seed = rows => {
  const mk=(ts,type,subtype,value,unit,added)=>({ms:Date.parse(ts),ts,sender:'Des',type,subtype,
    value:value===undefined?null:value,unit:unit||'',note:'',raw:type,msg_id:ts+type+subtype+(added||''),
    dur_min:null,ml_l:null,ml_r:null,pump_dev:'',added:added||'',own:true,device:'des'});
  localStorage.setItem('babylog.cfg.v2',JSON.stringify(
    {who:'Des',device:'des',repo:'me/d',branch:'main',token:''}));
  localStorage.setItem('babylog.entries.v2',JSON.stringify(rows.map(a=>mk(...a))));
};

async function open_(b, rows, width) {
  const ctx=await b.newContext({viewport:{width:width||375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
  await ctx.addInitScript(seed, rows);
  const page=await ctx.newPage();
  await page.clock.install({time:NOW});
  await page.goto('http://localhost:8966/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);
  await page.click('#tab-sum'); await page.waitForTimeout(500);
  return page;
}

(async()=>{
  await new Promise(r=>srv.listen(8966,r));
  const b=await chromium.launch();

  console.log('--- a day with doses in it ---');
  let page = await open_(b, [
    ['2026-11-11T07:00:00+08:00','feed','formula',90,'ml','simeticone'],
    ['2026-11-11T10:00:00+08:00','feed','expressed',60,'ml','biogaia+simeticone'],
    ['2026-11-11T13:00:00+08:00','feed','formula',80,'ml','simeticone'],
    ['2026-11-11T11:00:00+08:00','feed','breast',20,'min',''],
    // yesterday, so the week column has something to vary against
    ['2026-11-10T09:00:00+08:00','feed','formula',90,'ml','simeticone'],
    ['2026-11-09T09:00:00+08:00','feed','formula',90,'ml','']
  ]);
  const c = await cards(page);
  console.log('   cards:', JSON.stringify(c));
  t('simeticone is counted for the day', c['Simeticone'][0], '3');
  t('as doses, not millilitres', c['Simeticone'][1], '3 doses');
  t('the feeds card is unchanged by any of it', c['Feeds'][0], '4');
  // BioGaia is no longer given with a feed: it is a yes-or-no for the day
  t('BioGaia reads as not given', c['BioGaia'][0], 'not yet');
  t('and says where the nudge comes from', c['BioGaia'][1], 'prompted when you log a bath');
  t('no two cards share a name', await page.evaluate(()=>{
     const n=[...document.querySelectorAll('#sum-today .lcard')].map(c=>c.querySelector('dt').textContent);
     return n.length - new Set(n).size;}), 0);
  t('a retired option counted on old feeds says where it was',
     c['BioGaia in feeds'][1], '1 dose');
  t('shown amber while it is still owed', await page.evaluate(()=>{
     for(const c of document.querySelectorAll('#sum-today .lcard'))
       if(c.querySelector('dt').textContent==='BioGaia') return c.classList.contains('stale');
     return 'no card';}), true);

  console.log('--- and the days behind it ---');
  const head = await weekHead(page);
  t('the week table gains a column', head.join(','), 'Day,Feeds,ml,Wet,Dirty,Slept,Sim');
  t('today reads three', (await weekRow(page,'11 Nov')).pop(), '3');
  t('yesterday one', (await weekRow(page,'10 Nov')).pop(), '1');
  t('a day with feeds but no doses reads as a dash', (await weekRow(page,'9 Nov')).pop(), '—');
  t('and the note says what the column is',
     /<b>Sim<\/b> is simeticone, counted one to a feed/
       .test(await page.evaluate(()=>document.getElementById('sum-weeknote').innerHTML)), true);
  t('and names only the column that is there', /vitamin D/
       .test(await page.textContent('#sum-weeknote')), false);
  t('a day with nothing at all still spans the right width', await page.evaluate(()=>{
     for(const tr of document.querySelectorAll('#sum-week tr'))
       if(/nothing logged/.test(tr.textContent)) return tr.cells[1].getAttribute('colspan');
     return 'no empty day';}), '6');
  await page.context().close();

  console.log('--- a week with none: no column, no clutter ---');
  page = await open_(b, [
    ['2026-11-11T07:00:00+08:00','feed','formula',90,'ml',''],
    ['2026-11-11T10:00:00+08:00','feed','breast',20,'min','']
  ]);
  const c2 = await cards(page);
  t('no card for something that was not given', c2['Simeticone'][0], '(no such card)');
  // BioGaia is the exception: a yes-or-no for the day, so it shows either way
  t('but BioGaia still shows, unanswered', c2['BioGaia'][0], 'not yet');
  t('and no column either',
     (await weekHead(page)).join(','), 'Day,Feeds,ml,Wet,Dirty,Slept');
  t('the empty-day span narrows to match', await page.evaluate(()=>{
     for(const tr of document.querySelectorAll('#sum-week tr'))
       if(/nothing logged/.test(tr.textContent)) return tr.cells[1].getAttribute('colspan');
     return 'no empty day';}), '5');
  t('and the note does not explain a column that is not there',
     /is simeticone/.test(await page.textContent('#sum-weeknote')), false);
  // Vitamin D is the one addition whose absence is itself the finding.
  t('vitamin D shows anyway, because a day without it is a missed dose',
     c2['Vitamin D'][0], 'not yet');
  t('and says how to give it', c2['Vitamin D'][1], 'give it with a milk feed');
  t('amber while it is owed', await page.evaluate(()=>{
     for(const c of document.querySelectorAll('#sum-today .lcard'))
       if(c.querySelector('dt').textContent==='Vitamin D') return c.classList.contains('stale');
     return 'no card';}), true);
  await page.context().close();

  console.log('--- vitamin D, once it has gone into a feed ---');
  page = await open_(b, [
    ['2026-11-11T07:00:00+08:00','feed','formula',90,'ml','simeticone+vitd'],
    ['2026-11-11T13:00:00+08:00','feed','formula',80,'ml','simeticone'],
    ['2026-11-10T09:00:00+08:00','feed','formula',90,'ml','vitd']
  ], 320);
  const c4 = await cards(page);
  console.log('   cards:', JSON.stringify(c4));
  t('it is counted like any other dose', c4['Vitamin D'][0], '1');
  t('and reads as a dose, not millilitres', c4['Vitamin D'][1], '1 dose');
  t('no longer amber once it is in', await page.evaluate(()=>{
     for(const c of document.querySelectorAll('#sum-today .lcard'))
       if(c.querySelector('dt').textContent==='Vitamin D') return c.classList.contains('stale');
     return 'no card';}), false);
  t('still no two cards sharing a name', await page.evaluate(()=>{
     const n=[...document.querySelectorAll('#sum-today .lcard')].map(c=>c.querySelector('dt').textContent);
     return n.length - new Set(n).size;}), 0);
  t('the table carries a column for each, in picker order',
     (await weekHead(page)).join(','), 'Day,Feeds,ml,Wet,Dirty,Slept,Sim,VitD');
  t('today reads two simeticone and one vitamin D',
     (await weekRow(page,'11 Nov')).slice(-2).join('/'), '2/1');
  t('yesterday the other way round', (await weekRow(page,'10 Nov')).slice(-2).join('/'), '—/1');
  t('the note names both columns',
     /<b>Sim<\/b> is simeticone, <b>VitD<\/b> is vitamin D, counted one to a feed/
       .test(await page.evaluate(()=>document.getElementById('sum-weeknote').innerHTML)), true);
  t('and an empty day spans both', await page.evaluate(()=>{
     for(const tr of document.querySelectorAll('#sum-week tr'))
       if(/nothing logged/.test(tr.textContent)) return tr.cells[1].getAttribute('colspan');
     return 'no empty day';}), '7');
  // Eight columns is the widest this table ever gets. It was already too wide for a
  // 320px phone at seven, and `.wrap` scrolls sideways for exactly that - but the page
  // behind it must not move, or every tab goes with it. Measured at 320 (iPhone SE,
  // first generation), then at the two sizes a phone in use today actually is.
  const fitted = await page.evaluate(()=>{
    const tb=document.getElementById('sum-week');
    return {tbl:tb.scrollWidth, box:tb.parentElement.clientWidth,
            scrolls:tb.parentElement.scrollWidth > tb.parentElement.clientWidth,
            page:document.documentElement.scrollWidth, win:window.innerWidth};});
  console.log('   width at 320px:', JSON.stringify(fitted));
  t('at 320px the table scrolls inside its own box', fitted.scrolls, true);
  t('and the page behind it does not move', fitted.page <= fitted.win, true);
  await page.context().close();

  // A day at its widest in every column at once, which is what the table has to hold:
  // a four-figure millilitre total, two-figure feed and nappy counts, and a sleep total
  // in double-figure hours. Seeded rather than assumed, because the column that overflows
  // is always the one nobody pictured.
  const widest = [
    ['2026-11-11T02:00:00+08:00','sleep','start'],
    ['2026-11-11T13:40:00+08:00','sleep','end'],       // 11h 40m
    ['2026-11-10T09:00:00+08:00','feed','formula',90,'ml','vitd']
  ];
  for (let i = 0; i < 11; i++) {
    widest.push(['2026-11-11T0' + (i % 10) + ':' + (10 + i) + ':00+08:00',
                 'feed','formula',95,'ml','simeticone' + (i ? '' : '+vitd')]);
    widest.push(['2026-11-11T0' + (i % 10) + ':' + (20 + i) + ':00+08:00','nappy','both']);
  }
  for (const w of [375, 390]) {
    page = await open_(b, widest, w);
    const fit = await page.evaluate(()=>{
      const tb=document.getElementById('sum-week');
      return {cols:tb.querySelectorAll('tr:first-child th').length,
              scrolls:tb.parentElement.scrollWidth > tb.parentElement.clientWidth,
              page:document.documentElement.scrollWidth, win:window.innerWidth};});
    console.log('   at '+w+'px:', JSON.stringify(fit));
    t('all eight columns are on screen at '+w+'px, no swiping',
       fit.cols+'/'+fit.scrolls, '8/false');
    t('and the page does not scroll sideways at '+w+'px', fit.page <= fit.win, true);
    // The today marker is what made room: under the date, not beside it.
    t('the row for today still says so at '+w+'px', await page.evaluate(()=>{
       const tr=document.querySelector('#sum-week tr.today');
       return tr ? getComputedStyle(tr.cells[0],'::after').content : 'no today row';}),
       '"today"');
    await page.context().close();
  }

  console.log('--- an undone feed takes its dose with it ---');
  page = await open_(b, [
    ['2026-11-11T07:00:00+08:00','feed','formula',90,'ml','simeticone'],
    ['2026-11-11T10:00:00+08:00','feed','formula',90,'ml','simeticone']
  ]);
  t('two to begin with', (await cards(page))['Simeticone'][0], '2');
  await page.evaluate(()=>{
    const r = entries.filter(x=>x.added==='simeticone')[0];
    undo(r.msg_id); renderSummary();});
  await page.waitForTimeout(300);
  t('one once a feed is struck out', (await cards(page))['Simeticone'][0], '1');

  console.log('--- the page that offers them says what it offers ---');
  // Found by looking at the screen, not by a test: the Feed page still read "Simeticone
  // and BioGaia" for a while after BioGaia moved off the picker. Prose goes stale quietly,
  // so this checks the hint against the list the chips are actually drawn from.
  await page.click('#tab-log'); await page.waitForTimeout(300);
  await page.click('[data-go="feed"]'); await page.waitForTimeout(400);
  const hint = (await page.textContent('#cat-body .info')||'').replace(/\s+/g,' ');
  console.log('   hint:', hint);
  const offered = await page.evaluate(()=>ADDS.map(a=>a[1]));
  t('the hint names every addition the pickers offer',
     offered.filter(l=>!new RegExp(l,'i').test(hint)).join(',')
       .replace(/^$/,'none missing'), 'none missing');
  t('and does not offer BioGaia on a feed',
     /BioGaia/.test(hint) ? /button of its own/.test(hint) : true, true);

  console.log('--- the reminder, when a bath is logged ---');
  await page.click('#tab-log'); await page.waitForTimeout(300);
  await page.click('[data-go="more"]'); await page.waitForTimeout(400);
  t('BioGaia has a button of its own, for a day with no bath',
     await page.isVisible('[data-ev="med:biogaia"]'), true);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#cat-body [data-ev]')]
    .find(e=>e.dataset.ev==='hygiene:bath'); b.click();});
  await page.waitForTimeout(500);
  const tx = (await page.textContent('#toast-txt')||'').replace(/\s+/g,' ');
  t('logging a bath asks for it', /BioGaia\?/.test(tx), true);
  t('and says the bath itself was logged', /Bath logged/.test(tx), true);
  t('the button offers to give it', (await page.textContent('#toast-act')).trim(), 'Give it');
  await page.click('#toast-act'); await page.waitForTimeout(600);
  const given = await page.evaluate(()=>JSON.parse(localStorage.getItem('babylog.entries.v2'))
    .filter(r=>r.type==='med'&&r.subtype==='biogaia'));
  t('tapping it logs a dose', given.length, 1);
  t('as its own entry, not a feed', given[0].type+'/'+given[0].subtype, 'med/biogaia');
  t('and it is not written onto any feed', await page.evaluate(()=>
     JSON.parse(localStorage.getItem('babylog.entries.v2'))
       .some(r=>/biogaia/.test(r.added||''))), false);

  console.log('--- and it does not ask twice ---');
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#cat-body [data-ev]')]
    .find(e=>e.dataset.ev==='hygiene:bath'); b.click();});
  await page.waitForTimeout(500);
  const tx2 = (await page.textContent('#toast-txt')||'').replace(/\s+/g,' ');
  t('a second bath gets the ordinary toast', /BioGaia\?/.test(tx2), false);
  t('which offers undo as usual', (await page.textContent('#toast-act')).trim(), 'Undo');

  await page.click('#tab-sum'); await page.waitForTimeout(500);
  const c3 = await cards(page);
  t('the card now reads given', c3['BioGaia'][0], 'given');
  t('with the time it was given', /^\d\d:\d\d$/.test(c3['BioGaia'][1]), true);
  t('and no longer amber, the thing being done', await page.evaluate(()=>{
     for(const c of document.querySelectorAll('#sum-today .lcard'))
       if(c.querySelector('dt').textContent==='BioGaia') return c.classList.contains('stale');
     return 'no card';}), false);

  console.log('--- the whole story counts them over the record ---');
  await page.click('#go-stats'); await page.waitForTimeout(1200);
  const odd = (await page.textContent('#stats-odd')).replace(/\s+/g,' ');
  console.log('   fact:', (odd.match(/[^.]*Simeticone[^.]*\./)||[''])[0].trim());
  t('a lifetime dose count is there', /1 dose of Simeticone in a feed/.test(odd), true);
  t('and the standalone BioGaia doses are counted apart from it',
     /1 dose of BioGaia, given on its own/.test(odd), true);

  await b.close(); srv.close();
  console.log(fail?'\n======== '+fail+' FAILURES ========':'\n======== ALL PASS ========');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
