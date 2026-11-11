// Doses of simeticone and BioGaia, counted per day. The question behind this screen is
// "how many has he had today", so the number has to be on the Summary tab where the
// day's figures are, not buried on a tab you open once a week.
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

async function open_(b, rows) {
  const ctx=await b.newContext({viewport:{width:375,height:667},isMobile:true,timezoneId:'Asia/Singapore'});
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
     /Sim<\/b> is doses of simeticone/.test(await page.evaluate(()=>document.getElementById('sum-weeknote').innerHTML)), true);
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
     /is doses of simeticone/.test(await page.textContent('#sum-weeknote')), false);
  await page.context().close();

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
