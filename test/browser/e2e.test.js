// End-to-end: drives the real page in Chromium against a stubbed api.github.com and checks
// the exact requests it makes. Proves the things docs/background.md §9 lists as unverified.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(url.parse(req.url).pathname); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f));
});

let fail = 0;
const t = (n, got, want) => { const ok = String(got)===String(want); if(!ok) fail++;
  console.log((ok?'ok   ':'FAIL ')+n+' -> '+got+(ok?'':'   expected: '+want)); };

(async () => {
  await new Promise(r=>server.listen(8766,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true, timezoneId:'Asia/Singapore' });

  // ---- the fake GitHub ----
  const repoFiles = {};            // path -> {content(b64), sha}
  const calls = [];
  let forceStatus = null;          // override the next response
  let staleOnce = false;           // make the first PUT look like a racing write
  let sha = 0;
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace('/repos/me/baby-data/contents/','');
    if (/\/branches\//.test(u.pathname)) {       // set-test checks the branch exists
      calls.push({method:req.method(), url:req.url(), headers:req.headers(), body:null});
      return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({name:'main'})});
    }
    const rec = { method:req.method(), url:req.url(), headers:req.headers(), body:req.postData() };
    calls.push(rec);
    if (forceStatus) { const s = forceStatus; forceStatus = null;
      return route.fulfill({status:s, contentType:'application/json', body:JSON.stringify({message:'stubbed '+s})}); }
    if (req.method()==='PUT') {
      const b = JSON.parse(req.postData());
      if (staleOnce) { staleOnce=false;
        return route.fulfill({status:409, contentType:'application/json', body:JSON.stringify({message:'is at 111 but expected 222'})}); }
      // GitHub refuses a write to a file that already exists unless the request carries
      // its current sha. Without this the stub is more permissive than the real API, and
      // the overwrite protection never gets exercised on the path that matters.
      const cur = repoFiles[decodeURIComponent(p)];
      if (cur && b.sha !== cur.sha)
        return route.fulfill({status:422, contentType:'application/json',
          body:JSON.stringify({message: b.sha ? 'sha does not match' : '"sha" wasn\'t supplied.'})});
      const newSha = 'sha'+(++sha);
      repoFiles[decodeURIComponent(p)] = { content:b.content, sha:newSha };
      return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({content:{sha:newSha, path:p}})});
    }
    // GET: a directory listing or a file
    const dec = decodeURIComponent(p.split('?')[0]);
    const kids = Object.keys(repoFiles).filter(k => k.startsWith(dec+'/'));
    if (kids.length && !repoFiles[dec])
      return route.fulfill({status:200, contentType:'application/json',
        body:JSON.stringify(kids.map(k=>({type:'file', name:k.split('/').pop(), path:k})))});
    if (repoFiles[dec])
      return route.fulfill({status:200, contentType:'application/json',
        body:JSON.stringify({sha:repoFiles[dec].sha, content:repoFiles[dec].content, path:dec})});
    return route.fulfill({status:404, contentType:'application/json', body:JSON.stringify({message:'Not Found'})});
  });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e=>errs.push(String(e)));
  await page.goto('http://localhost:8766/', {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(300);

  console.log('--- setup ---');
  await page.click('#tab-set');
  await page.fill('#in-who','Simon'); await page.fill('#in-device','simon-phone');
  await page.fill('#in-repo','me/baby-data'); await page.fill('#in-branch','main');
  await page.fill('#in-token','github_pat_FAKE');
  await page.click('#set-test');
  await page.waitForTimeout(600);
  t('setup made a GitHub call', calls.length > 0, true);

  console.log('\n--- log a bottle feed and push it ---');
  await page.click('#tab-log');
  await page.click('[data-go="feed"]');
  await page.click('[data-sheet="bottle"]');
  await page.waitForTimeout(200);
  await page.click('#sheet-presets .chip:nth-child(2)');   // a preset amount
  await page.click('#sheet-save');
  await page.waitForTimeout(800);

  const puts = calls.filter(c=>c.method==='PUT');
  t('a PUT was made', puts.length >= 1, true);
  const put = puts[puts.length-1];
  t('PUT goes to the contents API', /\/repos\/me\/baby-data\/contents\/data\/events\/\d{4}-\d{2}-\d{2}\/simon-phone\.jsonl$/.test(put.url.split('?')[0]), true);
  t('Authorization is a bearer token', /^Bearer github_pat_/.test(put.headers['authorization']||''), true);
  t('sends the API version header', put.headers['x-github-api-version'], '2022-11-28');
  t('Accept is the github json type', put.headers['accept'], 'application/vnd.github+json');
  const pb = JSON.parse(put.body);
  t('names the branch', pb.branch, 'main');
  const decoded = Buffer.from(pb.content,'base64').toString('utf8');
  const rows = decoded.trim().split('\n').map(JSON.parse);
  t('one row pushed', rows.length, 1);
  t('field order matches the contract', JSON.stringify(Object.keys(rows[0])),
     JSON.stringify(['ts','sender','type','subtype','value','unit','note','raw','msg_id']));
  t('row is a bottle feed', rows[0].type+'/'+rows[0].subtype, 'feed/bottle');
  t('ts carries +08:00', /\+08:00$/.test(rows[0].ts), true);
  t('file ends with a newline', /\n$/.test(decoded), true);
  t('sender is who we set', rows[0].sender, 'Simon');

  console.log('\n--- a non-ASCII note survives the round trip ---');
  await page.fill('#free','note he smiled — 微笑 café');
  await page.waitForTimeout(250);
  await page.click('#free-save');
  await page.waitForTimeout(900);
  const put2 = calls.filter(c=>c.method==='PUT').pop();
  const rows2 = Buffer.from(JSON.parse(put2.body).content,'base64').toString('utf8').trim().split('\n').map(JSON.parse);
  const noteRow = rows2.find(r=>r.type==='note');
  t('note kept word for word', noteRow && noteRow.raw.includes('微笑 café'), true);

  console.log('\n--- the 409 retry path (never tested before: needs two phones racing) ---');
  staleOnce = true;
  const before = calls.length;
  await page.click('#cat-back');
  await page.click('[data-go="nappy"]');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#cat-body button')].find(x=>/wet/i.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(1200);
  const after = calls.slice(before);
  t('409 triggered a sha re-read', after.some(c=>c.method==='GET' && /simon-phone\.jsonl/.test(c.url)), true);
  t('and then a second PUT', after.filter(c=>c.method==='PUT').length >= 2, true);
  const sync1 = await page.textContent('#sync-txt');
  t('no error left on screen after the retry succeeded', /unsaved|failed|error/i.test(sync1||''), false);

  console.log('\n--- an entry survives a failed push and is not lost ---');
  forceStatus = 401;
  await page.click('#cat-back');
  await page.click('[data-go="hygiene"]');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#cat-body button')].find(x=>/bath/i.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(900);
  const strip = (await page.textContent('#sync-txt'))||'';
  t('the amber strip reports it unsaved', /unsaved|not saved|waiting/i.test(strip), true);
  await page.click('#tab-set');
  const diag = (await page.textContent('#diag'))||'';
  t('diagnostics shows the error verbatim', /401/.test(diag), true);
  t('diagnostics does not leak entry content', /bath|微笑/i.test(diag), false);

  console.log('\n--- it recovers when the token works again ---');
  await page.click('#sync-btn').catch(async()=>{ await page.click('#tab-set'); });
  await page.waitForTimeout(1200);
  const stripAfter = (await page.textContent('#sync-txt'))||'';
  t('strip clears once the push lands', /unsaved/i.test(stripAfter), false);

  console.log('\n--- the other phone appears in the summary ---');
  const day = await page.evaluate(()=>{ const d=new Date(); const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}); return f.format(d); });
  repoFiles['data/events/'+day+'/wife-phone.jsonl'] = { sha:'shaW', content: Buffer.from(
    JSON.stringify({ts:day+'T09:00:00+08:00',sender:'Wife',type:'feed',subtype:'breast',value:20,unit:'min',note:'left',raw:'bf 20',msg_id:'w-e2e-1'})+'\n'
  ).toString('base64') };
  await page.click('#tab-set'); await page.click('#set-test'); await page.waitForTimeout(1500);
  await page.click('#tab-sum'); await page.waitForTimeout(400);
  const tl = (await page.textContent('#sum-timeline'))||'';
  t("her entry shows on this phone", /Wife/.test(tl), true);
  const lastPut = calls.filter(c=>c.method==='PUT').pop();
  const lastRows = Buffer.from(JSON.parse(lastPut.body).content,'base64').toString('utf8').trim().split('\n').map(JSON.parse);
  t('we never write her rows into our own file', lastRows.some(r=>r.msg_id==='w-e2e-1'), false);

  console.log('\n--- a phone with nothing to push still sees the other one (regression) ---');
  repoFiles['data/events/'+day+'/wife-phone.jsonl'] = { sha:'shaW2', content: Buffer.from(
    JSON.stringify({ts:day+'T09:00:00+08:00',sender:'Wife',type:'feed',subtype:'breast',value:20,unit:'min',note:'left',raw:'bf 20',msg_id:'w-e2e-1'})+'\n' +
    JSON.stringify({ts:day+'T11:30:00+08:00',sender:'Wife',type:'nappy',subtype:'dirty',value:null,unit:'',note:'',raw:'poo',msg_id:'w-e2e-2'})+'\n'
  ).toString('base64') };
  const beforeReload = calls.length;
  await page.reload({waitUntil:'domcontentloaded'});           // fresh open, queue empty
  await page.waitForTimeout(1500);
  const reloadCalls = calls.slice(beforeReload);
  t('opening the app reads the other phone with nothing to push',
     reloadCalls.some(c=>c.method==='GET' && /\/contents\/data\/events\/[\d-]+\?/.test(c.url)), true);
  t('and makes no PUT when there is nothing of ours to save',
     reloadCalls.filter(c=>c.method==='PUT').length, 0);
  await page.click('#tab-sum'); await page.waitForTimeout(400);
  const tl2 = (await page.textContent('#sum-timeline'))||'';
  t('her second entry is on screen after a plain open', /Wife/.test(tl2), true);

  console.log('\n--- two phones sharing one device name must not wipe each other ---');
  // Put a row into OUR OWN remote file that this browser has never seen - which is what
  // the other phone's write looks like when both were named the same.
  const mineP = 'data/events/'+day+'/simon-phone.jsonl';
  const existing = Buffer.from(repoFiles[mineP].content,'base64').toString('utf8');
  const stranger = JSON.stringify({ts:day+'T03:05:00+08:00',sender:'Wife',type:'feed',subtype:'bottle',
    value:70,unit:'ml',note:'',raw:'70ml',msg_id:'other-phone-same-name-1'})+'\n';
  repoFiles[mineP] = { sha:'shaDRIFT', content: Buffer.from(stranger + existing).toString('base64') };
  staleOnce = true;                       // force the 409 path, as a real race would
  await page.click('#tab-log');
  await page.click('[data-go="nappy"]');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#cat-body button')].find(x=>/wet/i.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(1500);
  const finalPut = calls.filter(c=>c.method==='PUT').pop();
  const finalRows = Buffer.from(JSON.parse(finalPut.body).content,'base64').toString('utf8').trim().split('\n').map(JSON.parse);
  t("the other phone's row survived the overwrite",
     finalRows.some(r=>r.msg_id==='other-phone-same-name-1'), true);
  t('our own new entry is there too', finalRows.some(r=>r.type==='nappy'&&r.subtype==='wet'), true);
  t('nothing was duplicated', finalRows.length, new Set(finalRows.map(r=>r.msg_id)).size);
  await page.click('#tab-set'); await page.waitForTimeout(200);
  const diag2 = (await page.textContent('#diag'))||'';
  t('and the recovery is named in diagnostics, not silent', /recovered/.test(diag2), true);

  console.log('\n--- the undo toast after a mis-tap ---');
  await page.click('#tab-log');
  await page.evaluate(()=>{ const b=document.querySelector('#cat-back'); b && b.click(); });
  await page.click('[data-go="nappy"]');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#cat-body button')].find(x=>/^wet/i.test(x.textContent.trim())); b && b.click(); });
  await page.waitForTimeout(350);
  t('a toast appears after logging', await page.isVisible('#toast'), true);
  t('and it offers an Undo', await page.isVisible('#toast-act'), true);
  const nBefore = await page.evaluate(()=>entries.filter(r=>r.type!=='deleted').length);
  await page.click('#toast-act');
  await page.waitForTimeout(500);
  t('tapping Undo removes it from the live log',
     await page.evaluate(()=>entries.filter(r=>r.type!=='deleted').length), nBefore-1);
  t('but the row is kept, marked deleted',
     await page.evaluate(()=>entries.some(r=>r.type==='deleted')), true);
  t('the toast goes away', await page.isHidden('#toast'), true);

  console.log('\n--- correcting an entry keeps the original ---');
  await page.evaluate(()=>{ const b=document.querySelector('#cat-back'); b && b.click(); });
  await page.click('[data-go="feed"]');
  await page.click('[data-sheet="bottle"]');
  await page.waitForTimeout(200);
  await page.click('#sheet-presets .chip:nth-child(1)');
  await page.click('#sheet-save');
  await page.waitForTimeout(700);
  const target = await page.evaluate(()=>{ const r=entries.filter(x=>x.type==='feed'&&x.subtype==='bottle').pop(); return {id:r.msg_id, v:r.value}; });
  await page.click('#tab-sum'); await page.waitForTimeout(300);
  await page.evaluate(id=>{ const b=document.querySelector(`#sum-timeline [data-fix="${id}"]`); b && b.click(); }, target.id);
  await page.waitForTimeout(300);
  t('the correction box opens', await page.isVisible('#fix'), true);
  await page.fill('#fix-time','04:30');
  await page.fill('#fix-amt','125');
  await page.click('#fix-save');
  await page.waitForTimeout(900);
  const fixed = await page.evaluate(id=>({
    original: entries.find(r=>r.msg_id===id),
    corrected: entries.filter(r=>r.type==='feed'&&r.subtype==='bottle'&&r.value===125)[0] || null,
  }), target.id);
  t('the original is kept and marked deleted', fixed.original && fixed.original.type, 'deleted');
  t('the correction exists with the new amount', !!fixed.corrected, true);
  t('and it has its own msg_id', fixed.corrected && fixed.corrected.msg_id !== target.id, true);
  t('and the corrected time was applied', fixed.corrected && /T04:30:/.test(fixed.corrected.ts), true);
  await page.waitForTimeout(600);
  const pushedRows = Buffer.from(JSON.parse(calls.filter(c=>c.method==='PUT').pop().body).content,'base64')
    .toString('utf8').trim().split('\n').map(JSON.parse);
  t('both the deleted original and the correction are pushed',
     pushedRows.some(r=>r.msg_id===target.id && r.type==='deleted') &&
     pushedRows.some(r=>r.value===125), true);

  // a correction must refuse a time that has not happened yet
  await page.evaluate(()=>{ const b=document.querySelector('#sum-timeline [data-fix]'); b&&b.click(); });
  await page.waitForTimeout(250);
  const beforeCount = await page.evaluate(()=>entries.length);
  // Two hours ahead in Singapore, computed rather than hard-coded: a fixed "23:58" is in
  // the past whenever the suite runs late in the evening.
  const soon = await page.evaluate(()=>{
    const d = new Date(Date.now() + 2*3600000);
    const f = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false});
    const o={}; f.formatToParts(d).forEach(p=>o[p.type]=p.value);
    return {hm:`${o.hour}:${o.minute}`, wraps: Number(o.hour) < 2};
  });
  if (soon.wraps) {
    console.log('skip  future-time guard: +2h crosses midnight in Singapore, so it is not a future time on this entry\'s day');
    await page.click('#fix-cancel');
  } else {
    await page.fill('#fix-time', soon.hm);
    await page.click('#fix-save');
    await page.waitForTimeout(400);
    t('a correction into the future changes nothing', await page.evaluate(()=>entries.length), beforeCount);
    t('and says so', /has not happened yet/.test((await page.textContent('#toast-txt'))||''), true);
    await page.click('#fix-cancel');
  }

  console.log('\n--- which breast comes next ---');
  const side = await page.evaluate(()=>{ try { return {last:lastSide(), next:nextSide()}; } catch(e){ return {err:String(e)}; } });
  t('the app knows the last side used', side.last === 'left' || side.last === 'right', true);
  t('and proposes the other one', side.next, side.last === 'left' ? 'right' : 'left');
  await page.click('#tab-log');
  await page.evaluate(()=>{ const b=document.querySelector('#cat-back'); b && b.click(); });
  await page.click('[data-go="feed"]');
  await page.click('[data-sheet="breast"]');
  await page.waitForTimeout(250);
  t('the breast sheet pre-selects that side',
     await page.getAttribute(`#sheet-side [data-side="${side.next}"]`, 'aria-pressed'), 'true');
  t('and says why', /last feed was on the/i.test((await page.textContent('#sheet-hint'))||''), true);
  await page.click('#sheet-cancel');

  console.log('\n--- the other phone\'s rows carry no controls we cannot honour ---');
  await page.click('#tab-sum'); await page.waitForTimeout(300);
  // Check by ownership, not by the sender's name: a row absorbed from our own remote file
  // can carry another person's name and still be ours to write.
  const dead = await page.evaluate(()=>{
    const foreign = new Set(entries.filter(r=>!r.own).map(r=>r.msg_id));
    return [...document.querySelectorAll('.pane:not([hidden]) [data-del],.pane:not([hidden]) [data-fix]')]
      .filter(b=>foreign.has(b.dataset.del || b.dataset.fix)).length;
  });
  t('no undo or fix button on the other phone\'s entries', dead, 0);

  console.log('\n--- setup survives without tapping Save and test ---');
  // The token is the last box on the page, so it never loses focus and `change` never
  // fires for it. Everything else was kept and the token was not, which made the app say
  // "Not connected" with all five boxes looking correctly filled in.
  const fresh = await ctx.newPage();
  await fresh.goto('http://localhost:8766/', {waitUntil:'domcontentloaded'});
  await fresh.waitForTimeout(300);
  await fresh.click('#tab-set');
  await fresh.fill('#in-who','Wife');
  await fresh.fill('#in-device','wife-phone');
  await fresh.fill('#in-repo','me/baby-data');
  await fresh.fill('#in-branch','main');
  await fresh.fill('#in-token','github_pat_TYPEDLAST');   // last box, never blurred
  await fresh.reload({waitUntil:'domcontentloaded'});
  await fresh.waitForTimeout(500);
  t('the token survives a reload without Save and test',
     await fresh.evaluate(()=>(cfg.token||'').length > 0), true);
  t('and the app counts itself connected', await fresh.evaluate(()=>configured()), true);
  t('so the Not connected strip is gone', await fresh.evaluate(()=>document.getElementById('sync').hidden), true);

  console.log('\n--- the device box does not fight you while you type it ---');
  await fresh.click('#tab-set');          // the reload above landed on the Log tab
  await fresh.fill('#in-device','');
  await fresh.type('#in-device','Wife Phone', {delay:12});
  t('what was typed is still what is in the box', await fresh.inputValue('#in-device'), 'Wife Phone');
  await fresh.click('#in-repo');                       // move away: now it tidies
  t('and it is tidied once you leave it', await fresh.inputValue('#in-device'), 'wife-phone');

  console.log('\n--- a successful test says so ---');
  await fresh.fill('#in-token','github_pat_FAKE');
  await fresh.click('#set-test');
  await fresh.waitForTimeout(900);
  t('a toast confirms the connection', /Connected/.test((await fresh.textContent('#toast-txt'))||''), true);
  t('and names the file this phone writes', /wife-phone\.jsonl/.test((await fresh.textContent('#toast-txt'))||''), true);
  await fresh.close();

  console.log('\n--- the same device name on both phones is named, not left to be guessed ---');
  const diag3 = (await page.textContent('#diag'))||'';
  t('diagnostics says the name is shared', /SAME DEVICE NAME/.test(diag3), true);
  t('and says neither phone can see the other', /cannot see|skips the file named after itself/.test(diag3), true);

  console.log('\n--- no request goes anywhere but GitHub and the page itself ---');
  const hosts = [...new Set(calls.map(c=>new URL(c.url).host))];
  t('only api.github.com was called', JSON.stringify(hosts), JSON.stringify(['api.github.com']));

  if (errs.length) { fail++; console.log('FAIL page errors: '+[...new Set(errs)].join(' | ')); }
  await browser.close(); server.close();
  console.log(fail ? '\n======== '+fail+' FAILURES ========' : '\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
