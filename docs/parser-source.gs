/**
 * Parser.gs — turns a short message into structured events.
 *
 * This is the file you will edit most. Everything else is plumbing.
 * To teach the bot a new word, add it to the relevant list in RULES below.
 *
 * No network calls, no Sheet access — pure text in, objects out.
 * That means you can test it with runParserTests() without touching anything live.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────
// Add words here. Order inside a list does not matter.

var WORDS = {
  sleepStart: ['down', 'asleep', 'sleep', 'sleeping', 'slept', 'zzz', 'nap', 'napping'],
  sleepEnd:   ['up', 'awake', 'woke', 'wake', 'awoke', 'waking'],

  breast:     ['bf', 'breast', 'latch', 'latched', 'nurse', 'nursed', 'nursing'],
  expressed:  ['ebm', 'expressed', 'pumped'],
  formula:    ['formula', 'fm'],
  feedGeneric:['fed', 'feed', 'bottle'],

  wet:        ['pee', 'peed', 'wee', 'weed', 'wet'],
  dirty:      ['poo', 'poop', 'pooped', 'pooed', 'dirty', 'soiled', 'meconium', 'bm'],
  both:       ['both'],

  vomit:      ['vomit', 'vomited', 'spit', 'spitup', 'posset', 'possetted'],
  pump:       ['pump', 'pumped', 'pumping', 'expressing'],
  bath:       ['bath', 'bathed', 'bathing'],
  cry:        ['cry', 'cried', 'crying', 'fussy', 'fussing', 'colic', 'unsettled'],
  tummy:      ['tummy', 'tummytime'],
  undo:       ['no', 'undo', 'oops', 'delete', 'wrong', 'cancel']
};

// Clauses that swallow everything after them. Without this, "/ask why is he not
// pooping" would log a nappy.
var CONSUMING = /^(note|milestone|vax|vaccine|med|meds|medicine)\b\s*([\s\S]*)$/;

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param {string} text  the raw message
 * @param {number} nowMs Date.now() at receipt
 * @return {{events: Array, matched: boolean, tsShift: number}}
 *   events: [{type, subtype, value, unit, note, ts}]
 *   matched: false means nothing was recognised — caller should store it as a note
 */
function parseMessage(text, nowMs) {
  var raw = String(text || '').trim();
  if (!raw) return { events: [], matched: false, tsShift: 0 };

  var lower = raw.toLowerCase();

  // 1. Pull out a retrospective timestamp, if any, and strip it from the text.
  var shifted = extractTime_(lower, nowMs);
  var ts = shifted.ts;
  var body = shifted.rest;
  var tsShift = ts - nowMs;

  // 2. Undo is a whole-message command, never part of a compound.
  if (isWord_(body, WORDS.undo)) {
    return { events: [{ type: 'undo', subtype: '', value: '', unit: '', note: '', ts: ts }],
             matched: true, tsShift: tsShift };
  }

  // 3. A consuming clause takes the rest of the message verbatim — no splitting,
  //    no further parsing.
  var c = body.match(CONSUMING);
  if (c) {
    var ev = consumingEvent_(c[1], raw.replace(/^\S+\s*/, '').trim() || c[2], ts);
    return { events: [ev], matched: true, tsShift: tsShift };
  }

  // 4. Split compounds: "poo + 30ml", "fed 20, down", "30ml then down"
  var parts = body.split(/\s*(?:,|\+|\bthen\b)\s*/).filter(function (p) { return p.trim(); });
  if (!parts.length) parts = [body];

  var events = [];
  for (var i = 0; i < parts.length; i++) {
    var ev = parsePart_(parts[i].trim(), ts);
    if (ev) events.push(ev);
  }

  if (!events.length) return { events: [], matched: false, tsShift: tsShift };
  return { events: events, matched: true, tsShift: tsShift };
}

// ── Consuming clauses ─────────────────────────────────────────────────────────

function consumingEvent_(kw, text, ts) {
  text = String(text || '').trim();
  if (kw === 'vax' || kw === 'vaccine')                   return ev_('vax', '', '', '', text, ts);
  if (kw === 'med' || kw === 'meds' || kw === 'medicine') return ev_('med', '', '', '', text, ts);
  if (kw === 'milestone')                                 return ev_('milestone', '', '', '', text, ts);
  return ev_('note', '', '', '', text, ts);
}

// ── One clause ────────────────────────────────────────────────────────────────

function parsePart_(part, ts) {
  if (!part) return null;
  var m;

  // Measurements first — they are the most specific.
  m = part.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (m) return ev_('measure', 'weight', num_(m[1]), 'kg', rest_(part, m[0]), ts);

  m = part.match(/\bhead\D{0,8}(\d+(?:\.\d+)?)\s*cm\b/) || part.match(/\bhc\D{0,8}(\d+(?:\.\d+)?)/);
  if (m) return ev_('measure', 'head', num_(m[1]), 'cm', rest_(part, m[0]), ts);

  m = part.match(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (m) return ev_('measure', 'length', num_(m[1]), 'cm', rest_(part, m[0]), ts);

  m = part.match(/\btemp\w*\D{0,4}(\d{2}(?:\.\d+)?)/) || part.match(/(\d{2}\.\d)\s*(?:c|deg)\b/);
  if (m) return ev_('measure', 'temp', num_(m[1]), 'C', rest_(part, m[0]), ts);

  // Expressing is maternal, not a feed — check before the ml rule claims it.
  if (isWord_(part, WORDS.pump)) {
    var pm = part.match(/(\d+(?:\.\d+)?)/);
    return ev_('pump', '', pm ? num_(pm[1]) : '', pm ? 'ml' : '', '', ts);
  }

  // Minutes-valued events.
  if (isWord_(part, WORDS.cry)) {
    var cm = part.match(/(\d+)/);
    return ev_('cry', '', cm ? num_(cm[1]) : '', cm ? 'min' : '', '', ts);
  }
  if (isWord_(part, WORDS.tummy)) {
    var tm = part.match(/(\d+)/);
    return ev_('tummy', '', tm ? num_(tm[1]) : '', tm ? 'min' : '', '', ts);
  }
  if (isWord_(part, WORDS.bath)) return ev_('bath', '', '', '', '', ts);

  // Feeds — volume in ml.
  m = part.match(/(\d+(?:\.\d+)?)\s*(?:ml|mls)\b/);
  if (m) {
    var sub = isWord_(part, WORDS.formula) ? 'formula'
            : isWord_(part, WORDS.expressed) ? 'expressed'
            : 'bottle';
    return ev_('feed', sub, num_(m[1]), 'ml', rest_(part, m[0]), ts);
  }

  // Feeds — breast, optionally with minutes.
  if (isWord_(part, WORDS.breast)) {
    var mins = part.match(/(\d+)\s*(?:min|mins|m)?\b/);
    var side = part.match(/(?:^|[^a-z])(left|right|l|r)(?:[^a-z]|$)/);
    var sideNote = side ? (side[1].charAt(0) === 'l' ? 'left' : 'right') : '';
    return ev_('feed', 'breast', mins ? num_(mins[1]) : '', mins ? 'min' : '',
               sideNote || rest_(part, mins ? mins[0] : ''), ts);
  }
  if (isWord_(part, WORDS.expressed)) return ev_('feed', 'expressed', '', '', '', ts);
  if (isWord_(part, WORDS.formula))   return ev_('feed', 'formula', '', '', '', ts);

  // Nappies.
  var wet   = isWord_(part, WORDS.wet);
  var dirty = isWord_(part, WORDS.dirty);
  if (isWord_(part, WORDS.both) || (wet && dirty)) return ev_('nappy', 'both', '', '', '', ts);
  if (dirty) return ev_('nappy', 'dirty', '', '', '', ts);
  if (wet)   return ev_('nappy', 'wet', '', '', '', ts);

  if (isWord_(part, WORDS.vomit)) return ev_('vomit', '', '', '', '', ts);

  // Sleep last — "up" and "down" are short and appear inside other words,
  // so everything more specific gets first refusal.
  if (isWord_(part, WORDS.sleepEnd))   return ev_('sleep', 'end', '', '', '', ts);
  if (isWord_(part, WORDS.sleepStart)) return ev_('sleep', 'start', '', '', '', ts);

  // A bare "fed" with no detail still beats nothing.
  if (isWord_(part, WORDS.feedGeneric)) return ev_('feed', '', '', '', '', ts);

  return null;
}

// ── Retrospective timestamps ──────────────────────────────────────────────────
// "-20"      → twenty minutes ago
// "@0214"    → at 02:14 today (yesterday if that would be in the future)
// "@2.14am"  → same

function extractTime_(text, nowMs) {
  var m = text.match(/(?:^|\s)-(\d{1,3})(?=\s|$)/);
  if (m) {
    return { ts: nowMs - num_(m[1]) * 60000, rest: text.replace(m[0], ' ').trim() };
  }

  m = text.match(/(?:^|\s)@\s?(\d{1,2})[:.]?(\d{2})\s?(am|pm)?(?=\s|$)/);
  if (m) {
    var h = num_(m[1]), min = num_(m[2]), ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    var d = new Date(nowMs);
    d.setHours(h, min, 0, 0);
    if (d.getTime() > nowMs + 60000) d.setDate(d.getDate() - 1); // must be in the past
    return { ts: d.getTime(), rest: text.replace(m[0], ' ').trim() };
  }

  return { ts: nowMs, rest: text };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ev_(type, subtype, value, unit, note, ts) {
  return { type: type, subtype: subtype, value: value, unit: unit, note: note || '', ts: ts };
}

function isWord_(text, list) {
  for (var i = 0; i < list.length; i++) {
    if (new RegExp('(?:^|[^a-z])' + list[i] + '(?:[^a-z]|$)').test(text)) return true;
  }
  return false;
}

function num_(s) { var n = parseFloat(s); return isNaN(n) ? '' : n; }

function rest_(part, matched) {
  return part.replace(matched, ' ')
             .replace(/\b(fed|feed|bottle|of|at|ml|mls)\b/g, ' ')
             .replace(/\s+/g, ' ').trim();
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// Run this from the Apps Script editor after editing WORDS. It touches nothing live.

function runParserTests() {
  var now = new Date(2026, 9, 15, 3, 0, 0).getTime(); // 15 Oct 2026, 03:00
  var cases = [
    ['down',            'sleep/start'],
    ['asleep',          'sleep/start'],
    ['up',              'sleep/end'],
    ['woke',            'sleep/end'],
    ['30ml',            'feed/bottle 30 ml'],
    ['60 ml formula',   'feed/formula 60 ml'],
    ['bf 20',           'feed/breast 20 min'],
    ['latched 15 mins', 'feed/breast 15 min'],
    ['poo',             'nappy/dirty'],
    ['pee',             'nappy/wet'],
    ['both',            'nappy/both'],
    ['pee + poo',       'nappy/wet | nappy/dirty'],
    ['3.4kg',           'measure/weight 3.4 kg'],
    ['head 35cm',       'measure/head 35 cm'],
    ['50cm',            'measure/length 50 cm'],
    ['temp 37.8',       'measure/temp 37.8 C'],
    ['30ml then down',  'feed/bottle 30 ml | sleep/start'],
    ['no',              'undo'],
    ['rash on cheek',   'UNMATCHED']
  ];

  var out = [];
  cases.forEach(function (c) {
    var r = parseMessage(c[0], now);
    var got = r.matched
      ? r.events.map(function (e) {
          return e.type + (e.subtype ? '/' + e.subtype : '') +
                 (e.value !== '' ? ' ' + e.value : '') + (e.unit ? ' ' + e.unit : '');
        }).join(' | ')
      : 'UNMATCHED';
    out.push((got === c[1] ? 'ok   ' : 'FAIL ') + JSON.stringify(c[0]) +
             ' → ' + got + (got === c[1] ? '' : '   expected: ' + c[1]));
  });

  // Retrospective timestamps
  var shift = parseMessage('down -20', now);
  out.push((Math.round((now - shift.events[0].ts) / 60000) === 20 ? 'ok   ' : 'FAIL ') +
           '"down -20" → 20 min ago');
  var at = parseMessage('up @0214', now);
  out.push((new Date(at.events[0].ts).getHours() === 2 ? 'ok   ' : 'FAIL ') +
           '"up @0214" → 02:14');

  console.log(out.join('\n'));
  return out.join('\n');
}
