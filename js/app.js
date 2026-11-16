// Lockdown on Meridian Station — VR SQL escape room engine.
// Contains no answers: puzzles and result fingerprints arrive encrypted in data/lab.json.
import * as THREE from '../vendor/three.module.min.js';
import { check, cell, sha } from './canon.js';
import { buildSpace, buildRoom, setQuality, loadManifest, setBakedCallback, Q } from './scenery.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOOK = 'You need to look around the room to find your clues to exit the room.';

let CFG = null, MODE = 'student', SOL = null, S = null, KEY = '';
let db = null, dbReady = false;
let started = false, inXR = false, arMode = false;

/* ------------------------------------------------------------------ access phrase */
const LABFILE = await (await fetch('data/lab.json', { cache: 'no-cache' })).json();
$('#gTitle').textContent = LABFILE.title; $('#gCourse').textContent = LABFILE.course + ' · VR Escape Room';
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function open_(blob, phrase) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(blob.salt), iterations: LABFILE.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct)));
}
if (!window.crypto || !crypto.subtle) { $('#gMsg').textContent = 'This page must be opened over https:// to unlock.'; $('#gGo').disabled = true; }
$('#gForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const phrase = $('#gPw').value.trim(); if (!phrase) return;
  $('#gGo').disabled = true; $('#gMsg').style.color = 'var(--dim)'; $('#gMsg').textContent = 'Checking…';
  let body = null;
  try { const meta = JSON.parse(await open_(LABFILE.I, phrase)); body = await open_(LABFILE.S, meta.p); MODE = 'instructor'; SOL = meta.sol; } catch (e) {}
  if (!body) { try { body = await open_(LABFILE.S, phrase); } catch (e) {} }
  if (!body) {
    $('#gMsg').style.color = 'var(--bad)'; $('#gMsg').textContent = 'That phrase does not unlock this activity. Check spelling and capitalisation.';
    $('#gGo').disabled = false; $('#gPw').select(); return;
  }
  CFG = JSON.parse(body); $('#gate').remove(); boot();
});
$('#gPw').focus();

/* ------------------------------------------------------------------ state */
const now = () => Date.now();
const fresh = () => ({ v: 1, t0: null, tEnd: null, tBonus: null, room: 'r1', p: {} });
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 ? s : fresh(); } catch (e) { return fresh(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
const P = id => S.p[id] || (S.p[id] = { st: 'hidden', a: 0, tf: null, ts: null, draft: '' });
const pz = id => CFG.puzzles.find(p => p.id === id);
const rm = id => CFG.rooms.find(r => r.id === id);
const roomPuzzles = rid => CFG.puzzles.filter(p => p.room === rid);
const solvedIn = rid => roomPuzzles(rid).filter(p => P(p.id).st === 'solved').length;
const roomDone = rid => solvedIn(rid) === roomPuzzles(rid).length;
const roomUnlocked = rid => { const i = CFG.rooms.findIndex(r => r.id === rid); return i === 0 || roomDone(CFG.rooms[i - 1].id); };
const nextRoom = rid => CFG.rooms[CFG.rooms.findIndex(r => r.id === rid) + 1] || null;
function clockText() {
  if (!S || !S.t0) return '00:00';
  const end = S.tBonus || (S.room !== 'rb' && S.tEnd) || now();
  const s = Math.max(0, Math.floor((end - S.t0) / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ------------------------------------------------------------------ database */
function setDb(state, txt) { $('#dbDot').className = 'dot ' + state; $('#dbTxt').textContent = txt; }
async function initDb() {
  try {
    const { PGlite } = await import('../vendor/pglite/index.js');
    db = new PGlite();
    await db.exec(CFG.setup);
    await db.exec('SET default_transaction_read_only = on;');
    dbReady = true; setDb('', 'Station database online.');
    for (const b of ['#btnScreen', '#btnVR', '#btnAR']) $(b).disabled = false;
  } catch (e) {
    console.error(e); setDb('bad', 'The database could not start in this browser (' + (e.message || e) + '). Reload the page, or try a current version of Chrome, Edge, Safari or Firefox.');
  }
}
async function runSql(sql) {
  let q = sql.trim().replace(/;+\s*$/, '');
  if (!q) throw { friendly: 'Your query is empty. Start with SELECT.' };
  if (q.includes(';')) throw { friendly: 'Send VESTA one statement at a time: a single SELECT ending in one semicolon.' };
  if (!/^\s*select\b/i.test(q)) throw { friendly: 'VESTA only accepts queries that start with SELECT.' };
  const r = await db.query(q, [], { rowMode: 'array' });
  return { fields: r.fields.map(f => f.name), rows: r.rows.slice(0, 5000) };
}
function pgError(e) {
  if (e && e.friendly) return e.friendly;
  const m = (e && e.message) || String(e), c = e && e.code;
  let tip = 'Read the message, fix the query and run it again.';
  if (c === '42601') tip = 'That is a syntax error. Check the keyword spelling, the commas between column names, and that text values sit inside single quotes.';
  else if (c === '42703') tip = 'A column name is not recognised. Compare it with the Station database list, letter for letter. Text values need single quotes.';
  else if (c === '42P01') tip = 'That table does not exist. Check the table name after FROM.';
  else if (c === '42883' || c === '22P02') tip = 'A value has the wrong type. Numbers have no quotes; text has single quotes.';
  return 'Postgres says: ' + m + '. ' + tip;
}
function explain(v, p) {
  switch (v.reason) {
    case 'ncols': return `VESTA asked for ${v.want} column${v.want > 1 ? 's' : ''}; your result has ${v.got}. Re-read which columns the request names.`;
    case 'toomany': return p.exp.nrows < 14 ? 'Right shape, but too many rows came back. Does your WHERE keep only the rows VESTA asked for?' : 'Too many rows came back. Check the table and any filter.';
    case 'toofew': return v.got === 0 ? 'No rows came back. Text must match exactly, capitals included, inside single quotes.' : 'Some rows are missing. Is your filter too strict, or are you reading the wrong table?';
    case 'colorder': return 'Those are the right columns in the wrong order. List them after SELECT in the order VESTA asked.';
    case 'cols': return `Column ${v.bad.join(' and ')} of your result does not hold what VESTA asked for. Check the column names and the filter.`;
    case 'values': return 'The row count is right but the rows are not. Check your WHERE condition.';
    case 'order': return 'Right rows, wrong order. Check ORDER BY: which column, and ascending or descending (DESC)?';
  }
  return 'Not accepted.';
}

/* ------------------------------------------------------------------ three.js stage */
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.xr.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 4000);
camera.rotation.order = 'YXZ'; camera.position.set(0, 1.6, 0);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
let yaw = 0, pitch = 0, composer = null, bloom = null;
function resize() { if (renderer.xr.isPresenting) return; renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (composer) composer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

const env = { THREE, anim: [] };
/* graphics quality: 2 High (PC GPU), 1 Medium (Quest 3 standalone), 0 Low (Quest 2 standalone) */
function autoLevel() { const ua = navigator.userAgent; if (/Quest 3|Quest Pro/i.test(ua)) return 1; if (/OculusBrowser|Quest|Android|iPhone|iPad|Mobile/i.test(ua)) return 0; return 2; }
let gfxPref = 'auto'; try { gfxPref = localStorage.getItem('meridian.gfx') || 'auto'; } catch (e) {}
const levelOf = pref => pref === 'auto' ? autoLevel() : Number(pref);
setQuality(levelOf(gfxPref));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null, cubeRT = null, cubeCam = null;
function applyQuality() {
  renderer.shadowMap.enabled = Q.level === 2; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.level === 2 ? 2 : 1.5));
  scene.environmentIntensity = .85; composer = null;
  if (Q.level === 2) Promise.all([import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]).then(([a, b, c, d]) => {
    if (Q.level !== 2) return;
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    const comp = new a.EffectComposer(renderer, rt); comp.addPass(new b.RenderPass(scene, camera));
    bloom = new c.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .3, .5, 1.08); comp.addPass(bloom); comp.addPass(new d.OutputPass());
    comp.setPixelRatio(renderer.getPixelRatio()); comp.setSize(innerWidth, innerHeight); composer = comp;
  }).catch(e => console.warn('post-processing unavailable', e));
}
// Reflections: photograph the finished room from the player's head once, and let every surface reflect that picture.
function captureEnvironment() {
  if (envRT) { envRT.dispose(); envRT = null; } scene.environment = null;
  if (!Q.level) return;
  if (!cubeCam) { cubeRT = new THREE.WebGLCubeRenderTarget(Q.level === 2 ? 256 : 128, { type: THREE.HalfFloatType }); cubeCam = new THREE.CubeCamera(.1, 3000, cubeRT); cubeCam.position.set(0, 1.5, 0); scene.add(cubeCam); }
  const tv = term.visible, fv = fade.visible, sh = renderer.shadowMap.enabled; term.visible = false; fade.visible = false; label.visible = false;
  cubeCam.update(renderer, scene); envRT = pmrem.fromCubemap(cubeRT.texture); scene.environment = envRT.texture;
  term.visible = tv; fade.visible = fv; renderer.shadowMap.enabled = sh;
}
const space = buildSpace(env); scene.add(space.group);
setBakedCallback(rid => { if (S && rid === S.room) captureEnvironment(); });   // re-photograph the room once its baked light has arrived
let room = null;                         // {group, clues, hatch, update}
let interactives = [];                   // {obj, kind, pid}

// fade sphere
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0, side: THREE.BackSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
fade.renderOrder = 9998; scene.add(fade);
let fadeTarget = 0, fadeCb = null;
function fadeTo(v) { return new Promise(res => { if (fade.material.opacity === v) { fadeTarget = v; res(); return; } fadeTarget = v; fadeCb = res; }); }

/* ------------------------------------------------------------------ terminal (model) */
const T = { pid: null, sql: '', cur: 0, res: null, fb: null, busy: false, note: null, hits: [], shift: false, kb: true };
const TW = 1600, TH = 1000;
const tCan = document.createElement('canvas'); tCan.width = TW; tCan.height = TH; const tg = tCan.getContext('2d');
const tTex = new THREE.CanvasTexture(tCan); tTex.colorSpace = THREE.SRGBColorSpace; tTex.anisotropy = 8;
const term = new THREE.Group(); scene.add(term);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: tTex, toneMapped: false }));
screen.position.set(0, 1.36, -1.55); screen.rotation.x = -0.14; term.add(screen);
{ // housing and stand
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: .55, metalness: .7 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.12, .07), dark); back.position.set(0, 0, -.045); screen.add(back);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.72, .03, .12), new THREE.MeshBasicMaterial({ color: 0x4fd8ff })); lip.position.set(0, -.575, .0); screen.add(lip);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.0, 12), dark); arm.position.set(0, .45, -1.72); term.add(arm);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(.34, .4, .08, 24), dark); foot.position.set(0, .04, -1.72); term.add(foot);
}
// virtual keyboard
const KW = 1400, KH = 560;
const kCan = document.createElement('canvas'); kCan.width = KW; kCan.height = KH; const kg = kCan.getContext('2d');
const kTex = new THREE.CanvasTexture(kCan); kTex.colorSpace = THREE.SRGBColorSpace; kTex.anisotropy = 8;
const kbd = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.5), new THREE.MeshBasicMaterial({ map: kTex, toneMapped: false }));
kbd.position.set(0, 0.74, -1.02); kbd.rotation.x = -0.95; kbd.visible = false; term.add(kbd);
let kKeys = [];
// passthrough "keyboard window" (immersive-ar only): punches a hole to the real desk
const port = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.36), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, blending: THREE.NoBlending, depthTest: false, depthWrite: false }));
port.rotation.x = -Math.PI / 2; port.position.set(0, 0.72, -0.42); port.renderOrder = 9990; port.visible = false; term.add(port);
const portRim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-.34, -.19], [.34, -.19], [.34, .19], [-.34, .19]].map(p => new THREE.Vector3(p[0], p[1], 0))), new THREE.LineBasicMaterial({ color: 0x4fd8ff }));
port.add(portRim);

function ins(s) { T.sql = T.sql.slice(0, T.cur) + s + T.sql.slice(T.cur); T.cur += s.length; syncDraft(); }
function bksp() { if (T.cur > 0) { T.sql = T.sql.slice(0, T.cur - 1) + T.sql.slice(T.cur); T.cur--; syncDraft(); } }
function syncDraft(fromDom) { if (T.pid) { P(T.pid).draft = T.sql; save(); } if (!fromDom) $('#dSql').value = T.sql; drawTerm(); }

/* rich text on canvas */
function runsOf(html) {
  const out = []; let st = 'n';
  html.replace(/<(\/?)(b|code|em)>|([^<]+)/g, (m, cl, tag, txt) => {
    if (txt) out.push({ t: txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<')  .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), s: st });
    else st = cl ? 'n' : (tag === 'code' ? 'c' : tag === 'b' ? 'b' : 'n');
  });
  return out;
}
function rich(g, html, x, y, maxW, size, color, italic) {
  const lh = size * 1.38; let cx = x;
  const font = s => s === 'c' ? `600 ${size * .94}px ui-monospace,Menlo,Consolas,monospace` : `${italic ? 'italic ' : ''}${s === 'b' ? '700' : '400'} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  for (const r of runsOf(html)) {
    g.font = font(r.s); g.fillStyle = r.s === 'c' ? '#4fd8ff' : r.s === 'b' ? '#ffffff' : color;
    for (const w of r.t.split(/(\s+)/)) {
      if (!w) continue; const wd = g.measureText(w).width;
      if (/^\s+$/.test(w)) { if (cx > x) cx += wd; continue; }
      if (cx + wd > x + maxW && cx > x) { cx = x; y += lh; }
      g.fillText(w, cx, y); cx += wd;
    }
  }
  return y + lh;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function btn(g, x, y, w, h, label, act, style) {
  rr(g, x, y, w, h, 12); g.fillStyle = style === 'p' ? '#4fd8ff' : style === 'a' ? '#ffb347' : '#ffffff14'; g.fill();
  if (!style) { g.strokeStyle = '#ffffff40'; g.lineWidth = 2; g.stroke(); }
  g.fillStyle = style ? '#04121a' : '#e9eef5'; g.font = '700 30px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  T.hits.push({ x, y, w, h, act });
}
function drawTracker(g) {
  g.fillStyle = '#060b14'; g.fillRect(0, 0, TW, 92);
  g.fillStyle = '#4fd8ff'; g.fillRect(0, 90, TW, 2);
  g.font = '700 22px system-ui,sans-serif'; g.fillStyle = '#4fd8ff'; g.fillText('STATUS', 28, 40);
  g.font = '600 22px ui-monospace,Menlo,monospace'; g.fillStyle = '#ffb347'; g.fillText(clockText(), 28, 72);
  let x = 150;
  for (const r of CFG.rooms) {
    const ps = roomPuzzles(r.id), cur = r.id === S.room, done = roomDone(r.id), w = 70 + ps.length * 30;
    rr(g, x, 20, w, 54, 27); g.fillStyle = cur ? '#4fd8ff22' : '#ffffff0c'; g.fill();
    g.lineWidth = cur ? 3 : 1.5; g.strokeStyle = cur ? '#4fd8ff' : done ? '#5fe3a1' : '#ffffff30'; g.stroke();
    g.font = '700 24px ui-monospace,Menlo,monospace'; g.fillStyle = done ? '#5fe3a1' : cur ? '#fff' : roomUnlocked(r.id) ? '#9fb0c3' : '#566';
    g.fillText(r.bonus ? 'B' : String(r.n), x + 20, 56);
    ps.forEach((p, i) => {
      const st = P(p.id).st; g.beginPath(); g.arc(x + 62 + i * 30, 47, 10, 0, 7);
      if (st === 'solved') { g.fillStyle = '#5fe3a1'; g.fill(); } else if (st === 'found') { g.fillStyle = '#ffb347'; g.fill(); } else { g.strokeStyle = '#ffffff55'; g.lineWidth = 2.5; g.stroke(); }
    });
    x += w + 10;
  }
  g.font = '600 22px system-ui,sans-serif'; g.fillStyle = '#9fb0c3'; g.textAlign = 'right';
  g.fillText(MODE === 'instructor' ? 'INSTRUCTOR ' + ($('#fps').textContent || '') : solvedIn(S.room) + '/' + roomPuzzles(S.room).length + ' HATCH', TW - 28, 56); g.textAlign = 'left';
}
function drawSchema(g, x, y, w) {
  g.font = '700 20px system-ui,sans-serif'; g.fillStyle = '#9fb0c3'; g.fillText('STATION DATABASE', x, y); y += 12;
  for (const t of CFG.schema) {
    y += 34; g.font = '700 25px ui-monospace,Menlo,monospace'; g.fillStyle = '#ffb347'; g.fillText(t.table, x, y);
    g.font = '400 19px ui-monospace,Menlo,monospace'; g.fillStyle = '#6c7b8e'; g.fillText(t.rows + ' rows', x + g.measureText(t.table).width * 1.32 + 16, y);
    for (const c of t.cols) {
      y += 27; g.font = '400 22px ui-monospace,Menlo,monospace'; g.fillStyle = '#dfe8f2'; g.fillText(c[0], x + 22, y);
      g.fillStyle = '#6c7b8e'; g.font = '400 18px ui-monospace,Menlo,monospace'; g.fillText(c[1], x + 290, y);
    }
  }
}
function drawTerm() {
  if (!CFG || !S) return;
  const g = tg; T.hits = [];
  const bgr = g.createLinearGradient(0, 0, 0, TH); bgr.addColorStop(0, '#0a111c'); bgr.addColorStop(1, '#05080e');
  g.fillStyle = bgr; g.fillRect(0, 0, TW, TH);
  drawTracker(g);
  const L = 40, MW = 1060;
  g.fillStyle = '#ffffff0a'; g.fillRect(1140, 92, 460, TH - 92); drawSchema(g, 1168, 140, 420);
  if (!T.pid) {
    const n = T.note || { title: rm(S.room).name, lines: [rm(S.room).brief] };
    g.font = '700 26px system-ui,sans-serif'; g.fillStyle = '#4fd8ff'; g.fillText('VESTA · MODULE ' + (rm(S.room).bonus ? 'BONUS' : rm(S.room).n + ' OF 5'), L, 160);
    g.font = '700 58px system-ui,sans-serif'; g.fillStyle = '#fff'; g.fillText(n.title, L, 232);
    let y = 300; for (const ln of n.lines) y = rich(g, ln, L, y, MW, 34, '#cfd9e5') + 14;
    if (!T.note) {
      y += 10; rr(g, L, y, MW, 150, 16); g.fillStyle = '#ffb34718'; g.fill(); g.strokeStyle = '#ffb347'; g.lineWidth = 2; g.stroke();
      rich(g, '<b>' + LOOK + '</b>', L + 28, y + 62, MW - 56, 36, '#ffb347');
      y += 200; y = rich(g, `Skill in this module: <b>${rm(S.room).skill}</b>. Authorisations: <b>${solvedIn(S.room)} of ${roomPuzzles(S.room).length}</b>.`, L, y, MW, 30, '#9fb0c3');
      rich(g, 'Flagged items carry a slow amber beacon. Point at one and select it.', L, y + 12, MW, 28, '#6c7b8e');
    }
  } else {
    const p = pz(T.pid), st = P(p.id);
    g.font = '700 24px system-ui,sans-serif'; g.fillStyle = st.st === 'solved' ? '#5fe3a1' : '#ffb347';
    g.fillText((st.st === 'solved' ? 'ACCEPTED · ' : 'REQUEST · ') + p.item.toUpperCase(), L, 140);
    let y = rich(g, p.clue, L, 186, MW, 27, '#9fb0c3', true) + 4;
    y = rich(g, p.task, L, y + 6, MW, 31, '#e9eef5') - 8;
    // SQL box
    const bh = 168; rr(g, L, y, MW, bh, 12); g.fillStyle = '#02050a'; g.fill(); g.strokeStyle = '#4fd8ff'; g.lineWidth = 2.5; g.stroke();
    g.font = '500 32px ui-monospace,Menlo,Consolas,monospace'; const cw = g.measureText('M').width, per = Math.floor((MW - 40) / cw);
    const lines = []; let line = '', curPos = null;
    for (let i = 0; i <= T.sql.length; i++) {
      if (i === T.cur) curPos = [line.length, lines.length];
      if (i === T.sql.length) break;
      const ch = T.sql[i];
      if (ch === '\n' || line.length >= per) { lines.push(line); line = ch === '\n' ? '' : ch; } else line += ch;
    }
    lines.push(line);
    const first = Math.max(0, Math.min(lines.length - 4, curPos[1] - 3));
    g.fillStyle = '#e9eef5';
    if (!T.sql) { g.fillStyle = '#44546a'; g.fillText('SELECT ...', L + 20, y + 44); }
    for (let i = first; i < Math.min(lines.length, first + 4); i++) g.fillText(lines[i], L + 20, y + 44 + (i - first) * 38);
    if (Math.floor(performance.now() / 500) % 2 === 0) { g.fillStyle = '#4fd8ff'; g.fillRect(L + 20 + curPos[0] * cw, y + 14 + (curPos[1] - first) * 38, 4, 36); }
    y += bh + 16;
    btn(g, L, y, 190, 62, 'RUN ▶', 'run', 'p'); btn(g, L + 206, y, 150, 62, 'CLEAR', 'clear');
    if (inXR) btn(g, L + 372, y, 230, 62, T.kb ? 'HIDE KEYS' : 'KEYBOARD', 'kb');
    if (inXR && arMode) { btn(g, L + 618, y, 96, 62, 'DESK ▲', 'portUp'); btn(g, L + 724, y, 96, 62, 'DESK ▼', 'portDn'); }
    if (MODE === 'instructor') btn(g, MW + L - 210, y, 210, 62, 'SOLUTION', 'sol', 'a');
    y += 84;
    if (T.fb) {
      const col = T.fb.k === 'ok' ? '#5fe3a1' : T.fb.k === 'bad' ? '#ff8a7e' : '#9fb0c3';
      g.fillStyle = col; g.fillRect(L, y - 4, 6, 70);
      y = rich(g, T.fb.t, L + 22, y + 24, MW - 22, 27, col) + 4;
    }
    if (T.res && y < TH - 90) {
      const f = T.res.fields, rows = T.res.rows; g.font = '500 23px ui-monospace,Menlo,monospace';
      const cwid = g.measureText('M').width; let ws = f.map((n, i) => Math.min(24, Math.max(n.length, ...rows.slice(0, 12).map(r => cell(r[i]).length))));
      let tot = ws.reduce((a, b) => a + b + 3, 0); const maxc = Math.floor(MW / cwid);
      while (tot > maxc && ws.length > 1) { tot -= ws.pop() + 3; }
      const fit = Math.max(1, Math.floor((TH - y - 62) / 30) - 1);
      let x = L; g.fillStyle = '#4fd8ff';
      ws.forEach((w, i) => { g.fillText(f[i].slice(0, w), x, y + 24); x += (w + 3) * cwid; });
      g.fillStyle = '#ffffff30'; g.fillRect(L, y + 34, Math.min(MW, tot * cwid), 2);
      rows.slice(0, fit).forEach((r, ri) => { let x = L; g.fillStyle = '#dfe8f2'; ws.forEach((w, i) => { const s = cell(r[i]) === '∅' ? 'NULL' : cell(r[i]); g.fillText(s.length > w ? s.slice(0, w - 1) + '…' : s, x, y + 62 + ri * 30); x += (w + 3) * cwid; }); });
      g.fillStyle = '#6c7b8e'; g.font = '400 20px ui-monospace,Menlo,monospace';
      g.fillText(`${rows.length} row${rows.length === 1 ? '' : 's'}, ${f.length} column${f.length === 1 ? '' : 's'}` + (rows.length > fit ? ` (showing first ${fit})` : '') + (ws.length < f.length ? ` (first ${ws.length} columns shown)` : ''), L, TH - 22);
    }
  }
  tTex.needsUpdate = true;
}
/* virtual keyboard */
const KROWS = [
  ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'ASC', 'DESC', 'AND', 'OR'],
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '*'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'", '='],
  ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '_'],
  ['<', '>', '(', ')', ';', 'space', '◀', '▶', 'RUN'],
];
function drawKbd() {
  const g = kg; kKeys = []; g.fillStyle = '#0b1019'; g.fillRect(0, 0, KW, KH);
  const rh = KH / KROWS.length;
  KROWS.forEach((row, ri) => {
    const units = row.reduce((a, k) => a + (k === 'space' ? 4 : k === 'RUN' ? 2 : ri === 0 ? (k.length > 5 ? 1.7 : 1.25) : 1), 0), uw = KW / units; let x = 0;
    for (const k of row) {
      const w = uw * (k === 'space' ? 4 : k === 'RUN' ? 2 : ri === 0 ? (k.length > 5 ? 1.7 : 1.25) : 1);
      rr(g, x + 5, ri * rh + 5, w - 10, rh - 10, 10);
      g.fillStyle = k === 'RUN' ? '#4fd8ff' : ri === 0 ? '#ffb34726' : (k === '⇧' && T.shift) ? '#ffb347' : '#ffffff16'; g.fill();
      g.fillStyle = k === 'RUN' ? '#04121a' : ri === 0 ? '#ffb347' : '#e9eef5'; g.font = `600 ${ri === 0 ? 30 : 40}px ui-monospace,Menlo,monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const lab = k.length === 1 && /[a-z]/.test(k) && T.shift ? k.toUpperCase() : k;
      g.fillText(lab, x + w / 2, ri * rh + rh / 2 + 2);
      kKeys.push({ x, y: ri * rh, w, h: rh, k, kw: ri === 0 }); x += w;
    }
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; kTex.needsUpdate = true;
}
function pressKey(k) {
  if (!T.pid) return; sfx('key');
  if (k.kw) { const pre = T.cur > 0 && !/\s/.test(T.sql[T.cur - 1]) ? ' ' : ''; ins(pre + k.k + ' '); return; }
  switch (k.k) {
    case '⌫': bksp(); break; case 'space': ins(' '); break; case 'RUN': run(); break;
    case '⇧': T.shift = !T.shift; drawKbd(); break;
    case '◀': T.cur = Math.max(0, T.cur - 1); drawTerm(); break; case '▶': T.cur = Math.min(T.sql.length, T.cur + 1); drawTerm(); break;
    default: ins(T.shift && /[a-z]/.test(k.k) ? k.k.toUpperCase() : k.k); if (T.shift) { T.shift = false; drawKbd(); }
  }
}
function termAction(a) {
  if (a === 'run') run();
  else if (a === 'clear') { T.sql = ''; T.cur = 0; T.res = null; syncDraft(); }
  else if (a === 'kb') { T.kb = !T.kb; kbd.visible = inXR && T.kb; drawTerm(); }
  else if (a === 'sol' && SOL) { T.sql = SOL[T.pid]; T.cur = T.sql.length; syncDraft(); }
  else if (a === 'portUp') port.position.y += 0.03; else if (a === 'portDn') port.position.y -= 0.03;
}

/* ------------------------------------------------------------------ DOM dock + tracker */
function renderTrack() {
  $('#track').innerHTML = CFG.rooms.map(r => {
    const cls = r.id === S.room ? 'cur' : roomDone(r.id) ? 'done' : roomUnlocked(r.id) ? '' : 'lock';
    return `<span class="chip ${cls}" title="${esc(r.name)}: ${esc(r.skill)}">${r.bonus ? 'Bonus' : r.n}` + roomPuzzles(r.id).map(p => `<i class="pip ${P(p.id).st === 'hidden' ? '' : P(p.id).st}"></i>`).join('') + '</span>';
  }).join('');
  $('#bRoom').textContent = (rm(S.room).bonus ? '' : 'Module ' + rm(S.room).n + ' · ') + rm(S.room).name;
}
function renderDock() {
  const show = !!T.pid && !inXR && started;
  $('#dock').classList.toggle('hidden', !show || dockHidden); $('#dockTab').classList.toggle('hidden', !(show && dockHidden));
  if (!T.pid) return;
  const p = pz(T.pid);
  $('#dKick').textContent = (P(p.id).st === 'solved' ? 'Accepted · ' : 'Request · ') + rm(p.room).name; $('#dTitle').textContent = p.item;
  $('#dClue').textContent = p.clue; $('#dTask').innerHTML = p.task;
  if ($('#dSql').value !== T.sql) $('#dSql').value = T.sql;
  const fb = $('#dFb'); fb.className = 'fb ' + (T.fb ? T.fb.k : ''); fb.innerHTML = T.fb ? T.fb.t : '';
  const res = $('#dRes');
  if (T.res) {
    const rows = T.res.rows.slice(0, 200);
    res.innerHTML = '<table><thead><tr>' + T.res.fields.map(f => `<th>${esc(f)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(v => `<td>${esc(cell(v) === '∅' ? 'NULL' : cell(v))}</td>`).join('') + '</tr>').join('') + '</tbody></table>' +
      `<p class="rcount">${T.res.rows.length} row${T.res.rows.length === 1 ? '' : 's'}, ${T.res.fields.length} column${T.res.fields.length === 1 ? '' : 's'}</p>`;
  } else res.innerHTML = '';
}
let dockHidden = false;
function refresh() { renderTrack(); renderDock(); drawTerm(); }
function hint(html, ms) { const h = $('#hint'); h.innerHTML = html; h.classList.remove('hidden'); clearTimeout(hint.t); if (ms) hint.t = setTimeout(() => h.classList.add('hidden'), ms); }
function message(html) { if (inXR) return; $('#mBody').innerHTML = html; $('#dlgMsg').showModal(); }
$('#mOk').onclick = () => $('#dlgMsg').close();
$('#dClose').onclick = () => { dockHidden = true; renderDock(); };
$('#dockTab').onclick = () => { dockHidden = false; renderDock(); $('#dSql').focus(); };
$('#dSql').addEventListener('input', e => { T.sql = e.target.value; T.cur = T.sql.length; syncDraft(true); });
$('#dSql').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } e.stopPropagation(); });
$('#dRun').onclick = () => run(); $('#dClear').onclick = () => { termAction('clear'); $('#dSql').focus(); }; $('#dSol').onclick = () => termAction('sol');

/* ------------------------------------------------------------------ game flow */
function loadPuzzle(pid) {
  const st = P(pid); if (st.st === 'hidden') { st.st = 'found'; st.tf = now(); }
  T.pid = pid; T.note = null; T.sql = st.draft || ''; T.cur = T.sql.length; T.res = null;
  T.fb = st.st === 'solved' ? { k: 'ok', t: 'Already accepted. You can still run queries here.' } : { k: 'info', t: 'Write the query and press RUN.' };
  dockHidden = false; $('#hint').classList.add('hidden'); save(); sfx('pick'); refresh();
  if (!inXR) setTimeout(() => $('#dSql').focus(), 50);
}
async function run() {
  if (!T.pid || T.busy || !dbReady) return;
  const p = pz(T.pid), st = P(p.id); T.busy = true;
  try {
    const r = await runSql(T.sql); T.res = r;
    if (st.st !== 'solved') st.a++;
    const v = await check(CFG.lab.salt, p.id, p.exp, r.fields.length, r.rows);
    if (v.pass) {
      const first = st.st !== 'solved';
      if (first) { st.st = 'solved'; st.ts = now(); }
      const n = solvedIn(p.room), tot = roomPuzzles(p.room).length;
      T.fb = { k: 'ok', t: `<b>Authorisation accepted.</b> ${n} of ${tot} for this hatch.` + (n === tot ? ' ' + roomEndLine(p.room) : ' Find the next flagged item.') };
      if (first) { sfx('ok'); syncRoomState(true); if (n === tot) onRoomDone(p.room); }
    } else { T.fb = { k: 'bad', t: explain(v, p) }; sfx('bad'); }
  } catch (e) { if (st.st !== 'solved' && !(e && e.friendly)) st.a++; T.res = null; T.fb = { k: 'bad', t: esc(pgError(e)) }; sfx('bad'); }
  T.busy = false; save(); refresh();
}
function roomEndLine(rid) {
  if (rid === 'rb') return 'The Pod Bay is secure.';
  if (rid === 'r5') return 'Lockdown lifted. The amber hatch behind you leads to the bonus module.';
  return 'The hatch is open: find it and select it to move on.';
}
function onRoomDone(rid) {
  const r = rm(rid);
  if (rid === 'r5' && !S.tEnd) { S.tEnd = now(); save(); }
  if (rid === 'rb' && !S.tBonus) { S.tBonus = now(); save(); }
  setTimeout(() => {
    sfx('hatch');
    if (rid === 'r5') message(`<h3>Lockdown lifted</h3><p>${esc(r.done)}</p><p class="big">${clockText()}</p><p>You have escaped. Download your <b>Progress report</b> for Canvas. If there is time left, select the amber hatch on the bridge for the bonus module.</p>`);
    else if (rid === 'rb') message(`<h3>Pod Bay secured</h3><p>${esc(r.done)}</p><p class="big">${clockText()}</p><p>That is every module on Meridian Station. Download your <b>Progress report</b> for Canvas.</p>`);
    else hint(`<b>${esc(r.name)} cleared.</b> ${esc(r.done)} Select the open hatch to go through.`, 12000);
  }, 700);
}
function syncRoomState(animate) {
  if (!room) return;
  for (const it of interactives) if (it.kind === 'clue') setBeacon(it, P(it.pid).st);
  if (room.hatch) { room.hatch.setLocks(solvedIn(S.room)); if (roomDone(S.room)) room.hatch.open(!animate); }
}
let moving = false;
async function goRoom(rid, instant) {
  if (moving) return; moving = true;
  if (!instant) { sfx('whoosh'); await fadeTo(1); }
  if (room) { scene.remove(room.group); room.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const k of ['map', 'normalMap', 'roughnessMap', 'lightMap']) if (m[k] && !m[k].userData.shared) m[k].dispose(); m.dispose(); }); }); }
  env.anim = [];
  S.room = rid; save();
  room = buildRoom(rid, env); scene.add(room.group); space.face(room.earth || 0); room.group.updateMatrixWorld(true); space.group.updateMatrixWorld(true); captureEnvironment(); if (MODE === 'instructor') $('#jump').value = rid;
  interactives = [];
  for (const p of roomPuzzles(rid)) {
    const obj = room.clues[p.obj]; if (!obj) { console.warn('missing clue object', p.obj); continue; }
    const it = { obj, kind: 'clue', pid: p.id, label: p.item }; addBeacon(it); interactives.push(it);
  }
  if (room.hatch) interactives.push({ obj: room.hatch.obj, kind: 'hatch', label: 'Hatch' });
  T.pid = null; T.note = null; T.res = null; T.fb = null; T.sql = ''; T.cur = 0;
  yaw = 0; pitch = 0;
  syncRoomState(false); refresh();
  if (started) hint(`<b>${esc(rm(rid).name)}.</b> ${LOOK}`, 14000);
  await fadeTo(0); moving = false;
}
function useHatch() {
  if (!roomDone(S.room)) {
    const n = solvedIn(S.room), tot = roomPuzzles(S.room).length;
    sfx('bad'); const msg = `Hatch sealed. VESTA has ${n} of ${tot} authorisations.`;
    hint(msg + ' ' + LOOK, 6000);
    if (!T.pid) { T.note = { title: 'Hatch sealed', lines: [msg, LOOK] }; drawTerm(); }
    return;
  }
  const nx = nextRoom(S.room); if (nx) goRoom(nx.id);
}
/* beacons: the slow amber light VESTA puts on a flagged item */
const beaconGeo = new THREE.SphereGeometry(0.028, 12, 10);
function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#ffffffff'); gr.addColorStop(.3, '#ffffff88'); gr.addColorStop(1, '#ffffff00'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.userData.shared = true; return t; }
const GLOW = glowTex();
function addBeacon(it) {
  const m = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffb347, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(0.34); m.add(s);
  const b = it.obj.userData.beacon; if (b) m.position.copy(b); else { const box = new THREE.Box3().setFromObject(it.obj); it.obj.worldToLocal(m.position.set((box.min.x + box.max.x) / 2, box.max.y + .06, (box.min.z + box.max.z) / 2)); }
  m.userData.keep = true; it.obj.add(m); it.beacon = m; it.glow = s; it.phase = Math.random() * 6;
}
function setBeacon(it, st) { const c = st === 'solved' ? 0x5fe3a1 : 0xffb347; it.beacon.material.color.setHex(c); it.glow.material.color.setHex(c); it.solved = st === 'solved'; }

/* ------------------------------------------------------------------ picking */
const ray = new THREE.Raycaster(); ray.far = 12;
function pick() {
  const targets = [screen]; if (kbd.visible) targets.push(kbd);
  for (const it of interactives) targets.push(it.obj);
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
    if (h.object === screen || h.object === kbd) return { ui: h.object, uv: h.uv, point: h.point };
    if (h.object.isSprite || h.object.userData.nopick) continue;
    let o = h.object; while (o) { const it = interactives.find(i => i.obj === o); if (it) return { it, point: h.point }; o = o.parent; }
  }
  return null;
}
function select(hit) {
  if (!hit || moving) return;
  if (hit.ui === screen) { const x = hit.uv.x * TW, y = (1 - hit.uv.y) * TH; const b = T.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); if (b) termAction(b.act); else if (!inXR && T.pid) { dockHidden = false; renderDock(); } return; }
  if (hit.ui === kbd) { const x = hit.uv.x * KW, y = (1 - hit.uv.y) * KH; const k = kKeys.find(k => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h); if (k) pressKey(k); return; }
  if (hit.it.kind === 'clue') loadPuzzle(hit.it.pid); else if (hit.it.kind === 'hatch') useHatch();
}
// hover label (in-world, used in VR) and DOM label (screen mode)
const lCan = document.createElement('canvas'); lCan.width = 640; lCan.height = 96; const lTex = new THREE.CanvasTexture(lCan); lTex.colorSpace = THREE.SRGBColorSpace;
const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lTex, transparent: true, depthTest: false, depthWrite: false })); label.scale.set(.8, .12, 1); label.renderOrder = 9000; label.visible = false; scene.add(label);
let labelText = '';
function hoverText(it) { return it.kind === 'hatch' ? (roomDone(S.room) ? 'Hatch open: select to go through' : 'Hatch: sealed') : (it.solved ? '✓ ' : 'Inspect: ') + it.label; }
function setLabel(txt) { if (txt === labelText) return; labelText = txt; const g = lCan.getContext('2d'); g.clearRect(0, 0, 640, 96); if (!txt) return; g.font = '600 38px system-ui,sans-serif'; const w = Math.min(620, g.measureText(txt).width + 44); g.beginPath(); g.roundRect((640 - w) / 2, 14, w, 68, 14); g.fillStyle = '#04070deb'; g.fill(); g.strokeStyle = '#ffb347'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#ffb347'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 320, 50, 600); lTex.needsUpdate = true; }

// screen-mode look controls
let drag = null; const ptr = new THREE.Vector2();
canvas.addEventListener('pointerdown', e => { if (!started || inXR) return; drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); ensureAudio(); });
canvas.addEventListener('pointermove', e => {
  if (!started || inXR) return;
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY; const k = 0.0032 * camera.fov / 70; yaw -= dx * k; pitch = Math.max(-1.5, Math.min(1.5, pitch + dy * k)); }
  ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
  const h = pick(), hv = $('#hover'); const txt = h && h.it ? hoverText(h.it) : '';
  canvas.classList.toggle('point', !!h && !drag); hv.classList.toggle('hidden', !txt || !!(drag && drag.moved > 6)); if (txt) { hv.textContent = txt; hv.style.left = e.clientX + 'px'; hv.style.top = e.clientY + 'px'; }
});
canvas.addEventListener('pointerup', e => { if (!drag) return; const d = drag; drag = null; if (d.moved < 7) { ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera); select(pick()); } });
canvas.addEventListener('wheel', e => { if (inXR) return; camera.fov = Math.max(35, Math.min(85, camera.fov + e.deltaY * 0.03)); camera.updateProjectionMatrix(); e.preventDefault(); }, { passive: false });
const held = new Set();
addEventListener('keyup', e => held.delete(e.key));
addEventListener('keydown', e => {
  if (!started) return;
  if (inXR) { // physical keyboard while in the headset
    if (!T.pid || e.ctrlKey && e.key !== 'Enter' || e.metaKey && e.key !== 'Enter') return;
    if (e.key === 'Enter') run(); else if (e.key === 'Backspace') bksp(); else if (e.key === 'ArrowLeft') { T.cur = Math.max(0, T.cur - 1); drawTerm(); } else if (e.key === 'ArrowRight') { T.cur = Math.min(T.sql.length, T.cur + 1); drawTerm(); }
    else if (e.key === 'Tab') ins(' '); else if (e.key.length === 1) ins(e.key); else return;
    e.preventDefault(); return;
  }
  if (document.activeElement && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key.startsWith('Arrow')) { held.add(e.key); e.preventDefault(); }
});

/* ------------------------------------------------------------------ WebXR */
const ctrls = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: .7 }));
  line.scale.z = 4; line.visible = false; c.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.012, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false })); dot.visible = false; dot.renderOrder = 9001; scene.add(dot);
  c.addEventListener('connected', e => { c.userData.mode = e.data.targetRayMode; line.visible = e.data.targetRayMode === 'tracked-pointer'; c.userData.on = true; });
  c.addEventListener('disconnected', () => { c.userData.on = false; line.visible = false; dot.visible = false; });
  c.addEventListener('selectstart', () => { ensureAudio(); castFrom(c); select(pick()); });
  rig.add(c); ctrls.push({ c, line, dot });
}
const _m = new THREE.Matrix4();
function castFrom(c) { c.updateMatrixWorld(); _m.identity().extractRotation(c.matrixWorld); ray.ray.origin.setFromMatrixPosition(c.matrixWorld); ray.ray.direction.set(0, 0, -1).applyMatrix4(_m); }
async function enterXR(mode) {
  ensureAudio();
  try {
    const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    arMode = mode === 'immersive-ar';
    renderer.xr.setReferenceSpaceType('local-floor'); try { renderer.xr.setFramebufferScaleFactor(Q.level === 2 ? 1.3 : 1); } catch (e) {}
    await renderer.xr.setSession(session);
    try { renderer.xr.setFoveation(Q.level === 2 ? 0 : 1); } catch (e) {}
    inXR = true; beginPlay(); kbd.visible = T.kb = !arMode; port.visible = arMode; drawKbd(); $('#hover').classList.add('hidden'); refresh();
    session.addEventListener('end', () => { inXR = false; arMode = false; kbd.visible = false; port.visible = false; label.visible = false; camera.position.set(0, 1.6, 0); resize(); refresh(); });
  } catch (e) { console.error(e); hint('The headset session could not start: ' + esc(e.message || e), 8000); }
}
async function xrSupport() {
  if (!navigator.xr) return;
  try { if (await navigator.xr.isSessionSupported('immersive-vr')) { $('#btnVR').classList.remove('hidden'); $('#btnVR2').classList.remove('hidden'); $('#lNote').textContent = 'Headset detected. “Enter VR headset mode” puts you inside the module. A paired physical keyboard types straight into the terminal; an on-screen keyboard is there as a fallback.'; } } catch (e) {}
  try { if (await navigator.xr.isSessionSupported('immersive-ar')) $('#btnAR').classList.remove('hidden'); } catch (e) {}
}

/* ------------------------------------------------------------------ sound */
let AC = null, muted = false, master = null;
function ensureAudio() {
  if (AC || muted) { if (AC && AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .5; master.connect(AC.destination);
    for (const f of [55, 82.6, 110.4]) { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = f < 60 ? .05 : .018; o.connect(g).connect(master); o.start(); }
    const n = AC.createBufferSource(), buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf; n.loop = true; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const ng = AC.createGain(); ng.gain.value = .022; n.connect(lp).connect(ng).connect(master); n.start();
  } catch (e) { AC = null; }
}
function tone(f, t, d, type, v, f2) { const o = AC.createOscillator(), g = AC.createGain(), s = AC.currentTime + t; o.type = type || 'sine'; o.frequency.setValueAtTime(f, s); if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + d); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(v || .2, s + .01); g.gain.exponentialRampToValueAtTime(.001, s + d); o.connect(g).connect(master); o.start(s); o.stop(s + d + .02); }
function sfx(k) {
  if (!AC || muted) return;
  if (k === 'ok') { tone(523, 0, .18, 'triangle', .25); tone(659, .1, .18, 'triangle', .25); tone(784, .2, .3, 'triangle', .25); }
  else if (k === 'bad') { tone(150, 0, .22, 'sawtooth', .12, 90); }
  else if (k === 'pick') { tone(880, 0, .08, 'sine', .15); tone(1320, .06, .1, 'sine', .12); }
  else if (k === 'key') tone(1400, 0, .03, 'square', .04);
  else if (k === 'hatch') { tone(90, 0, 1.1, 'sawtooth', .16, 240); tone(392, .9, .5, 'triangle', .2); tone(587, 1.05, .6, 'triangle', .2); }
  else if (k === 'whoosh') tone(300, 0, .6, 'sine', .12, 60);
}
$('#btnMute').onclick = () => { muted = !muted; $('#btnMute').textContent = 'Sound: ' + (muted ? 'off' : 'on'); if (master) master.gain.value = muted ? 0 : .5; if (!muted) ensureAudio(); };

/* ------------------------------------------------------------------ progress report */
function recordLine(iso) { return [CFG.lab.code, iso, CFG.puzzles.map(p => p.id + ':' + (P(p.id).st === 'solved' ? 'S' : P(p.id).st === 'found' ? 'F' : '-') + P(p.id).a).join(','), clockText()].join('|'); }
async function codeFor(rec) { const h = (await sha(CFG.secret + '|' + rec)).slice(0, 12).toUpperCase(); return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12); }
let rep = null;
async function openReport() {
  const iso = new Date().toISOString().slice(0, 19) + 'Z', rec = recordLine(iso), code = await codeFor(rec); rep = { iso, rec, code };
  $('#rWhen').textContent = `${CFG.lab.course} · ${CFG.lab.title} · generated ${new Date().toLocaleString()} · elapsed ${clockText()}`;
  $('#rList').innerHTML = CFG.rooms.map(r => `<li class="rm"><span>${r.bonus ? '' : 'Module ' + r.n + ' · '}${esc(r.name)}</span><span>${solvedIn(r.id)}/${roomPuzzles(r.id).length}</span></li>` +
    roomPuzzles(r.id).map(p => { const s = P(p.id); return `<li><span>${esc(p.item)}</span><span>${s.st === 'solved' ? 'Solved' : s.st === 'found' ? 'Found, not solved' : 'Not found'} · ${s.a} attempt${s.a === 1 ? '' : 's'}</span></li>`; }).join('')).join('');
  $('#rCode').textContent = code; $('#dlgReport').showModal();
}
$('#btnReport').onclick = openReport; $('#rClose').onclick = () => $('#dlgReport').close();
$('#rPdf').onclick = () => {
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit: 'pt', format: 'letter' }); let y = 60;
  d.setFont('helvetica', 'bold'); d.setFontSize(18); d.text(CFG.lab.title, 54, y); y += 22;
  d.setFont('helvetica', 'normal'); d.setFontSize(11); d.text(`${CFG.lab.course} · VR SQL Escape Room · Progress report`, 54, y); y += 16;
  d.text(`Generated: ${new Date(rep.iso).toLocaleString()}    Elapsed: ${clockText()}`, 54, y); y += 26;
  for (const r of CFG.rooms) {
    d.setFont('helvetica', 'bold'); d.text(`${r.bonus ? '' : 'Module ' + r.n + ': '}${r.name}  (${r.skill})  ${solvedIn(r.id)}/${roomPuzzles(r.id).length}`, 54, y); y += 15; d.setFont('helvetica', 'normal');
    for (const p of roomPuzzles(r.id)) { const s = P(p.id); d.text(`   ${p.item}`, 54, y); d.text(`${s.st === 'solved' ? 'Solved' : s.st === 'found' ? 'Found, not solved' : 'Not found'}, ${s.a} attempt${s.a === 1 ? '' : 's'}`, 330, y); y += 14; }
    y += 8;
  }
  y += 8; d.setFont('helvetica', 'bold'); d.setFontSize(13); d.text('Verification code: ' + rep.code, 54, y); y += 18;
  d.setFont('courier', 'normal'); d.setFontSize(7.5); d.splitTextToSize('Record: ' + rep.rec, 500).forEach(l => { d.text(l, 54, y); y += 10; });
  y += 8; d.setFont('helvetica', 'normal'); d.setFontSize(9); d.text('No names or personal information are recorded in this report.', 54, y);
  d.save(`meridian-report-${rep.iso.replace(/[:]/g, '')}.pdf`);
};
$('#vGo').onclick = async () => { const ok = (await codeFor($('#vRec').value.trim().replace(/^Record:\s*/, ''))) === $('#vCode').value.trim().toUpperCase(); $('#vOut').textContent = ok ? '✓ Genuine: code matches the record.' : '✗ Code does not match this record.'; $('#vOut').style.color = ok ? 'var(--ok)' : 'var(--bad)'; };

/* ------------------------------------------------------------------ boot */
function beginPlay() {
  if (started) return; started = true;
  if (!S.t0) { S.t0 = now(); save(); }
  $('#landing').classList.add('hidden'); $('#bar').classList.remove('hidden');
  hint(`<b>${esc(rm(S.room).name)}.</b> ${LOOK}` + (inXR ? '' : ' Drag to look in every direction, up and down too. Click an item to inspect it.'), 16000);
  refresh();
}
function showBriefing() { $('#landing').classList.remove('hidden'); }
async function boot() {
  KEY = 'meridian.vr.' + CFG.lab.code + '.v' + CFG.lab.version; S = load();
  if (!rm(S.room) || (MODE !== 'instructor' && !roomUnlocked(S.room))) S.room = 'r1';
  $('#lKick').textContent = CFG.intro.kicker; $('#lTitle').textContent = CFG.lab.title; $('#bCourse').textContent = CFG.lab.course;
  $('#lStory').innerHTML = CFG.intro.paragraphs.map(p => `<p>${p}</p>`).join(''); $('#lHow').innerHTML = CFG.intro.how.map(p => `<li>${p}</li>`).join('');
  $('#dSchemaIn').innerHTML = CFG.schema.map(t => `<div class="tbl"><b>${t.table}</b> <span>${t.rows} rows</span>` + t.cols.map(c => `<div>${c[0]} <span>${c[1]}</span></div>`).join('') + '</div>').join('');
  if (S.t0) $('#btnScreen').textContent = 'Resume on this screen';
  if (MODE === 'instructor') {
    $('#jump').classList.remove('hidden'); $('#dSol').classList.remove('hidden'); $('#verify').classList.remove('hidden');
    $('#jump').innerHTML = CFG.rooms.map(r => `<option value="${r.id}">${r.bonus ? 'Bonus' : 'Module ' + r.n}: ${esc(r.name)}</option>`).join('');
    $('#jump').onchange = e => goRoom(e.target.value);
    window.__lab = { goRoom, loadPuzzle, run, T, S, room: () => room, look: (y, p) => { yaw = y; pitch = p; }, reset: () => { localStorage.removeItem(KEY); location.reload(); } };
  }
  $('#gfx').value = gfxPref; $('#gfx').onchange = async e => { gfxPref = e.target.value; try { localStorage.setItem('meridian.gfx', gfxPref); } catch (x) {} setQuality(levelOf(gfxPref)); applyQuality(); await goRoom(S.room, true); };
  if (MODE === 'instructor') $('#fps').classList.remove('hidden');
  applyQuality(); await loadManifest();
  showBriefing(); drawKbd();
  $('#btnScreen').onclick = () => { ensureAudio(); beginPlay(); };
  $('#btnVR').onclick = $('#btnVR2').onclick = () => enterXR('immersive-vr'); $('#btnAR').onclick = () => enterXR('immersive-ar');
  $('#btnHelp').onclick = () => { $('#btnScreen').textContent = 'Back to the station'; started = false; showBriefing(); $('#btnScreen').onclick = () => { started = true; $('#landing').classList.add('hidden'); }; };
  xrSupport();
  await goRoom(S.room, true);
  if (MODE === 'instructor') $('#jump').value = S.room;
  initDb();
  setInterval(() => { $('#clock').textContent = clockText(); }, 1000);
}

/* ------------------------------------------------------------------ frame loop */
const clock = new THREE.Clock(); let blink = 0; const _v = new THREE.Vector3(); let fpsN = 0, fpsT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .1), t = clock.elapsedTime;
  fpsN++; if (t - fpsT >= 1) { if (MODE === 'instructor') $('#fps').textContent = Math.round(fpsN / (t - fpsT)) + ' fps · gfx ' + ['low', 'medium', 'high'][Q.level]; fpsN = 0; fpsT = t; }
  if (!renderer.xr.isPresenting) {
    const sp = 1.4 * dt; if (held.has('ArrowLeft')) yaw -= sp; if (held.has('ArrowRight')) yaw += sp; if (held.has('ArrowUp')) pitch = Math.min(1.5, pitch + sp); if (held.has('ArrowDown')) pitch = Math.max(-1.5, pitch - sp);
    camera.rotation.set(pitch, -yaw, 0);
  }
  space.update(t, dt); if (room && room.update) room.update(t, dt); for (const f of env.anim) f(t, dt);
  for (const it of interactives) if (it.beacon) { const k = it.solved ? 1 : .55 + .45 * Math.sin(t * 2.2 + it.phase); it.glow.material.opacity = k; it.glow.scale.setScalar(it.hot ? .6 : .3 + .1 * k); it.hot = false; }
  if (inXR) {
    let txt = '', at = null;
    for (const { c, line, dot } of ctrls) {
      if (!c.userData.on || c.userData.mode !== 'tracked-pointer') { dot.visible = false; continue; }
      castFrom(c); const h = pick(); dot.visible = !!h; line.scale.z = h ? ray.ray.origin.distanceTo(h.point) : 4;
      if (h) { dot.position.copy(h.point); if (h.it) { txt = hoverText(h.it); at = h.point; h.it.hot = true; } }
    }
    label.visible = !!txt; if (txt) { setLabel(txt); label.position.copy(at); label.position.y += .16; }
    if (T.pid && t - blink > .5) { blink = t; drawTerm(); } else if (!T.pid && t - blink > 1) { blink = t; drawTerm(); }
  } else if (CFG && S && !T.pid && t - blink > 1) { blink = t; drawTerm(); }
  // fade
  const o = fade.material.opacity; if (o !== fadeTarget) { const n = fadeTarget > o ? Math.min(fadeTarget, o + dt * 2.6) : Math.max(fadeTarget, o - dt * 2.2); fade.material.opacity = n; if (n === fadeTarget && fadeCb) { const cb = fadeCb; fadeCb = null; cb(); } }
  fade.visible = fade.material.opacity > 0.001;
  (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(_v); fade.position.copy(_v);
  if (composer && !renderer.xr.isPresenting) composer.render(dt); else renderer.render(scene, camera);
});
