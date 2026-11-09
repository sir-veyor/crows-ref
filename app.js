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
const KEY = 'crowsRef.v1';
const DEFAULT = () => ({
  settings: { dtMin: 30, sound: true, mode: 'timer' },
  dt: { num: 0, running: false, endAt: 0, left: 30 * 60000, alerted: 0, rooms: 0, roomsDone: 0 },
  en: { ctx: 'dungeon', crowded: false, chaos: false, seclude: false, pace: 'normal', scout: false, other: 0, table: '' },
  ud: [], combat: { round: 0, pcsFirst: null, phase: 0, list: [] },
  log: [], notes: { session: '', campaign: '' }, roster: [], progress: {}, pins: [], recent: [], tmods: {},
  travel: { pace: 'normal', slow: 'normal', road: false, river: false, down: false, guide: 'none', scout: 'none' },
  test: { mod: 0, edges: 0, banes: 0, bonus: 0, effort: false },
});
let S;
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  const d = DEFAULT();
  if (!s) return d;
  for (const k in d) if (s[k] === undefined) s[k] = d[k];
  for (const k of ['settings', 'dt', 'en', 'combat', 'notes', 'travel', 'test']) s[k] = Object.assign(d[k], s[k]);
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
    if (x[0] === 'p') return `<p>${fmt(x[1], { noTables: true })}</p>`;
    const hd = x[1], cells = x[2];
    return `<div class="tiers" style="grid-template-columns:repeat(${hd.length},1fr)">${hd.map((hh, i) => `<div class="c c${hd.length === 2 ? i + 2 : i + 1}"><span class="h">${esc(hh)}</span>${fmt(cells[i] || '', { noTables: true })}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="icard ${c.magic ? 'magic' : ''}">
    <div class="in">${opts.link ? `<a href="#/item/${c.id}">${esc(c.name)}</a>` : esc(c.name)}${c.stack ? `<span class="stk">Stack ${esc(c.stack)}</span>` : ''}</div>
    ${itemExtra(c) ? `<div class="ex">${esc(itemExtra(c))}</div>` : ''}
    ${body}
    <div class="pr">${c.cat ? esc(c.cat) + ' · ' : ''}${esc(c.price || '—')}</div>
    ${c.found ? `<div class="ex">Dungeon cards: ${c.found.map(esc).join(', ')}</div>` : ''}
  </div>${opts.actions !== false ? `<div class="row" style="margin-top:6px">${pinBtn('item', c.id, c.name)}</div>` : ''}`;
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
  ['Play', [['session', '⏱', 'Session'], ['combat', '⚔', 'Combat'], ['rollers', '🎲', 'Rollers'], ['travel', '🧭', 'Travel day'], ['cheat', '📋', 'Cheat sheet']]],
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
function enValue() {
  const e = S.en; let v;
  if (e.ctx === 'dungeon' || e.ctx === 'drest') { v = 3 + (e.crowded ? 1 : 0) + (e.chaos ? 1 : 0); if (e.ctx === 'drest' && e.seclude) v -= 1; }
  else { v = { slow: 2, normal: 4, fast: 6 }[e.pace] + (e.ctx === 'trest' && e.seclude ? -1 : 0) + (e.ctx === 'travel' && e.scout ? -1 : 0); }
  v += +e.other || 0;
  return Math.max(1, v);
}
VIEWS.session = () => {
  const encTables = D.tables.filter(t => /^(Angel|Blood|Demon|Plant|Undead) Encounters$|^Any Monster Encounter$|^Travel Encounters$/.test(t.name));
  $('#main').innerHTML = `
  <div class="page-title"><h1>Session</h1><span class="muted">Dungeon turns, encounter checks, usage dice and your notes in one place.</span></div>
  <div class="grid dash">
    <div class="card" id="dtCard"></div>
    <div class="card">
      <h3>Encounter check</h3>
      <div class="row"><select id="enCtx">
        <option value="dungeon">In a dungeon</option><option value="drest">Resting in a dungeon</option><option value="travel">Overland travel</option><option value="trest">Resting outdoors</option></select>
        <select id="enPace" title="Travel pace"><option value="slow">Slow pace (EN 2)</option><option value="normal">Normal pace (EN 4)</option><option value="fast">Fast pace (EN 6)</option></select></div>
      <div class="row" style="margin-top:6px">
        <label class="chip" data-en="crowded">20+ creatures on level (+1)</label>
        <label class="chip" data-en="chaos">Trail of chaos / bodies (+1)</label>
        <label class="chip" data-en="seclude">Seclude Camp (−1)</label>
        <label class="chip" data-en="scout">Scout for Danger (−1)</label>
        <span class="sm muted">Other</span><input id="enOther" type="number" style="width:60px" value="${S.en.other || 0}">
      </div>
      <p style="margin:10px 0 4px">Encounter number: <b id="enVal" style="font-size:1.4rem"></b> <span class="muted sm">(roll d10 ≤ EN; never below 1)</span></p>
      <div class="row"><select id="enTable"><option value="">Then roll on… (optional)</option>${encTables.map(t => `<option value="${t.gid}" ${S.en.table === t.gid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <button class="btn primary" id="enRoll">Encounter check</button></div>
      <div id="enOut"></div>
      <p class="sm muted">On a 1 the encounter happens now. On 2+ give the players a sign (distant roar, fresh corpse, big footprint); it happens during the next DT when you choose.</p>
    </div>
    <div class="card" id="udCard"></div>
    <div class="card"><h3>Pinned &amp; recent</h3><div id="pins" class="pins"></div></div>
    <div class="card"><h3>Recent rolls</h3><div id="sessionLog">${logHTML(8)}</div></div>
    <div class="card"><h3>Session notes</h3><textarea id="sessNotes" placeholder="What happened, who owes whom, which doors are open…">${esc(S.notes.session)}</textarea></div>
  </div>`;
  renderDT(); renderUD(); renderPins();
  const sync = () => {
    $('#enCtx').value = S.en.ctx; $('#enPace').value = S.en.pace;
    const travel = S.en.ctx === 'travel' || S.en.ctx === 'trest';
    $('#enPace').style.display = travel ? '' : 'none';
    $$('[data-en]').forEach(c => {
      const k = c.dataset.en; c.classList.toggle('on', !!S.en[k]);
      c.style.display = (k === 'crowded' || k === 'chaos') ? (travel ? 'none' : '') : k === 'seclude' ? (S.en.ctx.includes('rest') ? '' : 'none') : k === 'scout' ? (S.en.ctx === 'travel' ? '' : 'none') : '';
    });
    $('#enVal').textContent = enValue();
  };
  sync();
  $('#enCtx').onchange = e => { S.en.ctx = e.target.value; save(); sync(); };
  $('#enPace').onchange = e => { S.en.pace = e.target.value; save(); sync(); };
  $('#enOther').oninput = e => { S.en.other = +e.target.value || 0; save(); sync(); };
  $('#enTable').onchange = e => { S.en.table = e.target.value; save(); };
  $$('[data-en]').forEach(c => c.onclick = () => { S.en[c.dataset.en] = !S.en[c.dataset.en]; save(); sync(); });
  $('#enRoll').onclick = () => encounterCheck($('#enOut'));
  $('#sessNotes').oninput = e => { S.notes.session = e.target.value; save(); };
};
function encounterCheck(out) {
  const en = enValue(), d = rnd(10);
  let html;
  if (d > en) html = `<b>Encounter check</b> (EN ${en}): rolled ${d} — <span style="color:var(--good)">no encounter.</span>`;
  else {
    html = `<b>Encounter check</b> (EN ${en}): rolled ${d} — <span style="color:var(--bad)"><b>ENCOUNTER!</b></span> ${d === 1 ? '<b>It happens immediately.</b>' : 'Give a sign now; it arrives during the next DT.'}`;
  }
  addLog(html);
  if (out) out.innerHTML = `<div class="result">${html}</div>`;
  if (d <= en && S.en.table) { const r = rollTable(S.en.table); if (out && r) out.innerHTML += `<div class="result">${r.html}</div>`; }
}
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
  on('dtResume', () => { S.dt.endAt = Date.now() + S.dt.left; S.dt.running = true; save(); renderDT(); });
  on('dtEnd', () => showEndDT());
  on('dtLeave', () => { if (confirm('Leave the dungeon and reset the DT counter?')) { S.dt = Object.assign(DEFAULT().dt, { left: S.settings.dtMin * 60000 }); save(); renderDT(); } });
  on('dtMinus', () => adjDT(-60000)); on('dtPlus', () => adjDT(60000));
  on('dtRoom', () => { S.dt.roomsDone++; save(); if (S.dt.roomsDone >= S.dt.rooms) showEndDT(); else renderDT(); });
  on('dtPresent', () => { $('#present').hidden = false; tick(); });
  if (S.dt.pendingEnd) showEndDT(true);
}
function adjDT(d) { if (S.dt.running) S.dt.endAt += d; else S.dt.left += d; save(); tick(); }
function startDT(n) {
  S.dt.num = n; S.dt.left = S.settings.dtMin * 60000; S.dt.endAt = Date.now() + S.dt.left; S.dt.running = true; S.dt.pendingEnd = false; S.dt.alerted = 0;
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
      <li><button class="btn sm" id="endEnc">Encounter check (EN ${S.en.ctx === 'dungeon' ? enValue() : 3 + (S.en.crowded ? 1 : 0) + (S.en.chaos ? 1 : 0)})</button></li>
      <li><button class="btn sm" id="endConds">Clear blessed / vulnerable / weakened in combat tracker</button> <span class="sm muted">(knocked-out creatures wake now)</span></li>
    </ol>
    <div id="endOut"></div>
    <button class="btn primary" id="endNext">Start DT ${S.dt.num + 1}</button></div>`;
  $('#endUD').onclick = () => { rollAllUD(); renderUD(); };
  $('#endEnc').onclick = () => { if (S.en.ctx !== 'dungeon') { S.en.ctx = 'dungeon'; save(); } encounterCheck($('#endOut')); };
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
  $('#dtMiniNum').textContent = n || '–'; $('#dtMiniTime').textContent = n ? txt : (rooms ? 'rooms' : fmtTime(S.settings.dtMin * 60000));
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
const UD_PRESETS = D.items.map(c => { const m = JSON.stringify(c.body).match(/<b>(?:UD|Duration):?<\/b>:?\s*(\d+)/); return m && c.cat !== 'Spellbook' ? { name: c.name, dice: +m[1] } : null; }).filter(Boolean);
function renderUD() {
  const c = $('#udCard'); if (!c) return;
  c.innerHTML = `<div class="row"><h3 style="margin:0">Usage dice</h3><span class="sp"></span><button class="btn primary sm" id="udAll">Roll all (end of DT)</button></div>
  <p class="sm muted" style="margin:4px 0">Each d6 showing 1–2 is removed. At 0 UD the effect ends or the item is spent.</p>
  <div id="udList">${S.ud.map(u => `<div class="udrow"><b style="min-width:120px">${esc(u.name)}</b>${u.who ? `<span class="muted sm">${esc(u.who)}</span>` : ''}<span class="dice">${Array.from({ length: Math.max(u.max, u.dice) }, (_, i) => `<span class="die ${i >= u.dice ? 'gone' : ''}">${u.last && u.last[i] ? u.last[i] : ''}</span>`).join('')}</span>${u.dice ? '' : '<span class="badge" style="color:var(--bad)">spent</span>'}<span class="sp"></span>
    <button class="btn sm" data-udroll="${u.id}">Roll</button><button class="btn sm" data-udref="${u.id}" title="Refuel / restore">↺</button><button class="btn sm" data-udplus="${u.id}">+</button><button class="icon-btn" data-uddel="${u.id}" title="Remove">✕</button></div>`).join('') || '<p class="muted">Nothing tracked. Add torches, lanterns, spell durations…</p>'}</div>
  <div class="row" style="margin-top:8px"><input id="udName" placeholder="Name (e.g. Boris’s torch)" list="udPresets" style="flex:1;min-width:150px"><input id="udN" type="number" min="1" value="1" style="width:56px" title="Usage dice"><input id="udWho" placeholder="Who" style="width:90px"><button class="btn" id="udAdd">Add</button></div>
  <datalist id="udPresets">${UD_PRESETS.map(p => `<option value="${esc(p.name)}">${p.dice} UD</option>`).join('')}</datalist>`;
  $('#udName').oninput = e => { const p = UD_PRESETS.find(p => p.name.toLowerCase() === e.target.value.toLowerCase()); if (p) $('#udN').value = p.dice; };
  $('#udAdd').onclick = () => { const n = $('#udName').value.trim(); if (!n) return; const d = Math.max(1, +$('#udN').value || 1); S.ud.push({ id: uid(), name: n, dice: d, max: d, who: $('#udWho').value.trim() }); save(); renderUD(); };
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
const PHASES = ['Group A fast turns', 'Group B fast turns', 'Group A slow turns', 'Group B slow turns'];
VIEWS.combat = () => {
  const C = S.combat;
  $('#main').innerHTML = `<div class="page-title"><h1>Combat</h1><span class="sp"></span><button class="btn" id="cbClear">Clear all</button><button class="btn" id="cbDT">End of DT: clear DT conditions</button></div>
  <div class="card"><div class="row"><h3 style="margin:0">Round ${C.round || '—'}</h3>
    <span id="cbGroups" class="muted">${C.pcsFirst == null ? 'Roll at the start of each round: 6+ on a d10 means the PCs are Group A.' : `<b>${C.pcsFirst ? 'PCs' : 'Enemies'}</b> are Group A this round (rolled ${C.lastRoll}).`}</span><span class="sp"></span>
    <button class="btn primary" id="cbRound">${C.round ? 'Next round' : 'Start combat'} (roll d10)</button></div>
    <div class="phase" style="margin-top:8px">${PHASES.map((p, i) => `<span class="${C.round && C.phase === i ? 'on' : ''}" data-phase="${i}">${i + 1}. ${p.replace('Group A', C.pcsFirst == null ? 'Group A' : C.pcsFirst ? 'PCs' : 'Enemies').replace('Group B', C.pcsFirst == null ? 'Group B' : C.pcsFirst ? 'Enemies' : 'PCs')}</span>`).join('')}<button class="btn sm" id="cbPhase">Next phase →</button></div>
    <p class="sm muted" style="margin:6px 0 0">Fast turn: a maneuver <i>or</i> an action. Slow turn: maneuver + action, or two maneuvers. Surprised creatures skip round 1.</p>
  </div>
  <div class="card" style="margin-top:12px"><div class="row">
    <input id="cbMon" list="monList" placeholder="Add monster / NPC / animal…" style="flex:1;min-width:200px"><input id="cbCount" type="number" value="1" min="1" style="width:56px" title="How many"><button class="btn primary" id="cbAddMon">Add</button>
    <span class="sp"></span><input id="cbPC" placeholder="PC or ally name" list="rosterList" style="width:160px"><button class="btn" id="cbAddPC">Add PC</button>${S.roster.length ? `<button class="btn" id="cbRoster">Add whole roster</button>` : ''}
  </div>
  <datalist id="monList">${D.monsters.map(m => `<option value="${esc(m.name)}">Power ${esc(m.power)} · ${esc(m.group)}</option>`).join('')}</datalist>
  <datalist id="rosterList">${S.roster.map(r => `<option value="${esc(r.name)}">`).join('')}</datalist></div>
  <div id="cbList"></div>`;
  renderCombatList();
  $('#cbRound').onclick = () => { const d = rnd(10); C.round++; C.pcsFirst = d >= 6; C.lastRoll = d; C.phase = 0; C.list.forEach(c => { if (C.round > 1) c.conds = (c.conds || []).filter(x => x !== 'surprised'); }); addLog(`<b>Round ${C.round}</b>: d10 = ${d} → <b>${C.pcsFirst ? 'PCs' : 'Enemies'}</b> are Group A`); save(); VIEWS.combat(); };
  $('#cbPhase').onclick = () => { if (!C.round) return; C.phase = (C.phase + 1) % 4; save(); VIEWS.combat(); };
  $$('[data-phase]').forEach(s => s.onclick = () => { C.phase = +s.dataset.phase; save(); VIEWS.combat(); });
  $('#cbAddMon').onclick = () => {
    const m = MON_BY_NAME[norm($('#cbMon').value)]; if (!m) { toast('Pick a creature from the list.'); return; }
    addCombatant(m, +$('#cbCount').value || 1); $('#cbMon').value = ''; renderCombatList();
  };
  $('#cbMon').onkeydown = e => { if (e.key === 'Enter') $('#cbAddMon').click(); };
  $('#cbAddPC').onclick = () => { const n = $('#cbPC').value.trim(); if (!n) return; C.list.push({ id: uid(), name: n, pc: true, sta: '', staMax: '', ad: '', adMax: '', conds: [] }); $('#cbPC').value = ''; save(); renderCombatList(); };
  if ($('#cbRoster')) $('#cbRoster').onclick = () => { S.roster.forEach(r => C.list.push({ id: uid(), name: r.name, pc: true, sta: '', staMax: '', ad: '', adMax: '', conds: [] })); save(); renderCombatList(); };
  $('#cbClear').onclick = () => { if (confirm('Remove all combatants and reset rounds?')) { S.combat = DEFAULT().combat; save(); VIEWS.combat(); } };
  $('#cbDT').onclick = () => { clearDTConds(); renderCombatList(); toast('Blessed, vulnerable and weakened cleared.'); };
};
function addCombatant(m, n = 1) {
  const same = S.combat.list.filter(c => c.mid === m.id).length;
  const ad = parseInt(m.ad) || 0, sta = parseInt(m.stamina) || 0;
  for (let i = 0; i < n; i++) S.combat.list.push({ id: uid(), mid: m.id, name: m.name + (n > 1 || same ? ' #' + (same + i + 1) : ''), sta, staMax: sta, ad, adMax: ad, conds: [] });
  save(); toast(`Added ${n} × ${esc(m.name)} to combat.`);
}
function renderCombatList() {
  const el = $('#cbList'); if (!el) return;
  const L = S.combat.list;
  el.innerHTML = L.length ? L.map(c => {
    const m = c.mid ? MON[c.mid] : null; const dead = !c.pc && c.staMax && c.sta <= 0;
    return `<div class="cb ${dead ? 'dead' : ''}" data-cb="${c.id}">
      <div class="row"><b>${esc(c.name)}</b>${c.pc ? '<span class="badge">PC</span>' : m ? `<span class="badge">Power ${esc(m.power)}</span>` : ''}
        ${m ? `<a class="sm mlink" data-m="${m.id}">stat block</a>` : ''}<span class="sp"></span>
        <span>Stamina <input class="num" type="number" data-f="sta" value="${c.sta}"> / <input class="num" type="number" data-f="staMax" value="${c.staMax}"></span>
        <span>AD <input class="num" type="number" data-f="ad" value="${c.ad}"> / <input class="num" type="number" data-f="adMax" value="${c.adMax}"></span>
        <button class="icon-btn" data-cbdel="${c.id}" title="Remove">✕</button></div>
      <div class="row" style="margin-top:6px"><input class="num" type="number" placeholder="dmg" data-dmgin><button class="btn sm" data-dmg="n">Damage</button><button class="btn sm" data-dmg="p">Piercing</button><button class="btn sm" data-dmg="h">Heal</button>
        <div class="conds">${COND_NAMES.map(k => `<span class="chip ${(c.conds || []).includes(k) ? 'on' : ''}" data-cond="${k}" title="${esc(CONDS[k]?.text || '')}">${k}</span>`).join('')}</div>
        <input placeholder="note" data-f="note" value="${esc(c.note || '')}" style="flex:1;min-width:120px"></div>
      ${dead ? '<div class="sm" style="color:var(--bad)">0 Stamina — monsters die (or are knocked out if you allow it).</div>' : ''}
      ${!c.pc && c.staMax && c.sta <= 0 ? '' : ''}
    </div>`;
  }).join('') : '<p class="muted" style="margin-top:12px">No combatants yet. Add monsters from the list above, or use “+ Add to combat” on any stat block.</p>';
  $$('.cb').forEach(row => {
    const c = L.find(x => x.id === row.dataset.cb);
    $$('[data-f]', row).forEach(inp => inp.onchange = () => { c[inp.dataset.f] = inp.type === 'number' ? (inp.value === '' ? '' : +inp.value) : inp.value; save(); if (inp.dataset.f !== 'note') renderCombatList(); });
    $$('[data-cond]', row).forEach(ch => ch.onclick = () => { const k = ch.dataset.cond; c.conds = c.conds || []; c.conds = c.conds.includes(k) ? c.conds.filter(x => x !== k) : [...c.conds, k]; save(); renderCombatList(); });
    $$('[data-dmg]', row).forEach(b => b.onclick = () => {
      let v = +$('[data-dmgin]', row).value || 0; if (!v) return;
      const kind = b.dataset.dmg;
      if (kind === 'h') { c.sta = Math.min(+c.staMax || Infinity, (+c.sta || 0) + v); }
      else {
        if ((c.conds || []).includes('vulnerable')) { const extra = rnd(6); v += extra; toast(`Vulnerable: +${extra} dam (1d6)`); }
        let msg = '';
        if (kind === 'n' && +c.ad > 0) { const a = Math.min(+c.ad, v); c.ad = +c.ad - a; v -= a; msg = `AD −${a}`; }
        const before = +c.sta || 0; c.sta = Math.max(0, before - v);
        const over = v - before;
        addLog(`${esc(c.name)} takes ${+$('[data-dmgin]', row).value}${kind === 'p' ? ' P' : ''} dam → ${msg ? msg + ', ' : ''}Stamina ${c.sta}${c.pc && over > 0 ? ` · <b>${over} wound${over > 1 ? 's' : ''}</b>` : ''}`, { quiet: true });
      }
      save(); renderCombatList();
    });
    $('[data-cbdel]', row).onclick = () => { S.combat.list = L.filter(x => x.id !== c.id); save(); renderCombatList(); };
  });
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

/* ---------------- travel ---------------- */
VIEWS.travel = () => {
  const T = S.travel;
  const head = HEAD['rules-overland-travel'] ? '#/book/rules/rules-overland-travel' : '#/book/rules';
  $('#main').innerHTML = `<div class="page-title"><h1>Travel day</h1><span class="muted">Hexes are 5 miles across. <a href="${head}">Full overland travel rules</a></span></div>
  <div class="grid dash">
    <div class="card"><h3>1. Pace &amp; route</h3>
      <div class="kv">
        <span>Pace</span><select data-t="pace"><option value="slow">Slow — 1 hex, EN 2, role tests gain an edge</option><option value="normal">Normal — 2 hexes, EN 4</option><option value="fast">Fast — 3 hexes, EN 6, role tests take a bane</option></select>
        <span>Slowest speed</span><select data-t="slow"><option value="s3">3 or lower (−1 hex)</option><option value="normal">4–6</option><option value="s7">7–9 (+1 hex)</option><option value="s10">10+ (+2 hexes)</option></select>
        <span>Route</span><span><label><input type="checkbox" data-t="road"> Road all day (+1)</label><br><label><input type="checkbox" data-t="river"> Cross river without bridge / go upstream (−1)</label><br><label><input type="checkbox" data-t="down"> Downstream on water (+1)</label></span>
      </div></div>
    <div class="card"><h3>2. Roles</h3>
      <div class="kv">
        <span>Guide</span><select data-t="guide"><option value="none">No guide / Normal Route not taken</option><option value="normal">Safe: Normal Route (+1 hex)</option><option value="secret1">Secret Path — tier 1: LOST</option><option value="secret2">Secret Path — tier 2 (EN −1, −1 hex)</option><option value="secret3">Secret Path — tier 3 (EN −2)</option><option value="short1">Shortcut — tier 1: LOST</option><option value="short2">Shortcut — tier 2 (+1 hex, EN +1)</option><option value="short3">Shortcut — tier 3 (+2 hexes)</option></select>
        <span>Scout</span><select data-t="scout"><option value="none">None / other</option><option value="danger">Safe: Scout for Danger (EN −1)</option><option value="places">Safe: Scout for Places (find hidden POIs)</option><option value="shelter1">Shelter — tier 1 (extra rest encounter check)</option><option value="shelter2">Shelter — tier 2 (rest EN −1, travel EN +1)</option><option value="shelter3">Shelter — tier 3 (ruin outside the Miasma)</option></select>
        <span>Other EN</span><input type="number" data-t="enx" value="${T.enx || 0}" style="width:70px">
      </div>
      <p class="sm muted">Supporters roll first, then guide, scouts, trackers. Risky tasks use the test roller. Hunting tier 2 also raises EN by 1 (use “Other EN”).</p></div>
    <div class="card"><h3>3. Result</h3><div id="trOut"></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="trEnc">Two encounter checks</button><button class="btn" data-rollt="${D.tables.find(t => t.name === 'Travel Encounters')?.gid}">🎲 Travel Encounters</button><button class="btn" id="trLost">Lost direction (d6)</button></div>
      <div id="trRes"></div></div>
    <div class="card"><h3>4. End of day</h3><ol class="checklist">
      <li>Explore a dungeon or POI? Switch to dungeon turns.</li>
      <li>Rest: consume a ration; resting in the Miasma restores no Effort. <button class="btn sm" id="trRest">Rest encounter check</button></li>
      <li>Each human makes a Mind RR against the Miasma — <a href="#/rollers">Miasma roller</a>.</li>
      <li>Animal tables by habitat: ${D.tables.filter(t => /Animal Encounters/.test(t.name)).map(t => `<span class="tlink" data-t="${t.gid}">${esc(t.name.replace(' Animal Encounters', ''))}</span>`).join(', ')}</li></ol></div>
  </div>`;
  const calc = () => {
    let hex = { slow: 1, normal: 2, fast: 3 }[T.pace], en = { slow: 2, normal: 4, fast: 6 }[T.pace]; const notes = [];
    hex += { s3: -1, normal: 0, s7: 1, s10: 2 }[T.slow];
    if (T.road) hex += 1; if (T.river) hex -= 1; if (T.down) hex += 1;
    const g = T.guide; let lost = false;
    if (g === 'normal') hex += 1; if (g === 'secret2') { en -= 1; hex -= 1; } if (g === 'secret3') en -= 2; if (g === 'short2') { hex += 1; en += 1; } if (g === 'short3') hex += 2;
    if (g === 'secret1' || g === 'short1') lost = true;
    if (T.scout === 'danger') en -= 1; if (T.scout === 'shelter2') { en += 1; notes.push('Resting tonight: EN −1.'); } if (T.scout === 'shelter1') notes.push('Extra encounter check next time you rest outdoors.'); if (T.scout === 'shelter3') notes.push('Found a ruin to rest outside the Miasma (10% inhabited).');
    en += +T.enx || 0; en = Math.max(1, en); hex = Math.max(0, hex);
    T.en = en; save();
    $('#trOut').innerHTML = `<div class="big" style="font-size:1.6rem;font-weight:700">${hex} hex${hex === 1 ? '' : 'es'} <span class="muted" style="font-size:1rem">(${hex * 5} miles)</span></div><div>Travel EN <b>${en}</b>${lost ? ' · <b style="color:var(--bad)">The group is LOST</b> — roll a direction each time they leave a hex.' : ''}</div>${notes.map(n => `<div class="sm">${n}</div>`).join('')}`;
  };
  $$('[data-t]').forEach(el => {
    const k = el.dataset.t; if (el.type === 'checkbox') el.checked = !!T[k]; else el.value = T[k] ?? el.value;
    el.onchange = el.oninput = () => { T[k] = el.type === 'checkbox' ? el.checked : el.value; save(); calc(); };
  });
  calc();
  const chk = (label, en) => { const d = rnd(10); return `${label}: d10 ${d} vs EN ${en} → ${d <= en ? '<b style="color:var(--bad)">ENCOUNTER</b>' : 'nothing'}`; };
  $('#trEnc').onclick = () => { const h = `<b>Travel encounter checks</b><br>${chk('Morning', T.en)}<br>${chk('Afternoon', T.en)}`; addLog(h, { quiet: true }); $('#trRes').innerHTML = `<div class="result">${h}</div>`; };
  $('#trRest').onclick = () => { const en = Math.max(1, { slow: 2, normal: 4, fast: 6 }[T.pace] - (T.scout === 'shelter2' ? 1 : 0)); const h = `<b>Rest encounter check</b>: ${chk('Night', en)}`; addLog(h, { quiet: true }); $('#trRes').innerHTML = `<div class="result">${h}</div>`; };
  $('#trLost').onclick = () => { const d = rnd(6); const h = `<b>Lost</b>: d6 = ${d} → actually moves <b>${['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'][d - 1]}</b>`; addLog(h, { quiet: true }); $('#trRes').innerHTML = `<div class="result">${h}</div>`; };
};

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
function qualHTML(s) {
  return strip(s).split(/,\s*/).map(q => { const k = q.replace(/\s+\d+$/, '').trim().toLowerCase(); const d = QUAL[k]; return d ? `<span class="cond" title="${esc(d)}">${esc(q)}</span>` : esc(q); }).join(', ');
}
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
  return `<div style="overflow-x:auto"><table class="tbl"><tr><th>Armor</th><th>Type</th><th>AD</th><th>Slots</th><th>Price</th></tr>${L.map(c => { const a = armorInfo(c); return `<tr><td><span class="ilink" data-i="${c.id}"><b>${expandName(c.name)}</b></span></td><td>${a.type}</td><td>${a.ad}</td><td>${slotsOf(c)}</td><td>${esc(c.price || '—')}</td></tr>`; }).join('')}</table></div>`;
}
VIEWS.items = () => {
  const st = VIEWS.items.st ||= { q: '', view: 'table' };
  const ref = ['Armor Types', 'Upgraded Armor', 'Armor Enchantments', 'Weapon Types', 'Weapon Qualities', 'Ammunition', 'Upgraded Weapons', 'Weapon Enchantments', 'Gear', 'Alchemical Items', 'Enchanted Items', 'Crafting Materials', 'Treasure', 'Shopping', 'Money']
    .map(n => { const b = D.books.chars.blocks.find(b => b.t === 'h' && b.text === n && b.lvl <= 3); return b ? `<a class="chip" href="#/book/chars/${b.id}">${esc(n)}</a>` : ''; }).join(' ');
  $('#main').innerHTML = `<div class="page-title"><h1>Items</h1><span class="muted">${D.items.filter(c => c.cat !== 'Spellbook').length} item cards · spells are on the <a href="#/spells">Spells</a> tab</span></div>
  <div class="row" style="margin-bottom:10px"><input id="iq" placeholder="Filter all items…" value="${esc(st.q)}" style="flex:1;max-width:340px">
    <span class="chip ${st.view === 'table' ? 'on' : ''}" data-view="table">Tables for weapons &amp; armor</span><span class="chip ${st.view === 'cards' ? 'on' : ''}" data-view="cards">Cards everywhere</span></div>
  <div class="filters" id="jump"></div>
  <div id="isecs"></div>
  <h2 id="sec-rules">Equipment rules</h2><p class="muted sm">Upgrades, enchantments, crafting and prices from the Characters booklet:</p><div class="filters">${ref}</div>`;
  const draw = () => {
    let L = D.items.filter(c => c.cat !== 'Spellbook');
    if (st.q) { const q = st.q.toLowerCase(); L = L.filter(c => (c.name + ' ' + strip(JSON.stringify(c.body))).toLowerCase().includes(q)); }
    const secs = itemSections(L).filter(s => s[2].length);
    $('#jump').innerHTML = secs.map(([id, t, l]) => `<a class="chip" href="#" data-jump="sec-${id}">${esc(t)} <span class="faint">${l.length}</span></a>`).join('') + `<a class="chip" href="#" data-jump="sec-rules">Equipment rules</a>`;
    $('#isecs').innerHTML = secs.map(([id, t, l]) => {
      const core = l.filter(c => c.src !== 'dungeon'), found = l.filter(c => c.src === 'dungeon');
      let body;
      if (st.view === 'table' && id === 'weapons') body = weaponTable(core) + (found.length ? `<h4>Upgraded weapons found in dungeons</h4>${weaponTable(found)}` : '');
      else if (st.view === 'table' && id === 'armor') body = armorTable(core) + (found.length ? `<h4>Upgraded armor found in dungeons</h4>${armorTable(found)}` : '');
      else body = `<div class="grid igrid">${l.map(c => `<div>${itemCardHTML(c, { link: true, actions: false })}</div>`).join('')}</div>`;
      return `<h2 id="sec-${id}">${esc(t)} <span class="faint sm">${l.length}</span></h2>${id === 'weapons' && st.view === 'table' ? '<p class="sm muted">Hover a quality for its rule. Click a name for the full card.</p>' : ''}${body}`;
    }).join('') || '<p class="muted">No matches.</p>';
    $$('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); const el = document.getElementById(a.dataset.jump); if (el) { el.scrollIntoView(); window.scrollBy(0, -70); } });
  };
  draw();
  $('#iq').oninput = e => { st.q = e.target.value; draw(); };
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
    <details><summary>Inventory cards (${p.cards.length})</summary><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-top:6px">${p.cards.map(c => itemCardHTML(Object.assign({ cat: '' }, c), { actions: false })).join('')}</div></details>
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
      <p class="sm muted" id="saveInfo"></p></div>
    <div class="card"><h3>Install as an app</h3><p class="sm">On a phone or laptop, use your browser’s “Install app” / “Add to Home Screen”. It then opens in its own window and works offline.</p></div>
    <div class="card"><h3>About</h3><p class="sm">An unofficial Ref companion built from the MCDM <i>Crows</i> public playtest (October 2026, playtest 3) files. All game text belongs to MCDM. Keep it to your own table; don’t post it publicly.</p>
      <p class="sm muted">Keyboard: <kbd>/</kbd> search · <kbd>Esc</kbd> close panels · <kbd>↑</kbd><kbd>↓</kbd><kbd>Enter</kbd> pick a result.</p></div>
  </div>`;
  $('#saveInfo').textContent = `Current save: ${(JSON.stringify(S).length / 1024).toFixed(1)} KB`;
  $$('[data-dtm]').forEach(c => c.onclick = () => { const v = c.dataset.dtm; if (v === 'rooms') S.settings.mode = 'rooms'; else { S.settings.mode = 'timer'; S.settings.dtMin = +v; if (!S.dt.num) S.dt.left = +v * 60000; } save(); VIEWS.settings(); tick(); });
  $('#snd').onchange = e => { S.settings.sound = e.target.checked; save(); };
  $('#testBeep').onclick = () => { const s = S.settings.sound; S.settings.sound = true; beep(); S.settings.sound = s; };
  $('#exp').onclick = () => { const b = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `crows-ref-save-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const s = JSON.parse(t); if (!s || typeof s !== 'object' || !s.settings) throw 0; localStorage.setItem(KEY, JSON.stringify(s)); S = load(); toast('Save file imported.'); route(); tick(); } catch (err) { toast('That file isn’t a Crows Ref save.'); } }); };
  $('#rst').onclick = () => { if (confirm('Erase all timers, trackers, notes, progress and logs on this device?')) { S = DEFAULT(); localStorage.setItem(KEY, JSON.stringify(S)); route(); tick(); } };
};

/* ---------------- global events ---------------- */
document.addEventListener('click', e => {
  const t = e.target;
  const ml = t.closest('.mlink'); if (ml) { e.preventDefault(); openDrawer('monster', ml.dataset.m); return; }
  const il = t.closest('.ilink'); if (il) { e.preventDefault(); openDrawer('item', il.dataset.i); return; }
  const tl = t.closest('.tlink'); if (tl) { e.preventDefault(); openDrawer('table', tl.dataset.t); return; }
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
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
