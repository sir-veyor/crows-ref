'use strict';
/* Crows Ref Tool — all game content comes from data.js (window.CROWS_DATA). */
const D = window.CROWS_DATA;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = s => String(s ?? '').replace(/<[^>]+>/g, '');
const norm = s => strip(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const uid = () => Math.random().toString(36).slice(2, 9);
function rnd(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return 1 + (a[0] % n); }

/* ---------------- state ---------------- */
const KEY = 'crowsRef.v1';          // never change this key — it is where everyone's saves live
const BACKUP_KEY = 'crowsRef.backup'; // automatic copy taken before any save-format upgrade
const SAVE_VERSION = 3;              // bump only when the save format changes, and add a step to migrate()
const DEFAULT = () => ({
  settings: { dtMin: 30, sound: true, mode: 'timer' },
  v: 2, lastExport: 0,
  dt: { num: 0, running: false, endAt: 0, left: 30 * 60000, alerted: 0, rooms: 0, roomsDone: 0 },
  en: { ctx: 'dungeon', crowded: false, chaos: false, seclude: false, pace: 'normal', scout: false, other: 0, table: '' },
  ud: [], combat: { round: 0, pcsFirst: null, phase: 0, list: [] },
  log: [], notes: { session: '', campaign: '' }, roster: [], progress: {}, pins: [], recent: [], tmods: {},
  travel: { pace: 'normal', slow: 'normal', road: false, river: false, down: false, roles: [], lost: false, enx: 0, day: 1 },
  enc: { dtype: 'Any', habitat: 'Forest', nearby: 'Undead', climate: 'Spring', party: 4, cur: null, history: [], autogen: null },
  rest: { where: 'miasma', day: 1, pcs: {}, log: [] },
  test: { mod: 0, edges: 0, banes: 0, bonus: 0, effort: false },
});
let S;
function migrate(s) {
  // Upgrades older saves in place. Only ever ADD fields here; never delete a player's data.
  if (!s.v || s.v < 2) { s.lastExport = s.lastExport || 0; }
  if (s.v < 3) { s.travel = s.travel || {}; s.travel.roles = s.travel.roles || []; }  // v3: encounter hub, rest tab, travel roles board
  s.v = SAVE_VERSION;
  return s;
}
function load() {
  let raw = null, s = null;
  try { raw = localStorage.getItem(KEY); s = JSON.parse(raw || 'null'); } catch (e) { s = null; }
  const d = DEFAULT();
  if (!s) { if (raw) try { localStorage.setItem(KEY + '.unreadable-' + Date.now(), raw); } catch (e) { } return d; }
  if ((s.v || 1) < SAVE_VERSION) { try { localStorage.setItem(BACKUP_KEY, raw); } catch (e) { } s = migrate(s); }
  for (const k in d) if (s[k] === undefined) s[k] = d[k];
  for (const k of ['settings', 'dt', 'en', 'combat', 'notes', 'travel', 'test', 'enc', 'rest']) s[k] = Object.assign(d[k], s[k]);
  return s;
}
S = load();
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }, 150); }

/* ---------------- dice ---------------- */
function rollExpr(expr) {
  const e = String(expr).replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9d+\-]+$/.test(e)) return null;
  let total = 0; const parts = [];
  for (const m of e.matchAll(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g)) {
    if (m[3]) {
      const n = +(m[2] || 1), f = +m[3], sg = m[1] === '-' ? -1 : 1;
      const rs = []; for (let i = 0; i < Math.min(n, 100); i++) rs.push(rnd(f));
      total += sg * rs.reduce((a, b) => a + b, 0); parts.push(`${m[1] || ''}${n}d${f}[${rs.join(',')}]`);
    } else if (m[5]) { const v = +m[5] * (m[4] === '-' ? -1 : 1); total += v; parts.push((v < 0 ? '' : '+') + v); }
  }
  return { total, text: parts.join(' ') };
}

/* ---------------- log & toast ---------------- */
function addLog(html, opts = {}) {
  S.log.unshift({ t: Date.now(), h: html }); S.log = S.log.slice(0, 150); save();
  if (!$('#logPanel').hidden) renderLog();
  if (!opts.quiet) toast(html);
  const sl = $('#sessionLog'); if (sl) sl.innerHTML = logHTML(8);
}
function logHTML(n) {
  return S.log.slice(0, n).map(l => `<div class="logitem"><div class="when">${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>${l.h}</div>`).join('') || '<p class="muted">No rolls yet.</p>';
}
function renderLog() { $('#logBody').innerHTML = logHTML(150); }
function toast(html, ms = 4500) {
  const t = document.createElement('div'); t.className = 'tt'; t.innerHTML = html;
  $('#toast').appendChild(t); setTimeout(() => t.remove(), ms);
  while ($('#toast').children.length > 3) $('#toast').firstChild.remove();
}

/* ---------------- indexes ---------------- */
const MON = {}, MON_BY_NAME = {}, ITEM = {}, ITEM_BY_NAME = {}, TBL = {}, TBL_BY_NAME = {}, HEAD = {}, PLACE = {};
D.monsters.forEach(m => {
  MON[m.id] = m;
  MON_BY_NAME[norm(m.name)] = m;
  MON_BY_NAME[norm(m.name.replace(/\s*\(Power.*\)/, ''))] ??= m;
  const rev = m.name.match(/^(.*), (.*)$/); if (rev) MON_BY_NAME[norm(rev[2] + ' ' + rev[1])] = m;
  m.atkFix = m.attacks.map(a => { if (/^dam/.test(a.t2) && /\d+$/.test(a.r)) { const n = a.r.match(/(\d+)$/)[1]; return { n: a.n, r: a.r.replace(/\s*\d+$/, ''), t2: n + ' ' + a.t2.split(/\s+(?=\d)/)[0], t3: a.t2.split(/\s+(?=\d)/).slice(1).join(' ') }; } return a; });
});
D.items.forEach(c => {
  ITEM[c.id] = c; const n = norm(c.name);
  ITEM_BY_NAME[n] = c; if (c.rank != null) ITEM_BY_NAME[n + ' spellbook'] = c;
});
D.tables.forEach(t => {
  TBL[t.gid] = t;
  const k = tkey(t.name); if (!TBL_BY_NAME[k]) TBL_BY_NAME[k] = t;
});
function tkey(s) { return norm(s).replace(/[?’'.]/g, '').replace(/\b(dungeon|table|the)\b/g, '').replace(/\s+/g, ' ').trim(); }
D.places.forEach(p => { PLACE[p.id] = p; p.areas.forEach(a => PLACE[a.id] = p); });
const CHAPTERS = {};
for (const [key, bk] of Object.entries(D.books)) {
  const ch = []; let cur = { start: 0, title: bk.title };
  bk.blocks.forEach((b, i) => {
    if (b.t === 'h') { HEAD[b.id] = { book: key, i, b }; if (b.lvl === 1) { if (i > 0) { cur.end = i; ch.push(cur); } cur = { start: i, title: b.text, id: b.id }; } }
  });
  cur.end = bk.blocks.length; ch.push(cur);
  CHAPTERS[key] = ch;
}
function chapterOf(key, i) { return CHAPTERS[key].find(c => i >= c.start && i < c.end) || CHAPTERS[key][0]; }

// condition glossary from Rules
const CONDS = {};
(() => {
  const bl = D.books.rules.blocks; let on = false, cur = null;
  for (const b of bl) {
    if (b.t === 'h' && b.lvl === 1) { on = b.text === 'Conditions'; cur = null; continue; }
    if (!on) continue;
    if (b.t === 'h') { cur = b.text.toLowerCase(); CONDS[cur] = { id: b.id, text: '' }; }
    else if (cur && b.t === 'p') CONDS[cur].text += strip(b.text) + ' ';
  }
  CONDS.surprised = { id: HEAD['rules-surprised'] ? 'rules-surprised' : null, text: 'Surprised creatures can’t take a turn and attacks against them gain an edge. After the first round of combat, surprised creatures are no longer surprised.' };
})();
const COND_NAMES = ['blessed', 'grabbed', 'prone', 'vulnerable', 'weakened', 'unconscious', 'surprised'];
const DT_CONDS = ['blessed', 'vulnerable', 'weakened'];

/* ---------------- text formatting / linkify ---------------- */
const TIER_LBL = { 1: '≤11', 2: '12–16', 3: '17+' };
const LETTERED = /\b(angels?|blood creatures?|demons?|plants?|undead)\s+([A-J])\b(?![a-z])/g;
const TNAMES = D.tables.map(t => t.name).filter(n => n.length >= 9 && !/^What/.test(n)).sort((a, b) => b.length - a.length);
const TNAME_RE = new RegExp('\\b(' + [...new Set(TNAMES)].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');
const COND_RE = /\b(blessed|grabbed|prone|vulnerable|weakened|unconscious)\b/gi;
function monIdForLettered(type, letter) {
  const t = type.toLowerCase().replace(/s$/, '').replace('blood creature', 'blood-creature');
  const id = `m-${t}-${letter.toLowerCase()}`;
  return MON[id] ? id : null;
}
function linkText(t, opts) {
  t = t.replace(LETTERED, (m, a, b) => { const id = monIdForLettered(a, b); return id ? `<span class="mlink" data-m="${id}">${m}</span>` : m; });
  if (!opts.noTables) t = t.replace(TNAME_RE, (m) => { const tb = TBL_BY_NAME[tkey(m)]; return tb && tb.gid !== opts.selfTable ? `<span class="tlink" data-t="${tb.gid}">${m}</span>` : m; });
  if (!opts.noConds) t = t.replace(COND_RE, (m) => { const c = CONDS[m.toLowerCase()]; return c ? `<span class="cond" title="${esc(c.text.trim())}">${m}</span>` : m; });
  return t;
}
function fmt(html, opts = {}) {
  if (!html) return '';
  let s = String(html);
  // tier glyphs
  let first = true;
  s = s.replace(/<g>\s*(\d)\s*<\/g>/g, (m, n) => { const out = (first ? '' : '<br>') + `<span class="g g${n}">${TIER_LBL[n] || n}</span>`; first = false; return out; });
  // linkify only text outside tags (and outside existing spans we create)
  const parts = s.split(/(<[^>]+>)/);
  let depth = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) { if (/^<span class="g/.test(p)) depth++; else if (p === '</span>' && depth) depth--; continue; }
    if (!depth && p) parts[i] = linkText(p, opts);
  }
  s = parts.join('');
  // bold item / monster names
  s = s.replace(/<i>([^<]{3,48})<\/i>/g, (m, inner) => {
    const k = norm(inner).replace(/^(a|an|the|\d+)\s+/, '').replace(/[.,:;]$/, '');
    const it = ITEM_BY_NAME[k] || ITEM_BY_NAME[k.replace(/s$/, '')];
    return it ? `<i><span class="ilink" data-i="${it.id}">${inner}</span></i>` : m;
  });
  s = s.replace(/<b>([^<]{3,48})<\/b>/g, (m, inner) => {
    const k = norm(inner).replace(/^(a|an|the|\d+)\s+/, '').replace(/[.,:;]$/, '');
    const it = ITEM_BY_NAME[k] || ITEM_BY_NAME[k.replace(/s$/, '')] || ITEM_BY_NAME[k.replace(/es$/, '')];
    if (it) return `<b><span class="ilink" data-i="${it.id}">${inner}</span></b>`;
    const mo = MON_BY_NAME[k] || MON_BY_NAME[k.replace(/s$/, '')];
    if (mo) return `<b><span class="mlink" data-m="${mo.id}">${inner}</span></b>`;
    return m;
  });
  if (opts.rules) s = ruleLinkHTML(s);
  return s;
}

/* ---------------- rules-term linking (item & spell cards) ---------------- */
const RULE_TERMS = [
  [/\bLight\s+\d+\/\d+/, 'rules-light'], [/\b(?:bright light|dim light|darkness)\b/i, 'rules-light'],
  [/\bP dam\b/, 'rules-piercing-damage'], [/\bpiercing damage\b/i, 'rules-piercing-damage'],
  [/\bAD\b/, 'rules-armor-defense'], [/\bUD\b/, 'rules-equipment-usage-dice'], [/\busage dice\b/i, 'rules-usage-dice'],
  [/\b(?:Useless|Refuel|Activate)\b/, 'rules-equipment-usage-dice'],
  [/\b[Mm]aneuvers?\b/, 'rules-maneuvers'], [/\b[Rr]eactions?\b/, 'rules-reactions'], [/\b[Aa]ctions?\b/, 'rules-actions'],
  [/\b(?:Melee|Ranged) \d+(?:\/Ranged \d+)?/, 'rules-making-attacks'], [/\bAttack\b/, 'rules-making-attacks'],
  [/\bRRs?\b/, 'rules-resistance-rolls'], [/\b(?:double edge|double bane|edges?|banes?)\b/, 'rules-edges-and-banes'],
  [/\b(?:crits?|dooms?)\b/, 'rules-crits-and-dooms'], [/\bEffort\b/, 'rules-effort-expertise'], [/\bexpertises?\b/, 'rules-effort-expertise'],
  [/\bwounds?\b/, 'rules-wounds'], [/\bStamina\b/, 'rules-stamina'],
  [/\b(?:[Vv]ertical )?(?:[Pp]ush|[Ss]lide) \d+/, 'rules-forced-movement'], [/\bteleport(?:s|ed|ing)?\b/i, 'rules-teleporting'],
  [/\bdifficult terrain\b/i, 'rules-difficult-terrain'], [/\bopportunity attacks?\b/i, 'rules-opportunity-attack'],
  [/\bcounters?\b/, 'rules-counter'], [/\bflank(?:s|ing)?\b/, 'rules-flanking'], [/\bhigh ground\b/, 'rules-high-ground'],
  [/\bcover\b/, 'rules-cover'], [/\bline of effect\b/i, 'rules-line-of-effect'], [/\b(?:hidden|hide|sneak)\b/, 'rules-hide-and-sneak'],
  [/\b(?:Aura|Cube) \d+|\bLine \d+ ?× ?\d+/, 'rules-area-of-effect'], [/\bmagic item slots?\b|\bwearable\b/i, 'rules-magic-item-slots'],
  [/\bsummon(?:s|ed)?\b/i, 'rules-summoned-creatures'], [/\bbacklash(?:es)?\b/i, 'rules-magic-backlashes'],
  [/\b(?:blessed|grabbed|prone|vulnerable|unconscious|weakened)\b/i, 'COND'],
];
const RULE_RE = new RegExp(RULE_TERMS.map(t => '(?:' + t[0].source + ')').join('|'), 'g');
const RULE_TIP = {};
function ruleTip(id) {
  if (RULE_TIP[id] != null) return RULE_TIP[id];
  const h = HEAD[id]; let t = '';
  if (h) { const bl = D.books[h.book].blocks; for (let j = h.i + 1; j < bl.length && t.length < 240; j++) { if (bl[j].t === 'h' && t) break; if (bl[j].t === 'p') t += strip(bl[j].text) + ' '; } }
  return RULE_TIP[id] = t.trim().slice(0, 260) + (t.length > 260 ? '…' : '');
}
function ruleIdFor(m) {
  for (const [re, id] of RULE_TERMS) if (new RegExp('^(?:' + re.source + ')$', re.flags.replace('g', '')).test(m)) return id === 'COND' ? 'rules-' + m.toLowerCase() : id;
  return null;
}
function rlink(text, id, tip) { return HEAD[id] ? `<span class="rlink" data-h="${id}" title="${esc(tip ?? ruleTip(id))}">${text}</span>` : text; }
const WEAPON_TYPES = ['bashing', 'bow', 'chopping', 'slashing', 'stabbing', 'unarmed'];
function qualityLinks(inner) {
  // "Bashing, Light, Pummeling" / "Parry 6" -> each linked to Weapon Types / Weapon Qualities
  const parts = inner.split(/(,\s*)/);
  let any = false;
  const out = parts.map(p => {
    const key = p.trim().replace(/\s+(?:\d+|X)$/, '').toLowerCase();
    if (!key || /^,/.test(p)) return p;
    if (WEAPON_TYPES.includes(key) && HEAD['chars-weapon-types']) { any = true; return rlink(p, 'chars-weapon-types', QUAL[key] || 'Weapon type: decides which weapon expertise applies.'); }
    if (QUAL[key] && HEAD['chars-weapon-qualities']) { any = true; return rlink(p, 'chars-weapon-qualities', QUAL[key]); }
    return p;
  });
  return any ? out.join('') : null;
}
// apply fn to plain text that is not already inside a <span>
function mapText(html, fn) {
  const parts = String(html).split(/(<[^>]+>)/); let depth = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) { if (/^<span\b/.test(p)) depth++; else if (p === '</span>' && depth) depth--; continue; }
    if (!depth && p) parts[i] = fn(p);
  }
  return parts.join('');
}
function ruleLinkHTML(html) {
  let s = String(html).replace(/<i>([^<]+)<\/i>/g, (m, inner) => { const q = qualityLinks(inner); return q ? `<i>${q}</i>` : m; });
  s = mapText(s, t => t.replace(RULE_RE, m => { const id = ruleIdFor(m); return id ? rlink(m, id) : m; }));
  return s;
}

/* ---------------- block rendering ---------------- */
function tierHTML(b) {
  return `<div class="tiers">${b.roll ? `<div class="rollh">${esc(b.roll)}</div>` : ''}${b.cells.map((c, i) => `<div class="c c${i + 1}"><span class="h">${TIER_LBL[i + 1]}</span>${fmt(c)}</div>`).join('')}</div>`;
}
function isHeaderRow(r) { return r[0].startsWith('<b>') && r.every(c => c === '' || c.startsWith('<b>')); }
function parseRange(c) {
  const s = strip(c).replace(/[–—]/g, '-').replace(/\s/g, '').replace(/orlower|orless/i, '');
  const m = s.match(/^(-?\d+)(?:-(-?\d*))?(\+)?$/); if (!m) return null;
  const a = +m[1]; if (m[3]) return [a, 999];
  return [a, m[2] ? +m[2] : a];
}
function tableHTML(b) {
  const g = b.group, t = g ? TBL[g] : null;
  let h = `<table${g ? ` data-g="${g}"` : ''}>`;
  b.rows.forEach((r, ri) => {
    if (ri === 0 && isHeaderRow(r)) {
      h += '<tr>' + r.map((c, ci) => {
        if (ci === 0 && t && !b.cont) {
          const mod = t.mod ? `<span class="sm"> + ${esc(t.mod)}</span><input class="modin" type="number" data-g="${g}" value="${S.tmods[g] || 0}" title="${esc(t.mod)}">` : '';
          return `<th><button class="rollbtn" data-g="${g}" title="Roll on this table">🎲 ${esc(strip(c).replace(/\+$/, '').trim())}</button>${mod}</th>`;
        }
        return `<th>${fmt(c, { noConds: true })}</th>`;
      }).join('') + '</tr>';
      return;
    }
    let attr = '';
    if (t) {
      const rg = parseRange(r[0]);
      if (rg) attr = t.two ? ` data-lo="${rg[0]}" data-b="${strip(r[1])}"` : ` data-lo="${rg[0]}" data-hi="${rg[1]}"`;
    }
    h += `<tr${attr}>` + r.map(c => `<td>${fmt(c, { selfTable: g })}</td>`).join('') + '</tr>';
  });
  return h + '</table>';
}
function blocksHTML(blocks, opts = {}) {
  let h = '';
  for (const b of blocks) {
    if (b.t === 'h') {
      const lv = Math.min(5, Math.max(1, b.lvl + (opts.shift || 0)));
      const pl = PLACE[b.id];
      const isArea = pl && pl.id !== b.id;
      const prog = isArea ? (S.progress[b.id] || {}) : null;
      h += `<h${lv} id="${b.id}" class="${prog && (prog.c || prog.l) ? 'done-h' : ''}">${esc(b.text)}<span class="pg">p.${b.page}</span></h${lv}>`;
      if (isArea && !opts.noTrack) h += areaTrackHTML(b.id);
      if (pl && pl.id === b.id && !opts.noTrack) h += placeBarHTML(pl);
    } else if (b.t === 'p') h += `<p>${fmt(b.text)}</p>`;
    else if (b.t === 'tier') h += tierHTML(b);
    else if (b.t === 'table') h += tableHTML(b);
  }
  return h;
}
function areaTrackHTML(id) {
  const p = S.progress[id] || {};
  const box = (k, l) => `<label><input type="checkbox" data-area="${id}" data-k="${k}" ${p[k] ? 'checked' : ''}> ${l}</label>`;
  return `<div class="area-track">${box('e', 'Explored')}${box('l', 'Looted')}${box('c', 'Cleared')}<input type="text" placeholder="Note…" data-area="${id}" data-k="n" value="${esc(p.n || '')}"></div>`;
}
function placeBarHTML(pl) {
  const n = pl.areas.length; if (!n && pl.kind !== 'Dungeon') return '';
  const done = pl.areas.filter(a => (S.progress[a.id] || {}).e).length;
  const map = MAPS[pl.name] ? `<button class="btn sm" data-map="${esc(pl.name)}">🗺 Show map</button>` : '';
  return `<div class="place-bar"><div class="row"><b>${esc(pl.kind)}: ${esc(pl.name)}</b><span class="sp"></span><span class="muted sm" data-placeprog="${pl.id}">${done}/${n} areas explored</span>${map}<button class="btn sm" data-resetplace="${pl.id}">Reset progress</button></div><div class="progress"><div style="width:${n ? Math.round(done / n * 100) : 0}%"></div></div></div>`;
}

/* ---------------- stat blocks & cards ---------------- */
function statBlockHTML(m, opts = {}) {
  const sg = [['Stamina', m.stamina], ['AD', m.ad], ['Speed', m.speed], ['Slots', m.slots], ['Reactions', m.reactions], ['Agility', m.agi], ['Mind', m.mind], ['Strength', m.str]]
    .filter(x => x[1] != null && x[1] !== '').map(x => `<div><b>${x[0]}</b>${esc(x[1])}</div>`).join('');
  const atk = m.atkFix.length ? `<table class="atk"><tr><th>Attack <span class="faint sm">(click to roll)</span></th><th>Range</th><th>12–16</th><th>17+</th></tr>${m.atkFix.map((a, i) => `<tr class="clk" data-atk="${m.id}" data-i="${i}"><td><b>${esc(a.n)}</b></td><td>${esc(a.r)}</td><td>${fmt(esc(a.t2))}</td><td>${fmt(esc(a.t3))}</td></tr>`).join('')}</table>` : '';
  const desc = m.desc ? `<details ${opts.openDesc ? 'open' : ''}><summary class="muted sm">Description &amp; names</summary><div class="desc">${m.desc.map(p => `<p>${fmt(p)}</p>`).join('')}</div></details>` : '';
  return `<div class="stat" data-mon="${m.id}">
    <div class="row"><p class="nm">${opts.link ? `<a href="#/monster/${m.id}">${esc(m.name)}</a>` : esc(m.name)}</p><span class="sp"></span><span class="badge">${esc(m.group)}</span></div>
    <div class="sub">${esc(m.size || '')} ${esc(m.type || '')} · Power ${esc(m.power)} · <span class="faint">The Ref p.${m.page}</span></div>
    <div class="sg">${sg}</div>
    ${m.equipment ? `<div class="sm"><b>Equipment:</b> ${fmt(m.equipment)}</div>` : ''}
    ${atk}<div class="ab">${blocksHTML(m.abilities)}</div>${desc}
    ${opts.actions !== false ? `<div class="row" style="margin-top:8px"><button class="btn sm" data-addcombat="${m.id}">+ Add to combat</button>${pinBtn('monster', m.id, m.name)}</div>` : ''}
  </div>`;
}
function pinBtn(kind, id, label) {
  const on = S.pins.some(p => p.kind === kind && p.id === id);
  return `<button class="btn sm ${on ? 'on' : ''}" data-pin="${kind}|${id}|${esc(label)}">${on ? '★ Pinned' : '☆ Pin'}</button>`;
}
function itemExtra(c) {
  if (c.rank != null) return [c.disc, c.cast, 'Rank ' + c.rank].filter(Boolean).join(' · ');
  return c.extra || '';
}
function itemCardHTML(c, opts = {}) {
  const body = c.body.map(x => {
    const fo = { noTables: true, noConds: true, rules: opts.rules !== false };
    if (x[0] === 'p') return `<p>${fmt(x[1], fo)}</p>`;
    const hd = x[1], cells = x[2];
    return `<div class="tiers" style="grid-template-columns:repeat(${hd.length},1fr)">${hd.map((hh, i) => `<div class="c c${hd.length === 2 ? i + 2 : i + 1}"><span class="h">${esc(hh)}</span>${fmt(cells[i] || '', fo)}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="icard ${c.magic ? 'magic' : ''}">
    <div class="in">${opts.link ? `<a href="#/item/${c.id}">${esc(c.name)}</a>` : esc(c.name)}${c.stack ? `<span class="stk">${rlink('Stack ' + esc(c.stack), 'rules-inventory-slots', 'How many of this item fit in one inventory slot.')}</span>` : ''}</div>
    ${itemExtra(c) ? `<div class="ex">${c.rank != null ? [c.disc ? rlink(esc(c.disc), 'rules-discipline') : '', c.cast ? rlink(esc(c.cast), 'rules-casting-time') : '', rlink('Rank ' + c.rank, 'rules-rank')].filter(Boolean).join(' · ') : opts.rules !== false ? ruleLinkHTML(esc(itemExtra(c)).replace(/(Occupies \d+ Slots)/, '<i>$1</i>')).replace(/<i>(Occupies \d+ Slots)<\/i>/, (m, x) => rlink(x, 'rules-inventory-slots')) : esc(itemExtra(c))}</div>` : ''}
    ${body}
    <div class="pr">${c.cat ? esc(c.cat) + ' · ' : ''}${esc(c.price || '—')}</div>
    ${opts.noCraft ? '' : craftLine(craftFor(c))}
    ${c.found ? `<div class="ex">Dungeon cards: ${c.found.map(esc).join(', ')}</div>` : ''}
  </div>${opts.actions !== false ? `<div class="row" style="margin-top:6px">${pinBtn('item', c.id, c.name)}</div>` : ''}`;
}

/* ---------------- crafting ---------------- */
const CRAFT = {};
function craftKey(n) { let k = norm(String(n).replace(/&amp;/g, '&')).replace(/\*/g, '').replace(/\s*\([^)]*\)/g, '').trim(); const m = k.match(/^(.*), (strong|greater)$/); if (m) k = m[2] + ' ' + m[1]; return k; }
(D.craft || []).forEach(r => {
  const k = craftKey(r.name); const vm = k.match(/^(fine|masterwork) (.*)$/);
  if (r.src === 'Upgraded Armor' || /armor|shield/i.test(r.name)) r.exp = r.exp || 'Blacksmithing';
  if (vm) { const base = CRAFT[vm[2]] ||= { variants: [] }; base.variants = base.variants || []; base.variants.push(Object.assign({ q: vm[1][0].toUpperCase() + vm[1].slice(1) }, r)); }
  else { const cur = CRAFT[k]; CRAFT[k] = Object.assign({ variants: cur ? cur.variants || [] : [] }, r); }
});
const CRAFT_NS = {}; for (const [k, v] of Object.entries(CRAFT)) CRAFT_NS[k.replace(/\s+/g, '')] = v;
const dash = v => !v || v === '-';
function craftFor(c) {
  if (c.cat === 'Spellbook') return null;
  const k = craftKey(c.name);
  let r = CRAFT[k] || CRAFT[craftKey(c.name.replace(/^(MW|Fine)\s+/, ''))] || CRAFT_NS[k.replace(/\s+/g, '')] || CRAFT[k + ' vial'];
  if (!r && (c.cat === 'Weapon' || /Quiver|Crossbow Bolts/.test(c.name)) && c.src !== 'dungeon') {
    const bow = /\bBow\b/.test(JSON.stringify(c.body)) && !/Quiver|Bolts/.test(c.name);
    r = { exp: 'Blacksmithing', cx: '1', mat: bow ? '1 hickory log' : '1 iron bar', goal: '5', rule: true, variants: [] };
  }
  return r || null;
}
function craftLine(r) {
  if (!r) return '';
  const can = !dash(r.cx) || !dash(r.mat);
  const v = (r.variants || []).map(x => `<div>${esc(x.q)} (${esc(x.price)}): ${dash(x.cx) ? 'buy only' : `${esc(x.exp && !dash(x.exp) ? x.exp : r.exp)} · complexity ${esc(x.cx)} · ${esc(x.mat)} · goal ${esc(x.goal)}`}</div>`).join('');
  return `<div class="craft">${can ? `<b>⚒ Craft:</b> ${esc(dash(r.exp) ? 'no expertise listed' : r.exp)} · complexity ${esc(r.cx)} · ${esc(r.mat)} · goal ${esc(r.goal)}${r.rule ? ' <span class="faint">(standard weapon rule)</span>' : ''}` : '<span class="faint">Not craftable — buy or find it</span>'}${v}</div>`;
}

/* ---------------- table rolling ---------------- */
function rollTable(gid, opts = {}) {
  const t = TBL[gid]; if (!t) return null;
  let res, die, label;
  if (t.two) {
    const a = rnd(6), b = rnd(6);
    res = t.rows.find(r => r.r[0] === a && strip(r.c[0]) === String(b)); die = `${a}, ${b}`;
    label = `d6 ${a} / d6 ${b}`;
  } else {
    const f = +t.die.replace(/^\d*d/, ''); const n = /^2d/.test(t.die) ? rnd(f) + rnd(f) : rnd(f);
    const mod = t.mod ? (+S.tmods[gid] || 0) : 0;
    let v = n + mod;
    const lo = Math.min(...t.rows.map(r => r.r[0])), hi = Math.max(...t.rows.map(r => r.r[1] > 900 ? r.r[0] : r.r[1]));
    const vv = Math.max(lo, Math.min(v, hi + 1000));
    res = t.rows.find(r => vv >= r.r[0] && vv <= r.r[1]) || (vv < lo ? t.rows[0] : t.rows[t.rows.length - 1]);
    die = v; label = `${t.die} ${n}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)} ${esc(t.mod)} = ${v}` : ''}`;
  }
  // highlight in rendered tables
  $$(`table[data-g="${gid}"] tr`).forEach(tr => tr.classList.remove('hit'));
  if (res) {
    const sel = t.two ? `table[data-g="${gid}"] tr[data-lo="${res.r[0]}"][data-b="${strip(res.c[0])}"]` : `table[data-g="${gid}"] tr[data-lo="${res.r[0]}"]`;
    const tr = $$(sel)[0];
    if (tr) { tr.classList.add('hit'); if (opts.scroll) tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  const cells = res ? res.c.filter(c => strip(c) !== '' && !(t.two && c === res.c[0])) : [];
  const out = cells.map(c => fmt(c, { selfTable: gid })).join(' — ');
  const html = `<b><span class="tlink" data-t="${gid}">${esc(t.name)}</span></b> <span class="faint">(${label})</span><br>${out || '<i>no matching row</i>'} ${followups(cells)}`;
  addLog(html, { quiet: opts.quiet });
  return { t, res, html, die };
}
function followups(cells) {
  const txt = strip(cells.join(' '));
  const btns = [];
  for (const t of D.tables) {
    const k = tkey(t.name);
    if (k.length > 5 && tkey(txt).includes(k.replace(/ encounters?$/, '')) && /encounter/i.test(t.name) && !btns.includes(t.gid) && /^(angel|blood|demon|plant|undead|any monster)/.test(k)) btns.push(t.gid);
  }
  return btns.slice(0, 2).map(g => `<button class="btn sm" data-rollt="${g}">🎲 ${esc(TBL[g].name)}</button>`).join(' ');
}

/* ---------------- tests ---------------- */
function tierOf(total) { return total <= 11 ? 1 : total <= 16 ? 2 : 3; }
function netEdges(e, b) { // returns {add, shift}
  e = Math.min(e, 2); b = Math.min(b, 2);
  if (e && b) { if (e === 2 && b === 1) return { add: 2, shift: 0, txt: 'edge' }; if (b === 2 && e === 1) return { add: -2, shift: 0, txt: 'bane' }; return { add: 0, shift: 0, txt: 'cancel' }; }
  if (e === 2) return { add: 0, shift: 1, txt: 'double edge' }; if (e === 1) return { add: 2, shift: 0, txt: 'edge' };
  if (b === 2) return { add: 0, shift: -1, txt: 'double bane' }; if (b === 1) return { add: -2, shift: 0, txt: 'bane' };
  return { add: 0, shift: 0, txt: '' };
}
function doTest({ mod = 0, edges = 0, banes = 0, bonus = 0, effort = false, label = 'Test' }) {
  const a = rnd(10), b = rnd(10), nat = a + b;
  const ne = netEdges(edges, banes);
  const total = nat + mod + bonus + ne.add;
  let tier = tierOf(total); tier = Math.max(1, Math.min(3, tier + ne.shift));
  const crit = nat >= 19, doom = nat <= 3;
  if (crit) tier = 3; if (doom) tier = 1;
  let eff = '';
  if (effort && !doom && tier < 3) { tier++; eff = ' +1 tier (Effort)'; }
  const html = `<b>${esc(label)}</b>: [${a}, ${b}] = ${nat}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)}` : ''}${bonus ? ` ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}` : ''}${ne.add ? ` ${ne.add > 0 ? '+2 edge' : '−2 bane'}` : ''} = <b>${total}</b>${ne.shift ? ` (${ne.txt})` : ''}${eff} → <span class="tierlbl t${tier}">Tier ${tier}</span>${crit ? ' <span class="crit">CRIT!</span>' : ''}${doom ? ' <span class="doom">DOOM!</span>' : ''}`;
  return { nat, total, tier, crit, doom, html };
}
function rollAttack(mid, i) {
  const m = MON[mid], a = m.atkFix[i]; if (!a) return;
  const bonus = +((a.n.match(/\(([+-]?\d+)\)/) || [])[1] || 0);
  const r = doTest({ mod: bonus, label: `${m.name} — ${a.n.replace(/\*$/, '')}` });
  const dmg = r.tier === 1 ? (r.doom ? 'Miss — <b>doom</b>: target can counter (tier 3 counter damage)' : 'Miss — melee target can counter') : r.tier === 2 ? a.t2 : a.t3;
  addLog(`${r.html}<br>${r.tier > 1 ? 'Hit: <b>' + fmt(esc(dmg)) + '</b>' : dmg}${r.crit ? ' · crit grants another action' : ''}`);
}

/* ---------------- drawer ---------------- */
let drawerState = null;
function openDrawer(kind, id) {
  const body = $('#drawerBody'); let title = '', url = '';
  if (kind === 'monster') { const m = MON[id]; if (!m) return; title = m.name; url = `#/monster/${id}`; body.innerHTML = statBlockHTML(m, { openDesc: true }); remember('monster', id, m.name); }
  else if (kind === 'item') { const c = ITEM[id]; if (!c) return; title = c.name; url = `#/item/${id}`; body.innerHTML = itemCardHTML(c); remember('item', id, c.name); }
  else if (kind === 'table') {
    const t = TBL[id]; if (!t) return; title = t.name; url = `#/book/${t.book}/${t.hid}`;
    const blocks = D.books[t.book].blocks.filter(b => b.group === id);
    const intro = HEAD[t.hid] ? sectionBlocks(t.book, HEAD[t.hid].i).filter(b => b.t === 'p').slice(0, 3) : [];
    body.innerHTML = `<p class="muted sm">${esc(D.books[t.book].title)} · p.${HEAD[t.hid]?.b.page ?? ''}</p>${blocksHTML(intro)}${blocks.map(tableHTML).join('')}<div class="row">${pinBtn('table', id, t.name)}</div>`;
  }
  else if (kind === 'rule') {
    const h = HEAD[id]; if (!h) return; title = h.b.text; url = `#/book/${h.book}/${id}`;
    body.innerHTML = `<p class="muted sm">${esc(D.books[h.book].title)} · p.${h.b.page}</p>${blocksHTML(sectionBlocks(h.book, h.i), { noTrack: true })}<div class="row">${pinBtn('heading', id, h.b.text + ' (' + D.books[h.book].title + ')')}</div>`;
  }
  else if (kind === 'map') { title = id + ' map'; url = '#/map'; body.innerHTML = `<img src="${MAPS[id]}" style="width:100%;border-radius:8px" alt="${esc(id)} map"><p class="sm"><a href="${MAPS[id]}" target="_blank">Open full size</a></p>`; }
  drawerState = { kind, id, url };
  $('#drawerTitle').textContent = title; $('#drawerOpen').hidden = !url;
  $('#drawer').hidden = false; $('#logPanel').hidden = true; body.scrollTop = 0;
}
function closeDrawer() { $('#drawer').hidden = true; drawerState = null; }
function sectionBlocks(book, i) {
  const bl = D.books[book].blocks, h = bl[i]; const out = [h];
  for (let j = i + 1; j < bl.length; j++) { if (bl[j].t === 'h' && bl[j].lvl <= h.lvl) break; out.push(bl[j]); }
  return out;
}
function remember(kind, id, label) {
  S.recent = [{ kind, id, label }, ...S.recent.filter(r => !(r.kind === kind && r.id === id))].slice(0, 12); save();
}

/* ---------------- maps ---------------- */
const MAPS = { 'Blood Library': 'maps/blood-library.jpg', 'Cornath': 'maps/cornath.jpg' };
const HOTSPOTS = [
  ['Hall of Angels', 9.5, 13.9], ['Idyllic Village', 26.5, 19.9], ['Vacant Mine', 13.4, 26.1], ['Farcliffe', 13.4, 37.9], ['Cult Shrine', 54.6, 25.9],
  ['Liston', 71.5, 19.9], ['Godswound', 88.4, 13.9], ['Ruined Sawmill', 77.1, 37.9], ['PC Village', 49, 44.1], ['Sunken Village', 37.75, 55.9],
  ['Ruined Tower', 56.5, 55.9], ['Blood Library', 62.1, 61.9], ['Ruined Fort', 19, 67.9], ['Gadwick', 86.5, 68.1], ['Burrfield', 37.75, 79.9],
  ['Verdant Creche', 20.9, 85.9], ['Floating Manor', 92.1, 86.1]];

/* ---------------- search ---------------- */
let IDX = null;
function buildIndex() {
  IDX = [];
  for (const [key, bk] of Object.entries(D.books)) {
    const bl = bk.blocks;
    bl.forEach((b, i) => {
      if (b.t !== 'h') return;
      let txt = '';
      for (let j = i + 1; j < bl.length && txt.length < 1600; j++) {
        if (bl[j].t === 'h') break;
        const x = bl[j]; txt += ' ' + strip(x.t === 'table' ? x.rows.map(r => r.join(' ')).join(' ') : x.t === 'tier' ? (x.roll || '') + ' ' + x.cells.join(' ') : x.text);
      }
      IDX.push({ type: bk.title, title: b.text, sub: (b.path || []).join(' › '), text: (b.text + ' ' + txt).toLowerCase(), snip: txt.trim().slice(0, 140), url: `#/book/${key}/${b.id}`, w: 2 + (5 - Math.min(b.lvl, 5)) * 0.4 });
    });
  }
  D.monsters.forEach(m => IDX.push({ type: 'Monster', title: m.name, sub: `${m.group} · Power ${m.power}`, text: (m.name + ' ' + m.group + ' ' + m.type + ' ' + m.atkFix.map(a => a.n).join(' ') + ' ' + m.abilities.map(a => strip(a.text || '')).join(' ') + ' ' + (m.desc || []).map(strip).join(' ')).toLowerCase(), snip: (m.desc || []).map(strip).join(' ').slice(0, 140), act: ['monster', m.id], w: 4 }));
  D.items.forEach(c => IDX.push({ type: c.cat === 'Spellbook' ? 'Spell' : 'Item', title: c.name, sub: c.cat + (itemExtra(c) ? ' · ' + itemExtra(c) : '') + (c.price ? ' · ' + c.price : ''), text: (c.name + ' ' + c.cat + ' ' + itemExtra(c) + ' ' + c.body.map(x => strip(x[0] === 'p' ? x[1] : x[2].join(' '))).join(' ')).toLowerCase(), snip: strip(c.body.map(x => x[0] === 'p' ? x[1] : '').join(' ')).slice(0, 140), act: ['item', c.id], w: 3.5 }));
  D.tables.forEach(t => IDX.push({ type: 'Table', title: t.name, sub: `Roll ${t.die}${t.mod ? ' + ' + t.mod : ''} · ${D.books[t.book].title}`, text: (t.name + ' table roll ' + t.rows.map(r => r.c.join(' ')).join(' ')).toLowerCase().replace(/<[^>]+>/g, ''), snip: '', act: ['table', t.gid], w: 4.5 }));
  D.pregens.forEach(p => IDX.push({ type: 'Pregen', title: `Pregen ${p.num} (L${p.level}): ${p.desc}`, sub: `Level ${p.level}`, text: (p.desc + ' pregen ' + p.traits.join(' ')).toLowerCase(), snip: p.gen, url: `#/pregens/${p.level}#${p.id}`, w: 1.5 }));
  D.places.forEach(p => IDX.push({ type: 'Place', title: p.name, sub: p.kind, text: (p.name + ' ' + p.kind).toLowerCase(), snip: `${p.areas.length} areas`, url: `#/book/dungeons/${p.id}`, w: 6 }));
  D.changelog.forEach(c => IDX.push({ type: 'Changelog ' + c[0], title: `${c[2]}`, sub: c[1], text: (c[1] + ' ' + c[2] + ' ' + c[3]).toLowerCase(), snip: String(c[3]).slice(0, 140), url: `#/changelog/${encodeURIComponent(c[2])}`, w: 0.5 }));
}
function search(q, limit = 40) {
  if (!IDX) buildIndex();
  q = q.toLowerCase().trim(); if (!q) return [];
  const toks = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const e of IDX) {
    if (!toks.every(t => e.text.includes(t))) continue;
    const tl = e.title.toLowerCase();
    let s = e.w;
    if (tl === q) s += 100; else if (tl.startsWith(q)) s += 60; else if (tl.includes(q)) s += 35;
    s += toks.filter(t => tl.includes(t)).length * 8;
    out.push([s, e]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit).map(x => x[1]);
}
let qSel = 0, qList = [];
function renderQ() {
  const q = $('#q').value; const box = $('#qres');
  if (!q.trim()) { box.hidden = true; return; }
  qList = search(q, 14); qSel = 0;
  box.innerHTML = qList.map((e, i) => `<a href="${e.url || '#'}" data-qi="${i}" class="${i === 0 ? 'sel' : ''}"><span class="badge">${esc(e.type)}</span> <span class="t">${esc(e.title)}</span><div class="s">${esc(e.sub)}${e.snip ? ' — ' + esc(e.snip) : ''}</div></a>`).join('') + `<a href="#/search/${encodeURIComponent(q)}" data-qi="all"><span class="muted">See all results for “${esc(q)}” →</span></a>`;
  if (!qList.length) box.innerHTML = `<a class="muted">No results</a>`;
  box.hidden = false;
}
function openQ(e) {
  if (!e) return;
  $('#qres').hidden = true;
  if (e.act) openDrawer(e.act[0], e.act[1]); else location.hash = e.url;
}

/* ---------------- navigation ---------------- */
const NAV = [
  ['Play', [['session', '⏱', 'Session'], ['encounters', '👁', 'Encounters'], ['combat', '⚔', 'Combat'], ['travel', '🧭', 'Travel day'], ['rest', '⛺', 'Rest'], ['rollers', '🎲', 'Rollers'], ['cheat', '📋', 'Cheat sheet']]],
  ['Books', [['book/rules', '📕', 'Rules'], ['book/chars', '📗', 'Characters'], ['book/ref', '📘', 'The Ref'], ['book/dungeons', '🏚', 'Dungeons']]],
  ['Reference', [['monsters', '👹', 'Monsters'], ['items', '🎒', 'Items'], ['spells', '✨', 'Spells'], ['tables', '🎰', 'Random tables'], ['pregens', '🧍', 'Pregens'], ['map', '🗺', 'Map of Cornath'], ['changelog', '📝', 'Changelog']]],
  ['Campaign', [['notes', '✎', 'Notes & roster'], ['settings', '⚙', 'Settings & saves']]],
];
function renderNav() {
  const cur = location.hash.slice(2);
  $('#side').innerHTML = NAV.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([r, ic, l]) => `<a href="#/${r}" class="${cur === r || cur.startsWith(r + '/') ? 'on' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')).join('');
}
const VIEWS = {};
function route() {
  const h = decodeURIComponent(location.hash.slice(2) || 'session');
  const [view, ...rest] = h.split('/');
  renderNav(); document.body.classList.remove('nav-open');
  const fn = VIEWS[view] || VIEWS.session;
  $('#main').innerHTML = '';
  fn(rest);
  if (!/^book/.test(view)) window.scrollTo(0, 0);
}

/* ---------------- views: session ---------------- */
function fmtTime(ms) { const neg = ms < 0; ms = Math.abs(ms); const s = Math.round(ms / 1000); return (neg ? '−' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function dtLeft() { return S.dt.running ? S.dt.endAt - Date.now() : S.dt.left; }
function greed(n) { return n === 1 ? 30 : n === 2 ? 20 : n === 3 ? 10 : 0; }
VIEWS.session = () => {
  $('#main').innerHTML = `
  <div class="page-title"><h1>Session</h1><span class="muted">Dungeon turns, encounter checks, usage dice and your notes in one place.</span></div>
  ${(!S.lastExport || Date.now() - S.lastExport > 14 * 864e5) && (S.notes.campaign || S.roster.length || Object.keys(S.progress).length) ? `<div class="notice sm">Your game is saved in this browser only. <a href="#/settings">Export a backup</a> now and then${S.lastExport ? ` (last one: ${new Date(S.lastExport).toLocaleDateString()})` : ''}.</div>` : ''}
  <div class="grid dash">
    <div class="card" id="dtCard"></div>
    <div class="card" id="sessEnc"><div class="row"><h3 style="margin:0">Encounter check</h3><span class="sp"></span><a class="btn sm" href="#/encounters">Encounter hub →</a></div>
      ${enControlsHTML()}
      <button class="btn primary" id="enRoll">Encounter check</button>
      <div id="enOut"></div>
      <p class="sm muted">A hit gives you a “Generate it” button that opens the Encounter hub with what they meet, how they react, and their stat blocks.</p>
    </div>
    <div class="card" id="udCard"></div>
    <div class="card"><h3>Pinned &amp; recent</h3><div id="pins" class="pins"></div></div>
    <div class="card"><h3>Recent rolls</h3><div id="sessionLog">${logHTML(8)}</div></div>
    <div class="card"><h3>Session notes</h3><textarea id="sessNotes" placeholder="What happened, who owes whom, which doors are open…">${esc(S.notes.session)}</textarea></div>
  </div>`;
  renderDT(); renderUD(); renderPins();
  bindEnControls($('#sessEnc'));
  $('#enRoll').onclick = () => encounterCheck($('#enOut'));
  $('#sessNotes').oninput = e => { S.notes.session = e.target.value; save(); };
};
function renderDT() {
  const c = $('#dtCard'); if (!c) return;
  const n = S.dt.num, left = dtLeft(), g = greed(n);
  const roomsMode = S.settings.mode === 'rooms';
  c.innerHTML = `<div class="row"><h3 style="margin:0">Dungeon turn ${n || '—'}</h3><span class="sp"></span><button class="btn sm" id="dtPresent" title="Full-screen clock to show players">⛶ Show players</button></div>
    ${roomsMode ? `<div class="bigtime">${S.dt.roomsDone}/${S.dt.rooms || '?'} rooms</div>` : `<div class="bigtime ${left <= 0 && n ? 'over' : left < 5 * 60000 && n ? 'low' : ''}" id="dtBig">${fmtTime(left)}</div>`}
    <div class="greed">${n && g ? `Greed bonus: treasure found this DT is worth +${g}%` : n ? '<span class="muted">No greed bonus after DT 3</span>' : '<span class="muted">Start when the PCs enter the dungeon.</span>'}</div>
    <div class="row" style="margin-top:8px">
      ${n === 0 ? `<button class="btn primary" id="dtStart">Enter dungeon (start DT 1)</button>` :
      `${roomsMode ? `<button class="btn" id="dtRoom">+1 room explored</button>` : S.dt.running ? `<button class="btn" id="dtPause">Pause</button>` : `<button class="btn primary" id="dtResume">Resume</button>`}
       <button class="btn" id="dtEnd">End this DT</button>
       <button class="btn sm" id="dtMinus">−1 min</button><button class="btn sm" id="dtPlus">+1 min</button>
       <button class="btn sm" id="dtLeave">Leave dungeon</button>`}
    </div>
    <div id="dtEndBox"></div>
    <p class="sm muted" style="margin-bottom:0">${roomsMode ? 'Rooms mode: each DT lasts 1d6 rooms (change in Settings).' : `Each DT is ${S.settings.dtMin} real minutes (change in Settings).`} Starting a rest ends the DT without an encounter check.</p>`;
  const on = (id, f) => { const el = $('#' + id); if (el) el.onclick = f; };
  on('dtStart', () => startDT(1));
  on('dtPause', () => { S.dt.left = dtLeft(); S.dt.running = false; save(); renderDT(); });
  on('dtResume', () => { S.dt.resting = false; S.dt.endAt = Date.now() + S.dt.left; S.dt.running = true; save(); renderDT(); });
  on('dtEnd', () => showEndDT());
  on('dtLeave', () => { if (confirm('Leave the dungeon and reset the DT counter?')) { S.dt = Object.assign(DEFAULT().dt, { left: S.settings.dtMin * 60000 }); save(); renderDT(); } });
  on('dtMinus', () => adjDT(-60000)); on('dtPlus', () => adjDT(60000));
  on('dtRoom', () => { S.dt.roomsDone++; save(); if (S.dt.roomsDone >= S.dt.rooms) showEndDT(); else renderDT(); });
  on('dtPresent', () => { $('#present').hidden = false; tick(); });
  if (S.dt.pendingEnd) showEndDT(true);
}
function adjDT(d) { if (S.dt.running) S.dt.endAt += d; else S.dt.left += d; save(); tick(); }
function startDT(n) {
  S.dt.resting = false; S.dt.num = n; S.dt.left = S.settings.dtMin * 60000; S.dt.endAt = Date.now() + S.dt.left; S.dt.running = true; S.dt.pendingEnd = false; S.dt.alerted = 0;
  if (S.settings.mode === 'rooms') { S.dt.rooms = rnd(6); S.dt.roomsDone = 0; addLog(`<b>DT ${n}</b> lasts <b>${S.dt.rooms}</b> rooms (1d6).`); }
  else addLog(`<b>DT ${n} started</b>${greed(n) ? ` — greed bonus +${greed(n)}%` : ''}`, { quiet: true });
  save(); renderDT(); tick();
}
function showEndDT(silent) {
  S.dt.pendingEnd = true; if (S.dt.running) { S.dt.left = dtLeft(); S.dt.running = false; } save();
  const box = $('#dtEndBox'); if (!box) { if (!silent) toast('<b>Dungeon turn over!</b> Open Session for the end-of-DT steps.'); return; }
  const nUD = S.ud.filter(u => u.dice > 0).length;
  box.innerHTML = `<div class="notice"><b>End of DT ${S.dt.num}</b>
    <ol class="checklist">
      <li>Players roll usage dice for their torches, lanterns, spells and effects.</li>
      <li><button class="btn sm" id="endUD">Roll tracked usage dice (${nUD})</button></li>
      <li><button class="btn sm" id="endEnc">Encounter check (EN ${enValue('dungeon')})</button></li>
      <li><button class="btn sm" id="endConds">Clear blessed / vulnerable / weakened in combat tracker</button> <span class="sm muted">(knocked-out creatures wake now)</span></li>
    </ol>
    <div id="endOut"></div>
    <button class="btn primary" id="endNext">Start DT ${S.dt.num + 1}</button></div>`;
  $('#endUD').onclick = () => { rollAllUD(); renderUD(); };
  $('#endEnc').onclick = () => { S.en.ctx = 'dungeon'; save(); encounterCheck($('#endOut'), { ctx: 'dungeon' }); };
  $('#endConds').onclick = () => { clearDTConds(); toast('Cleared DT conditions.'); };
  $('#endNext').onclick = () => startDT(S.dt.num + 1);
}
function clearDTConds() { S.combat.list.forEach(c => c.conds = (c.conds || []).filter(x => !DT_CONDS.includes(x))); save(); }

let beeped = 0;
function beep() {
  if (!S.settings.sound) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 660; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.25, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.3); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.3); });
  } catch (e) { }
}
function tick() {
  const n = S.dt.num, left = dtLeft();
  const rooms = S.settings.mode === 'rooms';
  const txt = rooms ? `${S.dt.roomsDone}/${S.dt.rooms || '?'}` : fmtTime(left);
  $('#dtMiniNum').textContent = n || '–'; $('#dtMiniTime').textContent = S.dt.resting ? 'resting' : n ? txt : (rooms ? 'rooms' : fmtTime(S.settings.dtMin * 60000));
  const mini = $('#dtMini'); mini.className = 'dtmini' + (n && S.dt.running ? ' run' : '') + (n && !rooms && left < 5 * 60000 && left > 0 ? ' low' : '') + (n && !rooms && left <= 0 ? ' over' : '');
  const big = $('#dtBig'); if (big) { big.textContent = fmtTime(left); big.className = 'bigtime ' + (left <= 0 && n ? 'over' : left < 5 * 60000 && n ? 'low' : ''); }
  if (!$('#present').hidden) {
    $('#pNum').textContent = n || '–'; const pt = $('#pTime'); pt.textContent = rooms ? txt + ' rooms' : fmtTime(left);
    pt.className = 'p-time ' + (left <= 0 && n ? 'over' : left < 5 * 60000 && n ? 'low' : '');
    $('#pGreed').textContent = greed(n) ? `Treasure found now is worth +${greed(n)}%` : '';
  }
  if (n && S.dt.running && !rooms && left <= 0 && S.dt.alerted !== n) {
    S.dt.alerted = n; save(); beep();
    toast(`<b>DT ${n} is over!</b> Roll usage dice and make an encounter check.`, 9000);
    showEndDT(true); if ($('#dtEndBox')) renderDT();
  }
}

/* usage dice */
const UD_PRESETS = D.items.map(c => { const b = JSON.stringify(c.body); const m = b.match(/<b>(?:UD|Duration):?<\/b>:?\s*(\d+)\s*(\([^)]*\))?/); return m ? { name: c.name + (c.cat === 'Spellbook' ? ' (spellbook)' : ''), dice: +m[1], rest: /Rest/.test(m[2] || '') || c.cat === 'Spellbook' } : null; }).filter(Boolean);
function renderUD() {
  const c = $('#udCard'); if (!c) return;
  c.innerHTML = `<div class="row"><h3 style="margin:0">Usage dice</h3><span class="sp"></span><button class="btn primary sm" id="udAll">Roll all (end of DT)</button></div>
  <p class="sm muted" style="margin:4px 0">Each d6 showing 1–2 is removed. At 0 UD the effect ends or the item is spent.</p>
  <div id="udList">${S.ud.map(u => `<div class="udrow"><b style="min-width:120px">${esc(u.name)}</b>${u.who ? `<span class="muted sm">${esc(u.who)}</span>` : ''}${u.rest ? '<span class="badge" title="Refilled when a rest finishes">rest</span>' : ''}<span class="dice">${Array.from({ length: Math.max(u.max, u.dice) }, (_, i) => `<span class="die ${i >= u.dice ? 'gone' : ''}">${u.last && u.last[i] ? u.last[i] : ''}</span>`).join('')}</span>${u.dice ? '' : '<span class="badge" style="color:var(--bad)">spent</span>'}<span class="sp"></span>
    <button class="btn sm" data-udroll="${u.id}">Roll</button><button class="btn sm" data-udref="${u.id}" title="Refuel / restore">↺</button><button class="btn sm" data-udplus="${u.id}">+</button><button class="icon-btn" data-uddel="${u.id}" title="Remove">✕</button></div>`).join('') || '<p class="muted">Nothing tracked. Add torches, lanterns, spell durations…</p>'}</div>
  <div class="row" style="margin-top:8px"><input id="udName" placeholder="Name (e.g. Boris’s torch)" list="udPresets" style="flex:1;min-width:150px"><input id="udN" type="number" min="1" value="1" style="width:56px" title="Usage dice"><input id="udWho" placeholder="Who" style="width:90px"><label class="sm" title="Spellbooks and items whose UD say “Rest”"><input type="checkbox" id="udRest"> restores on rest</label><button class="btn" id="udAdd">Add</button></div>
  <datalist id="udPresets">${UD_PRESETS.map(p => `<option value="${esc(p.name)}">${p.dice} UD</option>`).join('')}</datalist>`;
  $('#udName').oninput = e => { const p = UD_PRESETS.find(p => p.name.toLowerCase() === e.target.value.toLowerCase()); if (p) { $('#udN').value = p.dice; $('#udRest').checked = p.rest; } };
  $('#udAdd').onclick = () => { const n = $('#udName').value.trim(); if (!n) return; const d = Math.max(1, +$('#udN').value || 1); S.ud.push({ id: uid(), name: n, dice: d, max: d, who: $('#udWho').value.trim(), rest: $('#udRest').checked }); save(); renderUD(); };
  $('#udAll').onclick = () => { rollAllUD(); renderUD(); };
}
function rollUD(u) {
  if (!u.dice) return `${esc(u.name)}: already spent`;
  const rs = []; for (let i = 0; i < u.dice; i++) rs.push(rnd(6));
  const lost = rs.filter(x => x <= 2).length; u.last = rs; u.dice -= lost;
  return `${esc(u.name)}: [${rs.join(', ')}] → ${lost ? `<b>−${lost}</b>` : 'no loss'}, ${u.dice ? u.dice + ' UD left' : '<b style="color:var(--bad)">SPENT</b>'}`;
}
function rollAllUD() { const live = S.ud.filter(u => u.dice > 0); if (!live.length) { toast('No usage dice to roll.'); return; } addLog('<b>Usage dice</b><br>' + live.map(rollUD).join('<br>')); save(); }

function renderPins() {
  const el = $('#pins'); if (!el) return;
  const link = p => p.kind === 'heading' ? `<a href="#/book/${HEAD[p.id]?.book}/${p.id}">${esc(p.label)}</a>` : `<a href="#" data-open="${p.kind}|${p.id}">${esc(p.label)}</a>`;
  el.innerHTML = (S.pins.length ? '<div class="sm muted">Pinned</div>' + S.pins.map(p => `<div class="row">${link(p)}<span class="sp"></span><button class="icon-btn sm" data-unpin="${p.kind}|${p.id}">✕</button></div>`).join('') : '<p class="muted sm">Pin monsters, items, tables or book sections with ☆ to keep them here.</p>')
    + (S.recent.length ? '<div class="sm muted" style="margin-top:8px">Recently viewed</div>' + S.recent.map(link).join('') : '');
}

/* ---------------- combat ---------------- */
VIEWS.combat = () => {
  const C = S.combat;
  $('#main').innerHTML = `<div class="page-title"><h1>Combat</h1><span class="sp"></span><a class="btn" href="#/encounters">Encounter hub</a><button class="btn" id="cbClear">Clear all</button><button class="btn" id="cbDT">End of DT: clear DT conditions</button></div>
  <div class="card" id="cbRoundCard">${roundBarHTML()}</div>
  <div class="card" style="margin-top:12px"><div class="row">
    <input id="cbMon" list="monList" placeholder="Add monster / NPC / animal…" style="flex:1;min-width:200px"><input id="cbCount" type="number" value="1" min="1" style="width:56px" title="How many"><button class="btn primary" id="cbAddMon">Add</button>
    <span class="sp"></span><input id="cbPC" placeholder="PC or ally name" list="rosterList" style="width:160px"><button class="btn" id="cbAddPC">Add PC</button>${S.roster.length ? `<button class="btn" id="cbRoster">Add whole roster</button>` : ''}
  </div>
  <datalist id="monList">${D.monsters.map(m => `<option value="${esc(m.name)}">Power ${esc(m.power)} · ${esc(m.group)}</option>`).join('')}</datalist>
  <datalist id="rosterList">${S.roster.map(r => `<option value="${esc(r.name)}">`).join('')}</datalist></div>
  <div id="cbList"></div>`;
  renderCombatList();
  bindRoundBar($('#cbRoundCard'), VIEWS.combat);
  $('#cbAddMon').onclick = () => {
    const m = MON_BY_NAME[norm($('#cbMon').value)] || resolveMon($('#cbMon').value); if (!m) { toast('Pick a creature from the list.'); return; }
    addCombatant(m, +$('#cbCount').value || 1); $('#cbMon').value = ''; renderCombatList();
  };
  $('#cbMon').onkeydown = e => { if (e.key === 'Enter') $('#cbAddMon').click(); };
  $('#cbAddPC').onclick = () => { const n = $('#cbPC').value.trim(); if (!n) return; C.list.push({ id: uid(), name: n, pc: true, sta: '', staMax: '', ad: '', adMax: '', conds: [] }); $('#cbPC').value = ''; save(); renderCombatList(); };
  if ($('#cbRoster')) $('#cbRoster').onclick = () => { S.roster.forEach(r => C.list.push({ id: uid(), name: r.name, pc: true, sta: '', staMax: '', ad: '', adMax: '', conds: [] })); save(); renderCombatList(); };
  $('#cbClear').onclick = () => { if (confirm('Remove all combatants and reset rounds?')) { S.combat = DEFAULT().combat; save(); VIEWS.combat(); } };
  $('#cbDT').onclick = () => { clearDTConds(); renderCombatList(); toast('Blessed, vulnerable and weakened cleared.'); };
};

/* ---------------- encounter numbers (shared by Session, Encounters, Travel, Rest) ---------------- */
function travelBaseEN() { return { slow: 2, normal: 4, fast: 6 }[S.travel.pace] || 4; }
function enValue(ctx = S.en.ctx) {
  const e = S.en; let v;
  if (ctx === 'dungeon' || ctx === 'drest') { v = 3 + (e.crowded ? 1 : 0) + (e.chaos ? 1 : 0); if (ctx === 'drest' && e.seclude) v -= 1; }
  else { const tc = travelCalc(); v = ctx === 'trest' ? tc.restEn - (e.seclude ? 1 : 0) : tc.en; }
  v += +e.other || 0;
  return Math.max(1, v);
}
const CTX_LABEL = { dungeon: 'In a dungeon', drest: 'Resting in a dungeon', travel: 'Travel day', trest: 'Resting outdoors' };
function enControlsHTML() {
  return `<div class="row">${Object.entries(CTX_LABEL).map(([k, l]) => `<span class="chip ${S.en.ctx === k ? 'on' : ''}" data-enctx="${k}">${l}</span>`).join('')}</div>
    <div class="row" style="margin-top:6px" id="enMods"></div>
    <p style="margin:8px 0 4px">Encounter number: <b class="enVal" style="font-size:1.4rem"></b> <span class="muted sm" id="enWhy"></span></p>`;
}
function bindEnControls(root, onChange) {
  const draw = () => {
    const c = S.en.ctx, dung = c === 'dungeon' || c === 'drest';
    $$('[data-enctx]', root).forEach(x => x.classList.toggle('on', x.dataset.enctx === c));
    $('#enMods', root).innerHTML = (dung ? `<span class="chip ${S.en.crowded ? 'on' : ''}" data-en="crowded">20+ creatures on this level (+1)</span><span class="chip ${S.en.chaos ? 'on' : ''}" data-en="chaos">Trail of chaos or bodies (+1)</span>` : '')
      + (c === 'drest' || c === 'trest' ? `<span class="chip ${S.en.seclude ? 'on' : ''}" data-en="seclude">Seclude Camp (−1)</span>` : '')
      + `<span class="sm muted">Other</span><input type="number" data-enother style="width:56px" value="${S.en.other || 0}">`;
    $$('.enVal', root).forEach(x => x.textContent = enValue());
    const tc = travelCalc();
    $('#enWhy', root).innerHTML = dung ? 'base 3, max 5 · roll d10 ≤ EN' : c === 'travel' ? `from <a href="#/travel">Travel day</a>: ${S.travel.pace} pace + roles${tc.extra ? ` · ${tc.extra} extra check${tc.extra > 1 ? 's' : ''}` : ''}` : `rest EN from <a href="#/travel">Travel day</a> pace${tc.extraRest ? ` · ${tc.extraRest} extra check` : ''}`;
    $$('[data-en]', root).forEach(x => x.onclick = () => { S.en[x.dataset.en] = !S.en[x.dataset.en]; save(); draw(); onChange && onChange(); });
    const o = $('[data-enother]', root); if (o) o.oninput = () => { S.en.other = +o.value || 0; save(); $$('.enVal', root).forEach(x => x.textContent = enValue()); onChange && onChange(); };
  };
  $$('[data-enctx]', root).forEach(x => x.onclick = () => { S.en.ctx = x.dataset.enctx; save(); draw(); onChange && onChange(); });
  draw();
}
function encounterCheck(out, opts = {}) {
  const ctx = opts.ctx || S.en.ctx, en = enValue(ctx), d = rnd(10), hit = d <= en;
  const label = opts.label || 'Encounter check';
  const html = hit
    ? `<b>${esc(label)}</b> (EN ${en}): rolled ${d} — <span style="color:var(--bad)"><b>ENCOUNTER!</b></span> ${ctx === 'dungeon' || ctx === 'drest' ? (d === 1 ? '<b>It happens now.</b>' : 'Give a sign now; it arrives during the next DT.') : 'You choose when it happens today.'} <button class="btn sm primary" data-gen="${ctx}">Generate it →</button>`
    : `<b>${esc(label)}</b> (EN ${en}): rolled ${d} — <span style="color:var(--good)">no encounter.</span>`;
  addLog(html, { quiet: !!opts.quiet });
  if (out) out.innerHTML = (opts.append ? out.innerHTML : '') + `<div class="result">${html}</div>`;
  return { d, en, hit };
}

/* ---------------- encounter generation ---------------- */
const TB = n => D.tables.find(t => t.name === n);
const MON_TABLES = { Angel: 'Angel Encounters', Blood: 'Blood Encounters', Demon: 'Demon Encounters', Plant: 'Plant Encounters', Undead: 'Undead Encounters' };
const HABITATS = { Coastal: 'Coastal Animal Encounters', 'Cold climate': 'Cold Climate Animal Encounters', Desert: 'Desert Animal Encounters', Forest: 'Forest Animal Encounters', Grassland: 'Grassland Animal Encounters', 'Hill / mountain': 'Hill/Mountain Animal Encounters', 'Marsh / swamp': 'Marsh/Swamp Animal Encounters' };
const WEATHER = { 'Cold or winter': ['Blizzard', 'Cold Snap'], Desert: ['Heat Wave', 'Sandstorm'], Fall: ['Rain', 'Thunderstorm'], Spring: ['Rain', 'Thunderstorm'], 'Tropical or summer': ['Heat Wave', 'Thunderstorm'] };
const MERCH_NPC = { Alchemist: 'Alchemist', Blacksmith: 'Blacksmith', Bookseller: 'Sage (Power 6)', Enchanter: 'Enchanter', 'General Store': 'Commoner' };
const KIND_HELP = {
  'Any Monster': 'Roll which monster table, then who shows up. You decide what they’re doing, or use the behavior roll.',
  'Nearby Monster': 'Monsters from the closest dungeon’s table (set “Nearest dungeon’s monsters” above).',
  'Bad Weather': 'Lasts 24 hours. Depends on climate or season (set above).',
  'Merchant': 'A caravan that trades like an institution. 1d6 guards per PC travel with it — only place them if you need to.',
  'Miasma-Touched': '1d6 humans permanently corrupted by the Miasma. Their reaction is a prompt — put your own spin on it.',
  'Strong Miasma': 'No encounter if the PCs avoid Miasma hexes today thanks to an upgraded beacon.',
  'Traveler': '1d10 humans on the road. Cautious until the PCs prove they’re kind.',
  'Wild Animal': 'Roll on the habitat’s table (set above), then the animal’s reaction.',
};
function wordsKey(s) { return norm(s).replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '); }
const MON_WORDS = D.monsters.map(m => [m, wordsKey(m.name)]);
function singular(w) { return w.replace(/^oxen$/, 'ox').replace(/^mice$/, 'mouse').replace(/^geese$/, 'goose').replace(/wolves$/, 'wolf').replace(/ies$/, 'y').replace(/(ch|sh|ss|x)es$/, '$1').replace(/([^s])s$/, '$1'); }
function resolveMon(name) {
  const n = norm(name).replace(/^(the|a|an)\s+/, '').replace(/[.;]$/, '');
  const lt = n.match(/^(angels?|blood creatures?|demons?|plants?|undead)\s+([a-j])$/i);
  if (lt) { const id = monIdForLettered(lt[1], lt[2]); if (id) return MON[id]; }
  const w = n.replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean);
  for (const v of [w, w.map(singular), w.map((x, i) => i === w.length - 1 ? singular(x) : x)]) {
    const k = [...v].sort().join(' '); const hit = MON_WORDS.find(x => x[1] === k); if (hit) return hit[0];
  }
  return null;
}
function parseComp(text) {
  const out = [], unknown = [];
  for (const part of strip(text).replace(/\.$/, '').split(/\s+and\s+|,\s*/)) {
    const p = part.trim(); if (!p) continue;
    const m = p.match(/^(\d+d\d+(?:\s*[+]\s*\d+)?|\d+)\s+(.+)$/i);
    const mon = resolveMon(m ? m[2] : p);
    if (mon) out.push({ expr: m ? m[1].replace(/\s/g, '') : '1', mid: mon.id }); else unknown.push(p);
  }
  return { out, unknown };
}
function tRoll(name) {
  const t = TB(name); if (!t) return null;
  const r = rollTable(t.gid, { quiet: true });
  return { gid: t.gid, name: t.name, die: r.die, cells: r.res ? r.res.c : [], txt: r.res ? strip(r.res.c[0]) : '' };
}
function mkStep(k, label, r, extra = '') { return { k, label, gid: r?.gid, die: r?.die, html: r ? r.cells.filter(c => strip(c)).map(c => fmt(c, { selfTable: r.gid })).join(' — ') : '', extra }; }
function encTitle(E) { return E.kind || (E.groups.length ? E.groups.map(g => `${g.count} × ${MON[g.mid]?.name}`).join(', ') : 'Encounter'); }

function genEncounter(ctx) {
  const old = S.enc.cur;
  if (old) { S.combat.list = S.combat.list.filter(c => c.enc !== old.id); S.enc.history = [{ at: old.at, ctx: old.ctx, title: encTitle(old), disp: old.disp ? strip(old.disp.html).slice(0, 90) : '' }, ...(S.enc.history || [])].slice(0, 12); }
  const E = { id: uid(), at: Date.now(), ctx, steps: [], groups: [], unknown: [], disp: null, notes: [], kind: '' };
  S.enc.cur = E;
  if (ctx === 'dungeon' || ctx === 'drest') { E.kind = (S.enc.dtype === 'Any' ? 'Monsters' : S.enc.dtype + ' monsters') + ' (dungeon)'; genMonsters(E, S.enc.dtype, true); }
  else {
    const k = tRoll('Travel Encounters'); E.kind = k.txt.replace(/^Nearby Monster$/, 'Nearby Monster');
    E.steps.push(mkStep('kind', 'What kind of encounter?', k, KIND_HELP[E.kind] || ''));
    genKind(E);
  }
  placeCreatures(E);
  save();
  addLog(`<b>Encounter</b>: ${esc(encTitle(E))}${E.groups.length ? ' — ' + E.groups.map(g => `${g.count} × ${esc(MON[g.mid].name)}`).join(', ') : ''}${E.disp ? '<br>' + strip(E.disp.html).slice(0, 140) : ''}`, { quiet: true });
}
function genMonsters(E, type, inDungeon) {
  let t = type;
  if (type === 'Any') { const a = tRoll('Any Monster Encounter'); E.steps.push(mkStep('type', 'Which monster table?', a)); t = (a.txt.match(/^(Angel|Blood|Demon|Plant|Undead)/) || [])[1] || 'Angel'; }
  E.compTable = MON_TABLES[t]; rollComp(E);
  E.dispTable = 'Monster Outdoor Behaviors';
  if (!inDungeon) rollDisp(E);
  else E.notes.push('In a dungeon you decide what the monsters are doing. You can still roll an outdoor behavior for ideas.');
}
function genKind(E) {
  const k = E.kind;
  if (k === 'Any Monster') genMonsters(E, 'Any', false);
  else if (k === 'Nearby Monster') genMonsters(E, S.enc.nearby || 'Undead', false);
  else if (k === 'Wild Animal') { E.compTable = HABITATS[S.enc.habitat] || HABITATS.Forest; rollComp(E); E.dispTable = 'Wild Animal Reaction'; rollDisp(E); }
  else if (k === 'Miasma-Touched') { E.compMulti = { table: 'Miasma-Touched Humans', die: 6 }; rollComp(E); E.dispTable = 'Miasma-Touched Encounters'; rollDisp(E); }
  else if (k === 'Traveler') { E.compMulti = { table: 'Travelers', die: 10 }; rollComp(E); E.dispTable = 'Traveler Encounters'; rollDisp(E); E.extras = ['Traveler Rewards']; }
  else if (k === 'Merchant') {
    const s = tRoll('Merchant Sales'); const inst = strip(s.cells[0]), lvl = strip(s.cells[1] || '');
    E.steps.push(mkStep('comp', 'What does the merchant trade?', s));
    const npc = MERCH_NPC[inst]; if (npc) { const m = resolveMon(npc); if (m) E.groups = [{ mid: m.id, expr: '1', count: 1 }]; }
    const pct = rnd(10) * 10;
    E.disp = { k: 'disp', label: 'Prices', html: `Sells as a <b>${esc(lvl)}-level ${esc(inst)}</b> (see Village in Characters). Buys the PCs’ goods at <b>${pct}%</b> of their value (1d10 × 10%).` };
    E.extras = ['guards'];
  }
  else if (k === 'Bad Weather') {
    const cl = S.enc.climate || 'Spring'; const opts = WEATHER[cl]; const d = rnd(10); const w = opts[d % 2 ? 0 : 1];
    E.steps.push({ k: 'comp', label: `Which weather? (${cl}: ${opts.join(' or ')})`, die: `any die: ${d} (${d % 2 ? 'odd → first' : 'even → second'})`, html: `<b>${esc(w)}</b>` });
    const h = HEAD['ref-' + slugJS(w)]; E.rule = h ? h.b.id : null; E.weather = w;
  }
  else if (k === 'Strong Miasma') { E.rule = 'ref-strong-miasma'; }
}
function slugJS(s) { return strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function rollComp(E) {
  E.steps = E.steps.filter(s => s.k !== 'comp');
  if (E.compMulti) {
    const n = rnd(E.compMulti.die); const lines = []; const tally = {};
    for (let i = 0; i < n; i++) { const r = tRoll(E.compMulti.table); const m = resolveMon(r.txt); lines.push(`${r.die} ${esc(r.txt)}`); if (m) tally[m.id] = (tally[m.id] || 0) + 1; }
    E.groups = Object.entries(tally).map(([mid, c]) => ({ mid, expr: String(c), count: c }));
    E.steps.push({ k: 'comp', label: `Who? (1d${E.compMulti.die} = ${n} ${n === 1 ? 'person' : 'people'}, each rolled on ${E.compMulti.table})`, gid: TB(E.compMulti.table).gid, die: '', html: lines.join(' · ') });
  } else {
    const r = tRoll(E.compTable); const pc = parseComp(r.txt);
    E.groups = pc.out.map(g => { const rr = rollExpr(g.expr); return { mid: g.mid, expr: g.expr, count: Math.max(1, rr.total), roll: /d/.test(g.expr) ? rr.text : '' }; });
    E.unknown = pc.unknown;
    E.steps.push(mkStep('comp', 'Who shows up?', r, E.groups.filter(g => g.roll).map(g => `${g.expr} → ${g.count}`).join(', ')));
  }
}
function rollDisp(E) { const r = tRoll(E.dispTable); E.disp = mkStep('disp', E.dispTable === 'Wild Animal Reaction' ? 'How does it react?' : E.dispTable === 'Monster Outdoor Behaviors' ? 'What are they doing?' : 'What do they want?', r); }
function placeCreatures(E) {
  S.combat.list = S.combat.list.filter(c => c.enc !== E.id);
  for (const g of E.groups) { const m = MON[g.mid]; if (m) addCombatant(m, g.count, { enc: E.id, quiet: true }); }
}

/* ---------------- reusable combatant tracker ---------------- */
function addCombatant(m, n = 1, opts = {}) {
  const same = S.combat.list.filter(c => c.mid === m.id).length;
  const ad = parseInt(m.ad) || 0, sta = parseInt(m.stamina) || 0;
  for (let i = 0; i < n; i++) S.combat.list.push({ id: uid(), mid: m.id, enc: opts.enc, name: m.name + (n > 1 || same ? ' #' + (same + i + 1) : ''), sta, staMax: sta, ad, adMax: ad, conds: [] });
  save(); if (!opts.quiet) toast(`Added ${n} × ${esc(m.name)} to combat.`);
}
function combatantHTML(c) {
  const m = c.mid ? MON[c.mid] : null; const dead = !c.pc && c.staMax && c.sta <= 0;
  const pct = c.staMax ? Math.max(0, Math.min(100, Math.round((+c.sta || 0) / +c.staMax * 100))) : 0;
  return `<div class="cb ${dead ? 'dead' : ''}" data-cb="${c.id}">
    <div class="row"><b>${esc(c.name)}</b>${c.pc ? '<span class="badge">PC</span>' : m ? `<span class="badge">Power ${esc(m.power)}</span>` : ''}
      ${m ? `<a class="sm mlink" data-m="${m.id}">stat block</a>` : ''}<span class="sp"></span>
      <span>Stamina <input class="num" type="number" data-f="sta" value="${c.sta}"> / <input class="num" type="number" data-f="staMax" value="${c.staMax}"></span>
      <span>AD <input class="num" type="number" data-f="ad" value="${c.ad}"> / <input class="num" type="number" data-f="adMax" value="${c.adMax}"></span>
      <button class="icon-btn" data-cbdel="${c.id}" title="Remove">✕</button></div>
    ${c.staMax ? `<div class="hpbar"><div style="width:${pct}%"></div></div>` : ''}
    <div class="row" style="margin-top:6px"><input class="num" type="number" placeholder="dmg" data-dmgin><button class="btn sm" data-dmg="n">Damage</button><button class="btn sm" data-dmg="p" title="Piercing: ignores AD">Piercing</button><button class="btn sm" data-dmg="h">Heal</button>
      <div class="conds">${COND_NAMES.map(k => `<span class="chip ${(c.conds || []).includes(k) ? 'on' : ''}" data-cond="${k}" title="${esc(CONDS[k]?.text || '')}">${k}</span>`).join('')}</div>
      <input placeholder="note" data-f="note" value="${esc(c.note || '')}" style="flex:1;min-width:120px"></div>
    ${m && m.atkFix.length && !dead ? `<div class="row atkbtns">${m.atkFix.map((a, i) => `<button class="btn sm" data-atkb="${m.id}" data-i="${i}" title="${esc(a.r)} · ${esc(a.t2)} / ${esc(a.t3)}">⚔ ${esc(a.n.replace(/\*+$/, ''))}</button>`).join('')}</div>` : ''}
    ${dead ? '<div class="sm" style="color:var(--bad)">0 Stamina — monsters die (or are knocked out if you allow it).</div>' : ''}
  </div>`;
}
function renderCombatants(el, filter, rerender) {
  if (!el) return;
  const L = S.combat.list.filter(filter);
  el.innerHTML = L.map(combatantHTML).join('') || '';
  $$('.cb', el).forEach(row => {
    const c = S.combat.list.find(x => x.id === row.dataset.cb); if (!c) return;
    $$('[data-f]', row).forEach(inp => inp.onchange = () => { c[inp.dataset.f] = inp.type === 'number' ? (inp.value === '' ? '' : +inp.value) : inp.value; save(); if (inp.dataset.f !== 'note') rerender(); });
    $$('[data-cond]', row).forEach(ch => ch.onclick = () => { const k = ch.dataset.cond; c.conds = c.conds || []; c.conds = c.conds.includes(k) ? c.conds.filter(x => x !== k) : [...c.conds, k]; save(); rerender(); });
    $$('[data-dmg]', row).forEach(b => b.onclick = () => {
      const raw = +$('[data-dmgin]', row).value || 0; let v = raw; if (!v) return;
      const kind = b.dataset.dmg;
      if (kind === 'h') { c.sta = Math.min(+c.staMax || Infinity, (+c.sta || 0) + v); }
      else {
        if ((c.conds || []).includes('vulnerable')) { const extra = rnd(6); v += extra; toast(`Vulnerable: +${extra} dam (1d6)`); }
        let msg = '';
        if (kind === 'n' && +c.ad > 0) { const a = Math.min(+c.ad, v); c.ad = +c.ad - a; v -= a; msg = `AD −${a}`; }
        const before = +c.sta || 0; c.sta = Math.max(0, before - v); const over = v - before;
        addLog(`${esc(c.name)} takes ${raw}${kind === 'p' ? ' P' : ''} dam → ${msg ? msg + ', ' : ''}Stamina ${c.sta}${c.pc && over > 0 ? ` · <b>${over} wound${over > 1 ? 's' : ''}</b>` : ''}${!c.pc && c.sta <= 0 ? ' · <b>down</b>' : ''}`, { quiet: true });
      }
      save(); rerender();
    });
    $('[data-cbdel]', row).onclick = () => { S.combat.list = S.combat.list.filter(x => x.id !== c.id); save(); rerender(); };
  });
}
function renderCombatList() { renderCombatants($('#cbList'), () => true, renderCombatList); if ($('#cbList') && !S.combat.list.length) $('#cbList').innerHTML = '<p class="muted" style="margin-top:12px">No combatants yet. Add monsters above, roll an encounter in the <a href="#/encounters">Encounter hub</a>, or use “+ Add to combat” on any stat block.</p>'; }

const PHASES = ['Group A fast turns', 'Group B fast turns', 'Group A slow turns', 'Group B slow turns'];
function roundBarHTML() {
  const C = S.combat;
  const nm = (s) => s.replace('Group A', C.pcsFirst == null ? 'Group A' : C.pcsFirst ? 'PCs' : 'Enemies').replace('Group B', C.pcsFirst == null ? 'Group B' : C.pcsFirst ? 'Enemies' : 'PCs');
  return `<div class="row"><b>Round ${C.round || '—'}</b>
    <span class="muted sm">${C.pcsFirst == null ? 'Roll each round: 6+ on a d10 means the PCs are Group A.' : `<b>${C.pcsFirst ? 'PCs' : 'Enemies'}</b> are Group A this round (rolled ${C.lastRoll}).`}</span><span class="sp"></span>
    <button class="btn primary sm" data-rb="round">${C.round ? 'Next round' : 'Start combat'} (d10)</button></div>
    <div class="phase" style="margin-top:6px">${PHASES.map((p, i) => `<span class="${C.round && C.phase === i ? 'on' : ''}" data-phase="${i}">${i + 1}. ${nm(p)}</span>`).join('')}<button class="btn sm" data-rb="phase">Next phase →</button></div>
    <p class="sm muted" style="margin:6px 0 0">Fast turn: a maneuver <i>or</i> an action. Slow turn: maneuver + action, or two maneuvers. Surprised creatures skip round 1.</p>`;
}
function bindRoundBar(root, rerender) {
  const C = S.combat;
  $$('[data-rb="round"]', root).forEach(b => b.onclick = () => { const d = rnd(10); C.round++; C.pcsFirst = d >= 6; C.lastRoll = d; C.phase = 0; if (C.round > 1) C.list.forEach(c => c.conds = (c.conds || []).filter(x => x !== 'surprised')); addLog(`<b>Round ${C.round}</b>: d10 = ${d} → <b>${C.pcsFirst ? 'PCs' : 'Enemies'}</b> are Group A`); save(); rerender(); });
  $$('[data-rb="phase"]', root).forEach(b => b.onclick = () => { if (!C.round) return; C.phase = (C.phase + 1) % 4; save(); rerender(); });
  $$('[data-phase]', root).forEach(s => s.onclick = () => { C.phase = +s.dataset.phase; save(); rerender(); });
}

/* ---------------- views: encounter hub ---------------- */
VIEWS.encounters = () => {
  const go = S.enc.autogen; S.enc.autogen = null;
  if (go) { S.en.ctx = go; genEncounter(go); }
  const E = S.enc.cur;
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const dung = S.en.ctx === 'dungeon' || S.en.ctx === 'drest';
  $('#main').innerHTML = `<div class="page-title"><h1>Encounters</h1><span class="muted">Check → who and what they want → stat blocks with health, all on one screen.</span></div>
  <div class="grid enc-top">
    <div class="card" id="encCheck"><h3><span class="stepn">1</span>Encounter check</h3>${enControlsHTML()}
      <div class="kv sm" style="margin:6px 0">
        ${dung ? `<span>Dungeon’s monsters</span>${sel('encD', ['Any', 'Angel', 'Blood', 'Demon', 'Plant', 'Undead'], S.enc.dtype)}` :
      `<span>Habitat (animals)</span>${sel('encH', Object.keys(HABITATS), S.enc.habitat)}
        <span>Nearest dungeon’s monsters</span>${sel('encN', ['Angel', 'Blood', 'Demon', 'Plant', 'Undead'], S.enc.nearby)}
        <span>Climate / season (weather)</span>${sel('encW', Object.keys(WEATHER), S.enc.climate)}
        <span>PCs in the party</span><input id="encP" type="number" min="1" value="${S.enc.party}" style="width:60px">`}
      </div>
      <div class="row"><button class="btn primary" id="encRoll">Encounter check</button><button class="btn" id="encGen">Skip the check — generate one</button></div>
      <div id="encOut"></div>
      <p class="sm muted" style="margin-bottom:0">${dung ? 'Dungeon: check at the end of every DT and whenever the PCs make a racket. Rolling a 1 means it happens now.' : 'Travel: two checks per travel day, plus any extras from roles. Resting outdoors: one check (plus Scout for Shelter extras).'}</p>
    </div>
    <div class="card" id="encWhat"></div>
  </div>
  <div id="encWho"></div>
  ${(S.enc.history || []).length ? `<details class="card" style="margin-top:12px"><summary class="muted">Earlier encounters (${S.enc.history.length})</summary>${S.enc.history.map(h => `<div class="sm" style="padding:3px 0;border-bottom:1px solid #23272c">${new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · <b>${esc(h.title)}</b> <span class="muted">${esc(h.disp)}</span></div>`).join('')}</details>` : ''}`;
  bindEnControls($('#encCheck'), () => VIEWS.encounters());
  const on = (id, f) => { const el = $('#' + id); if (el) el.onchange = el.oninput = f; };
  on('encD', e => { S.enc.dtype = e.target.value; save(); });
  on('encH', e => { S.enc.habitat = e.target.value; save(); });
  on('encN', e => { S.enc.nearby = e.target.value; save(); });
  on('encW', e => { S.enc.climate = e.target.value; save(); });
  on('encP', e => { S.enc.party = Math.max(1, +e.target.value || 1); save(); });
  $('#encRoll').onclick = () => { const r = encounterCheck($('#encOut'), { quiet: true }); if (r.hit) { genEncounter(S.en.ctx); renderEncWhat(); renderEncWho(); } };
  $('#encGen').onclick = () => { genEncounter(S.en.ctx); renderEncWhat(); renderEncWho(); };
  renderEncWhat(); renderEncWho();
};
function renderEncWhat() {
  const el = $('#encWhat'); if (!el) return; const E = S.enc.cur;
  if (!E) { el.innerHTML = `<h3><span class="stepn">2</span>What is it?</h3><p class="muted">Make an encounter check. When one hits, this panel rolls what the PCs meet and how they react, then puts the stat blocks with health trackers below.</p>`; return; }
  const stepRow = s => `<div class="encstep"><div class="row"><span class="sm muted">${esc(s.label)}</span><span class="sp"></span>${s.gid ? `<span class="faint sm">${esc(String(s.die ?? ''))}</span> <span class="tlink sm" data-t="${s.gid}">table</span>` : s.die ? `<span class="faint sm">${esc(String(s.die))}</span>` : ''}${s.k === 'comp' || s.k === 'disp' ? ` <button class="icon-btn sm" data-reroll="${s.k}" title="Reroll just this">↻</button>` : ''}</div><div>${s.html}${s.extra ? `<div class="sm muted">${esc(s.extra)}</div>` : ''}</div></div>`;
  const rule = E.rule && HEAD[E.rule] ? `<div class="encrule">${blocksHTML(sectionBlocks(HEAD[E.rule].book, HEAD[E.rule].i), { noTrack: true, shift: 2 })}</div>` : '';
  el.innerHTML = `<div class="row"><h3 style="margin:0"><span class="stepn">2</span>${esc(encTitle(E))}</h3><span class="sp"></span><span class="badge">${CTX_LABEL[E.ctx]}</span><button class="btn sm" data-reroll="all">↻ New encounter</button></div>
    ${E.steps.map(stepRow).join('')}
    ${E.unknown && E.unknown.length ? `<div class="sm muted">No stat block found for: ${E.unknown.map(esc).join(', ')}</div>` : ''}
    ${E.disp ? `<div class="encdisp">${stepRow(E.disp)}</div>` : E.dispTable ? `<button class="btn sm" data-reroll="disp">🎲 Roll ${esc(E.dispTable)}</button>` : ''}
    ${(E.notes || []).map(n => `<p class="sm muted">${esc(n)}</p>`).join('')}
    ${rule}
    <div class="row" style="margin-top:8px">
      ${(E.extras || []).includes('Traveler Rewards') ? `<button class="btn sm" data-rollt="${TB('Traveler Rewards').gid}">🎲 Traveler Rewards (if helped)</button>` : ''}
      ${(E.extras || []).includes('guards') ? `<button class="btn sm" id="encGuards">+ Add guards (1d6 × ${S.enc.party} PCs)</button>` : ''}
      ${E.groups.length ? `<button class="btn sm" id="encTerrain">🎲 Combat terrain &amp; distance</button>` : ''}
    </div><div id="encTerr">${E.terrain ? `<div class="result sm">${E.terrain}</div>` : ''}</div>`;
  $$('[data-reroll]', el).forEach(b => b.onclick = () => {
    const k = b.dataset.reroll;
    if (k === 'all') genEncounter(E.ctx);
    else if (k === 'disp') rollDisp(E);
    else if (k === 'comp') { if (E.kind === 'Merchant' || E.kind === 'Bad Weather') { genEncounter(E.ctx); } else { rollComp(E); placeCreatures(E); } }
    save(); renderEncWhat(); renderEncWho();
  });
  if ($('#encGuards')) $('#encGuards').onclick = () => {
    let n = 0; for (let i = 0; i < S.enc.party; i++) n += rnd(6);
    const tally = {}; for (let i = 0; i < n; i++) { const r = tRoll('Merchant Guards'); const m = resolveMon(r.txt); if (m) tally[m.id] = (tally[m.id] || 0) + 1; }
    for (const [mid, c] of Object.entries(tally)) { const g = E.groups.find(x => x.mid === mid); if (g) g.count += c; else E.groups.push({ mid, expr: String(c), count: c }); addCombatant(MON[mid], c, { enc: E.id, quiet: true }); }
    E.extras = E.extras.filter(x => x !== 'guards'); E.notes.push(`${n} guards rolled.`); save(); renderEncWhat(); renderEncWho();
  };
  if ($('#encTerrain')) $('#encTerrain').onclick = () => { const r = tRoll('Combat Terrain'); const dist = rollExpr(strip(r.cells[1] || '').replace(/\s*squares?/, '')); E.terrain = `<b>Terrain</b> (${r.die}): ${fmt(r.cells[0])}<br><b>Starting distance</b>: ${esc(strip(r.cells[1] || ''))}${dist ? ` → <b>${dist.total} squares</b>` : ''}`; save(); $('#encTerr').innerHTML = `<div class="result sm">${E.terrain}</div>`; };
}
function renderEncWho() {
  const el = $('#encWho'); if (!el) return; const E = S.enc.cur;
  if (!E || !E.groups.length) { el.innerHTML = E ? '' : ''; return; }
  const pcs = S.combat.list.filter(c => c.pc);
  el.innerHTML = `<div class="card" style="margin-top:12px" id="encRound"><div class="row"><h3 style="margin:0"><span class="stepn">3</span>Stat blocks &amp; health</h3><span class="sp"></span>
      ${S.roster.length && !pcs.length ? `<button class="btn sm" id="encPCs">+ Add the party (${S.roster.length})</button>` : ''}
      <a class="btn sm" href="#/combat">Open in Combat tab</a><button class="btn sm" id="encClear">Clear encounter</button></div>
      <div style="margin-top:8px">${roundBarHTML()}</div>
      ${pcs.length ? `<details style="margin-top:8px"><summary class="sm muted">PCs in this fight (${pcs.length})</summary><div id="encPCList"></div></details>` : ''}</div>
    ${E.groups.map(g => { const m = MON[g.mid]; return `<div class="encgrp"><div>${statBlockHTML(m, { openDesc: false })}</div><div><div class="row"><h4 style="margin:4px 0">${g.count} × ${esc(m.name)}</h4><span class="sp"></span><button class="btn sm" data-addone="${m.id}">+1</button></div><div data-grp="${m.id}"></div></div></div>`; }).join('')}`;
  const rr = () => renderEncWho();
  bindRoundBar($('#encRound'), rr);
  E.groups.forEach(g => renderCombatants($(`[data-grp="${g.mid}"]`, el), c => c.enc === E.id && c.mid === g.mid, rr));
  if ($('#encPCList')) renderCombatants($('#encPCList'), c => c.pc, rr);
  if ($('#encPCs')) $('#encPCs').onclick = () => { S.roster.forEach(r => S.combat.list.push({ id: uid(), name: r.name, pc: true, sta: '', staMax: '', ad: '', adMax: '', conds: [] })); save(); rr(); };
  $$('[data-addone]', el).forEach(b => b.onclick = () => { const g = E.groups.find(x => x.mid === b.dataset.addone); g.count++; addCombatant(MON[g.mid], 1, { enc: E.id, quiet: true }); rr(); });
  $('#encClear').onclick = () => { if (!confirm('Clear this encounter and remove its creatures from combat?')) return; S.combat.list = S.combat.list.filter(c => c.enc !== E.id); S.enc.history = [{ at: E.at, ctx: E.ctx, title: encTitle(E), disp: E.disp ? strip(E.disp.html).slice(0, 90) : '' }, ...(S.enc.history || [])].slice(0, 12); S.enc.cur = null; save(); VIEWS.encounters(); };
}


/* ---------------- rollers ---------------- */
VIEWS.rollers = () => {
  const T = S.test;
  const tables = n => D.tables.find(t => t.name === n);
  const quick = ['Minor Treasures', 'Major Treasures', 'What’s the Gem?', 'What’s the Art Object?', 'Combat Terrain', 'Monster Outdoor Behaviors', 'Wild Animal Reaction', 'Traveler Encounters', 'Miasma-Touched Encounters'].map(tables).filter(Boolean);
  $('#main').innerHTML = `<div class="page-title"><h1>Rollers</h1></div>
  <div class="grid dash">
    <div class="card"><h3>Test (2d10 + characteristic)</h3>
      <div class="kv"><span>Characteristic</span><span><input id="tMod" type="number" value="${T.mod}" style="width:70px"></span>
      <span>Edges</span><span class="row">${[0, 1, 2].map(n => `<span class="chip ${T.edges === n ? 'on' : ''}" data-te="${n}">${['none', 'edge (+2)', 'double edge'][n]}</span>`).join('')}</span>
      <span>Banes</span><span class="row">${[0, 1, 2].map(n => `<span class="chip ${T.banes === n ? 'on' : ''}" data-tb="${n}">${['none', 'bane (−2)', 'double bane'][n]}</span>`).join('')}</span>
      <span>Other bonus</span><span><input id="tBonus" type="number" value="${T.bonus}" style="width:70px"> <span class="sm muted">assists, gear</span></span>
      <span>Expertise + Effort</span><span><label><input type="checkbox" id="tEff" ${T.effort ? 'checked' : ''}> spend 1 Effort (+1 tier, not on doom)</label></span></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="tRoll">Roll test</button></div><div id="tOut"></div>
      <p class="sm muted">≤11 tier 1 · 12–16 tier 2 · 17+ tier 3. Natural 19–20 = crit (tier 3 + extra). Natural 2–3 = doom (tier 1 + setback). Edge and bane cancel; double edge + bane = edge.</p></div>
    <div class="card"><h3>Spellcasting</h3>
      <div class="row">Spell rank <input id="sRank" type="number" min="0" max="5" value="${S.test.rank || 0}" style="width:60px"></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="sChaos">Chaos roll (tier 1 casting)</button><button class="btn" id="sBack">Roll backlash</button></div><div id="sOut"></div>
      <p class="sm muted">Tier 1 (not doom): chaos roll d10 + rank, 8+ = backlash. Doom on a casting = backlash. Backlash: d100 + rank. Caster still rolls the spellbook’s UD.</p></div>
    <div class="card"><h3>Miasma (after resting in it)</h3>
      <div class="row">Mind <input id="mMind" type="number" value="0" style="width:60px"> Cruelty level <input id="mCru" type="number" min="0" value="0" style="width:60px"> Other bonus <input id="mBon" type="number" value="0" style="width:60px"></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="mRoll">Roll Miasma RR</button><button class="btn" id="mEff">Roll Miasma effect only</button></div><div id="mOut"></div>
      <p class="sm muted">−1 per cruelty level. Tier 1: gain a cruelty level and roll d10 + cruelty on Miasma Effects. Tier 3: lose all cruelty (or help another human by a tier). Plague mask: +2.</p></div>
    <div class="card"><h3>Quick tables</h3><div class="grid" style="grid-template-columns:1fr 1fr">${quick.map(t => `<button class="btn wrap" data-rollt="${t.gid}">🎲 ${esc(t.name)}</button>`).join('')}</div>
      <p class="sm"><a href="#/tables">All ${D.tables.length} random tables →</a></p>
      <div class="row">Treasure value <input id="gVal" type="number" placeholder="gc" style="width:90px"> found in DT <input id="gDT" type="number" value="${S.dt.num || 1}" min="1" style="width:56px"> <button class="btn" id="gCalc">Apply greed bonus</button></div><div id="gOut"></div></div>
    <div class="card"><h3>Dice</h3><div class="row"><input id="dExpr" placeholder="e.g. 3d6+2, 1d100, 4d10" style="flex:1"><button class="btn primary" id="dRoll">Roll</button></div>
      <div class="row" style="margin-top:8px">${['1d6', '2d6', '3d6', '1d10', '2d10', '1d100', '4d6', '6d6'].map(x => `<button class="btn sm" data-roll="${x}">${x}</button>`).join('')}</div><div id="dOut"></div></div>
    <div class="card"><h3>Hazards</h3>
      <div class="row">Fall distance <input id="fFeet" type="number" value="20" style="width:70px"> ft <button class="btn" id="fRoll">Falling damage</button></div>
      <p class="sm muted" style="margin:2px 0 8px">1d6 P per 10 ft. Reaction Agility RR: tier 2 −1d6, tier 3 −2d6.</p>
      <div class="row">Object is <select id="topSize">${[0, 1, 2, 3, 4].map(n => `<option value="${n}">${n === 0 ? 'same size as' : n + ' size' + (n > 1 ? 's' : '') + ' larger than'}</option>`).join('')}</select> target <button class="btn" id="topRoll">Toppling damage</button></div>
      <p class="sm muted" style="margin:2px 0">1d10 + 2d10 per size category larger.</p>
      <div class="row" style="margin-top:8px"><button class="btn" id="hexLost">Lost: which hex? (d6)</button></div><div id="hOut"></div></div>
  </div>`;
  const out = (id, h) => { $(id).innerHTML = `<div class="result">${h}</div>`; };
  $('#tMod').oninput = e => { T.mod = +e.target.value || 0; save(); };
  $('#tBonus').oninput = e => { T.bonus = +e.target.value || 0; save(); };
  $('#tEff').onchange = e => { T.effort = e.target.checked; save(); };
  $$('[data-te]').forEach(c => c.onclick = () => { T.edges = +c.dataset.te; save(); $$('[data-te]').forEach(x => x.classList.toggle('on', x === c)); });
  $$('[data-tb]').forEach(c => c.onclick = () => { T.banes = +c.dataset.tb; save(); $$('[data-tb]').forEach(x => x.classList.toggle('on', x === c)); });
  $('#tRoll').onclick = () => { const r = doTest({ ...T }); addLog(r.html, { quiet: true }); out('#tOut', r.html); };
  $('#sRank').oninput = e => { S.test.rank = +e.target.value || 0; save(); };
  const backlash = () => { const g = D.tables.find(t => t.name === 'Backlashes'); S.tmods[g.gid] = S.test.rank || 0; return rollTable(g.gid, { quiet: true }); };
  $('#sChaos').onclick = () => { const d = rnd(10), rk = S.test.rank || 0, tot = d + rk; let h = `<b>Chaos roll</b>: d10 ${d} + rank ${rk} = <b>${tot}</b> → ${tot >= 8 ? '<span class="doom">BACKLASH</span>' : 'no backlash'}`; addLog(h, { quiet: true }); if (tot >= 8) h += '<hr>' + backlash().html; out('#sOut', h); };
  $('#sBack').onclick = () => out('#sOut', backlash().html);
  $('#mRoll').onclick = () => {
    const cru = +$('#mCru').value || 0; const r = doTest({ mod: +$('#mMind').value || 0, bonus: (+$('#mBon').value || 0) - cru, label: 'Miasma RR (Mind)' });
    let h = r.html;
    if (r.tier === 1) { h += `<br>Gain a level of cruelty (now ${cru + 1}).`; const g = D.tables.find(t => t.name === 'Miasma Effects'); S.tmods[g.gid] = cru + 1; h += '<hr>' + rollTable(g.gid, { quiet: true }).html; $('#mCru').value = cru + 1; }
    else if (r.tier === 3) h += '<br>Remove all cruelty, or improve another human’s result by a tier.'; else h += '<br>No effect.';
    addLog(r.html, { quiet: true }); out('#mOut', h);
  };
  $('#mEff').onclick = () => { const g = D.tables.find(t => t.name === 'Miasma Effects'); S.tmods[g.gid] = +$('#mCru').value || 0; out('#mOut', rollTable(g.gid, { quiet: true }).html); };
  $('#gCalc').onclick = () => { const v = +$('#gVal').value || 0, dt = +$('#gDT').value || 1, g = greed(dt); out('#gOut', `${v} gc found in DT ${dt}: ${g ? `+${g}% → <b>${Math.floor(v * (1 + g / 100))} gc</b>` : 'no greed bonus'} <span class="sm muted">(first visit only)</span>`); };
  $('#dRoll').onclick = () => { const r = rollExpr($('#dExpr').value || '1d6'); if (!r) return; const h = `<b>${esc($('#dExpr').value)}</b>: ${r.text} = <b>${r.total}</b>`; addLog(h, { quiet: true }); out('#dOut', h); };
  $('#dExpr').onkeydown = e => { if (e.key === 'Enter') $('#dRoll').click(); };
  $('#fRoll').onclick = () => { const n = Math.floor((+$('#fFeet').value || 0) / 10); const r = rollExpr(n + 'd6'); const h = n ? `<b>Fall ${n * 10} ft</b>: ${r.text} = <b>${r.total} P dam</b>` : 'Under 10 ft: no damage.'; addLog(h, { quiet: true }); out('#hOut', h); };
  $('#topRoll').onclick = () => { const k = +$('#topSize').value; const r = rollExpr(`1d10+${2 * k}d10`.replace('+0d10', '')); const h = `<b>Toppled object</b> (${k} size${k === 1 ? '' : 's'} larger): ${r.text} = <b>${r.total} dam</b>`; addLog(h, { quiet: true }); out('#hOut', h); };
  $('#hexLost').onclick = () => { const d = rnd(6); const h = `<b>Lost</b>: d6 = ${d} → the group actually moves <b>${['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'][d - 1]}</b> (count clockwise from the northern hex). Keep it secret!`; addLog(h, { quiet: true }); out('#hOut', h); };
};

/* ---------------- travel roles ---------------- */
const ROLE_DEFS = {
  supporter: { n: 'Supporter', many: true, h: 'rules-supporter', blurb: 'Helps the others do their jobs. Any number. Rolls first.', tasks: [
    { k: 'fight', n: 'Fight the Miasma', safe: true, h: 'rules-safe-fight-the-miasma', eff: 'Pick an ally: +1 on their next Mind RR against the Miasma.' },
    { k: 'support', n: 'Support Everyone', roll: '2d10 + M or S', h: 'rules-risky-support-everyone', t: ['Up to 3 allies in roles take −1 on role tests today.', 'Up to 3 allies in roles gain +1 on role tests today.', 'Up to 3 allies in roles gain +2 on role tests today.'] }] },
  guide: { n: 'Guide', one: true, h: 'rules-guide', blurb: 'Leads the way. Only one. Rolls after supporters.', tasks: [
    { k: 'normal', n: 'Normal Route', safe: true, h: 'rules-safe-normal-route', eff: '+1 hex today.' },
    { k: 'secret', n: 'Secret Path', roll: '2d10 + A or M', h: 'rules-risky-secret-path', t: ['The group gets LOST.', 'Travel EN −1, but 1 hex less today.', 'Travel EN −2.'] },
    { k: 'shortcut', n: 'Shortcut', roll: '2d10 + A or M', h: 'rules-risky-shortcut', t: ['The group gets LOST.', '+1 hex, but travel EN +1.', '+2 hexes.'] },
    { k: 'back', n: 'Back on Track (only while lost)', roll: '2d10 + M', h: 'rules-risky-back-on-track', t: ['Still lost.', 'You realize where you are at the end of today’s journey.', 'You realize where you are at the start of today’s journey.'] }] },
  scout: { n: 'Scout', one: true, h: 'rules-scout', blurb: 'Watches for danger, shelter and treasure. Only one (two if one Scouts for Places).', tasks: [
    { k: 'danger', n: 'Scout for Danger', safe: true, h: 'rules-safe-scout-for-danger', eff: 'Travel EN −1 today.' },
    { k: 'places', n: 'Scout for Places', safe: true, h: 'rules-safe-scout-for-places', eff: 'Find any unknown POI, dungeon or village in the hexes you cross. A second scout may take a different task.' },
    { k: 'shelter', n: 'Scout for Shelter', roll: '2d10 + A or M', h: 'rules-risky-scout-for-shelter', t: ['Extra encounter check the next time you rest outdoors.', 'Resting outdoors today: EN −1. Travel EN +1.', 'Found a ruin to rest in outside the Miasma (10% chance it’s already inhabited).'] },
    { k: 'treasure', n: 'Treasure Hunt', roll: '2d10 + M or S', h: 'rules-risky-treasure-hunt', t: ['Extra travel encounter check.', 'Roll on Minor Treasures, plus an extra travel encounter check.', 'Roll on Minor Treasures.'] }] },
  tracker: { n: 'Tracker', many: true, h: 'rules-tracker', blurb: 'Finds food or a specific creature. Any number. Rolls last.', tasks: [
    { k: 'forage', n: 'Forage', safe: true, h: 'rules-safe-forage', eff: 'Gain 1 ration.' },
    { k: 'hunt', n: 'Hunt', roll: '2d10 + A or S', h: 'rules-risky-hunt', t: ['Extra travel encounter check.', 'Gain 1d6 rations; travel EN +1.', 'Gain 3d6 rations and 1d6 animal parts.'] },
    { k: 'track', n: 'Track Specific Creature', roll: '2d10 + A or M', h: 'rules-risky-track-specific-creature', t: ['Extra travel encounter check.', 'You find a sign; the creature is 1 hex off your path (Ref picks the hex).', 'You meet the creature today (Ref picks when and where).'] }] },
};
const ROLE_ORDER = ['supporter', 'guide', 'scout', 'tracker'];
function taskDef(r) { return ROLE_DEFS[r.role]?.tasks.find(t => t.k === r.task); }
function supportBonus() { const s = (S.travel.roles || []).find(r => r.role === 'supporter' && r.task === 'support' && r.tier); return s ? [0, -1, 1, 2][s.tier] : 0; }
function travelCalc() {
  const T = S.travel; const base = travelBaseEN();
  let hex = { slow: 1, normal: 2, fast: 3 }[T.pace] || 2, en = base, restAdj = 0, extra = 0, extraRest = 0, lost = !!T.lost; const notes = [];
  hex += { s3: -1, normal: 0, s7: 1, s10: 2 }[T.slow] || 0;
  if (T.road) hex += 1; if (T.river) hex -= 1; if (T.down) hex += 1;
  for (const r of T.roles || []) {
    const t = r.tier || 0, who = r.who ? esc(r.who) + ': ' : '';
    switch (r.task) {
      case 'normal': hex += 1; break;
      case 'secret': if (t === 1) lost = true; if (t === 2) { en -= 1; hex -= 1; } if (t === 3) en -= 2; break;
      case 'shortcut': if (t === 1) lost = true; if (t === 2) { hex += 1; en += 1; } if (t === 3) hex += 2; break;
      case 'back': if (t === 2) notes.push(who + 'the group finds its bearings at the end of today.'); if (t === 3) { lost = false; notes.push(who + 'the group knows where it is from the start of today.'); } break;
      case 'danger': en -= 1; break;
      case 'places': notes.push(who + 'reveal any unknown POIs, dungeons or villages in the hexes crossed.'); break;
      case 'shelter': if (t === 1) extraRest++; if (t === 2) { restAdj -= 1; en += 1; } if (t === 3) notes.push(who + 'found a ruin to rest outside the Miasma (10% inhabited).'); break;
      case 'treasure': if (t === 1 || t === 2) extra++; if (t >= 2) notes.push(who + `found treasure <button class="btn sm" data-rollt="${TB('Minor Treasures').gid}">🎲 Minor Treasures</button>`); break;
      case 'forage': notes.push(who + '+1 ration.'); break;
      case 'hunt': if (t === 1) extra++; if (t === 2) { en += 1; notes.push(who + `<button class="btn sm" data-roll="1d6">🎲 1d6 rations</button>`); } if (t === 3) notes.push(who + `<button class="btn sm" data-roll="3d6">🎲 3d6 rations</button> <button class="btn sm" data-roll="1d6">🎲 1d6 animal parts</button>`); break;
      case 'track': if (t === 1) extra++; if (t === 2) notes.push(who + 'found a sign; the creature is 1 hex off the path.'); if (t === 3) notes.push(who + 'meets the tracked creature today.'); break;
      case 'fight': notes.push(who + `+1 to ${r.target ? esc(r.target) + '’s' : 'an ally’s'} next Miasma RR.`); break;
    }
  }
  en += +T.enx || 0;
  return { hex: Math.max(0, hex), en: Math.max(1, en), restEn: Math.max(1, base + restAdj), extra, extraRest, lost, notes };
}

/* ---------------- views: travel day ---------------- */
VIEWS.travel = () => {
  const T = S.travel; T.roles = T.roles || [];
  const L = (id, t = 'rules') => HEAD[id] ? ` <a class="rlink sm" data-h="${id}">${t}</a>` : '';
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  $('#main').innerHTML = `<div class="page-title"><h1>Travel day</h1><span class="muted">Follow the steps top to bottom. Hexes are 5 miles. Day ${T.day || 1}.</span><span class="sp"></span><button class="btn" id="trNew">Start a new travel day</button></div>
  <div class="grid dash">
    <div class="card"><h3><span class="stepn">1</span>Pace &amp; route${L('rules-travel-pace')}</h3>
      <div class="kv">
        <span>Pace</span><select data-t="pace"><option value="slow">Slow — 1 hex · EN 2 · role tests gain an edge</option><option value="normal">Normal — 2 hexes · EN 4</option><option value="fast">Fast — 3 hexes · EN 6 · role tests take a bane</option></select>
        <span>Slowest speed</span><select data-t="slow"><option value="s3">3 or lower (−1 hex)</option><option value="normal">4–6</option><option value="s7">7–9 (+1 hex)</option><option value="s10">10+ (+2 hexes)</option></select>
        <span>Route</span><span><label><input type="checkbox" data-t="road"> Road all day (+1 hex)</label><br><label><input type="checkbox" data-t="river"> Cross a river without a bridge, or go upstream (−1)</label><br><label><input type="checkbox" data-t="down"> Downstream on water (+1)</label></span>
        <span>Habitat</span>${sel('trHab', Object.keys(HABITATS), S.enc.habitat)}
        <span>Nearest dungeon</span>${sel('trNear', ['Angel', 'Blood', 'Demon', 'Plant', 'Undead'], S.enc.nearby)}
        <span>Climate / season</span>${sel('trClim', Object.keys(WEATHER), S.enc.climate)}
      </div>
      <p class="sm muted" style="margin-bottom:0">The group moves at the speed of its slowest member (mount or vehicle counts). Habitat, nearest dungeon and climate feed the Encounter hub.</p></div>

    <div class="card wide"><div class="row"><h3 style="margin:0"><span class="stepn">2</span>Travel roles${L('rules-travel-roles')}</h3><span class="sp"></span>${ROLE_ORDER.map(k => `<button class="btn sm" data-addrole="${k}">+ ${ROLE_DEFS[k].n}</button>`).join('')}</div>
      <p class="sm muted">Resolve in order: supporters → guide → scout → trackers. Safe tasks just work. Risky tasks roll 2d10 + the listed characteristic${T.pace === 'slow' ? ' <b>with an edge (slow pace)</b>' : T.pace === 'fast' ? ' <b>with a bane (fast pace)</b>' : ''}. Anyone without a role can assist a risky task.${supportBonus() ? ` <b>Support Everyone: ${supportBonus() > 0 ? '+' : ''}${supportBonus()}</b> for up to 3 allies (tick “supported”).` : ''}</p>
      <div id="roleBoard"></div></div>

    <div class="card"><h3><span class="stepn">3</span>How far &amp; how dangerous</h3><div id="trOut"></div></div>

    <div class="card"><h3><span class="stepn">4</span>Encounter checks${L('rules-encounters-and-pois')}</h3>
      <p class="sm muted" style="margin-top:0">Two checks per travel day, plus any extras from risky roles. You choose when during the day an encounter happens. Points of interest on the route are run with dungeon turns.</p>
      <button class="btn primary" id="trEnc">Roll today’s encounter checks</button><div id="trRes"></div></div>

    <div class="card ${travelCalc().lost ? 'lostcard' : ''}"><h3><span class="stepn">5</span>Getting lost${L('rules-lost')}</h3>
      <div class="row"><label><input type="checkbox" id="trLostFlag" ${T.lost ? 'checked' : ''}> The group is lost</label><button class="btn sm" id="trLost">🎲 Which hex? (d6)</button></div>
      <p class="sm muted" style="margin-bottom:0">Roll secretly each time a lost group leaves a hex. Count clockwise from the northern hex: 1 N · 2 NE · 3 SE · 4 S · 5 SW · 6 NW. Next day, the guide can only try <i>Back on Track</i> (or the group finds a map, a landmark or directions).</p><div id="trLostOut"></div></div>

    <div class="card"><h3><span class="stepn">6</span>End of the day</h3><ol class="checklist">
      <li>Reached a dungeon or POI? Switch to dungeon turns on <a href="#/session">Session</a>.</li>
      <li>Make camp and rest: encounter check, rest activities, Miasma RRs. <a class="btn sm" href="#/rest" id="trCamp">Go to Rest →</a></li></ol></div>
  </div>
  <h2>Travel roles reference</h2><p class="muted sm">Read these out when the players pick roles. Click a task name for the full rule.</p>
  <div class="grid rolesref">${ROLE_ORDER.map(k => { const d = ROLE_DEFS[k]; return `<div class="card"><h3 style="margin-top:0">${d.n}${L(d.h)}</h3><p class="sm muted">${d.blurb}</p>${d.tasks.map(t => `<div class="taskref"><div class="row"><span class="badge ${t.safe ? 'safe' : 'risky'}">${t.safe ? 'Safe' : 'Risky'}</span><span class="rlink" data-h="${t.h}"><b>${esc(t.n)}</b></span>${t.roll ? `<span class="faint sm">${t.roll}</span>` : ''}</div>${t.safe ? `<div class="sm">${esc(t.eff)}</div>` : `<div class="sm">${t.t.map((x, i) => `<div><span class="g g${i + 1}">${TIER_LBL[i + 1]}</span>${esc(x)}</div>`).join('')}</div>`}</div>`).join('')}</div>`; }).join('')}</div>`;

  $$('[data-t]').forEach(el => {
    const k = el.dataset.t; if (el.type === 'checkbox') el.checked = !!T[k]; else el.value = T[k] ?? el.value;
    el.onchange = () => { T[k] = el.type === 'checkbox' ? el.checked : el.value; save(); VIEWS.travel(); };
  });
  $('#trHab').onchange = e => { S.enc.habitat = e.target.value; save(); };
  $('#trNear').onchange = e => { S.enc.nearby = e.target.value; save(); };
  $('#trClim').onchange = e => { S.enc.climate = e.target.value; save(); };
  $$('[data-addrole]').forEach(b => b.onclick = () => { const k = b.dataset.addrole; const d = ROLE_DEFS[k]; T.roles.push({ id: uid(), role: k, who: '', task: d.tasks[0].k, tier: 0, mod: 0, sup: false }); save(); VIEWS.travel(); });
  renderRoleBoard(); renderTravelOut();
  $('#trEnc').onclick = () => {
    const tc = travelCalc(); S.en.ctx = 'travel'; const out = $('#trRes'); out.innerHTML = '';
    const n = 2 + tc.extra;
    for (let i = 0; i < n; i++) encounterCheck(out, { ctx: 'travel', label: i < 2 ? ['Morning check', 'Afternoon check'][i] : `Extra check ${i - 1}`, append: true, quiet: true });
    save();
  };
  $('#trLostFlag').onchange = e => { T.lost = e.target.checked; save(); VIEWS.travel(); };
  $('#trLost').onclick = () => { const d = rnd(6); const h = `<b>Lost</b>: d6 = ${d} → they actually enter the hex to the <b>${['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'][d - 1]}</b>. Keep it secret!`; addLog(h, { quiet: true }); $('#trLostOut').innerHTML = `<div class="result">${h}</div>`; };
  $('#trCamp').onclick = () => { S.rest.where = S.rest.where === 'dungeon' ? 'miasma' : S.rest.where; S.en.ctx = 'trest'; save(); };
  $('#trNew').onclick = () => {
    if (!confirm('Start a new travel day? Role assignments stay; today’s rolls are cleared.')) return;
    const tc = travelCalc(); T.lost = tc.lost; T.day = (T.day || 1) + 1;
    T.roles.forEach(r => { r.tier = 0; r.roll = ''; r.sup = false; if (T.lost && r.role === 'guide') r.task = 'back'; if (!T.lost && r.task === 'back') r.task = 'normal'; });
    save(); VIEWS.travel();
  };
};
function renderRoleBoard() {
  const T = S.travel, el = $('#roleBoard'); if (!el) return;
  const roles = [...T.roles].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const names = S.roster.map(r => r.name);
  const guides = roles.filter(r => r.role === 'guide').length, scouts = roles.filter(r => r.role === 'scout');
  const warn = [];
  if (guides > 1) warn.push('Only one guide at a time.');
  if (scouts.length > 2 || (scouts.length === 2 && !scouts.some(s => s.task === 'places'))) warn.push('Only one scout — unless one of them takes Scout for Places.');
  el.innerHTML = (roles.length ? roles.map(r => {
    const d = ROLE_DEFS[r.role], t = taskDef(r) || d.tasks[0];
    return `<div class="rolerow" data-role="${r.id}">
      <div class="row"><span class="badge">${d.n}</span>
        <input data-rf="who" list="rosterNames" placeholder="Who?" value="${esc(r.who || '')}" style="width:130px">
        <select data-rf="task">${d.tasks.filter(x => x.k !== 'back' || T.lost || r.task === 'back').map(x => `<option value="${x.k}" ${x.k === r.task ? 'selected' : ''}>${x.safe ? 'Safe' : 'Risky'}: ${esc(x.n)}</option>`).join('')}</select>
        ${t.k === 'fight' ? `<input data-rf="target" list="rosterNames" placeholder="Which ally?" value="${esc(r.target || '')}" style="width:120px">` : ''}
        ${t.safe ? `<span class="sm">${esc(t.eff)}</span>` : `<span class="faint sm">${t.roll} +</span><input data-rf="mod" type="number" value="${r.mod || 0}" style="width:52px" title="Characteristic + assists + other bonuses">
          ${supportBonus() && r.role !== 'supporter' ? `<label class="sm"><input type="checkbox" data-rf="sup" ${r.sup ? 'checked' : ''}> supported</label>` : ''}
          <button class="btn sm primary" data-rroll>Roll</button>
          ${[1, 2, 3].map(n => `<span class="chip ${r.tier === n ? 'on' : ''}" data-tier="${n}" title="Set the result by hand">${TIER_LBL[n]}</span>`).join('')}`}
        <span class="sp"></span><button class="icon-btn" data-rdel title="Remove">✕</button></div>
      ${!t.safe && r.tier ? `<div class="sm rolres"><span class="g g${r.tier}">${TIER_LBL[r.tier]}</span>${esc(t.t[r.tier - 1])}${r.roll ? ` <span class="faint">(${r.roll})</span>` : ''}</div>` : ''}
    </div>`;
  }).join('') : '<p class="muted sm">No roles yet. Add a guide, a scout and whoever else wants a job today.</p>')
    + (warn.length ? `<div class="notice sm">${warn.join(' ')}</div>` : '')
    + `<datalist id="rosterNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  $$('.rolerow', el).forEach(row => {
    const r = T.roles.find(x => x.id === row.dataset.role);
    $$('[data-rf]', row).forEach(inp => inp.onchange = () => { const k = inp.dataset.rf; r[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value || 0) : inp.value; if (k === 'task') { r.tier = 0; r.roll = ''; } save(); renderRoleBoard(); renderTravelOut(); });
    $$('[data-tier]', row).forEach(c => c.onclick = () => { r.tier = r.tier === +c.dataset.tier ? 0 : +c.dataset.tier; r.roll = ''; save(); renderRoleBoard(); renderTravelOut(); });
    const rb = $('[data-rroll]', row); if (rb) rb.onclick = () => {
      const t = taskDef(r); const bonus = r.sup && r.role !== 'supporter' ? supportBonus() : 0;
      const res = doTest({ mod: +r.mod || 0, bonus, edges: S.travel.pace === 'slow' ? 1 : 0, banes: S.travel.pace === 'fast' ? 1 : 0, label: `${r.who || ROLE_DEFS[r.role].n}: ${t.n}` });
      r.tier = res.tier; r.roll = `${res.total}${res.crit ? ', crit' : res.doom ? ', doom' : ''}`; addLog(res.html + '<br>' + esc(t.t[res.tier - 1]), { quiet: true }); save(); renderRoleBoard(); renderTravelOut();
    };
    $('[data-rdel]', row).onclick = () => { T.roles = T.roles.filter(x => x.id !== r.id); save(); VIEWS.travel(); };
  });
}
function renderTravelOut() {
  const el = $('#trOut'); if (!el) return; const tc = travelCalc();
  el.innerHTML = `<div class="big" style="font-size:1.6rem;font-weight:700">${tc.hex} hex${tc.hex === 1 ? '' : 'es'} <span class="muted" style="font-size:1rem">(${tc.hex * 5} miles)</span></div>
    <div class="kv sm" style="margin-top:6px"><span>Travel EN</span><b>${tc.en}</b><span>Encounter checks today</span><b>${2 + tc.extra}${tc.extra ? ` (2 + ${tc.extra} extra)` : ''}</b><span>Rest EN tonight</span><b>${tc.restEn}${tc.extraRest ? ` + ${tc.extraRest} extra check` : ''}</b>
    <span>Other EN changes</span><input type="number" id="trEnx" value="${S.travel.enx || 0}" style="width:60px"></div>
    ${tc.lost ? '<div class="notice sm" style="margin-top:8px"><b>The group is lost.</b> Roll a direction in step 5 each time they leave a hex.</div>' : ''}
    ${tc.notes.length ? `<ul class="sm" style="padding-left:18px;margin:8px 0 0">${tc.notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="sm muted" style="margin-bottom:0">Bad weather cuts travel: rain −1 hex; thunderstorm, sandstorm or blizzard −2.</p>`;
  $('#trEnx').onchange = e => { S.travel.enx = +e.target.value || 0; save(); renderTravelOut(); };
}

/* ---------------- views: rest ---------------- */
const REST_ACTS = [
  ['', '— no activity —', null], ['sleep', 'Good Night’s Rest', 'rules-good-night-s-rest'], ['craft', 'Craft Equipment', 'rules-craft-equipment'],
  ['harvest', 'Harvest a monster corpse', 'rules-harvest'], ['identify', 'Identify Item', 'rules-identify-item'], ['repair', 'Repair Armor', 'rules-repair-armor'],
  ['seclude', 'Seclude Camp', 'rules-seclude-camp'], ['tend', 'Tend Wounds', 'rules-tend-wounds'], ['watch', 'Keep watch / other', null]];
const REST_WHERE = { miasma: 'Outdoors in the Miasma', clear: 'Outdoors, no Miasma (ruin, beacon)', dungeon: 'In a dungeon', village: 'In a village' };
function restPC(name) { const P = S.rest.pcs; return P[name] ||= { ate: true, act: '', target: '', mind: 0, cru: 0, res: '' }; }
VIEWS.rest = () => {
  const R = S.rest; const inMiasma = R.where === 'miasma';
  const L = (id, t = 'rules') => HEAD[id] ? ` <a class="rlink sm" data-h="${id}">${t}</a>` : '';
  const ctx = R.where === 'dungeon' ? 'drest' : 'trest';
  const seclude = S.roster.some(r => restPC(r.name).act === 'seclude');
  if (S.en.seclude !== seclude && S.roster.length) { S.en.seclude = seclude; save(); }
  const resting = S.dt.resting;
  $('#main').innerHTML = `<div class="page-title"><h1>Rest</h1><span class="muted">Night ${R.day || 1}. Six uninterrupted hours, four of them asleep, and a ration each.</span></div>
  <div class="grid dash">
    <div class="card"><h3><span class="stepn">1</span>Where are you resting?</h3>
      <div class="row">${Object.entries(REST_WHERE).map(([k, l]) => `<span class="chip ${R.where === k ? 'on' : ''}" data-where="${k}">${l}</span>`).join('')}</div>
      <ul class="sm" style="padding-left:18px">
        <li>A rest ends the current dungeon turn <b>without</b> an encounter check. Halfway through, effects that end or roll UD at the end of a DT end. A new DT starts when the rest ends.${L('rules-resting')}</li>
        <li>Interrupted by combat or other strenuous activity? Start over to get the benefits.</li>
        <li>After finishing a rest you can’t benefit from another for 6 hours or 3 DTs.</li>
        <li>${inMiasma ? '<b>In the Miasma: no Effort comes back</b> (Good Night’s Rest still gives +1), and each human makes a Mind RR afterwards.' : 'Outside the Miasma: Effort comes back, and everyone loses all cruelty levels.'}</li></ul>
      ${S.dt.num ? (resting ? `<div class="notice sm">Resting — DT ${S.dt.num} has ended. Finishing the rest starts DT ${S.dt.num + 1}.</div>` : `<button class="btn" id="rsStart">Start resting (ends DT ${S.dt.num}, no encounter check)</button>`) : ''}</div>

    <div class="card" id="rsEnc"><h3><span class="stepn">2</span>Rest encounter check${L('rules-rest-encounters')}</h3>
      <p class="sm muted" style="margin-top:0">${ctx === 'drest' ? 'Uses the dungeon’s EN (3–5).' : 'Uses today’s travel pace EN (slow 2 · normal 4 · fast 6), plus Scout for Shelter results.'} Seclude Camp lowers it by 1 ${seclude ? '<b>(someone is secluding camp)</b>' : ''}.</p>
      <p style="margin:4px 0">EN <b class="enVal" style="font-size:1.4rem">${enValue(ctx)}</b>${ctx === 'trest' && travelCalc().extraRest ? ` · <b>${travelCalc().extraRest} extra check</b> (Scout for Shelter)` : ''}</p>
      <button class="btn primary" id="rsCheck">Roll rest encounter check${ctx === 'trest' && travelCalc().extraRest ? 's' : ''}</button><div id="rsOut"></div></div>

    <div class="card wide"><h3><span class="stepn">3</span>Who’s doing what tonight${L('rules-rest-activities', 'activities')}</h3>
      ${S.roster.length ? `<div id="rsPCs"></div>` : `<p class="muted">Add your party on <a href="#/notes">Notes &amp; roster</a> to track each PC’s rest.</p>`}
      <details class="sm" style="margin-top:8px"><summary class="muted">What each activity does</summary><ul style="padding-left:18px">${REST_ACTS.filter(a => a[2]).map(a => `<li><span class="rlink" data-h="${a[2]}"><b>${a[1]}</b></span>: ${esc(ruleTip(a[2]))}</li>`).join('')}</ul></details></div>

    <div class="card"><h3><span class="stepn">4</span>When the rest finishes</h3><div id="rsSum"></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="rsFinish">Finish rest</button><button class="btn" id="rsInterrupt">Rest interrupted</button></div>
      <p class="sm muted">Finish rest: logs the night, restores usage dice marked “restores on rest”, clears DT conditions, ${S.dt.num ? `starts DT ${S.dt.num + 1}, ` : ''}and moves to night ${(R.day || 1) + 1}.</p></div>

    <div class="card"><h3>No rest, no food${L('rules-exhaustion')}</h3><ul class="sm" style="padding-left:18px;margin:0">
      <li>Each day without finishing a rest: an <b>exhaustion wound</b> (all removed by a finished rest).</li>
      <li>Each day without 1 ration: a <b>starvation wound</b> (all removed by eating 1 ration).</li>
      <li>Rest activities outside a rest take about 2 hours each, up to 4 a day.</li></ul>
      ${(R.log || []).length ? `<details style="margin-top:8px"><summary class="sm muted">Past nights (${R.log.length})</summary>${R.log.map(l => `<div class="sm" style="border-bottom:1px solid #23272c;padding:4px 0">${l}</div>`).join('')}</details>` : ''}</div>
  </div>`;
  $$('[data-where]').forEach(c => c.onclick = () => { R.where = c.dataset.where; S.en.ctx = R.where === 'dungeon' ? 'drest' : 'trest'; save(); VIEWS.rest(); });
  if ($('#rsStart')) $('#rsStart').onclick = () => { if (S.dt.running) S.dt.left = dtLeft(); S.dt.running = false; S.dt.pendingEnd = false; S.dt.resting = true; save(); addLog(`<b>Rest begins</b> — DT ${S.dt.num} ends (no encounter check).`, { quiet: true }); VIEWS.rest(); tick(); };
  $('#rsCheck').onclick = () => {
    S.en.ctx = ctx; const out = $('#rsOut'); out.innerHTML = '';
    const n = 1 + (ctx === 'trest' ? travelCalc().extraRest : 0);
    for (let i = 0; i < n; i++) encounterCheck(out, { ctx, label: n > 1 ? `Rest check ${i + 1}` : 'Rest check', append: true, quiet: true });
    save();
  };
  renderRestPCs(); renderRestSum();
  $('#rsFinish').onclick = finishRest;
  $('#rsInterrupt').onclick = () => { addLog(`<b>Rest interrupted</b> (night ${R.day || 1}) — start over to get the benefits.`); };
};
function renderRestPCs() {
  const el = $('#rsPCs'); if (!el) return; const R = S.rest, inMiasma = R.where === 'miasma';
  el.innerHTML = `<div class="restgrid"><div class="rh">PC</div><div class="rh">Ate</div><div class="rh">Activity</div><div class="rh">${inMiasma ? 'Miasma RR (after)' : 'Cruelty'}</div>` + S.roster.map(r => {
    const p = restPC(r.name);
    const extra = p.act === 'tend' ? `<select data-p="target"><option value="">Whose wounds?</option>${S.roster.filter(x => x.name !== r.name).map(x => `<option ${p.target === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
      : p.act === 'harvest' ? `<select data-p="size">${['Medium or smaller|1d6', 'Large|2d6', 'Huge|3d6', 'Holy Shit!|4d6'].map(s => `<option value="${s.split('|')[1]}" ${p.size === s.split('|')[1] ? 'selected' : ''}>${s.split('|')[0]}</option>`).join('')}</select><button class="btn sm" data-harv>🎲 Parts</button>`
        : p.act === 'craft' ? `<span class="sm">Mind</span><input type="number" data-p="mind" value="${p.mind || 0}" style="width:48px"><label class="sm"><input type="checkbox" data-p="eff" ${p.eff ? 'checked' : ''}> Effort/double edge (+4)</label><button class="btn sm" data-craft>🎲 Crafting roll</button>` : '';
    return `<div><b>${esc(r.name)}</b></div>
      <div><input type="checkbox" data-pn="${esc(r.name)}" data-p="ate" ${p.ate ? 'checked' : ''} title="Ate at least 1 ration"></div>
      <div class="row" data-pn="${esc(r.name)}"><select data-p="act">${REST_ACTS.map(a => `<option value="${a[0]}" ${p.act === a[0] ? 'selected' : ''}>${a[1]}</option>`).join('')}</select>${extra}${p.res ? `<span class="sm">${p.res}</span>` : ''}</div>
      <div class="row" data-pn="${esc(r.name)}">${inMiasma ? `<span class="sm">Mind</span><input type="number" data-p="mind" value="${p.mind || 0}" style="width:48px"><span class="sm">Cruelty</span><input type="number" min="0" data-p="cru" value="${p.cru || 0}" style="width:48px"><button class="btn sm" data-mia>🎲 RR</button>${p.mres ? `<span class="sm">${p.mres}</span>` : ''}` : `<span class="sm">Cruelty ${p.cru || 0}${p.cru ? ' → 0 when this rest finishes' : ''}</span>`}</div>`;
  }).join('') + '</div>';
  $$('[data-pn]', el).forEach(box => {
    const name = box.dataset.pn, p = restPC(name);
    const bind = inp => inp.onchange = () => { const k = inp.dataset.p; p[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value || 0) : inp.value; if (k === 'act') p.res = ''; save(); if (k === 'act' || k === 'ate') VIEWS.rest(); else renderRestSum(); };
    if (box.matches('[data-p]')) bind(box); $$('[data-p]', box).forEach(bind);
    const h = $('[data-harv]', box); if (h) h.onclick = () => { const r = rollExpr(p.size || '1d6'); p.res = `<b>${r.total} parts</b> (${r.text}) — the corpse is used up`; addLog(`<b>${esc(name)}</b> harvests ${p.res}`, { quiet: true }); save(); renderRestPCs(); };
    const c = $('[data-craft]', box); if (c) c.onclick = () => {
      const a = rnd(10), b = rnd(10), nat = a + b; let pts, extra = '';
      if (nat <= 3) { pts = 0; extra = ' — doom: no points'; } else { pts = Math.max(1, nat + (+p.mind || 0) + (p.eff ? 4 : 0)); if (nat >= 19) extra = ' — crit: make another crafting roll for the same item!'; }
      p.res = `<b>+${pts} crafting points</b> [${a}, ${b}]${extra}`; addLog(`<b>${esc(name)}</b> crafting roll: ${p.res}`, { quiet: true }); save(); renderRestPCs();
    };
    const m = $('[data-mia]', box); if (m) m.onclick = () => {
      const cru = +p.cru || 0; const r = doTest({ mod: +p.mind || 0, bonus: -cru, label: `${name}: Miasma RR` });
      let out = r.html;
      if (r.tier === 1) { p.cru = cru + 1; const g = TB('Miasma Effects'); S.tmods[g.gid] = p.cru; const e = rollTable(g.gid, { quiet: true }); out += `<br>Cruelty → ${p.cru}. ${e.html}`; p.mres = `<span class="tierlbl t1">T1</span> cruelty ${p.cru}, effect rolled (see log)`; }
      else if (r.tier === 3) { p.cru = 0; out += '<br>Removes all cruelty (or helps another human by a tier).'; p.mres = '<span class="tierlbl t3">T3</span> cruelty cleared'; }
      else { out += '<br>No effect.'; p.mres = '<span class="tierlbl t2">T2</span> no effect'; }
      addLog(out); save(); renderRestPCs();
    };
  });
}
function restSummary() {
  const R = S.rest, inMiasma = R.where === 'miasma';
  return S.roster.map(r => {
    const p = restPC(r.name); const tended = S.roster.some(o => o.name !== r.name && restPC(o.name).act === 'tend' && restPC(o.name).target === r.name);
    const bits = ['all Stamina back', tended ? '<b>−2 wounds</b> (tended)' : '−1 wound', 'exhaustion wounds gone'];
    bits.push(inMiasma ? (p.act === 'sleep' ? 'Effort: none back (Miasma), <b>+1 extra</b> from Good Night’s Rest' : '<b>no Effort back</b> (Miasma)') : 'Effort back to max' + (p.act === 'sleep' ? ' <b>+1 extra</b>' : ''));
    if (!p.ate) bits.push('<b style="color:var(--bad)">no ration: starvation wound for the day</b>');
    if (p.act === 'repair') bits.push('one armor or shield back to full AD');
    if (p.act === 'identify') bits.push('learns one magic item’s properties');
    if (!inMiasma && p.cru) bits.push('cruelty cleared');
    return `<li><b>${esc(r.name)}</b>: ${bits.join(' · ')}</li>`;
  }).join('');
}
function renderRestSum() {
  const el = $('#rsSum'); if (!el) return;
  const ud = S.ud.filter(u => u.rest);
  el.innerHTML = (S.roster.length ? `<ul class="sm" style="padding-left:18px;margin:0">${restSummary()}</ul>` : '<p class="sm">Everyone: all Stamina back, −1 wound (−2 if tended), exhaustion wounds removed, Effort back unless resting in the Miasma.</p>')
    + `<p class="sm" style="margin:6px 0 0">Spellbooks and other “Rest” items regain their UD.${ud.length ? ` Tracked: ${ud.map(u => esc(u.name)).join(', ')}.` : ' (Tick “restores on rest” when adding usage dice on Session to have them refilled automatically.)'}</p>`;
}
function finishRest() {
  const R = S.rest, inMiasma = R.where === 'miasma';
  const night = R.day || 1;
  const summary = `<b>Night ${night}</b> — ${esc(REST_WHERE[R.where])}<ul style="padding-left:18px;margin:4px 0">${restSummary()}</ul>`;
  S.ud.forEach(u => { if (u.rest) { u.dice = u.max; u.last = null; } });
  clearDTConds();
  S.roster.forEach(r => { const p = restPC(r.name); if (!inMiasma) p.cru = 0; p.act = ''; p.target = ''; p.res = ''; p.mres = ''; p.ate = true; });
  S.en.seclude = false; R.log = [summary, ...(R.log || [])].slice(0, 20); R.day = night + 1;
  addLog(`<b>Rest finished</b> (night ${night}).`);
  if (S.dt.num) { S.dt.resting = false; startDT(S.dt.num + 1); }
  save(); VIEWS.rest();
}


/* ---------------- cheat sheet ---------------- */
VIEWS.cheat = () => {
  const L = (id, t) => HEAD[id] ? `<a href="#/book/${HEAD[id].book}/${id}">${t}</a>` : t;
  const cond = Object.entries(CONDS).filter(([k]) => k !== 'surprised').map(([k, v]) => `<li><b>${k[0].toUpperCase() + k.slice(1)}</b>: ${esc(v.text.trim())}</li>`).join('');
  $('#main').innerHTML = `<div class="page-title"><h1>Cheat sheet</h1><span class="muted">Condensed from the Rules booklet; links open the full text.</span></div>
  <div class="cheat">
    <div class="card"><h3>Tests — ${L('rules-tests', 'rules')}</h3><ul>
      <li>Only call for a test if failure is reasonably likely <i>and</i> matters. 80%+ real-world success = no roll. Clever plans just work.</li>
      <li>Roll <b>2d10 + characteristic</b> (Agility, Mind, Strength).</li>
      <li><span class="g g1">≤11</span> fail (maybe a setback) <span class="g g2">12–16</span> partial or success at a cost <span class="g g3">17+</span> clean success.</li>
      <li><b>Crit</b>: natural 19–20 → tier 3 + something extra. On attacks: an extra action.</li>
      <li><b>Doom</b>: natural 2–3 → tier 1 + major setback.</li>
      <li>No retries unless circumstances change significantly.</li></ul></div>
    <div class="card"><h3>Edges &amp; banes — ${L('rules-edges-and-banes', 'rules')}</h3><ul>
      <li>Edge +2 · Bane −2. Two or more = double: no number, shift the tier up/down by one.</li>
      <li>Edge + bane cancel; double edge + double bane cancel.</li>
      <li>Double edge + one bane = one edge; double bane + one edge = one bane.</li>
      <li>Other bonuses/penalties (gear, assists) aren’t edges or banes.</li></ul></div>
    <div class="card"><h3>Effort &amp; expertise — ${L('rules-effort-expertise', 'rules')}</h3><ul>
      <li>After a non-doom result where an expertise applies: spend 1 Effort → +1 tier (max tier 3). One expertise, 1 Effort per test.</li>
      <li>Starting Effort 2; regain on a rest outside the Miasma. Experts can skip amateur-level tests entirely.</li>
      <li><b>Assist</b> (made first): tier 1 −1 · tier 2 +1 · tier 3 +2. <b>Group test</b>: everyone assists the leader.</li>
      <li><b>Hide</b> only when unobserved; sneaking above half speed takes a bane. Hidden: edge on attacks, foes take a bane on your RRs.</li></ul></div>
    <div class="card"><h3>Damage — ${L('rules-damage-and-death', 'rules')}</h3><ul>
      <li>Damage hits armor/shield AD first, then Stamina. PCs, humans and animals then take wounds (1 per point), each filling a backpack slot of their choice.</li>
      <li>Every slot holding a wound and an item: −1 speed. All 10 backpack slots wounded = dead.</li>
      <li><b>P</b> (piercing) damage ignores AD.</li>
      <li>Monsters die at 0 Stamina. Knock ’em out (Ref’s OK): stay at 1 Stamina, unconscious until end of DT.</li>
      <li>Rest: regain all Stamina, lose 1 wound. Tend Wounds: 2 instead.</li></ul></div>
    <div class="card"><h3>Conditions — ${L('rules-conditions', 'rules')}</h3><ul>${cond}</ul><p class="sm muted">Blessed, vulnerable and weakened end at the end of the DT unless noted.</p></div>
    <div class="card"><h3>Combat round — ${L('rules-combat', 'rules')}</h3><ul>
      <li>Each round: d10, 6+ = PCs are Group A. Phases: A fast → B fast → A slow → B slow.</li>
      <li><b>Fast turn</b>: maneuver <i>or</i> action. <b>Slow turn</b>: maneuver + action, or 2 maneuvers.</li>
      <li><b>Maneuvers</b>: Move, Shift 1, Command pet, Draw from pack (d10 ≥ slot #) or belt, Pick up item, Dump backpack, Stand up, Grab, Escape grab, Knockback.</li>
      <li><b>Actions</b>: Attack, Flee (2× speed, edge on OAs vs you), Ready, Taunt (bane on attacks not including you).</li>
      <li><b>Reaction</b> (1/round): Counter when a melee attack/grab/knockback vs you gets tier 1 (deal your weapon’s tier 2 damage; tier 3 on a doom). Opportunity attack when a foe leaves your reach.</li>
      <li>Surprised: no turn in round 1, attacks vs them gain an edge.</li></ul></div>
    <div class="card"><h3>Attacks — ${L('rules-making-attacks', 'rules')}</h3><ul>
      <li>Tier 1 = miss. Melee miss lets the target counter. Ranged miss next to allies: odd die → hits a random ally for tier 2 damage.</li>
      <li>Edge: flanking, high ground (1+ square above), prone target in melee, unseen attacker. Bane: ranged vs adjacent, cover, dim light/light concealment (double: darkness/heavy).</li>
      <li>Ranged beyond range: −2 per extra square. Unarmed: 2d10 + A or S, 1+A/S / 2+A/S.</li>
      <li>Prone: speed halved, bane on melee, melee vs you gains edge, ranged vs you takes bane.</li></ul></div>
    <div class="card"><h3>Dungeon turns — ${L('rules-dungeon-turns', 'rules')}</h3><ul>
      <li>DT = 30 real minutes (20 intense, 60 relaxed, or 1d6 rooms).</li>
      <li>End of DT: roll all UD (d6s; 1–2 removed), then encounter check.</li>
      <li><b>Greed bonus</b> on first visit: treasure found in DT 1 +30%, DT 2 +20%, DT 3 +10%.</li>
      <li><b>Encounter check</b>: d10 ≤ EN. EN 3; 4 if 20+ creatures or a trail of chaos; 5 if both. Also check when PCs are loud. 1 = now; 2+ = sign now, arrives next DT.</li>
      <li>Outside dungeons, 2 hours = 1 DT for UD.</li></ul></div>
    <div class="card"><h3>Resting — ${L('rules-resting', 'rules')}</h3><ul>
      <li>6 uninterrupted hours, 4 asleep, eat 1 ration. Regain all Stamina, −1 wound, Effort (not in the Miasma). Ends the DT (no check).</li>
      <li>One rest activity each: Craft, Good Night’s Rest (+1 Effort), Harvest (1d6/2d6/3d6/4d6 parts), Identify Item, Repair Armor, Seclude Camp (EN −1), Tend Wounds.</li>
      <li>No rest for a day = exhaustion wound; no food for a day = starvation wound.</li></ul></div>
    <div class="card"><h3>Light &amp; senses — ${L('rules-light', 'rules')}</h3><ul>
      <li>Light X/Y = X squares bright, then Y dim. Torch 5/5, lantern 10/10, candle 0/5.</li>
      <li>Dim light: bane to attack or search. Darkness: double bane; guess the square of silent targets.</li>
      <li>Monsters have no darkness penalties.</li></ul></div>
    <div class="card"><h3>Hazards — ${L('rules-common-hazards', 'rules')}</h3><ul>
      <li>Falling: 1d6 P per 10 ft; reaction Agility RR reduces by 1d6 (tier 2) or 2d6 (tier 3).</li>
      <li>Suffocation: hold breath 3 + Strength rounds, then 1d6 P per round.</li>
      <li>Toppling: 1d10 + 2d10 per size larger than the target.</li>
      <li>Jump: 2d10 + A/S (edge with 2+ squares run-up): 0 / 2 squares / 2 + A or S.</li></ul></div>
    <div class="card"><h3>Travel — ${L('rules-overland-travel', 'rules')}</h3><ul>
      <li>Pace: slow 1 hex EN 2 (edge on roles) · normal 2 hexes EN 4 · fast 3 hexes EN 6 (bane on roles).</li>
      <li>Roles: supporters → guide → scouts → trackers. Two encounter checks per travel day.</li>
      <li>After resting outdoors: each human makes a Mind RR vs the Miasma.</li></ul></div>
    <div class="card"><h3>Spellcasting — ${L('rules-spellcasting', 'rules')}</h3><ul>
      <li>Casting = Mind test; may choose a lower tier. Roll the book’s UD each cast (not on a crit). Books recharge on a rest.</li>
      <li>Tier 1 (non-doom): chaos roll d10 + rank; 8+ = backlash. Doom = backlash. Backlash: d100 + rank.</li></ul></div>
  </div>`;
};

/* ---------------- books ---------------- */
VIEWS.book = ([key, hid]) => {
  const bk = D.books[key]; if (!bk) return VIEWS.session();
  let i = hid && HEAD[hid] ? HEAD[hid].i : 0;
  const ch = chapterOf(key, i);
  const tocHTML = bk.toc.filter(t => t.lvl <= (key === 'chars' ? 3 : 3)).map(t => `<a class="l${t.lvl} ${t.id === ch.id ? 'cur' : ''}" href="#/book/${key}/${t.id}">${esc(t.text)}</a>`).join('');
  const idx = CHAPTERS[key].indexOf(ch);
  const prev = CHAPTERS[key][idx - 1], next = CHAPTERS[key][idx + 1];
  const navBtns = `<div class="row" style="margin:20px 0">${prev ? `<a class="btn" href="#/book/${key}/${prev.id || ''}">← ${esc(prev.title)}</a>` : ''}<span class="sp"></span>${next ? `<a class="btn" href="#/book/${key}/${next.id}">${esc(next.title)} →</a>` : ''}</div>`;
  $('#main').innerHTML = `<div class="page-title"><h1>${esc(bk.title)}</h1><span class="muted sm">Chapter ${idx + 1} of ${CHAPTERS[key].length}</span><span class="sp"></span>${hid ? pinBtn('heading', hid, (HEAD[hid]?.b.text || '') + ' (' + bk.title + ')') : ''}</div>
  <div class="reader"><div class="toc"><input id="tocQ" type="search" placeholder="Filter contents…">${tocHTML}</div>
  <div class="content" id="bookContent">${blocksHTML(bk.blocks.slice(ch.start, ch.end))}${navBtns}</div></div>`;
  $('#tocQ').oninput = e => { const q = e.target.value.toLowerCase(); $$('.toc a').forEach(a => a.style.display = !q || a.textContent.toLowerCase().includes(q) ? '' : 'none'); };
  const cur = $('.toc a.cur'); if (cur) cur.scrollIntoView({ block: 'center' });
  if (hid && HEAD[hid]) {
    remember('heading', hid, HEAD[hid].b.text + ' (' + bk.title + ')');
    requestAnimationFrame(() => { const el = document.getElementById(hid); if (el && i !== ch.start) { el.scrollIntoView(); window.scrollBy(0, -70); } else window.scrollTo(0, 0); });
  } else window.scrollTo(0, 0);
};

/* ---------------- monsters ---------------- */
VIEWS.monsters = () => {
  const groups = [...new Set(D.monsters.map(m => m.group))];
  const st = VIEWS.monsters.st ||= { g: 'All', q: '', sort: 'group' };
  $('#main').innerHTML = `<div class="page-title"><h1>Monsters &amp; NPCs</h1><span class="muted">${D.monsters.length} stat blocks · click an attack to roll it</span></div>
  <div class="filters">${['All', ...groups].map(g => `<span class="chip ${st.g === g ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</span>`).join('')}</div>
  <div class="row" style="margin-bottom:12px"><input id="mq" placeholder="Filter by name, ability…" value="${esc(st.q)}" style="flex:1;max-width:340px"><select id="msort"><option value="group">Sort: book order</option><option value="power">Sort: power</option><option value="name">Sort: name</option></select></div>
  <div class="grid mgrid" id="mgrid"></div>`;
  $('#msort').value = st.sort;
  const draw = () => {
    let L = D.monsters.filter(m => (st.g === 'All' || m.group === st.g));
    if (st.q) { const q = st.q.toLowerCase(); L = L.filter(m => (m.name + ' ' + m.abilities.map(a => strip(a.text || '')).join(' ')).toLowerCase().includes(q)); }
    if (st.sort === 'power') L = [...L].sort((a, b) => (+a.power || 0) - (+b.power || 0)); else if (st.sort === 'name') L = [...L].sort((a, b) => a.name.localeCompare(b.name));
    $('#mgrid').innerHTML = L.map(m => statBlockHTML(m, { link: true })).join('') || '<p class="muted">No matches.</p>';
  };
  draw();
  $$('[data-g]', $('.filters')).forEach(c => c.onclick = () => { st.g = c.dataset.g; $$('.filters .chip').forEach(x => x.classList.toggle('on', x === c)); draw(); });
  $('#mq').oninput = e => { st.q = e.target.value; draw(); };
  $('#msort').onchange = e => { st.sort = e.target.value; draw(); };
};
VIEWS.monster = ([id]) => {
  const m = MON[id]; if (!m) return VIEWS.monsters();
  remember('monster', id, m.name);
  const enc = D.tables.filter(t => t.rows.some(r => r.c.join(' ').toLowerCase().includes(m.name.toLowerCase())));
  $('#main').innerHTML = `<div class="page-title"><a href="#/monsters" class="btn sm">← All monsters</a></div><div style="max-width:720px">${statBlockHTML(m, { openDesc: true })}
  ${enc.length ? `<p class="sm muted">Appears on: ${enc.map(t => `<span class="tlink" data-t="${t.gid}">${esc(t.name)}</span>`).join(', ')}</p>` : ''}</div>`;
};

/* ---------------- items ---------------- */
const ABBR = { EE: 'Elemental Essence', NDT: 'Necromancer Deathtree', DH: 'Demon Hide', AO: 'Archmage Obsidian', MW: 'Masterwork' };
const QUAL = {};
(() => {
  const bl = D.books.chars.blocks; const i = bl.findIndex(b => b.t === 'h' && b.text === 'Weapon Qualities'); if (i < 0) return;
  let last = null;
  for (let j = i + 1; j < bl.length && bl[j].t !== 'h'; j++) {
    const b = bl[j]; if (b.t !== 'p') continue;
    const m = b.text.match(/^•\s*<b>([^<:]+?)(?:\s+X)?:<\/b>\s*(.*)$/);
    if (m) { last = m[1].trim(); QUAL[last.toLowerCase()] = strip(m[2]); } else if (last && !/^A weapon/.test(b.text)) QUAL[last.toLowerCase()] += ' ' + strip(b.text);
  }
  const wt = bl.findIndex(b => b.t === 'h' && b.text === 'Weapon Types');
  if (wt >= 0) for (let j = wt + 1; j < bl.length && bl[j].t !== 'h'; j++) { const m = (bl[j].text || '').match(/^•?\s*<b>([^<:]+):<\/b>\s*(.*)$/); if (m) QUAL[m[1].trim().toLowerCase()] = strip(m[2]); }
})();
function qualHTML(s) { const t = esc(strip(s)); return qualityLinks(t) || t; }
function expandName(n) { const m = n.match(/^(EE|NDT|DH|AO|MW)\s+(.*)$/); return m ? `${esc(n)} <span class="faint sm">(${ABBR[m[1]]})</span>` : esc(n); }
function slotsOf(c) { const m = (c.extra || '').match(/Occupies\s+(\d+)/i); return m ? +m[1] : 1; }
function weaponInfo(c) {
  const ps = c.body.filter(x => x[0] === 'p').map(x => x[1]);
  const all = ps.join(' ');
  const range = (all.match(/<i>((?:Melee|Ranged)[^<]*)<\/i>/) || [])[1] || '';
  const attack = strip((all.match(/<b>Attack<\/b>\s*([^<]*)/) || [])[1] || '');
  const t = c.body.find(x => x[0] === 'tiers');
  const quals = ps.map(p => (p.match(/<i>([^<]*)<\/i>\s*$/) || [])[1]).filter(q => q && !/^(Melee|Ranged)/.test(q)).pop() || '';
  return { range, attack, t2: t ? strip(t[2][t[1].indexOf('12-16')] || '') : '', t3: t ? strip(t[2][t[1].indexOf('17+')] || '') : '', quals };
}
function armorInfo(c) { const all = strip(c.body.map(x => x[0] === 'p' ? x[1] : '').join(' ')); return { ad: (all.match(/AD:?\s*(\d+)/) || [])[1] || '', type: /shield/i.test(c.name) ? 'Shield' : 'Suit' }; }
const ITEM_SECTIONS = [
  ['weapons', 'Weapons', c => c.cat === 'Weapon'],
  ['armor', 'Armor & shields', c => c.cat === 'Armor'],
  ['ammo', 'Ammunition', c => /Quiver|Crossbow Bolts|Arrows/.test(c.name)],
  ['light', 'Light sources', c => /^(Torch|Lantern|Candle|Oil Flask)$/.test(c.name)],
  ['alchemy', 'Potions, poisons & bombs', c => c.cat === 'Alchemy'],
  ['magic', 'Magic items', c => c.cat === 'Magic Item'],
  ['tools', 'Tools & kits', c => c.cat === 'Gear' && /Tools|Utensils|Kit|Lockpick|Scales|Pick$|Shovel|Crowbar|Magnifying|Spyglass|Quill/.test(c.name)],
  ['gear', 'Adventuring gear', c => c.cat === 'Gear'],
  ['food', 'Food', c => c.cat === 'Food'],
  ['treasure', 'Treasure & crafting materials', c => c.cat === 'Treasure & Materials'],
];
function itemSections(list) {
  const used = new Set(); const out = [];
  for (const [id, title, f] of ITEM_SECTIONS) { const L = list.filter(c => !used.has(c) && f(c)); L.forEach(c => used.add(c)); out.push([id, title, L]); }
  return out;
}
function weaponTable(L) {
  return `<div style="overflow-x:auto"><table class="tbl"><tr><th>Weapon</th><th>Range</th><th>Attack</th><th>12–16</th><th>17+</th><th>Qualities</th><th>Slots</th><th>Stack</th><th>Price</th></tr>${L.map(c => { const w = weaponInfo(c); return `<tr><td><span class="ilink" data-i="${c.id}"><b>${expandName(c.name)}</b></span></td><td>${esc(w.range)}</td><td>${esc(w.attack)}</td><td>${esc(w.t2)}</td><td>${esc(w.t3)}</td><td>${qualHTML(w.quals)}</td><td>${slotsOf(c)}</td><td>${esc(c.stack || '')}</td><td>${esc(c.price || '—')}</td></tr>`; }).join('')}</table></div>`;
}
function armorTable(L) {
  L = [...L].sort((x, y) => (armorInfo(x).type === 'Shield') - (armorInfo(y).type === 'Shield') || (+armorInfo(x).ad) - (+armorInfo(y).ad));
  return `<div style="overflow-x:auto"><table class="tbl"><tr><th>Armor</th><th>Type</th><th>AD</th><th>Slots</th><th>Price</th><th>Complexity</th><th>Materials</th><th>Goal</th></tr>${L.map(c => { const a = armorInfo(c), r = craftFor(c) || {}; return `<tr><td><span class="ilink" data-i="${c.id}"><b>${expandName(c.name)}</b></span></td><td>${a.type}</td><td>${a.ad}</td><td>${slotsOf(c)}</td><td>${esc(c.price || '—')}</td><td>${esc(r.cx || '—')}</td><td>${esc(r.mat || '—')}</td><td>${esc(r.goal || '—')}</td></tr>`; }).join('')}</table></div>`;
}
VIEWS.items = () => {
  const st = VIEWS.items.st ||= { q: '', view: 'table', craft: 'Any' };
  const ref = ['Armor Types', 'Upgraded Armor', 'Armor Enchantments', 'Weapon Types', 'Weapon Qualities', 'Ammunition', 'Upgraded Weapons', 'Weapon Enchantments', 'Gear', 'Alchemical Items', 'Enchanted Items', 'Crafting Materials', 'Treasure', 'Shopping', 'Money']
    .map(n => { const b = D.books.chars.blocks.find(b => b.t === 'h' && b.text === n && b.lvl <= 3); return b ? `<a class="chip" href="#/book/chars/${b.id}">${esc(n)}</a>` : ''; }).join(' ');
  $('#main').innerHTML = `<div class="page-title"><h1>Items</h1><span class="muted">${D.items.filter(c => c.cat !== 'Spellbook').length} item cards · spells are on the <a href="#/spells">Spells</a> tab</span></div>
  <div class="row" style="margin-bottom:10px"><input id="iq" placeholder="Filter all items…" value="${esc(st.q)}" style="flex:1;max-width:340px">
    <select id="icraft" title="Show only items you can craft with this expertise">${['Any', 'Craftable', 'Alchemy', 'Blacksmithing', 'Enchanting'].map(x => `<option value="${x}" ${st.craft === x ? 'selected' : ''}>${x === 'Any' ? 'All items' : x === 'Craftable' ? 'Craftable only' : 'Craft with ' + x}</option>`).join('')}</select>
    <span class="chip ${st.view === 'table' ? 'on' : ''}" data-view="table">Tables for weapons &amp; armor</span><span class="chip ${st.view === 'cards' ? 'on' : ''}" data-view="cards">Cards everywhere</span></div>
  <div class="filters" id="jump"></div>
  <div id="isecs"></div>
  <h2 id="sec-rules">Equipment rules</h2><p class="muted sm">Upgrades, enchantments, crafting and prices from the Characters booklet:</p><div class="filters">${ref}</div>`;
  const draw = () => {
    let L = D.items.filter(c => c.cat !== 'Spellbook');
    if (st.q) { const q = st.q.toLowerCase(); L = L.filter(c => (c.name + ' ' + strip(JSON.stringify(c.body))).toLowerCase().includes(q)); }
    if (st.craft !== 'Any') L = L.filter(c => { const r = craftFor(c); if (!r || (dash(r.cx) && dash(r.mat))) return false; return st.craft === 'Craftable' || r.exp === st.craft; });
    const secs = itemSections(L).filter(s => s[2].length);
    $('#jump').innerHTML = secs.map(([id, t, l]) => `<a class="chip" href="#" data-jump="sec-${id}">${esc(t)} <span class="faint">${l.length}</span></a>`).join('') + `<a class="chip" href="#" data-jump="sec-rules">Equipment rules</a>`;
    $('#isecs').innerHTML = secs.map(([id, t, l]) => {
      const core = l.filter(c => c.src !== 'dungeon'), found = l.filter(c => c.src === 'dungeon');
      let body;
      if (st.view === 'table' && id === 'weapons') body = weaponTable(core) + (found.length ? `<h4>Upgraded weapons found in dungeons</h4>${weaponTable(found)}` : '');
      else if (st.view === 'table' && id === 'armor') body = armorTable(core) + (found.length ? `<h4>Upgraded armor found in dungeons</h4>${armorTable(found)}` : '');
      else body = `<div class="grid igrid">${l.map(c => `<div>${itemCardHTML(c, { link: true, actions: false })}</div>`).join('')}</div>`;
      return `<h2 id="sec-${id}">${esc(t)} <span class="faint sm">${l.length}</span></h2>${id === 'weapons' && st.view === 'table' ? '<p class="sm muted">Hover a quality for its rule. Click a name for the full card. <b>Crafting:</b> every standard weapon (and 20 arrows or bolts) is Blacksmithing, complexity 1, goal 5 — bows need 1 hickory log, everything else 1 iron bar.</p>' : ''}${body}`;
    }).join('') || '<p class="muted">No matches.</p>';
    $$('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); const el = document.getElementById(a.dataset.jump); if (el) { el.scrollIntoView(); window.scrollBy(0, -70); } });
  };
  draw();
  $('#iq').oninput = e => { st.q = e.target.value; draw(); };
  $('#icraft').onchange = e => { st.craft = e.target.value; draw(); };
  $$('[data-view]').forEach(c => c.onclick = () => { st.view = c.dataset.view; $$('[data-view]').forEach(x => x.classList.toggle('on', x === c)); draw(); });
};
VIEWS.spells = () => {
  const st = VIEWS.spells.st ||= { q: '', disc: 'All', rank: 'All' };
  const S_ = D.items.filter(c => c.cat === 'Spellbook');
  $('#main').innerHTML = `<div class="page-title"><h1>Spells</h1><span class="muted">${S_.length} spellbooks · casting is a Mind test; roll the book’s UD each cast</span></div>
  <div class="filters" id="spf"></div><div class="row" style="margin-bottom:12px"><input id="sq" placeholder="Filter spells…" value="${esc(st.q)}" style="flex:1;max-width:340px"></div><div id="sgrid"></div>`;
  const draw = () => {
    $('#spf').innerHTML = ['All', 'Alteration', 'Benefaction', 'Conjuration', 'Elemental', 'Illusion', 'Necromancy'].map(d => `<span class="chip ${st.disc === d ? 'on' : ''}" data-d="${d}">${d}</span>`).join('') + ' &nbsp; ' + ['All', 0, 1, 2, 3, 4, 5].map(r => `<span class="chip ${String(st.rank) === String(r) ? 'on' : ''}" data-r="${r}">${r === 'All' ? 'Any rank' : 'Rank ' + r}</span>`).join('');
    $$('[data-d]').forEach(c => c.onclick = () => { st.disc = c.dataset.d; draw(); });
    $$('[data-r]').forEach(c => c.onclick = () => { st.rank = c.dataset.r; draw(); });
    let L = S_;
    if (st.disc !== 'All') L = L.filter(c => c.disc === st.disc);
    if (st.rank !== 'All') L = L.filter(c => String(c.rank) === String(st.rank));
    if (st.q) { const q = st.q.toLowerCase(); L = L.filter(c => (c.name + ' ' + strip(JSON.stringify(c.body))).toLowerCase().includes(q)); }
    const ranks = [...new Set(L.map(c => c.rank))].sort();
    $('#sgrid').innerHTML = ranks.map(r => `<h2>Rank ${r}</h2><div class="grid igrid">${L.filter(c => c.rank === r).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<div>${itemCardHTML(c, { link: true, actions: false })}</div>`).join('')}</div>`).join('') || '<p class="muted">No matches.</p>';
  };
  draw();
  $('#sq').oninput = e => { st.q = e.target.value; draw(); };
};
VIEWS.item = ([id]) => {
  const c = ITEM[id]; if (!c) return VIEWS.items();
  remember('item', id, c.name);
  const back = c.cat === 'Spellbook' ? '<a href="#/spells" class="btn sm">← All spells</a>' : '<a href="#/items" class="btn sm">← All items</a>';
  $('#main').innerHTML = `<div class="page-title">${back}</div><div style="max-width:380px">${itemCardHTML(c)}</div>`;
};

/* ---------------- tables ---------------- */
VIEWS.tables = () => {
  const by = {}; D.tables.forEach(t => (by[t.book] ||= []).push(t));
  $('#main').innerHTML = `<div class="page-title"><h1>Random tables</h1><span class="muted">Every die table in the books. Results also go to the roll log; names open the full table.</span></div>
  ${Object.entries(by).map(([b, ts]) => `<h2>${esc(D.books[b].title)}</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(330px,1fr))">${ts.map(t => `<div class="card tbl-list"><div class="row tg"><span class="tlink" data-t="${t.gid}"><b>${esc(t.name)}</b></span><span class="sp"></span>${t.mod ? `<span class="sm muted">+ ${esc(t.mod)}</span><input class="modin" type="number" data-g="${t.gid}" value="${S.tmods[t.gid] || 0}">` : ''}<button class="rollbtn" data-gtab="${t.gid}">🎲 ${esc(t.two ? '2×d6' : t.die)}</button></div><div class="sm" id="out-${t.gid}"></div></div>`).join('')}</div>`).join('')}`;
  $$('[data-gtab]').forEach(b => b.onclick = () => { const r = rollTable(b.dataset.gtab, { quiet: true }); $('#out-' + b.dataset.gtab).innerHTML = r ? r.html.split('<br>').slice(1).join('<br>') + ` <span class="faint">(${r.die})</span>` : ''; });
};

/* ---------------- pregens ---------------- */
VIEWS.pregens = ([lvl]) => {
  lvl = +(lvl || 4);
  const L = D.pregens.filter(p => p.level === lvl);
  $('#main').innerHTML = `<div class="page-title"><h1>Pregens</h1><span class="sp"></span>${[4, 7, 10].map(l => `<a class="btn ${l === lvl ? 'on' : ''}" href="#/pregens/${l}">Level ${l}</a>`).join('')}</div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(420px,1fr))">${L.map(p => `<div class="card" id="${p.id}">
    <div class="row"><h3 style="margin:0">Pregen ${p.num}: ${esc(p.desc)}</h3><span class="sp"></span><span class="badge">L${p.level} · ${esc(p.txp)} TXP</span></div>
    <div class="stat" style="border:none;padding:0;background:none"><div class="sg">${[['Strength', p.str], ['Agility', p.agi], ['Mind', p.mind], ['Stamina', p.stamina], ['Speed', p.speed], ['Effort', p.effort], ['AD', p.ad]].map(x => `<div><b>${x[0]}</b>${esc(x[1])}</div>`).join('')}</div></div>
    <div class="sm"><b>General:</b> ${esc(p.gen)}<br><b>Weapon:</b> ${esc(p.weap)}<br><b>Magic:</b> ${esc(p.magic)}</div>
    <details><summary>Traits (${p.traits.length})</summary><ul class="sm">${p.traits.map(t => `<li>${esc(t).replace(/^([^:]{2,60}):/, '<b>$1</b>:')}</li>`).join('')}</ul></details>
    <details><summary>Inventory cards (${p.cards.length})</summary><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-top:6px">${p.cards.map(c => itemCardHTML(Object.assign({ cat: '' }, c), { actions: false, noCraft: true })).join('')}</div></details>
  </div>`).join('')}</div>`;
  const h = location.hash.split('#')[2]; if (h) { const el = document.getElementById(h); if (el) el.scrollIntoView(); }
};

/* ---------------- map ---------------- */
VIEWS.map = () => {
  const pid = n => (D.places.find(p => p.name === n) || {}).id;
  $('#main').innerHTML = `<div class="page-title"><h1>Cornath</h1><span class="muted">Click a location to open it in the Dungeons book. Each hex is 5 miles.</span></div>
  <div class="mapwrap"><img src="${MAPS.Cornath}" alt="Hex map of Cornath">${HOTSPOTS.map(([n, x, y]) => { const id = pid(n); return `<a class="hot" style="left:${x}%;top:${y}%" href="${id ? '#/book/dungeons/' + id : '#/notes'}" title="${esc(n)}"><span>${esc(n)}${id ? '' : ' (your village)'}</span></a>`; }).join('')}</div>
  <h2>Dungeon maps</h2><p class="muted sm">Only the Blood Library map was provided so far. Add more images to the <code>maps</code> folder and list them in <code>MAPS</code> in app.js.</p>
  <div class="row">${Object.keys(MAPS).filter(k => k !== 'Cornath').map(k => `<button class="btn" data-map="${esc(k)}">🗺 ${esc(k)}</button>`).join('')}</div>`;
};

/* ---------------- changelog ---------------- */
VIEWS.changelog = ([q]) => {
  const st = VIEWS.changelog.st ||= { v: 'v3', doc: 'All', q: '' };
  if (q) st.q = q;
  const docs = ['All', ...new Set(D.changelog.map(c => c[1]))];
  $('#main').innerHTML = `<div class="page-title"><h1>Changelog</h1><span class="sp"></span>${['v3', 'v2', 'All'].map(v => `<span class="chip ${st.v === v ? 'on' : ''}" data-v="${v}">${v === 'All' ? 'Both' : 'Playtest ' + v.slice(1)}</span>`).join(' ')}</div>
  <div class="row" style="margin-bottom:10px"><select id="clDoc">${docs.map(d => `<option ${st.doc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select><input id="clQ" placeholder="Filter…" value="${esc(st.q)}" style="flex:1;max-width:340px"></div>
  <table class="tbl" id="clT"></table>`;
  const draw = () => {
    const qq = st.q.toLowerCase();
    const L = D.changelog.filter(c => (st.v === 'All' || c[0] === st.v) && (st.doc === 'All' || c[1] === st.doc) && (!qq || c.join(' ').toLowerCase().includes(qq)));
    $('#clT').innerHTML = `<tr><th>Ver</th><th>Document</th><th>Area</th><th>Change</th></tr>` + L.map(c => `<tr><td>${c[0]}</td><td>${esc(c[1])}</td><td><b>${esc(c[2])}</b></td><td>${esc(c[3])}</td></tr>`).join('');
  };
  draw();
  $$('[data-v]').forEach(c => c.onclick = () => { st.v = c.dataset.v; $$('[data-v]').forEach(x => x.classList.toggle('on', x === c)); draw(); });
  $('#clDoc').onchange = e => { st.doc = e.target.value; draw(); };
  $('#clQ').oninput = e => { st.q = e.target.value; draw(); };
};

/* ---------------- search page ---------------- */
VIEWS.search = ([q]) => {
  q = q || ''; $('#q').value = q;
  const R = search(q, 200);
  $('#main').innerHTML = `<div class="page-title"><h1>Search</h1><span class="muted">${R.length} result${R.length === 1 ? '' : 's'} for “${esc(q)}”</span></div>
  ${R.map((e, i) => `<div class="card" style="margin-bottom:8px;padding:8px 12px"><span class="badge">${esc(e.type)}</span> <a href="${e.url || '#'}" data-ri="${i}"><b>${esc(e.title)}</b></a> <span class="muted sm">${esc(e.sub)}</span>${e.snip ? `<div class="sm muted">${esc(e.snip)}…</div>` : ''}</div>`).join('')}`;
  $$('[data-ri]').forEach(a => a.onclick = ev => { const e = R[+a.dataset.ri]; if (e.act) { ev.preventDefault(); openDrawer(e.act[0], e.act[1]); } });
};

/* ---------------- notes ---------------- */
VIEWS.notes = () => {
  $('#main').innerHTML = `<div class="page-title"><h1>Notes &amp; roster</h1></div>
  <div class="grid dash">
    <div class="card"><h3>Campaign notes</h3><p class="sm muted">Your village, NPC connections, rumors, unfinished business.</p><textarea id="campNotes" style="min-height:300px">${esc(S.notes.campaign)}</textarea></div>
    <div class="card"><h3>Session notes</h3><textarea id="sessNotes2" style="min-height:300px">${esc(S.notes.session)}</textarea></div>
    <div class="card"><h3>Party roster</h3><p class="sm muted">Names here can be added to combat in one click.</p><div id="roster"></div>
      <div class="row" style="margin-top:8px"><input id="rName" placeholder="PC name" style="flex:1"><input id="rPlayer" placeholder="Player" style="width:110px"><button class="btn" id="rAdd">Add</button></div></div>
    <div class="card"><h3>Dungeon progress</h3>${D.places.filter(p => p.areas.length).map(p => { const n = p.areas.length, d = p.areas.filter(a => (S.progress[a.id] || {}).e).length; return `<div class="row"><a href="#/book/dungeons/${p.id}">${esc(p.name)}</a><span class="sp"></span><span class="sm muted">${d}/${n} explored</span></div><div class="progress" style="margin-bottom:8px"><div style="width:${Math.round(d / n * 100)}%"></div></div>`; }).join('')}</div>
  </div>`;
  const drawR = () => {
    $('#roster').innerHTML = S.roster.map((r, i) => `<div class="udrow"><b>${esc(r.name)}</b><span class="muted sm">${esc(r.player || '')}</span><span class="sp"></span><input placeholder="notes" data-rn="${i}" value="${esc(r.notes || '')}" style="flex:1;min-width:120px"><button class="icon-btn" data-rdel="${i}">✕</button></div>`).join('') || '<p class="muted sm">No PCs yet.</p>';
    $$('[data-rn]').forEach(inp => inp.oninput = () => { S.roster[+inp.dataset.rn].notes = inp.value; save(); });
    $$('[data-rdel]').forEach(b => b.onclick = () => { S.roster.splice(+b.dataset.rdel, 1); save(); drawR(); });
  };
  drawR();
  $('#rAdd').onclick = () => { const n = $('#rName').value.trim(); if (!n) return; S.roster.push({ name: n, player: $('#rPlayer').value.trim(), notes: '' }); $('#rName').value = $('#rPlayer').value = ''; save(); drawR(); };
  $('#campNotes').oninput = e => { S.notes.campaign = e.target.value; save(); };
  $('#sessNotes2').oninput = e => { S.notes.session = e.target.value; save(); };
};

/* ---------------- settings ---------------- */
VIEWS.settings = () => {
  $('#main').innerHTML = `<div class="page-title"><h1>Settings &amp; saves</h1></div>
  <div class="grid dash">
    <div class="card"><h3>Dungeon turns</h3>
      <div class="row">${[20, 30, 60].map(m => `<span class="chip ${S.settings.mode === 'timer' && S.settings.dtMin === m ? 'on' : ''}" data-dtm="${m}">${m} minutes${m === 30 ? ' (default)' : m === 20 ? ' (intense)' : ' (relaxed)'}</span>`).join('')}<span class="chip ${S.settings.mode === 'rooms' ? 'on' : ''}" data-dtm="rooms">1d6 rooms (no timer)</span></div>
      <p><label><input type="checkbox" id="snd" ${S.settings.sound ? 'checked' : ''}> Beep when a DT runs out</label> <button class="btn sm" id="testBeep">Test sound</button></p></div>
    <div class="card"><h3>Your saved game</h3>
      <p class="sm">Everything you do here (timers, trackers, notes, dungeon progress, pins, roll log) saves automatically in <b>this browser on this device</b>. It survives closing the tab. Clearing your browser data erases it, so export a backup now and then.</p>
      <div class="row"><button class="btn primary" id="exp">Export save file</button><label class="btn">Import save file<input type="file" id="imp" accept="application/json,.json" hidden></label><button class="btn" id="rst">Reset everything</button></div>
      <p class="sm muted" id="saveInfo"></p>
      <p class="sm">Updating the site (new files on GitHub) <b>never erases saves</b>. If a future update changes the save format, a copy of your old save is kept automatically${localStorage.getItem(BACKUP_KEY) ? ' — <button class="btn sm" id="restoreBk">Restore the automatic backup</button>' : '.'}</p></div>
    <div class="card"><h3>Install as an app</h3><p class="sm">On a phone or laptop, use your browser’s “Install app” / “Add to Home Screen”. It then opens in its own window and works offline.</p></div>
    <div class="card"><h3>About</h3><p class="sm">An unofficial Ref companion built from the MCDM <i>Crows</i> public playtest (October 2026, playtest 3) files. All game text belongs to MCDM. Keep it to your own table; don’t post it publicly.</p>
      <p class="sm muted">Keyboard: <kbd>/</kbd> search · <kbd>Esc</kbd> close panels · <kbd>↑</kbd><kbd>↓</kbd><kbd>Enter</kbd> pick a result.</p></div>
  </div>`;
  $('#saveInfo').textContent = `Current save: ${(JSON.stringify(S).length / 1024).toFixed(1)} KB · last exported: ${S.lastExport ? new Date(S.lastExport).toLocaleDateString() : 'never'}`;
  if ($('#restoreBk')) $('#restoreBk').onclick = () => { if (confirm('Replace your current save with the automatic backup?')) { localStorage.setItem(KEY, localStorage.getItem(BACKUP_KEY)); S = load(); route(); tick(); toast('Backup restored.'); } };
  $$('[data-dtm]').forEach(c => c.onclick = () => { const v = c.dataset.dtm; if (v === 'rooms') S.settings.mode = 'rooms'; else { S.settings.mode = 'timer'; S.settings.dtMin = +v; if (!S.dt.num) S.dt.left = +v * 60000; } save(); VIEWS.settings(); tick(); });
  $('#snd').onchange = e => { S.settings.sound = e.target.checked; save(); };
  $('#testBeep').onclick = () => { const s = S.settings.sound; S.settings.sound = true; beep(); S.settings.sound = s; };
  $('#exp').onclick = () => { S.lastExport = Date.now(); save(); const b = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `crows-ref-save-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const s = JSON.parse(t); if (!s || typeof s !== 'object' || !s.settings) throw 0; localStorage.setItem(KEY, JSON.stringify(s)); S = load(); toast('Save file imported.'); route(); tick(); } catch (err) { toast('That file isn’t a Crows Ref save.'); } }); };
  $('#rst').onclick = () => { if (confirm('Erase all timers, trackers, notes, progress and logs on this device?')) { S = DEFAULT(); localStorage.setItem(KEY, JSON.stringify(S)); route(); tick(); } };
};

/* ---------------- global events ---------------- */
document.addEventListener('click', e => {
  const t = e.target;
  const ml = t.closest('.mlink'); if (ml) { e.preventDefault(); openDrawer('monster', ml.dataset.m); return; }
  const il = t.closest('.ilink'); if (il) { e.preventDefault(); openDrawer('item', il.dataset.i); return; }
  const tl = t.closest('.tlink'); if (tl) { e.preventDefault(); openDrawer('table', tl.dataset.t); return; }
  const rl = t.closest('.rlink'); if (rl) { e.preventDefault(); openDrawer('rule', rl.dataset.h); return; }
  const gn = t.closest('[data-gen]'); if (gn) { S.enc.autogen = gn.dataset.gen; save(); closeDrawer(); if (location.hash === '#/encounters') VIEWS.encounters(); else location.hash = '#/encounters'; return; }
  const ab = t.closest('[data-atkb]'); if (ab) { rollAttack(ab.dataset.atkb, +ab.dataset.i); return; }
  const rb = t.closest('.rollbtn[data-g]'); if (rb) { rollTable(rb.dataset.g, { scroll: true }); return; }
  const rt = t.closest('[data-rollt]'); if (rt) { rollTable(rt.dataset.rollt); return; }
  const dr = t.closest('[data-roll]'); if (dr) { const r = rollExpr(dr.dataset.roll); addLog(`<b>${dr.dataset.roll}</b>: ${r.text} = <b>${r.total}</b>`); return; }
  const at = t.closest('tr[data-atk]'); if (at) { rollAttack(at.dataset.atk, +at.dataset.i); return; }
  const ac = t.closest('[data-addcombat]'); if (ac) { addCombatant(MON[ac.dataset.addcombat]); if (location.hash.startsWith('#/combat')) renderCombatList(); return; }
  const pn = t.closest('[data-pin]'); if (pn) {
    const [kind, id, label] = pn.dataset.pin.split('|');
    const has = S.pins.some(p => p.kind === kind && p.id === id);
    S.pins = has ? S.pins.filter(p => !(p.kind === kind && p.id === id)) : [...S.pins, { kind, id, label }]; save();
    pn.classList.toggle('on', !has); pn.textContent = has ? '☆ Pin' : '★ Pinned'; renderPins(); return;
  }
  const up = t.closest('[data-unpin]'); if (up) { const [k, i] = up.dataset.unpin.split('|'); S.pins = S.pins.filter(p => !(p.kind === k && p.id === i)); save(); renderPins(); return; }
  const op = t.closest('[data-open]'); if (op) { e.preventDefault(); const [k, i] = op.dataset.open.split('|'); openDrawer(k, i); return; }
  const mp = t.closest('[data-map]'); if (mp) { openDrawer('map', mp.dataset.map); return; }
  const rp = t.closest('[data-resetplace]'); if (rp) { const pl = PLACE[rp.dataset.resetplace]; if (confirm(`Clear progress for ${pl.name}?`)) { pl.areas.forEach(a => delete S.progress[a.id]); save(); route(); } return; }
  const ud = t.closest('[data-udroll],[data-udref],[data-udplus],[data-uddel]'); if (ud) {
    const id = ud.dataset.udroll || ud.dataset.udref || ud.dataset.udplus || ud.dataset.uddel; const u = S.ud.find(x => x.id === id); if (!u) return;
    if (ud.dataset.udroll) addLog('<b>Usage dice</b>: ' + rollUD(u)); if (ud.dataset.udref) { u.dice = u.max; u.last = null; } if (ud.dataset.udplus) { u.dice++; u.max = Math.max(u.max, u.dice); } if (ud.dataset.uddel) S.ud = S.ud.filter(x => x !== u);
    save(); renderUD(); return;
  }
  const qa = t.closest('#qres a[data-qi]'); if (qa) { if (qa.dataset.qi !== 'all') { e.preventDefault(); openQ(qList[+qa.dataset.qi]); } else $('#qres').hidden = true; return; }
  if (!t.closest('.searchwrap')) $('#qres').hidden = true;
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('input[data-area]')) {
    const id = t.dataset.area, k = t.dataset.k; S.progress[id] = S.progress[id] || {};
    S.progress[id][k] = t.type === 'checkbox' ? t.checked : t.value; save();
    const h = document.getElementById(id); if (h) h.classList.toggle('done-h', !!(S.progress[id].c || S.progress[id].l));
    const pl = PLACE[id]; const pp = $(`[data-placeprog="${pl.id}"]`);
    if (pp) { const n = pl.areas.length, d = pl.areas.filter(a => (S.progress[a.id] || {}).e).length; pp.textContent = `${d}/${n} areas explored`; pp.closest('.place-bar').querySelector('.progress div').style.width = Math.round(d / n * 100) + '%'; }
  }
  if (t.matches('.modin')) { S.tmods[t.dataset.g] = +t.value || 0; save(); $$(`.modin[data-g="${t.dataset.g}"]`).forEach(x => { if (x !== t) x.value = t.value; }); }
});
document.addEventListener('input', e => { if (e.target.matches('input[data-area][type=text]')) { const id = e.target.dataset.area; S.progress[id] = S.progress[id] || {}; S.progress[id].n = e.target.value; save(); } });
$('#q').addEventListener('input', renderQ);
$('#q').addEventListener('focus', () => { if ($('#q').value.trim()) renderQ(); });
$('#q').addEventListener('keydown', e => {
  const items = $$('#qres a[data-qi]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qSel = Math.max(0, Math.min(items.length - 1, qSel + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((a, i) => a.classList.toggle('sel', i === qSel)); items[qSel]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); const a = items[qSel]; if (!a) return; if (a.dataset.qi === 'all') { location.hash = a.getAttribute('href'); $('#qres').hidden = true; } else openQ(qList[+a.dataset.qi]); $('#q').blur(); }
  else if (e.key === 'Escape') { $('#qres').hidden = true; $('#q').blur(); }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape') { if (!$('#present').hidden) $('#present').hidden = true; else if (!$('#drawer').hidden) closeDrawer(); else $('#logPanel').hidden = true; }
});
$('#drawerClose').onclick = closeDrawer;
$('#drawerOpen').onclick = () => { if (drawerState?.url) { location.hash = drawerState.url; closeDrawer(); } };
$('#logBtn').onclick = () => { const p = $('#logPanel'); p.hidden = !p.hidden; if (!p.hidden) { $('#drawer').hidden = true; renderLog(); } };
$('#logClose').onclick = () => $('#logPanel').hidden = true;
$('#logClear').onclick = () => { S.log = []; save(); renderLog(); };
$('#navToggle').onclick = () => document.body.classList.toggle('nav-open');
$('#dtMini').onclick = () => { location.hash = '#/session'; };
$('#pClose').onclick = () => $('#present').hidden = true;
window.addEventListener('hashchange', route);
route(); tick(); setInterval(tick, 500);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
