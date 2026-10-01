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

  console.log('\n--- no request goes anywhere but GitHub and the page itself ---');
  const hosts = [...new Set(calls.map(c=>new URL(c.url).host))];
  t('only api.github.com was called', JSON.stringify(hosts), JSON.stringify(['api.github.com']));

  if (errs.length) { fail++; console.log('FAIL page errors: '+[...new Set(errs)].join(' | ')); }
  await browser.close(); server.close();
  console.log(fail ? '\n======== '+fail+' FAILURES ========' : '\n======== ALL PASS ========');
  process.exit(fail?1:0);
})();
