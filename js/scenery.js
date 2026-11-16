// Meridian Station scenery. Everything is built procedurally (no downloaded models or images).
// Convention: the player stands at the origin. deg 0 = straight ahead (-Z), 90 = right, 180 = behind, 270 = left.
// Props are built with their "front" on local +Z, so put() turns them to face the player.
import * as THREE from '../vendor/three.module.min.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Graphics quality. level 2 = High (PC GPU): bevelled geometry, shadows, large textures. 1 = Medium (Quest 3): normal maps + reflections.
// 0 = Low (Quest 2): flat-lit, cheapest. Set by app.js before a room is built.
export const Q = { level: 2 };
export function setQuality(level) { Q.level = level; }
let MANIFEST = { models: {}, baked: {} };
let CUR_ROOM = null, onBaked = null;
export function setBakedCallback(f) { onBaked = f; }
const isBaked = () => !!(MANIFEST.baked && MANIFEST.baked[CUR_ROOM]);
// Baked lighting. tools/blender/bake_room.py renders the light that really falls on the walls, floor and ceiling (soft shadows,
// bounce, colour from screens) into one 2048 px atlas per room. Tile positions here must match TILES in that script.
function bakedTile(name) { if (name === 'shell_floor') return [0, 1024, 1024, 1024]; if (name === 'shell_ceil') return [1024, 1024, 1024, 1024]; const i = Number(name.split('_')[2]); return [(i % 6) * 256, i < 6 ? 512 : 0, 256, 512]; }
function applyBaked(meshes) {
  if (!isBaked()) return; const b = MANIFEST.baked[CUR_ROOM], room = CUR_ROOM;
  new THREE.TextureLoader().load('assets/baked/' + b.file, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const m of meshes) { const [x, y, w, h] = bakedTile(m.name), t = tex.clone(); t.channel = 0; t.repeat.set((w - 2) / 2048, (h - 2) / 2048); t.offset.set((x + 1) / 2048, (y + 1) / 2048); t.needsUpdate = true;
      m.material.lightMap = t; m.material.lightMapIntensity = (b.intensity || 1) * 2.8; m.material.needsUpdate = true; }
    if (onBaked) onBaked(room);
  });
}
export async function loadManifest() { try { const r = await fetch('assets/manifest.json', { cache: 'no-cache' }); if (r.ok) MANIFEST = await r.json(); } catch (e) {} if (!MANIFEST.models) MANIFEST.models = {}; if (!MANIFEST.baked) MANIFEST.baked = {}; }

const D2R = Math.PI / 180, N = 12, R = 3.4, H = 3.3, FW = 2 * R * Math.tan(Math.PI / N);
let rnd = mulberry(7);
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rr = (a, b) => a + (b - a) * rnd();
const pickOf = a => a[Math.floor(rnd() * a.length)];

/* ---------------------------------------------------------------- basics */
function ctex(w, h, fn, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
let _grunge = null;
function GRUNGE() { // shared smudge/wear map: makes highlights uneven, the way handled, painted metal really looks
  if (_grunge) return _grunge; const keep = rnd; rnd = mulberry(1234);
  _grunge = ctex(256, 256, (g, w) => { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, w); for (let i = 0; i < 90; i++) { const v = 150 + Math.floor(rnd() * 105); g.fillStyle = `rgba(${v},${v},${v},${.1 + rnd() * .22})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * w, 8 + rnd() * 50, 6 + rnd() * 30, rnd() * 3, 0, 7); g.fill(); } for (let i = 0; i < 140; i++) { g.strokeStyle = `rgba(${rnd() < .5 ? '255,255,255' : '90,90,90'},${.08 + rnd() * .2})`; g.lineWidth = .6 + rnd(); g.beginPath(); const x = rnd() * w, y = rnd() * w; g.moveTo(x, y); g.lineTo(x + rr(-40, 40), y + rr(-12, 12)); g.stroke(); } noise(g, w, w, 5000, .12); }, [1, 1]);
  _grunge.colorSpace = THREE.NoColorSpace; _grunge.userData.shared = true; rnd = keep; return _grunge;
}
const std = (color, rough = .6, metal = .3, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: Q.level ? Math.min(1, rough * 1.12) : rough, metalness: metal }, Q.level ? { roughnessMap: GRUNGE() } : null, extra));
const glow = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
const box = (w, h, d, m) => { const mn = Math.min(w, h, d), mx = Math.max(w, h, d); return new THREE.Mesh(Q.level === 2 && mn >= .04 && mx >= .12 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(.014, mn * .22)) : new THREE.BoxGeometry(w, h, d), m); };
const cyl = (r1, r2, h, m, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, Q.level === 2 ? Math.max(seg, 32) : seg), m);
const sph = (r, m, ws = 16, hs = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, Q.level === 2 ? Math.round(ws * 1.7) : ws, Q.level === 2 ? Math.round(hs * 1.7) : hs), m);
const plane = (w, h, m) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
const tor = (r, t, m, seg = 32, arc = Math.PI * 2) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, seg, arc), m);
const cap = (r, l, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 14), m);
function at(o, x, y, z, rx = 0, ry = 0, rz = 0) { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; }
function grp(...kids) { const g = new THREE.Group(); kids.forEach(k => k && g.add(k)); return g; }
function put(parent, o, deg, r, y, turn = 0) { const a = deg * D2R; o.position.set(Math.sin(a) * r, y, -Math.cos(a) * r); o.rotation.y = -a + turn; parent.add(o); return o; }
function aim(parent, o, deg, r, y) { const a = deg * D2R; o.position.set(Math.sin(a) * r, y, -Math.cos(a) * r); parent.add(o); o.lookAt(0, 1.45, 0); return o; }
function pipe(pts, rad, m, closed) { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), !!closed, 'catmullrom', .2); return new THREE.Mesh(new THREE.TubeGeometry(c, pts.length * 10, rad, 8, !!closed), m); }
const pol = (deg, r, y) => [Math.sin(deg * D2R) * r, y, -Math.cos(deg * D2R) * r];
function ringPipe(r, y, rad, m, from = 0, to = 360) { const pts = []; for (let d = from; d <= to; d += 15) pts.push(pol(d, r, y)); return pipe(pts, rad, m, to - from >= 360); }

function noise(g, w, h, n, a) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '0,0,0' : '255,255,255'},${rnd() * a})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } }
function scuffs(g, w, h, n) { for (let i = 0; i < n; i++) { g.strokeStyle = `rgba(0,0,0,${.04 + rnd() * .08})`; g.lineWidth = 1 + rnd() * 3; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + rr(-60, 60), y + rr(-20, 20)); g.stroke(); } }
function rivets(g, x, y, w, h, step) { g.fillStyle = 'rgba(0,0,0,.35)'; for (let i = x + step / 2; i < x + w; i += step) { for (const yy of [y + 7, y + h - 7]) { g.beginPath(); g.arc(i, yy, 2.4, 0, 7); g.fill(); } } g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = x + step / 2; i < x + w; i += step) for (const yy of [y + 6, y + h - 8]) { g.beginPath(); g.arc(i - .8, yy, 1, 0, 7); g.fill(); } }

function hcanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); return c; }
// Turns a grey height drawing (light = raised) into a tangent-space normal map so flat panels catch light like real plating.
function heightToNormal(hc, strength) {
  const w = hc.width, h = hc.height, tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tg = tmp.getContext('2d');
  tg.filter = 'blur(1.1px)'; tg.drawImage(hc, 0, 0); tg.filter = 'none';
  const src = tg.getImageData(0, 0, w, h).data, img = tg.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) { const yu = Math.max(0, y - 1) * w, yd = Math.min(h - 1, y + 1) * w, yy = y * w;
    for (let x = 0; x < w; x++) { const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
      const dx = (src[(yy + xl) * 4] - src[(yy + xr) * 4]) / 255 * strength, dy = (src[(yd + x) * 4] - src[(yu + x) * 4]) / 255 * strength, il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (yy + x) * 4;
      d[i] = (dx * il * .5 + .5) * 255; d[i + 1] = (dy * il * .5 + .5) * 255; d[i + 2] = (il * .5 + .5) * 255; d[i + 3] = 255; } }
  tg.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(tmp); t.anisotropy = 4; return t;
}
function hrivets(hg, x, y, w, h, step) { hg.fillStyle = '#e8e8e8'; for (let i = x + step / 2; i < x + w; i += step) for (const yy of [y + 7, y + h - 7]) { hg.beginPath(); hg.arc(i, yy, 3.2, 0, 7); hg.fill(); } }

/* wall panel texture: seams, rivets, accent band, stencils, vents */
function wallTex(o, seed, hole) {
  rnd = mulberry(seed);
  const hc = Q.level ? hcanvas(512, 928) : null, hg = hc ? hc.getContext('2d') : { fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, roundRect() {} };
  const map = ctex(512, 928, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, o.top || o.base); gr.addColorStop(1, o.base); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    noise(g, w, h, 2600, .06);
    // panels
    let y = 0; const rows = [150, 210, 190, 200, 178];
    for (const rh of rows) {
      const cols = pickOf([1, 2, 2, 3]); const cw = w / cols;
      for (let c = 0; c < cols; c++) {
        const x = c * cw; g.fillStyle = `rgba(${rnd() < .5 ? '255,255,255' : '0,0,0'},${rnd() * .07})`; g.fillRect(x + 4, y + 4, cw - 8, rh - 8);
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, cw - 6, rh - 6);
        g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.strokeRect(x + 6, y + 6, cw - 12, rh - 12);
        rivets(g, x + 6, y + 6, cw - 12, rh - 12, 38);
        const lv = 118 + Math.floor(rnd() * 26); hg.fillStyle = `rgb(${lv},${lv},${lv})`; hg.fillRect(x + 5, y + 5, cw - 10, rh - 10);
        hg.strokeStyle = '#2a2a2a'; hg.lineWidth = 5; hg.strokeRect(x + 2.5, y + 2.5, cw - 5, rh - 5); if (hc) hrivets(hg, x + 6, y + 6, cw - 12, rh - 12, 38);
        const k = rnd();
        if (k < .22) { // vent
          const vx = x + cw * .2, vy = y + rh * .3, vw = cw * .6, vh = rh * .4; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(vx, vy, vw, vh);
          g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 2; for (let i = vy + 6; i < vy + vh; i += 9) { g.beginPath(); g.moveTo(vx + 4, i); g.lineTo(vx + vw - 4, i); g.stroke(); }
          hg.fillStyle = '#383838'; hg.fillRect(vx, vy, vw, vh); hg.strokeStyle = '#b8b8b8'; hg.lineWidth = 3.5; for (let i = vy + 6; i < vy + vh; i += 9) { hg.beginPath(); hg.moveTo(vx + 4, i); hg.lineTo(vx + vw - 4, i); hg.stroke(); }
        } else if (k < .5) { // stencil
          g.fillStyle = o.ink || 'rgba(0,0,0,.45)'; g.font = '700 17px ui-monospace,Menlo,monospace'; g.fillText(pickOf(['MS-0', 'PNL ', 'BAY ', 'SEC ', 'LSS-']) + Math.floor(rr(10, 99)) + pickOf(['A', 'B', 'C', 'D']), x + 16, y + 30);
          g.font = '400 11px ui-monospace,Menlo,monospace'; g.fillText(pickOf(['NO STEP', 'ACCESS PANEL', 'TORQUE 12 Nm', 'DO NOT BLOCK', 'CHECK SEAL', 'HANDHOLD']), x + 16, y + 46);
        } else if (k < .62) { // small indicator plate
          g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + cw - 70, y + 18, 52, 22); for (let i = 0; i < 3; i++) { g.fillStyle = pickOf([o.accent, '#5fe3a1', '#ff6b5e', '#ffb347']); g.fillRect(x + cw - 64 + i * 15, y + 24, 9, 9); }
        }
      }
      y += rh;
    }
    // accent band at handrail height
    hg.fillStyle = '#9c9c9c'; hg.fillRect(0, h * .655 - 2, w, 16);
    g.fillStyle = o.accent; g.globalAlpha = .85; g.fillRect(0, h * .655, w, 12); g.globalAlpha = .35; g.fillRect(0, h * .655 + 16, w, 4); g.globalAlpha = 1;
    scuffs(g, w, h, 40);
    const vg = g.createLinearGradient(0, 0, w, 0); vg.addColorStop(0, 'rgba(0,0,0,.28)'); vg.addColorStop(.12, 'rgba(0,0,0,0)'); vg.addColorStop(.88, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    // baked ambient occlusion: walls darken where they meet floor and ceiling, and grime collects low down
    const ao = g.createLinearGradient(0, 0, 0, h); ao.addColorStop(0, 'rgba(0,0,0,.5)'); ao.addColorStop(.1, 'rgba(0,0,0,.08)'); ao.addColorStop(.8, 'rgba(0,0,0,.06)'); ao.addColorStop(1, 'rgba(0,0,0,.6)'); g.fillStyle = ao; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const sx = rnd() * w, sl = 30 + rnd() * 160; const st = g.createLinearGradient(0, 0, 0, sl); st.addColorStop(0, 'rgba(20,14,8,.16)'); st.addColorStop(1, 'rgba(20,14,8,0)'); g.save(); g.translate(sx, pickOf([150, 360, 550, 750]) + 4); g.fillStyle = st; g.fillRect(0, 0, 3 + rnd() * 9, sl); g.restore(); }
    if (hole) { // window cut-out with bolted frame.  hole = [x,y,w,h] in 0..1
      const [hx, hy, hw, hh] = [hole[0] * w, hole[1] * h, hole[2] * w, hole[3] * h], rad = Math.min(hw, hh) * .22;
      g.fillStyle = o.frame || '#2a313b'; g.beginPath(); g.roundRect(hx - 26, hy - 26, hw + 52, hh + 52, rad + 20); g.fill();
      hg.fillStyle = '#c8c8c8'; hg.beginPath(); hg.roundRect(hx - 26, hy - 26, hw + 52, hh + 52, rad + 20); hg.fill(); hg.fillStyle = '#606060'; hg.beginPath(); hg.roundRect(hx - 6, hy - 6, hw + 12, hh + 12, rad + 4); hg.fill();
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; g.beginPath(); g.roundRect(hx - 22, hy - 22, hw + 44, hh + 44, rad + 17); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.5)'; const per = 2 * (hw + hh); for (let i = 0; i < 28; i++) { const d = i / 28 * per; let px, py; if (d < hw) { px = hx + d; py = hy - 13; } else if (d < hw + hh) { px = hx + hw + 13; py = hy + d - hw; } else if (d < 2 * hw + hh) { px = hx + hw - (d - hw - hh); py = hy + hh + 13; } else { px = hx - 13; py = hy + hh - (d - 2 * hw - hh); } g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill(); }
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.roundRect(hx, hy, hw, hh, rad); g.fill(); g.globalCompositeOperation = 'source-over';
    }
  });
  return { map, normalMap: hc ? heightToNormal(hc, 2.6) : null };
}
function deckTex(o, seed, ceiling) {
  rnd = mulberry(seed);
  const hc = Q.level ? hcanvas(1024, 1024) : null, hg = hc ? hc.getContext('2d') : null;
  const map = ctex(1024, 1024, (g, w) => {
    const c = w / 2; g.fillStyle = o.base; g.fillRect(0, 0, w, w); noise(g, w, w, 9000, .07);
    for (let i = 0; i < 12; i++) { // sector plates
      g.save(); g.translate(c, c); g.rotate(i * Math.PI / 6 + Math.PI / 12);
      g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},.05)`; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, c, 0, Math.PI / 6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4; g.beginPath(); g.moveTo(60, 0); g.lineTo(c, 0); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(60, 3); g.lineTo(c, 3); g.stroke();
      if (hg) { hg.save(); hg.translate(c, c); hg.rotate(i * Math.PI / 6 + Math.PI / 12); const lv = 120 + (i * 37 % 18); hg.fillStyle = `rgb(${lv},${lv},${lv})`; hg.beginPath(); hg.moveTo(0, 0); hg.arc(0, 0, c, 0, Math.PI / 6); hg.fill(); hg.strokeStyle = '#242424'; hg.lineWidth = 6; hg.beginPath(); hg.moveTo(60, 0); hg.lineTo(c, 0); hg.stroke();
        if (!ceiling && i % 3 === 0) { hg.rotate(Math.PI / 12); hg.fillStyle = '#202020'; for (let r = 250; r < 400; r += 12) for (let a = -.2; a < .2; a += .035) hg.fillRect(r * Math.cos(a), r * Math.sin(a), 7, 5); } hg.restore(); }
      if (!ceiling && i % 3 === 0) { g.rotate(Math.PI / 12); g.fillStyle = 'rgba(0,0,0,.5)'; for (let r = 250; r < 400; r += 12) for (let a = -.2; a < .2; a += .035) g.fillRect(r * Math.cos(a), r * Math.sin(a), 7, 5); }
      g.restore();
    }
    if (hg) for (const r of [80, 200, 330, 440, 505]) { hg.strokeStyle = '#242424'; hg.lineWidth = 6; hg.beginPath(); hg.arc(c, c, r, 0, 7); hg.stroke(); }
    for (const r of [80, 200, 330, 440, 505]) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1.5; g.beginPath(); g.arc(c, c, r - 3, 0, 7); g.stroke(); }
    g.strokeStyle = o.accent; g.lineWidth = 10; g.globalAlpha = .8; g.setLineDash(o.hazard ? [26, 22] : []); g.beginPath(); g.arc(c, c, 418, 0, 7); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    // centre roundel
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(c, c, 76, 0, 7); g.fill(); g.strokeStyle = o.accent; g.lineWidth = 5; g.beginPath(); g.arc(c, c, 66, 0, 7); g.stroke();
    g.fillStyle = o.accent; g.font = '700 30px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(ceiling ? '▲' : 'MERIDIAN', c, ceiling ? c + 10 : c - 2); if (!ceiling) { g.font = '600 17px ui-monospace,monospace'; g.fillText(o.tag || 'STATION', c, c + 24); }
    scuffs(g, w, w, ceiling ? 20 : 120);
    const ao = g.createRadialGradient(c, c, c * .55, c, c, c); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(.8, 'rgba(0,0,0,.12)'); ao.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = ao; g.fillRect(0, 0, w, w);
    if (!ceiling) for (let i = 0; i < 60; i++) { const a = rnd() * 7, r = 120 + rnd() * 380; g.fillStyle = `rgba(0,0,0,${.03 + rnd() * .06})`; g.beginPath(); g.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 8 + rnd() * 40, 6 + rnd() * 22, rnd() * 3, 0, 7); g.fill(); }
  });
  return { map, normalMap: hc ? heightToNormal(hc, 2.2) : null };
}
function screenTex(lines, o = {}) {
  const w = o.w || 512, h = o.h || 320;
  return ctex(w, h, g => {
    g.fillStyle = o.bg || '#04101a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = o.fg || '#4fd8ff'; g.globalAlpha = .1; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } g.globalAlpha = 1;
    let y = o.pad || 44; const size = o.size || 28;
    if (o.title) { g.fillStyle = o.fg || '#4fd8ff'; g.fillRect(0, 0, w, size * 1.7); g.fillStyle = o.bg || '#04101a'; g.font = `700 ${size}px system-ui,sans-serif`; g.fillText(o.title, 16, size * 1.2); y = size * 2.9; }
    for (const ln of lines) {
      if (ln && ln.bar !== undefined) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(16, y - size * .7, w - 32, size * .7); g.fillStyle = ln.c || o.fg || '#4fd8ff'; g.fillRect(16, y - size * .7, (w - 32) * ln.bar, size * .7); }
      else if (ln && ln.graph) { g.strokeStyle = ln.c || o.fg || '#4fd8ff'; g.lineWidth = 3; g.beginPath(); for (let x = 16; x < w - 16; x += 8) { const yy = y + Math.sin(x * .05 * ln.graph) * size * .6 * Math.sin(x * .011) + size * .2; x === 16 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); y += size * .8; }
      else { const t = typeof ln === 'string' ? ln : ln.t; g.fillStyle = (ln && ln.c) || o.fg || '#4fd8ff'; g.font = `${(ln && ln.b) ? 700 : 500} ${size}px ui-monospace,Menlo,Consolas,monospace`; g.fillText(t, 16, y, w - 32); }
      y += size * 1.32;
    }
  });
}
function display(w, h, lines, o = {}) { // framed, glowing screen
  const g = grp(box(w + .06, h + .06, .04, std(0x151a22, .5, .6)));
  const s = plane(w, h, new THREE.MeshBasicMaterial({ map: screenTex(lines, Object.assign({ w: Math.round(512 * Math.min(2, w / h * .62 + .4)), h: 320 }, o)), toneMapped: false })); s.position.z = .022; g.add(s); return g;
}
function labelPlate(text, w, h, bg, fg, size) { return plane(w, h, new THREE.MeshBasicMaterial({ map: ctex(512, Math.round(512 * h / w), (g, W, HH) => { g.fillStyle = bg; g.fillRect(0, 0, W, HH); g.fillStyle = fg; g.font = `700 ${size || HH * .5}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, HH / 2 + 2, W - 20); }), toneMapped: false })); }
function hazardTex() { return ctex(256, 64, (g, w, h) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h); g.fillStyle = '#14161a'; for (let x = -h; x < w + h; x += 44) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 22, h); g.lineTo(x + 22 + h, 0); g.lineTo(x + h, 0); g.fill(); } }, [1, 1]); }

/* ---------------------------------------------------------------- shell */
function shell(g, o) {
  const tex = [0, 1, 2].map(i => wallTex(o, o.seed + i * 13)), baked = [];
  for (let i = 0; i < N; i++) {
    const kind = (o.facets || {})[i];
    if (kind === 'none') continue;
    let m;
    if (kind && kind.win) { const wt = wallTex(o, o.seed + i * 5, kind.win); m = new THREE.MeshStandardMaterial({ map: wt.map, normalMap: wt.normalMap, roughness: .58, metalness: .4, alphaTest: .5 }); const gl = plane(FW * kind.win[2] + .1, H * kind.win[3] + .1, new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: .08, roughness: .05, metalness: 0, depthWrite: false })); put(g, gl, i * 30, R + .03, H * (1 - kind.win[1] - kind.win[3] / 2)); gl.position.x += Math.sin(i * 30 * D2R) * 0 + (kind.win[0] + kind.win[2] / 2 - .5) * FW * Math.cos(i * 30 * D2R); gl.position.z += (kind.win[0] + kind.win[2] / 2 - .5) * FW * Math.sin(i * 30 * D2R); }
    else { const wt = tex[(i * 7 + o.seed) % 3]; m = new THREE.MeshStandardMaterial({ map: wt.map, normalMap: wt.normalMap, roughness: .58, metalness: .4 }); }
    const wall = plane(FW + .01, H, m); wall.name = 'shell_wall_' + i; baked.push(wall); put(g, wall, i * 30, R, H / 2);
  }
  const ribM = std(o.rib || 0x2b323c, .45, .75), stripM = glow(o.strip || o.accent, 1.3);
  for (let i = 0; i < N; i++) {
    const d = i * 30 + 15, rib = grp(box(.16, H, .2, ribM), at(box(.03, H * .7, .012, stripM), 0, 0, .105));
    for (const y of [-1.1, -.2, .7]) rib.add(at(box(.22, .07, .24, ribM), 0, y, 0));
    put(g, rib, d, R / Math.cos(Math.PI / N) - .08, H / 2);
  }
  const fr = R / Math.cos(Math.PI / N) + .05;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(fr, 48), (() => { const dt = deckTex(o.floor, o.seed + 91); return new THREE.MeshStandardMaterial({ map: dt.map, normalMap: dt.normalMap, roughness: .7, metalness: .35 }); })()); floor.rotation.x = -Math.PI / 2; floor.name = 'shell_floor'; baked.push(floor); g.add(floor);
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(fr, 48), (() => { const dt = deckTex(o.ceil, o.seed + 47, true); return new THREE.MeshStandardMaterial({ map: dt.map, normalMap: dt.normalMap, roughness: .7, metalness: .35 }); })()); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; ceil.name = 'shell_ceil'; baked.push(ceil); g.add(ceil);
  applyBaked(baked);
  for (const y of [.06, H - .06]) { const t = tor(R + .06, .07, ribM, 48); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t); }
  // handrail ring segments (leave the terminal bay clear)
  const rail = std(o.rail || 0xc9ced6, .3, .9);
  for (const [a, b] of (o.rails || [[45, 135], [225, 315]])) { g.add(ringPipe(R - .14, 1.02, .018, rail, a, b)); for (let d = a; d <= b; d += 30) put(g, at(cyl(.012, .012, .14, rail, 8), 0, 0, 0, Math.PI / 2), d, R - .07, 1.02); }
  // ceiling light panels
  const lm = glow(o.light || 0xfff1d8, o.lightK || 1.6);
  for (let i = 0; i < 6; i++) { const p = box(.34, .03, 1.0, lm); const a = (i * 60 + 30) * D2R; p.position.set(Math.sin(a) * 1.75, H - .03, -Math.cos(a) * 1.75); p.rotation.y = -a; g.add(p); const fr2 = box(.42, .05, 1.08, ribM); fr2.position.copy(p.position); fr2.position.y += .02; fr2.rotation.y = -a; g.add(fr2); }
  // cable trays near ceiling
  const cab = [std(0x1a1d22, .8, .1), std(o.cable || 0x8a2f2f, .8, .1), std(0x2d5a8c, .8, .1)];
  cab.forEach((m, i) => g.add(ringPipe(R - .12 - i * .045, H - .32 - (i % 2) * .03, .017, m)));
}
function lights(g, o) {
  const bk = isBaked() ? .5 : 1;   // with baked light on the shell, live lights only need to fill the props
  g.add(new THREE.HemisphereLight(o.sky, o.ground, (o.hemi || 1.1) * (Q.level ? .5 : 1) * bk));
  o.points.forEach((l, i) => { const p = new THREE.PointLight(l[0], l[1] * (Q.level === 2 && i === 0 ? .45 : 1) * bk, l[5] || 9, 1.6); p.position.set(l[2], l[3], l[4]); g.add(p); });
  if (Q.level === 2) { // one shadow-casting key light from the ceiling: props sit on the deck instead of floating over it
    const s = new THREE.SpotLight(o.points[0][0], (o.key || 1) * o.points[0][1] * 3.2 * (bk < 1 ? .6 : 1), 9, 1.3, .75, 1.3); s.position.set(0, H - .1, 0); s.target.position.set(0, 0, 0); g.add(s, s.target);
    s.castShadow = true; s.shadow.mapSize.set(2048, 2048); s.shadow.bias = -.0005; s.shadow.normalBias = .03; s.shadow.camera.near = .15; s.shadow.camera.far = 7; s.shadow.radius = 4;
  }
}

/* ---------------------------------------------------------------- shared props */
function hatch(env, o) {
  const g = new THREE.Group(), dark = std(0x232a33, .45, .8), col = o.color || 0x4fd8ff;
  g.add(at(cyl(.98, .98, .1, dark, 40), 0, 0, 0, Math.PI / 2)); const ring = tor(.84, .07, std(0xb8bec8, .3, .9), 40); ring.position.z = .06; g.add(ring);
  const ring2 = tor(.93, .02, glow(col, 1.2), 40); ring2.position.z = .07; g.add(ring2);
  for (let i = 0; i < 12; i++) { const b = cyl(.035, .035, .05, std(0x8a9099, .3, .9), 8); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(i * Math.PI / 6) * .9, Math.sin(i * Math.PI / 6) * .9, .07); g.add(b); }
  const tun = new THREE.Mesh(new THREE.CircleGeometry(.78, 40), new THREE.MeshBasicMaterial({ map: ctex(256, 256, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.25, o.tunnel || '#9be8ff'); gr.addColorStop(1, '#02060c'); c.fillStyle = gr; c.fillRect(0, 0, w, w); for (let r = 20; r < 128; r += 22) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; c.beginPath(); c.arc(w / 2, w / 2, r, 0, 7); c.stroke(); } }), toneMapped: false })); tun.position.z = .052; g.add(tun);
  const doorTex = ctex(512, 512, (c, w) => { c.fillStyle = '#4a525e'; c.fillRect(0, 0, w, w); rnd = mulberry(5); noise(c, w, w, 3000, .08); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 6; for (let i = 60; i < w; i += 110) { c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } c.fillStyle = '#f2c230'; c.fillRect(w / 2 - 34, 0, 68, w); c.fillStyle = '#14161a'; for (let y = -40; y < w + 40; y += 44) { c.beginPath(); c.moveTo(w / 2 - 34, y); c.lineTo(w / 2 + 34, y + 40); c.lineTo(w / 2 + 34, y + 62); c.lineTo(w / 2 - 34, y + 22); c.fill(); } c.fillStyle = 'rgba(0,0,0,.55)'; c.font = '700 44px system-ui'; c.textAlign = 'center'; c.fillText(o.code || 'H-01', w * .22, w / 2 + 14); c.fillText('SEALED', w * .79, w / 2 + 14, 180); });
  const halves = [];
  for (const s of [-1, 1]) { const geo = new THREE.CircleGeometry(.79, 24, s < 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI); const d = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: doorTex, roughness: .5, metalness: .6 })); d.position.z = .058; g.add(d); const lip = box(.05, 1.56, .05, std(0x1c2129, .4, .8)); lip.position.set(s * .025, 0, .02); d.add(lip); halves.push([d, s]); }
  const locks = []; const bar = at(box(.62, .16, .06, dark), 0, 1.12, .04); g.add(bar);
  for (let i = 0; i < (o.locks || 3); i++) { const l = sph(.04, glow(0xff5a4d, 1.4)); l.position.set((i - ((o.locks || 3) - 1) / 2) * .17, 1.12, .08); g.add(l); locks.push(l); }
  const sign = labelPlate(o.sign || 'HATCH', 1.1, .17, '#0a1320', '#' + new THREE.Color(col).getHexString(), 44); sign.position.set(0, 1.33, .04); g.add(sign);
  for (const s of [-1, 1]) { const hz = plane(.12, 1.7, new THREE.MeshBasicMaterial({ map: hazardTex() })); hz.material.map.repeat.set(.5, 6); hz.material.map.rotation = Math.PI / 2; hz.position.set(s * 1.1, 0, .012); g.add(hz); }
  let openK = 0, target = 0; g.scale.setScalar(o.scale || .9);
  env.anim.push((t, dt) => { if (openK !== target) { openK = Math.min(target, openK + dt * .7); const e = 1 - Math.pow(1 - openK, 3); for (const [d, s] of halves) d.position.x = s * e * .8; } ring2.material.color.set(col).multiplyScalar(target ? 1.2 + .5 * Math.sin(t * 4) : .9); });
  return { obj: g, setLocks(n) { locks.forEach((l, i) => l.material.color.setHex(i < n ? 0x5fe3a1 : 0xff5a4d).multiplyScalar(1.4)); }, open(instant) { target = 1; if (instant) { openK = 1; for (const [d, s] of halves) d.position.x = s * .8; } } };
}
function crate(w, h, d, color, text) {
  const g = grp(box(w, h, d, std(color, .7, .2)));
  const edge = std(0x20252c, .5, .7); for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(.035, h + .01, .035, edge), sx * w / 2, 0, sz * d / 2));
  for (const sy of [-1, 1]) { g.add(at(box(w + .02, .035, d + .02, edge), 0, sy * h / 2, 0)); }
  if (text) { const l = labelPlate(text, w * .7, h * .28, '#f1f1ea', '#15181c'); l.position.set(0, .02, d / 2 + .003); g.add(l); }
  g.add(at(box(w * .3, .03, .02, std(0xbcc2ca, .3, .9)), 0, h * .32, d / 2 + .012));
  return g;
}
function softBag(w, h, d, color, text) { const g = grp(); const b = sph(.5, std(color, .95, 0), 14, 10); b.scale.set(w, h, d); g.add(b); const strap = std(0x30353c, .9, 0); g.add(at(box(w * 1.02, .03, .03, strap), 0, h * .12, d * .46)); if (text) { const l = labelPlate(text, w * .5, h * .2, '#f6f6f0', '#1b1b1b'); l.position.set(0, -h * .08, d * .5 - .005); g.add(l); } return g; }
function ledBank(env, w, h, n, colors) { // blinking status LEDs as one instanced mesh
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(.018, .018, .008), new THREE.MeshBasicMaterial({ toneMapped: false }), n); const cols = Math.ceil(Math.sqrt(n * w / h)), c = new THREE.Color(), d = new THREE.Object3D(), ph = [];
  for (let i = 0; i < n; i++) { d.position.set((i % cols) / cols * w - w / 2 + .02, -Math.floor(i / cols) / Math.ceil(n / cols) * h + h / 2 - .02, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); ph.push([rnd() * 9, .5 + rnd() * 3, new THREE.Color(pickOf(colors))]); m.setColorAt(i, ph[i][2]); }
  let acc = 0; env.anim.push((t, dt) => { acc += dt; if (acc < .12) return; acc = 0; for (let i = 0; i < n; i++) { const on = Math.sin(t * ph[i][1] + ph[i][0]) > -.3; m.setColorAt(i, c.copy(ph[i][2]).multiplyScalar(on ? 1.5 : .12)); } m.instanceColor.needsUpdate = true; });
  return m;
}
function fan(env, r, speed) { const g = grp(tor(r, .025, std(0x2a3038, .4, .8), 24)); const hub = cyl(r * .2, r * .2, .05, std(0x9aa1aa, .3, .9)); hub.rotation.x = Math.PI / 2; const bl = new THREE.Group(); for (let i = 0; i < 5; i++) { const b = box(r * .85, r * .26, .012, std(0x555d68, .4, .7)); b.position.x = r * .5; const h = new THREE.Group(); h.add(b); h.rotation.z = i * Math.PI * .4; b.rotation.x = .5; bl.add(h); } g.add(hub, bl, at(plane(r * 2, r * 2, new THREE.MeshBasicMaterial({ color: 0x05070a })), 0, 0, -.04)); for (let i = 0; i < 4; i++) g.add(at(box(r * 2, .012, .012, std(0x8a9099, .3, .9)), 0, 0, .04, 0, 0, i * Math.PI / 4)); env.anim.push((t, dt) => { bl.rotation.z -= dt * speed; }); return g; }
function floaty(env, o, amp = .04, sp = .5, spin = 0) { const y = o.position.y, ph = rnd() * 6; const rx = o.rotation.x, rz = o.rotation.z; env.anim.push((t, dt) => { o.position.y = y + Math.sin(t * sp + ph) * amp; if (spin) { o.rotation.y += dt * spin; } else { o.rotation.x = rx + Math.sin(t * sp * .7 + ph) * .06; o.rotation.z = rz + Math.cos(t * sp * .6 + ph) * .06; } }); return o; }
function console_(env, w, lines, o = {}) { // angled desk console with screen, keys and LEDs
  const dark = std(o.body || 0x222933, .5, .6), g = grp(at(box(w, .7, .5, dark), 0, .35, -.05));
  const top = at(box(w, .06, .62, std(0x2e3642, .4, .7)), 0, .78, .06, .38); g.add(top);
  const keys = plane(w * .86, .4, new THREE.MeshBasicMaterial({ toneMapped: false, map: ctex(512, 200, (c, W, HH) => { c.fillStyle = '#0b0f15'; c.fillRect(0, 0, W, HH); rnd = mulberry(o.seed || 3); for (let y = 10; y < HH - 20; y += 30) for (let x = 10; x < W - 20; x += 30) { const k = rnd(); c.fillStyle = k < .08 ? '#ff6b5e' : k < .16 ? '#ffb347' : k < .3 ? (o.fg || '#4fd8ff') : '#27303b'; c.fillRect(x, y, 22, 22); } }) })); keys.rotation.x = -Math.PI / 2 + .38; keys.position.set(0, .818, .07); g.add(keys);
  const d = display(w * .92, .56, lines, o); d.position.set(0, 1.22, -.2); d.rotation.x = -.12; g.add(d);
  g.add(at(box(.08, .3, .08, dark), 0, .9, -.24));
  return g;
}
function gauge(val, color, text) { return plane(.26, .26, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, map: ctex(256, 256, (g, w) => { g.fillStyle = '#0c1118'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill(); g.strokeStyle = '#cfd6de'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 118, 0, 7); g.stroke(); g.lineWidth = 16; g.strokeStyle = '#5fe3a1'; g.beginPath(); g.arc(128, 128, 92, Math.PI * .75, Math.PI * 1.6); g.stroke(); g.strokeStyle = '#ffb347'; g.beginPath(); g.arc(128, 128, 92, Math.PI * 1.6, Math.PI * 1.95); g.stroke(); g.strokeStyle = '#ff5a4d'; g.beginPath(); g.arc(128, 128, 92, Math.PI * 1.95, Math.PI * 2.25); g.stroke(); const a = Math.PI * (.75 + 1.5 * val); g.strokeStyle = color; g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 10, 0, 7); g.fill(); g.font = '700 26px system-ui'; g.textAlign = 'center'; g.fillText(text || '', 128, 200); }) })); }
function valve(color) { const g = grp(tor(.11, .018, std(color, .5, .4), 20)); for (let i = 0; i < 3; i++) g.add(at(box(.22, .018, .018, std(color, .5, .4)), 0, 0, 0, 0, 0, i * Math.PI / 3)); g.add(at(cyl(.02, .02, .1, std(0x8a9099, .3, .9), 8), 0, 0, -.05, Math.PI / 2)); return g; }
function tablet(w, h, lines, o) { const g = grp(box(w + .04, h + .04, .02, std(0x10141a, .4, .5))); const s = plane(w, h, new THREE.MeshBasicMaterial({ toneMapped: false, map: screenTex(lines, Object.assign({ w: 512, h: Math.round(512 * h / w) }, o)) })); s.position.z = .011; g.add(s); return g; }

// Optional real 3D models. If assets/manifest.json lists a GLB for this name, it replaces the simple shapes once loaded.
// The fallback group stays the same object, so clues, beacons and positions keep working. See docs/GRAPHICS-UPGRADE.md.
function model(name, fallback) {
  const m = MANIFEST.models[name]; if (!m) return fallback;
  import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().load('assets/models/' + m.file, gltf => {
    for (const c of [...fallback.children]) if (!c.userData.keep) fallback.remove(c);
    const sc = gltf.scene; sc.scale.setScalar(m.scale || 1); sc.position.set(...(m.offset || [0, 0, 0])); sc.rotation.y = (m.turn || 0) * D2R;
    sc.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = Q.level === 2; } }); fallback.add(sc);
  }, undefined, e => console.warn('model failed to load, keeping simple shapes:', name)));
  return fallback;
}

/* ---------------------------------------------------------------- space outside the windows */
export function buildSpace(env) {
  const g = new THREE.Group(); rnd = mulberry(42);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1900, 24, 16), new THREE.MeshBasicMaterial({ color: 0x010207, side: THREE.BackSide })));
  const n = 3200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, th = rnd() * 6.283, s = Math.sqrt(1 - u * u), r = 1500; pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3); const b = .45 + rnd() * .55, tint = rnd(); col.set([b * (tint < .15 ? 1 : .88), b * .9, b * (tint > .85 ? 1 : .86)], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, toneMapped: false })); g.add(stars);
  // Earth: continents, ice and cloud from fractal noise sampled on the sphere (no seam, no blobs)
  const P = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
  const vn = (x, y, z) => { const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), xi = X & 255, yi = Y & 255, zi = Z & 255;
    const h = (a, b, c) => P[P[P[a] + b] + c] / 255, l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v), l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w); };
  const fbm = (x, y, z, o) => { let a = .5, f = 1, s = 0, n = 0; for (let i = 0; i < o; i++) { s += a * vn(x * f, y * f, z * f); n += a; a *= .5; f *= 2.03; } return s / n; };
  const EW = Q.level === 2 ? 2048 : 1024, EH = EW / 2;
  const earthTex = ctex(EW, EH, (c, w, h) => {
    const img = c.createImageData(w, h), d = img.data, mix = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
    for (let y = 0; y < h; y++) { const lat = (y / h - .5) * Math.PI, cy = Math.cos(lat), sy = Math.sin(lat);
      for (let x = 0; x < w; x++) { const lon = x / w * Math.PI * 2, px = Math.cos(lon) * cy, pz = Math.sin(lon) * cy, i = (y * w + x) * 4;
        const e = fbm(px * 2.1 + 5, sy * 2.1 + 9, pz * 2.1 + 2, 6) + (fbm(px * 9, sy * 9, pz * 9, 3) - .5) * .12, al = Math.abs(sy);
        let r, g, b;
        if (e < .56) { const k = (e - .32) / .24; r = mix(5, 20, k); g = mix(20, 66, k); b = mix(50, 104, k); }               // ocean, lighter on the shelves
        else { const k = (e - .56) / .16, dry = fbm(px * 4 + 20, sy * 4, pz * 4, 3) * 1.9 - .45; r = mix(mix(44, 128, dry), 108, k); g = mix(mix(66, 104, dry), 94, k); b = mix(mix(40, 70, dry), 72, k); }
        const ice = (al - .8) * 9 + (e - .5) * 2.5; if (ice > 0) { r = mix(r, 236, ice); g = mix(g, 242, ice); b = mix(b, 246, ice); }
        const cl = Math.pow(Math.max(0, fbm(px * 3.2 + 40, sy * 5.5 + 3, pz * 3.2 + 7, 6) - .44) * 3.6, 1.2); r = mix(r, 250, cl); g = mix(g, 251, cl); b = mix(b, 253, cl);
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } }
    c.putImageData(img, 0, 0);
  });
  earthTex.userData.shared = true;
  const earth = sph(600, new THREE.MeshBasicMaterial({ map: earthTex }), 96, 64); earth.position.set(0, -207, -975); earth.rotation.z = .4; g.add(earth);
  const shade = sph(603, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: ctex(512, 4, (c, w) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,8,.93)'); gr.addColorStop(.3, 'rgba(0,0,8,.9)'); gr.addColorStop(.5, 'rgba(0,0,8,0)'); gr.addColorStop(.85, 'rgba(0,0,8,0)'); gr.addColorStop(1, 'rgba(0,0,8,.93)'); c.fillStyle = gr; c.fillRect(0, 0, w, 4); }) }), 48, 32); shade.position.copy(earth.position); shade.rotation.y = 2.75; g.add(shade);
  const atm = sph(616, new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: .16, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }), 48, 32); atm.position.copy(earth.position); g.add(atm);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex(256, 256, (c) => { const gr = c.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(.12, '#fff7e0'); gr.addColorStop(.3, 'rgba(255,220,150,.35)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256); }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); sun.scale.setScalar(420); sun.position.set(900, 520, -700); g.add(sun);
  // the rest of the station, seen through the windows: truss and solar wings
  const truss = new THREE.Group(), tm = new THREE.MeshBasicMaterial({ color: 0x8d949c }), pm = new THREE.MeshBasicMaterial({ color: 0x16325e }), pm2 = new THREE.MeshBasicMaterial({ color: 0xb98a2b });
  truss.add(box(70, .8, .8, tm)); for (let x = -30; x <= 30; x += 20) { for (const s of [-1, 1]) { const pn = box(7, .1, 22, pm); pn.position.set(x, 0, s * 13); truss.add(pn); const st = box(.25, .14, 22, pm2); st.position.set(x, .02, s * 13); truss.add(st); } }
  truss.position.set(-10, 16, -42); truss.rotation.set(.25, .5, .12); g.add(truss);
  return { group: g, face(deg) { g.rotation.y = -deg * D2R; }, update(t, dt) { earth.rotation.y += dt * .003; stars.rotation.y += dt * .0015; } };
}

/* ---------------------------------------------------------------- rooms */
const ROOMS = {};
export function buildRoom(id, env) { rnd = mulberry(id.charCodeAt(1) * 31 + 5); CUR_ROOM = id; const g = new THREE.Group(); const r = ROOMS[id](g, env); r.group = g;
  if (Q.level === 2) g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && !o.material.transparent) { o.receiveShadow = true; o.castShadow = !o.material.alphaTest && !(o.geometry && o.geometry.type === 'CircleGeometry') && !(o.geometry && o.geometry.type === 'PlaneGeometry'); } }); r.earth = ({ r1: 60, r2: 180, r3: 0, r4: 200, r5: 0, rb: 270 })[id]; return r; }
const beaconAt = (o, x, y, z) => { o.userData.beacon = new THREE.Vector3(x, y, z); return o; };

/* ---- 1. Crew Quarters: warm, lived-in ---- */
ROOMS.r1 = (g, env) => {
  const pal = { base: '#b9ae9c', top: '#d2c8b6', accent: '#d9822b', ink: 'rgba(60,40,20,.5)', seed: 11, rib: 0x4a4038, strip: 0xffc98a, light: 0xffe2b8, cable: 0x7a4a2a,
    floor: { base: '#5b5148', accent: '#d9822b', tag: 'CREW QUARTERS' }, ceil: { base: '#8f8676', accent: '#ffc98a' }, facets: { 2: { win: [.22, .2, .56, .3] }, 10: { win: [.22, .2, .56, .3] } }, rails: [[40, 80], [280, 320]] };
  shell(g, pal); lights(g, { sky: 0xffe6c4, ground: 0x3a2c22, hemi: .75, points: [[0xffc58a, 7, 0, 2.7, 0], [0xff9a55, 4, 2.2, 1.2, .6], [0x9fc6ff, 4, -2, 1.6, -1.6]] });
  const clues = {};
  // sleep pods (two stacked, each side)
  const podM = std(0xe7dfd0, .85, .05), innerM = std(0x3b3028, .9, 0), bagCols = [0x2f6f8f, 0x8f3f3f, 0x4d7a4a, 0x6a4f8f];
  let bi = 0;
  for (const deg of [90, 120, 240, 270]) for (const lvl of [0, 1]) {
    const p = new THREE.Group(), y0 = .28 + lvl * 1.42;
    p.add(at(box(1.5, 1.3, .12, podM), 0, .65, -.5), at(box(1.5, .1, .95, podM), 0, .04, 0), at(box(1.5, .1, .95, podM), 0, 1.27, 0), at(box(.1, 1.3, .95, podM), -.72, .65, 0), at(box(.1, 1.3, .95, podM), .72, .65, 0));
    p.add(at(plane(1.34, 1.1, innerM), 0, .65, -.43));
    const bag = cap(.2, .95, std(bagCols[bi++ % 4], .95, 0)); bag.rotation.z = Math.PI / 2; bag.position.set(-.05, .32, -.1); p.add(bag);
    p.add(at(sph(.13, std(0xf2efe6, .95, 0)), .56, .34, -.12)); const pil = sph(.16, std(0xf6f2ea, 1, 0)); pil.scale.set(1.3, .5, 1); pil.position.set(.52, .2, -.12); p.add(pil);
    p.add(at(box(.14, .04, .08, glow(0xffd9a0, 1.5)), .5, 1.14, -.3));                                    // reading light
    const cur = plane(.62, 1.12, new THREE.MeshStandardMaterial({ color: pickOf([0x7d5a3c, 0x556b7a, 0x6d6a4f]), roughness: 1, side: THREE.DoubleSide })); cur.position.set(-.38 + rnd() * .1, .65, .47); p.add(cur);   // half-drawn curtain
    p.add(at(plane(.2, .15, new THREE.MeshBasicMaterial({ map: ctex(96, 72, (c) => { c.fillStyle = pickOf(['#7fb3d9', '#e3b27a', '#9fd39a']); c.fillRect(0, 0, 96, 72); c.fillStyle = '#3d6b3a'; c.fillRect(0, 48, 96, 24); c.fillStyle = '#fff3c9'; c.beginPath(); c.arc(70, 20, 10, 0, 7); c.fill(); }) })), .1, .95, -.425));   // photo from home
    const num = labelPlate('POD ' + (bi), .3, .09, '#2a221b', '#ffc98a'); num.position.set(.5, 1.27, .48); p.add(num);
    put(g, p, deg, R - .55, y0);
    if (deg === 90 && lvl === 0) { // duty card clipped beside the lower pod: low, to the right
      const card = grp(box(.36, .48, .015, std(0xf4efe2, .9, 0)), at(plane(.32, .44, new THREE.MeshBasicMaterial({ map: screenTex(['SHIFT ROSTER', '--------------', 'Day    ???', 'Night  ???', '', 'who is awake?'], { w: 256, h: 352, bg: '#f4efe2', fg: '#3a2c1e', size: 22 }) })), 0, 0, .009), at(box(.1, .05, .03, std(0x8a9099, .3, .9)), 0, .24, .01));
      card.position.set(-.98, .1, .52); card.rotation.set(-.25, .5, 0); p.add(card); clues.dutycard = beaconAt(card, 0, .32, .02);
    }
  }
  // lockers behind-left
  const lk = new THREE.Group(), lm = std(0x8c9aa6, .5, .6);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const d = box(.4, .62, .05, lm); d.position.set((i - 1.5) * .43, .4 + j * .66, 0); lk.add(d); lk.add(at(box(.05, .1, .03, std(0x20252c, .4, .8)), (i - 1.5) * .43 + .13, .4 + j * .66, .035)); lk.add(at(box(.3, .012, .01, std(0x20252c)), (i - 1.5) * .43, .62 + j * .66, .03)); lk.add(at(plane(.24, .07, new THREE.MeshBasicMaterial({ color: 0x0a0d12 })), (i - 1.5) * .43 - .04, .52 + j * .66, .027)); }
  lk.add(at(box(1.8, 2.1, .4, std(0x6f7c88, .6, .5)), 0, 1.05, -.23));
  model('locker_bank', lk); put(g, lk, 210, R - .42, 0); clues.lockers = beaconAt(lk, 0, 2.2, .1);
  // roster slate strapped to the ceiling, ahead-left
  const slate = tablet(.62, .42, ['CREW ROSTER', '', 'crew_id  full_name', '  ...      ...', '', '! VESTA: unable to', '  confirm who is', '  aboard'], { fg: '#ffb347', size: 26 });
  slate.add(at(box(.7, .04, .03, std(0x30353c, .9, 0)), 0, .12, .014), at(box(.7, .04, .03, std(0x30353c, .9, 0)), 0, -.12, .014));
  aim(g, slate, 320, 1.25, H - .1); clues.roster = beaconAt(slate, .36, .24, .03);
  // hatch behind
  const h = hatch(env, { sign: 'HATCH 01  ▸  GALLEY', code: 'H-01', color: 0xffb347 }); put(g, h.obj, 180, R - .07, 1.45);
  // lived-in details
  const guitar = grp(at(sph(.17, std(0xa8672f, .5, .1)), 0, 0, 0), at(sph(.13, std(0xa8672f, .5, .1)), 0, .2, 0), at(box(.05, .55, .025, std(0x3a2414, .6, 0)), 0, .52, .0), at(cyl(.045, .045, .01, std(0x120c08), 16), 0, .02, .1, Math.PI / 2)); guitar.children[0].scale.z = guitar.children[1].scale.z = .35;
  model('guitar', guitar); put(g, guitar, 150, R - .5, 1.9, .3); guitar.rotation.z = .5; floaty(env, guitar, .03, .4);
  const mug = grp(cyl(.045, .04, .1, std(0xe8e2d5, .6, 0)), at(tor(.03, .008, std(0xe8e2d5, .6, 0), 12), .05, 0, 0)); mug.position.set(.9, 1.5, -1.9); g.add(mug); floaty(env, mug, .05, .6, .4);
  for (let i = 0; i < 3; i++) { const b = softBag(.5, .36, .32, pickOf([0xe9e4d8, 0xcdbf9f, 0xa9b6bf]), 'CTB-' + (14 + i)); aim(g, b, 30 + i * 22, 2.5, H - .3); }     // bags netted to the ceiling
  const net = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0, 8, 4), new THREE.MeshBasicMaterial({ color: 0xd8d2c4, wireframe: true, transparent: true, opacity: .5 })); aim(g, net, 52, 2.35, H - .5);
  put(g, fan(env, .22, 6), 0, R - .03, 2.75); put(g, fan(env, .22, 5), 180, R - .03, 2.95);
  const board = plane(.9, .6, new THREE.MeshBasicMaterial({ map: ctex(360, 240, (c, w, hh) => { c.fillStyle = '#7a5a3a'; c.fillRect(0, 0, w, hh); rnd = mulberry(8); for (let i = 0; i < 9; i++) { c.save(); c.translate(30 + (i % 3) * 110 + rnd() * 20, 20 + Math.floor(i / 3) * 72 + rnd() * 10); c.rotate(rr(-.12, .12)); c.fillStyle = pickOf(['#f4efe2', '#ffe9a8', '#cfe6f5', '#f9d0c4']); c.fillRect(0, 0, 80, 56); c.fillStyle = '#444'; for (let k = 0; k < 4; k++) c.fillRect(8, 10 + k * 11, 40 + rnd() * 24, 3); c.fillStyle = '#c33'; c.beginPath(); c.arc(40, 4, 4, 0, 7); c.fill(); c.restore(); } }) })); put(g, board, 150, R - .02, 1.2);
  const boots = grp(at(box(.11, .09, .28, std(0x23272e, .8, .2)), -.09, .045, 0), at(box(.11, .09, .28, std(0x23272e, .8, .2)), .09, .045, .05), at(box(.11, .16, .1, std(0x23272e, .8, .2)), -.09, .17, -.09), at(box(.11, .16, .1, std(0x23272e, .8, .2)), .09, .17, -.04)); put(g, boots, 60, 2.3, 0, .6);
  put(g, display(.7, .42, [{ t: 'CABIN  21.4 C', b: 1 }, 'O2    20.9 %', 'CO2   0.41 %', { bar: .82, c: '#5fe3a1' }, { t: 'LOCKDOWN ACTIVE', c: '#ff6b5e', b: 1 }], { fg: '#ffc98a' }), 30, R - .04, 1.75);
  put(g, display(.7, .42, ['STATION TIME', { t: '03:12:44', b: 1 }, '', { t: 'HATCH 01 SEALED', c: '#ff6b5e' }, { graph: 1.3 }], { fg: '#ffc98a' }), 330, R - .04, 1.75);
  const plant = grp(cyl(.07, .05, .1, std(0xb5683c, .8, 0)), at(sph(.1, std(0x3f8f4a, .9, 0), 8, 6), 0, .13, 0), at(sph(.07, std(0x57a85e, .9, 0), 8, 6), .06, .2, .02)); put(g, plant, 300, R - .25, 1.12);
  put(g, at(box(.5, .04, .22, std(0x4a4038, .6, .5)), 0, 0, 0), 300, R - .2, 1.04);
  return { clues, hatch: h };
};

/* ---- 2. Galley and Stores: bright, white and teal ---- */
ROOMS.r2 = (g, env) => {
  const pal = { base: '#c9d3d6', top: '#e6ecee', accent: '#1fa7a0', seed: 23, rib: 0x39474d, strip: 0x7ff3e6, light: 0xf2fbff, cable: 0x1f6f8a,
    floor: { base: '#51606a', accent: '#1fa7a0', tag: 'GALLEY' }, ceil: { base: '#a9b4b8', accent: '#7ff3e6' }, facets: { 5: { win: [.14, .16, .72, .4] }, 6: { win: [.14, .16, .72, .4] }, 7: { win: [.14, .16, .72, .4] } }, rails: [[40, 110], [290, 320]] };
  shell(g, pal); lights(g, { sky: 0xeaf6ff, ground: 0x2c3a40, hemi: 1.0, key: .7, points: [[0xdff6ff, 9, 0, 2.7, 0], [0x7ff3e6, 5, -2.2, 1.3, -1], [0xfff0d0, 4, 2, 1, 1.4]] });
  const clues = {};
  // storage racks with labelled cargo bags (right side)
  for (const deg of [60, 90]) { const rk = new THREE.Group(), fm = std(0x9aa3ab, .35, .85); for (const x of [-.8, .8]) rk.add(at(box(.04, 2.9, .04, fm), x, 1.5, .25), at(box(.04, 2.9, .04, fm), x, 1.5, -.2)); for (let s = 0; s < 4; s++) { rk.add(at(box(1.64, .03, .5, fm), 0, .3 + s * .72, .02)); for (let b = 0; b < 3; b++) { const bag = softBag(.46 + rnd() * .06, .42, .4, pickOf([0xf1efe8, 0xdfe6ea, 0xe8dcc0, 0xbfd6d6]), pickOf(['FOOD', 'WATER', 'MEDICAL', 'SPARES', 'SEEDS', 'OXYGEN']) + ' ' + Math.floor(rr(1, 20))); bag.position.set(-.53 + b * .53, .54 + s * .72, .05); bag.rotation.y = rr(-.2, .2); rk.add(bag); } rk.add(at(box(1.64, .012, .012, std(0x1fa7a0)), 0, .62 + s * .72, .27)); } put(g, rk, deg, R - .4, 0); }
  // galley counter (left) with oven, rehydrator and table
  const gal = new THREE.Group(), wm = std(0xdfe5e8, .5, .3);
  gal.add(at(box(1.7, .95, .55, wm), 0, .475, 0), at(box(1.74, .04, .6, std(0x2f3a40, .3, .8)), 0, .97, .01), at(box(1.7, 1.0, .35, wm), 0, 2.3, -.1));
  for (let i = 0; i < 4; i++) { gal.add(at(box(.38, .42, .02, std(0xc6ced3, .4, .5)), -.63 + i * .42, 2.3, .085), at(box(.14, .02, .03, std(0x2f3a40)), -.63 + i * .42, 2.13, .1)); }
  gal.add(at(box(.5, .34, .4, std(0x39444b, .4, .7)), -.5, 1.17, -.04), at(plane(.34, .2, glow(0xff8a3d, 1.1)), -.56, 1.17, .165), at(labelPlate('OVEN 82 C', .3, .06, '#0a0d12', '#ff8a3d'), -.5, 1.38, .165));
  const reh = grp(box(.36, .5, .3, std(0xbfc8cd, .4, .6)), at(cyl(.015, .015, .12, std(0x8a9099, .3, .9), 8), -.08, -.3, .1), at(cyl(.015, .015, .12, std(0x8a9099, .3, .9), 8), .08, -.3, .1), at(plane(.24, .12, new THREE.MeshBasicMaterial({ map: screenTex(['HOT  88 C', 'COLD  4 C'], { w: 256, h: 128, size: 30, fg: '#7ff3e6', pad: 44 }), toneMapped: false })), 0, .1, .152)); reh.position.set(.45, 1.4, -.05); gal.add(reh);
  for (let i = 0; i < 6; i++) { const pch = box(.1, .14, .02, std(pickOf([0xc9ced3, 0xd9c27a, 0xb5d1a0, 0xe0a58a]), .5, .4)); pch.position.set(-.1 + i * .13, 1.07 + rnd() * .02, .12 + rnd() * .1); pch.rotation.set(-1.2, rr(-.5, .5), 0); gal.add(pch); }
  put(g, gal, 300, R - .38, 0);
  const table = grp(at(cyl(.55, .55, .04, std(0xe8edf0, .4, .4), 32), 0, .95, 0), at(cyl(.05, .09, .95, std(0x8a9099, .3, .9)), 0, .47, 0));
  for (let i = 0; i < 4; i++) { const tr = box(.3, .02, .22, std(pickOf([0x1fa7a0, 0x39444b]), .5, .3)); tr.position.set(Math.cos(i * 1.57) * .32, .985, Math.sin(i * 1.57) * .32); tr.rotation.y = -i * 1.57; table.add(tr); const pk = box(.1, .03, .13, std(pickOf([0xd9c27a, 0xb5d1a0, 0xe0a58a]), .6, .2)); pk.position.copy(tr.position); pk.position.y += .03; table.add(pk); }
  for (let i = 0; i < 3; i++) table.add(at(cyl(.025, .025, .14, std(pickOf([0xc0392b, 0xe0b030, 0x2d7d46]), .4, .2), 10), rr(-.12, .12), 1.05, rr(-.12, .12)));
  model('galley_table', table); put(g, table, 250, 2.2, 0);
  // floating cargo crate, behind-right, tumbling slowly
  const cr = crate(.6, .5, .5, 0xd98a2b, 'CARGO 7-B'); const tag = at(plane(.22, .1, glow(0xff5a4d, 1.3)), .15, -.14, .253); cr.add(tag); env.anim.push(t => { tag.visible = Math.sin(t * 5) > 0; });
  for (const ry of [Math.PI / 2, Math.PI, -Math.PI / 2]) { const l2 = labelPlate('CARGO 7-B', .42, .14, '#f1f1ea', '#15181c'); l2.position.set(Math.sin(ry) * .253, .02, Math.cos(ry) * .253); l2.rotation.y = ry; cr.add(l2); }
  model('cargo_crate', cr); put(g, cr, 165, 1.9, 1.2); cr.rotation.set(.3, .6, .2); floaty(env, cr, .06, .35, .12); clues.crate = beaconAt(cr, 0, .34, 0);
  // pantry manifest board on the ceiling, ahead-right
  const man = tablet(.75, .5, ['PANTRY MANIFEST', '', 'item_name | quantity | unit', '----------+----------+-----', '   ...    |   ...    | ...', '', 'three columns. no more.'], { fg: '#7ff3e6', size: 24 });
  man.add(at(box(.05, .2, .03, std(0x8a9099, .3, .9)), -.3, .32, 0), at(box(.05, .2, .03, std(0x8a9099, .3, .9)), .3, .32, 0)); aim(g, man, 40, 1.5, H - .12); clues.pantry = beaconAt(man, .42, .3, .03);
  // water recycler under the deck grating, behind-left at your feet
  const rec = new THREE.Group(); rec.add(at(box(.9, .06, .7, std(0x1a2026, .6, .7)), 0, .0, 0));
  rec.add(at(plane(.8, .6, new THREE.MeshBasicMaterial({ transparent: true, map: ctex(256, 192, (c, w, hh) => { c.clearRect(0, 0, w, hh); c.fillStyle = '#0a2630'; c.fillRect(0, 0, w, hh); const gr = c.createRadialGradient(128, 96, 5, 128, 96, 130); gr.addColorStop(0, 'rgba(60,220,230,.9)'); gr.addColorStop(1, 'rgba(10,40,50,.2)'); c.fillStyle = gr; c.fillRect(0, 0, w, hh); c.strokeStyle = '#9aa3ab'; c.lineWidth = 5; for (let x = 0; x <= w; x += 22) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); } c.lineWidth = 3; for (let y = 0; y <= hh; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }) })), 0, .035, 0, -Math.PI / 2));
  rec.add(at(gauge(.86, '#ff5a4d', 'H2O'), -.28, .09, .42, -1.1), at(labelPlate('WATER RECYCLER  ·  DEGRADED', .7, .08, '#14161a', '#f2c230'), .15, .06, .42, -1.1));
  const hz = plane(.98, .78, new THREE.MeshBasicMaterial({ map: hazardTex() })); hz.material.map.repeat.set(4, 4); hz.rotation.x = -Math.PI / 2; hz.position.y = .012; rec.add(hz); hz.userData.nopick = false;
  const drip = sph(.02, glow(0x7ff3e6)); rec.add(drip); env.anim.push(t => { const k = (t * .6) % 1; drip.position.set(.3, .1 + k * .5, -.2); drip.scale.setScalar(1 - k * .7); });
  put(g, rec, 215, 1.45, .0, 0); clues.recycler = beaconAt(rec, 0, .14, 0);
  const h = hatch(env, { sign: 'HATCH 02  ▸  HYDROPONICS', code: 'H-02', color: 0xc77dff, tunnel: '#e2b6ff' }); put(g, h.obj, 120, R - .07, 1.45);
  // details: water tank, floating droplets, utensils, screens
  const tank = grp(cyl(.3, .3, 1.5, new THREE.MeshStandardMaterial({ color: 0x8fdcf0, transparent: true, opacity: .45, roughness: .15, depthWrite: false }), 24), at(cyl(.27, .27, 1.0, new THREE.MeshBasicMaterial({ color: 0x2aa8c8, transparent: true, opacity: .55 }), 24), 0, -.24, 0), at(cyl(.32, .32, .06, std(0x8a9099, .3, .9), 24), 0, .76, 0), at(cyl(.32, .32, .06, std(0x8a9099, .3, .9), 24), 0, -.76, 0), at(labelPlate('H2O 310 L', .3, .08, '#0a2630', '#7ff3e6'), 0, .2, .31)); put(g, tank, 330, R - .45, .85);
  for (let i = 0; i < 9; i++) { const d = sph(.012 + rnd() * .022, new THREE.MeshPhysicalMaterial({ color: 0xbfefff, transparent: true, opacity: .6, roughness: 0 }), 10, 8); d.position.set(...pol(rr(230, 290), rr(1.4, 2.4), rr(1.2, 2.2))); g.add(d); floaty(env, d, .06, rr(.3, .8)); }
  const spoon = grp(at(box(.012, .14, .006, std(0xcfd6de, .2, 1)), 0, 0, 0), at(sph(.02, std(0xcfd6de, .2, 1), 8, 6), 0, .08, 0)); spoon.children[1].scale.z = .3; spoon.position.set(...pol(262, 1.9, 1.35)); g.add(spoon); floaty(env, spoon, .04, .5, .7);
  put(g, display(.8, .46, [{ t: 'GALLEY STORES', b: 1 }, 'meals      148', 'water      310 L', { t: 'coffee       6 !', c: '#ff6b5e' }, { bar: .31, c: '#ffb347' }], { fg: '#7ff3e6' }), 30, R - .04, 1.8);
  put(g, display(.8, .46, ['MENU · DAY 212', 'tortilla + beans', 'rehydrated curry', 'no coffee (again)', { graph: 2 }], { fg: '#7ff3e6' }), 270, R - .04, 2.75);
  put(g, fan(env, .2, 7), 0, R - .03, 2.8);
  for (let i = 0; i < 3; i++) put(g, crate(.5, .4, .45, pickOf([0x4f6d7a, 0x8a9a5b, 0xb5683c]), pickOf(['RATIONS', 'SPARES', 'LINEN'])), 20 + i * 4, R - .5 - (i % 2) * .05, .2 + i * .41, rr(-.2, .2));
  return { clues, hatch: h };
};

/* ---- 3. Hydroponics Bay: violet grow light and green ---- */
ROOMS.r3 = (g, env) => {
  const pal = { base: '#aeb8a9', top: '#c9d2c2', accent: '#7ac74f', seed: 37, rib: 0x2f3b33, strip: 0xd27dff, light: 0xf0c8ff, lightK: 1.3, cable: 0x3d7a3a,
    floor: { base: '#3f4a45', accent: '#7ac74f', tag: 'HYDROPONICS' }, ceil: { base: '#6f7a70', accent: '#d27dff' }, facets: { 0: { win: [.25, .08, .5, .16] } }, rails: [[150, 170]] };
  shell(g, pal); lights(g, { sky: 0xe7c6ff, ground: 0x1c2a1f, hemi: .95, points: [[0xd77dff, 14, 2.2, 2, 0], [0xd77dff, 14, -2.2, 2, 0], [0xbfffd0, 6, 0, 2.6, 1.5], [0xffffff, 5, 0, 1.5, -1.2]] });
  const clues = {};
  // plant racks both sides
  const leafG = new THREE.SphereGeometry(.06, 6, 5), rackM = std(0xcfd6d0, .4, .7), trayM = std(0x222a26, .7, .3);
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ roughness: .8, metalness: 0 }), 1500); let li = 0; const d = new THREE.Object3D(), lc = new THREE.Color();
  for (const deg of [60, 90, 120, 240, 270, 300]) {
    const rk = new THREE.Group(); for (const x of [-.82, .82]) rk.add(at(box(.04, 2.95, .04, rackM), x, 1.5, .28), at(box(.04, 2.95, .04, rackM), x, 1.5, -.2));
    for (let s = 0; s < 4; s++) {
      const y = .28 + s * .72; rk.add(at(box(1.66, .1, .5, trayM), 0, y, .04), at(box(1.58, .02, .42, std(0x3a2a1c, 1, 0)), 0, y + .05, .04));
      rk.add(at(box(1.6, .03, .1, glow(0xe58bff, 1.7)), 0, y + .62, .04), at(box(1.66, .05, .16, rackM), 0, y + .645, .04));
      rk.add(at(cyl(.014, .014, 1.66, std(0x2d5a8c, .4, .5), 8), 0, y + .02, .3, 0, 0, Math.PI / 2));
      const kind = Math.floor(rnd() * 4);
      for (let p = 0; p < 9; p++) { const px = -.7 + p * .175, hgt = kind === 1 ? rr(.2, .42) : rr(.08, .2); const n = kind === 1 ? 5 : 4;
        for (let k = 0; k < n && li < 1500; k++) { const a = deg * D2R, lx = px + rr(-.05, .05), ly = y + .07 + (k / n) * hgt, lz = .04 + rr(-.1, .1); const wx = Math.sin(a) * (R - .42) + Math.cos(a) * lx - Math.sin(a) * lz, wz = -Math.cos(a) * (R - .42) + Math.sin(a) * lx + Math.cos(a) * lz; d.position.set(wx, ly, wz); d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); d.scale.set(rr(.6, 1.3), rr(.25, .5), rr(.7, 1.4)); if (kind === 1) d.scale.set(.3, 1.4, .3); d.updateMatrix(); leaves.setMatrixAt(li, d.matrix); leaves.setColorAt(li, lc.setHSL(kind === 2 ? rr(.0, .04) : rr(.26, .36), rr(.5, .8), kind === 2 && k === n - 1 ? .45 : rr(.25, .45))); li++; } }
    }
    put(g, rk, deg, R - .42, 0);
  }
  leaves.count = li; g.add(leaves);
  // nutrient tank (behind-right, on the floor) with a gauge in the red
  const tk = grp(cyl(.42, .42, 1.5, new THREE.MeshStandardMaterial({ color: 0xc9ffb0, transparent: true, opacity: .42, roughness: .15, metalness: .1, depthWrite: false }), 28), at(cyl(.39, .39, .28, new THREE.MeshBasicMaterial({ color: 0x69d94a, transparent: true, opacity: .7 }), 28), 0, -.58, 0), at(cyl(.45, .47, .12, std(0x59646a, .4, .8), 28), 0, -.8, 0), at(cyl(.45, .45, .1, std(0x59646a, .4, .8), 28), 0, .78, 0), at(gauge(.93, '#ff5a4d', 'NUTR'), 0, .25, .44), at(box(.05, 1.5, .05, std(0x59646a, .4, .8)), .4, 0, .12), at(box(.05, 1.5, .05, std(0x59646a, .4, .8)), -.4, 0, .12), at(box(.05, 1.5, .05, std(0x59646a, .4, .8)), 0, 0, -.42), at(labelPlate('NUTRIENT A  ·  9 LEFT', .5, .08, '#14161a', '#ff8a7e'), 0, -.02, .43));
  for (let i = 0; i < 7; i++) { const b = sph(.02 + rnd() * .02, glow(0xb6ff9a, .8), 8, 6); tk.add(b); const x = rr(-.25, .25), z = rr(-.25, .25), sp = rr(.2, .5), ph = rnd(); env.anim.push(t => { const k = (t * sp + ph) % 1; b.position.set(x, -.7 + k * .25, z); }); }
  tk.add(pipe([[.3, .82, 0], [.5, 1.2, 0], [.55, 1.9, -.1], [.4, 2.3, -.3]], .03, std(0x2d5a8c, .4, .5)));
  model('nutrient_tank', tk); put(g, tk, 150, R - .75, .86); clues.tank = beaconAt(tk, 0, .95, 0);
  // seed drawer cabinet, low, ahead-left; one drawer jammed half open
  const cab = new THREE.Group(), cm = std(0xd8dccf, .6, .3); cab.add(at(box(1.0, 1.05, .5, cm), 0, .525, 0));
  for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 3; c2++) { const open = r2 === 2 && c2 === 1; const dr = grp(box(.3, .22, .04, std(0xbfc6b4, .6, .3)), at(box(.12, .025, .03, std(0x59646a, .3, .9)), 0, 0, .03), at(labelPlate(pickOf(['LETTUCE', 'WHEAT', 'RADISH', 'TOMATO', 'BASIL', 'KALE']), .2, .045, '#f6f6ea', '#263322'), 0, .07, .022)); dr.position.set(-.33 + c2 * .33, .15 + r2 * .25, .26 + (open ? .22 : 0)); cab.add(dr); if (open) { dr.add(at(box(.28, .18, .22, std(0x9aa38c, .7, .2)), 0, -.01, -.12)); for (let k = 0; k < 4; k++) dr.add(at(box(.07, .1, .012, std(pickOf([0xf2e9c9, 0xe3d08a, 0xcfe3b0]), .8, 0)), -.09 + k * .06, .1, -.12 + rnd() * .05, rr(-.3, .3), 0, rr(-.3, .3))); } }
  cab.add(at(plane(.5, .34, new THREE.MeshBasicMaterial({ map: screenTex(['Only count what', 'we can plant.', '', '        - Priya'], { w: 300, h: 204, bg: '#fff6c4', fg: '#3a3320', size: 26 }) })), .2, 1.24, .02, -.3, 0, .06));
  put(g, cab, 330, R - .5, 0); clues.seeds = beaconAt(cab, 0, .72, .52);
  // grow lamp controller on the ceiling, behind-left
  const lc2 = grp(box(.6, .42, .1, std(0x2b332e, .5, .6)), at(plane(.52, .3, new THREE.MeshBasicMaterial({ toneMapped: false, map: screenTex([{ t: 'GROW LAMP ARRAY', b: 1 }, { t: 'FAULT · OFFLINE', c: '#ff5a4d', b: 1 }, 'what else is dark?'], { w: 400, h: 230, fg: '#e58bff', size: 30, pad: 50 }) })), 0, .02, .052));
  const wl = sph(.04, glow(0xff5a4d, 1.6)); wl.position.set(.24, -.17, .06); lc2.add(wl); env.anim.push(t => { wl.material.color.setHex(0xff5a4d).multiplyScalar(Math.sin(t * 6) > 0 ? 1.8 : .2); });
  lc2.add(pipe([[0, .2, 0], [.1, .5, -.1], [.5, .6, -.12]], .02, std(0x1a1d22, .8, .1)));
  aim(g, lc2, 235, 1.4, H - .14); clues.lamps = beaconAt(lc2, -.34, .24, .05);
  const h = hatch(env, { sign: 'HATCH 03  ▸  ENGINEERING', code: 'H-03', color: 0xff8a3d, tunnel: '#ffc08a' }); put(g, h.obj, 180, R - .07, 1.45);
  // flickering lamp bars on the ceiling, vines, mist, irrigation
  for (let i = 0; i < 4; i++) { const bar = box(1.5, .04, .1, glow(0xe58bff, 1.6)); const a = (i * 90 + 45) * D2R; bar.position.set(Math.sin(a) * .9, H - .08, -Math.cos(a) * .9); bar.rotation.y = -a + Math.PI / 2; g.add(bar); const ph = rnd() * 9; env.anim.push(t => { const f = Math.sin(t * 13 + ph) * Math.sin(t * 2.1 + ph) > .55 ? .25 : 1.6; bar.material.color.setHex(0xe58bff).multiplyScalar(f); }); }
  const vm = std(0x3d7a3a, .9, 0); for (let i = 0; i < 7; i++) { const dg = pickOf([20, 45, 75, 105, 200, 255, 285, 315]) + rr(-6, 6), r0 = rr(2.3, 3.0), len = rr(.5, 1.2); g.add(pipe([pol(dg, r0, H - .05), pol(dg + 3, r0 - .05, H - len * .5), pol(dg - 2, r0 - .02, H - len)], .012, vm)); for (let k = 0; k < 5; k++) { const lf = sph(.05, std(0x4f9a4a, .9, 0), 6, 5); lf.scale.set(1, .3, .6); lf.position.set(...pol(dg + rr(-3, 3), r0 - .03, H - rr(.1, len))); lf.rotation.set(rnd() * 3, rnd() * 3, 0); g.add(lf); } }
  g.add(ringPipe(R - .3, .12, .04, std(0x2d5a8c, .4, .5), 30, 330)); g.add(ringPipe(R - .22, 2.98, .03, std(0xcfd6de, .3, .9), 30, 330));
  for (let i = 0; i < 16; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: MIST(), transparent: true, opacity: .08, depthWrite: false, color: 0xe9c6ff })); m.scale.setScalar(rr(.8, 1.6)); m.position.set(...pol(rnd() * 360, rr(1.6, 2.8), rr(.2, 1.2))); g.add(m); const ph = rnd() * 6, y = m.position.y; env.anim.push(t => { m.position.y = y + Math.sin(t * .2 + ph) * .15; m.material.opacity = .05 + .04 * Math.sin(t * .3 + ph); }); }
  const drone = grp(sph(.07, std(0xf2f2ee, .4, .3)), at(sph(.025, glow(0x4fd8ff, 1.5)), 0, 0, .06), at(tor(.1, .008, std(0x8a9099, .3, .9), 16), 0, .0, 0, Math.PI / 2)); g.add(drone); env.anim.push(t => { drone.position.set(Math.sin(t * .25) * 1.9, 2.1 + Math.sin(t * .9) * .12, Math.cos(t * .25) * 1.9); drone.rotation.y = t * .25 + Math.PI / 2; });
  put(g, display(.8, .46, [{ t: 'BAY CLIMATE', b: 1 }, 'humidity   71 %', 'CO2       0.09 %', { bar: .71, c: '#7ac74f' }, { t: 'LAMPS: FAULT', c: '#ff6b5e' }], { fg: '#b6ff9a' }), 30, R - .04, 1.8);
  put(g, display(.8, .46, ['HARVEST LOG', 'lettuce   day 22', 'wheat     day 61', 'tomato    day 48', { graph: 1.6, c: '#7ac74f' }], { fg: '#b6ff9a' }), 210, R - .04, 2.75);
  return { clues, hatch: h };
};
let _mist = null; function MIST() { if (!_mist) { _mist = ctex(128, 128, c => { const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128); }); _mist.userData.shared = true; } return _mist; }

/* ---- 4. Engineering: dark steel, reactor glow, hazard stripes ---- */
ROOMS.r4 = (g, env) => {
  const pal = { base: '#4a5059', top: '#5d646e', accent: '#ff8a3d', ink: 'rgba(255,200,120,.5)', seed: 53, rib: 0x1d2228, strip: 0xff8a3d, light: 0xffd2a8, lightK: 1.1, cable: 0xb83a2a, frame: '#15191e',
    floor: { base: '#2a2f36', accent: '#f2c230', hazard: true, tag: 'ENGINEERING' }, ceil: { base: '#343a42', accent: '#ff8a3d' }, facets: { 3: 'none' }, rails: [[45, 60], [120, 135], [240, 300]] };
  shell(g, pal); lights(g, { sky: 0xffd9b8, ground: 0x10151c, hemi: .75, points: [[0x58c8ff, 30, 4.2, 1.6, 0, 11], [0xff8a3d, 12, -1.5, 2.6, 1], [0xff5a3d, 6, 0, 2.6, -2], [0xffffff, 4, 0, 1.6, -1.2]] });
  const clues = {};
  // reactor chamber through the open facet on the right
  const rx = new THREE.Group(), steel = std(0x2a3038, .4, .85);
  rx.add(at(cyl(1.6, 1.6, 3.6, new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: .5, metalness: .8, side: THREE.BackSide }), 28), 0, 0, -1.3));
  const core = cyl(.42, .42, 2.6, glow(0x7fdcff, 1.5), 24); core.position.z = -1.3; rx.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: MIST(), color: 0x58c8ff, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.set(3.2, 4.2, 1); halo.position.z = -1.3; rx.add(halo);
  const rings = []; for (let i = 0; i < 5; i++) { const t = tor(.62, .05, steel, 32); t.rotation.x = Math.PI / 2; t.position.set(0, -1.1 + i * .55, -1.3); rx.add(t); const e = tor(.56, .018, glow(0x9be8ff, 1.5), 32); e.rotation.x = Math.PI / 2; e.position.copy(t.position); rx.add(e); rings.push(e); }
  for (let i = 0; i < 6; i++) { const s = box(.07, 2.9, .07, steel); s.position.set(Math.cos(i * 1.047) * .75, 0, -1.3 + Math.sin(i * 1.047) * .75); rx.add(s); }
  rx.add(at(cyl(.8, .95, .3, steel, 28), 0, -1.5, -1.3), at(cyl(.95, .8, .3, steel, 28), 0, 1.5, -1.3));
  for (const s of [-1, 1]) rx.add(at(box(.12, H, .2, steel), s * .93, 0, .0)); rx.add(at(box(1.9, .16, .2, steel), 0, 1.3, 0), at(box(1.9, .9, .16, steel), 0, -1.2, 0));
  const hz = plane(1.9, .22, new THREE.MeshBasicMaterial({ map: hazardTex() })); hz.material.map.repeat.set(4, 1); hz.position.set(0, -.72, .09); rx.add(hz); rx.add(at(labelPlate('MAIN REACTOR  ·  CONTAINMENT', 1.5, .12, '#14161a', '#f2c230'), 0, 1.3, .105));
  const gl = plane(1.74, 1.9, new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: .1, roughness: .05, depthWrite: false })); gl.position.set(0, .28, -.02); rx.add(gl);
  env.anim.push(t => { const k = 1.25 + .35 * Math.sin(t * 3); core.material.color.setHex(0x7fdcff).multiplyScalar(k); halo.material.opacity = .4 + .15 * Math.sin(t * 3); rings.forEach((e, i) => e.material.color.setHex(0x9be8ff).multiplyScalar(.5 + 1.2 * Math.max(0, Math.sin(t * 4 - i * .9)))); });
  put(g, rx, 90, R, H / 2);
  // power bus panel: left, eye level, with sparks
  const pb = new THREE.Group(); pb.add(box(1.2, 1.5, .12, std(0x2b3139, .5, .7)), at(box(1.26, .1, .16, std(0xf2c230, .5, .3)), 0, .8, 0));
  for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 6; c2++) { const on = rnd() > .3; pb.add(at(box(.1, .2, .05, std(0x15181d, .5, .5)), -.45 + c2 * .18, .42 - r2 * .3, .07), at(box(.05, .08, .05, std(on ? 0xdfe5e8 : 0xff5a4d, .4, .3)), -.45 + c2 * .18, .42 - r2 * .3 + (on ? .04 : -.04), .1)); }
  pb.add(at(ledBank(env, 1.0, .12, 36, [0x5fe3a1, 0xffb347, 0xff5a4d]), 0, -.64, .07), at(labelPlate('POWER BUS A  ·  OVERLOAD', 1.0, .1, '#14161a', '#ff8a3d'), 0, .65, .065));
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: MIST(), color: 0xbfe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); spark.position.set(.45, .1, .14); pb.add(spark); env.anim.push(t => { const on = Math.sin(t * 37) * Math.sin(t * 3.3) > .72; spark.visible = on; spark.scale.setScalar(.15 + Math.random() * .3); });
  put(g, pb, 285, R - .08, 1.5); clues.powerbus = beaconAt(pb, 0, .9, .1);
  // service ledger floating near the ceiling pipes, ahead-right
  const led = grp(box(.5, .66, .02, std(0x7a5a3a, .8, 0)), at(plane(.44, .56, new THREE.MeshBasicMaterial({ map: screenTex(['SERVICE LEDGER', '----------------', 'system      days', 'Reactor      ??', 'Coolant      ??', 'Antenna      ??', '', 'most recent first'], { w: 320, h: 408, bg: '#f4efe2', fg: '#2a241b', size: 23 }) })), 0, -.03, .012), at(box(.2, .06, .04, std(0x8a9099, .3, .9)), 0, .31, .015));
  aim(g, led, 35, 2.0, 2.72); floaty(env, led, .04, .5); clues.ledger = beaconAt(led, .3, .36, .02);
  // tool check-out board at your feet, behind-left
  const tb = new THREE.Group(); tb.add(box(1.1, .7, .04, std(0xb5683c, .8, .1)));
  const toolM = std(0xcfd6de, .25, 1); for (let i = 0; i < 5; i++) { const x = -.42 + i * .21; const wr = grp(at(box(.03, .34, .012, toolM), 0, 0, 0), at(tor(.035, .012, toolM, 10, 4.6), 0, .19, 0), at(tor(.028, .01, toolM, 10), 0, -.19, 0)); wr.position.set(x, .02, .03); wr.rotation.z = rr(-.5, .5); tb.add(wr); tb.add(at(labelPlate(pickOf(['T. REINHOLT', 'D. ACHEBE', 'O. BRENNAN', 'K. MORIKAWA', '???']), .18, .05, '#f4efe2', '#2a241b'), x, -.28, .022)); }
  tb.add(at(labelPlate('TOOL CHECK-OUT  (A-Z)', .8, .08, '#14161a', '#f2c230'), 0, .29, .022));
  put(g, tb, 218, 1.75, .36); tb.rotation.order = 'YXZ'; tb.rotation.x = -.95; clues.toolboard = beaconAt(tb, 0, .44, .03);
  const h = hatch(env, { sign: 'HATCH 04  ▸  COMMAND BRIDGE', code: 'H-04', color: 0x4fd8ff }); put(g, h.obj, 150, R - .07, 1.45);
  // pipes, valves, steam, drums, workbench, beacon
  const pm = [std(0x8a5a2b, .5, .7), std(0x59646a, .4, .9), std(0x2d5a8c, .5, .6), std(0xb8a03a, .5, .6)];
  for (let i = 0; i < 5; i++) g.add(ringPipe(R - .2 - i * .12, 2.5 + (i % 3) * .14, .035 + (i % 2) * .02, pm[i % 4], 130 + i * 9, 420 - i * 7));
  for (const dg of [0, 30, 195, 255, 330]) { g.add(pipe([pol(dg, R - .16, .05), pol(dg, R - .18, 1.4), pol(dg + 2, R - .22, 2.5)], .05, pickOf(pm))); put(g, valve(pickOf([0xc0392b, 0xf2c230, 0x2d7d46])), dg, R - .28, rr(1.0, 1.5)); }
  for (const dg of [0, 255]) { for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: MIST(), transparent: true, opacity: .2, depthWrite: false })); g.add(s); const ph = i / 5, b = pol(dg + 2, R - .5, 2.45); env.anim.push(t => { const k = (t * .35 + ph) % 1; s.position.set(b[0] * (1 - k * .08), b[1] - k * .2 + k * k * .5, b[2] * (1 - k * .08)); s.scale.setScalar(.15 + k * .7); s.material.opacity = .22 * (1 - k); }); } }
  for (let i = 0; i < 3; i++) { const dr = grp(cyl(.24, .24, .7, std(pickOf([0x2d5a8c, 0x3d6b3a, 0x8a2f2f]), .5, .5), 20), at(tor(.245, .015, std(0x1a1d22), 20), 0, .2, 0, Math.PI / 2), at(tor(.245, .015, std(0x1a1d22), 20), 0, -.2, 0, Math.PI / 2), at(labelPlate('COOLANT', .26, .08, '#f2c230', '#14161a'), 0, 0, .245)); put(g, dr, 20 + i * 11, R - .45 - (i % 2) * .25, .35); }
  const wb = grp(at(box(1.5, .06, .6, std(0x59646a, .4, .8)), 0, .9, 0), at(box(.06, .9, .06, std(0x2a3038)), -.7, .45, .25), at(box(.06, .9, .06, std(0x2a3038)), .7, .45, .25), at(box(1.5, .5, .04, std(0x2a3038, .5, .7)), 0, 1.25, -.28), at(box(.3, .12, .2, std(0xc0392b, .5, .4)), -.4, .99, 0), at(cyl(.05, .05, .2, std(0xf2c230, .5, .3), 12), .2, 1.03, .05), at(box(.4, .02, .26, std(0x1a1d22)), .45, .94, .05));
  wb.add(at(ledBank(env, 1.3, .3, 60, [0xff8a3d, 0x4fd8ff, 0x5fe3a1]), 0, 1.3, -.255)); model('workbench', wb); put(g, wb, 250, R - .45, 0);
  const bc = grp(cyl(.09, .09, .12, glow(0xff3b2e, 1.5), 16), at(cyl(.11, .11, .04, std(0x2a3038), 16), 0, .08, 0)); bc.position.set(0, H - .12, 0); g.add(bc); const bl = new THREE.PointLight(0xff3b2e, 0, 6, 1.5); bl.position.set(0, H - .4, 0); g.add(bl); env.anim.push(t => { const k = Math.max(0, Math.sin(t * 2.4)); bc.children[0].material.color.setHex(0xff3b2e).multiplyScalar(.3 + 1.6 * k); bl.intensity = 5 * k; });
  put(g, display(.8, .46, [{ t: 'REACTOR', b: 1 }, 'core temp  612 K', 'output      94 %', { bar: .94, c: '#58c8ff' }, { t: 'COOLANT DEGRADED', c: '#ffb347' }], { fg: '#ff8a3d' }), 60, R - .04, 1.8);
  put(g, display(.8, .46, ['POWER DRAW  kW', { graph: 2.4, c: '#ff8a3d' }, { graph: 1.1, c: '#4fd8ff' }, { t: 'SHED LOAD NOW', c: '#ff6b5e', b: 1 }], { fg: '#ff8a3d' }), 330, R - .04, 1.8);
  put(g, fan(env, .3, 9), 195, R - .03, 2.2); put(g, fan(env, .3, 8), 0, R - .03, 2.75);
  return { clues, hatch: h };
};

/* ---- 5. Command Bridge: navy and cyan, Earth in the windows ---- */
ROOMS.r5 = (g, env) => {
  const win = { win: [.07, .1, .86, .46] };
  const pal = { base: '#27323f', top: '#34414f', accent: '#4fd8ff', ink: 'rgba(150,220,255,.5)', seed: 71, rib: 0x141a22, strip: 0x4fd8ff, light: 0xcfeaff, lightK: .9, cable: 0x2d5a8c, frame: '#10151c',
    floor: { base: '#1c232c', accent: '#4fd8ff', tag: 'COMMAND BRIDGE' }, ceil: { base: '#222a34', accent: '#4fd8ff' }, facets: { 10: win, 11: win, 0: win, 1: win, 2: win }, rails: [[120, 135]] };
  shell(g, pal); lights(g, { sky: 0xbfe2ff, ground: 0x0b1018, hemi: .8, points: [[0x8fd8ff, 12, 0, 2.7, 0], [0x4fd8ff, 7, 0, 1.2, -2.4], [0xffb347, 5, -1.6, 1.4, 1.8], [0xff5a4d, 4, 2.6, 1.6, 0]] });
  const clues = {};
  // ring of consoles under the forward windows (the terminal bay at deg 0 stays clear)
  const texts = [[{ t: 'NAVIGATION', b: 1 }, 'alt     408 km', 'incl    51.6 deg', { graph: 1.7 }], [{ t: 'ATTITUDE', b: 1 }, 'pitch   +0.2', 'yaw     -1.1', { bar: .5 }], [{ t: 'COMMS', b: 1 }, { t: 'ANTENNA OFFLINE', c: '#ff6b5e' }, 'ground   no link', { graph: 3 }], [{ t: 'LIFE SUPPORT', b: 1 }, 'O2     20.7 %', { bar: .78, c: '#5fe3a1' }, 'scrubbers  7']];
  [300, 330, 30, 60].forEach((dg, i) => put(g, console_(env, 1.5, texts[i], { seed: 20 + i, fg: '#4fd8ff' }), dg, R - .5, 0));
  for (const dg of [300, 330, 30, 60]) put(g, ledBank(env, 1.4, .1, 40, [0x4fd8ff, 0x5fe3a1, 0xffb347]), dg, R - .16, 1.62);
  // hatch log console: right side, security station in red
  const sec = console_(env, 1.5, [{ t: 'HATCH SECURITY', b: 1 }, { t: '03:33 DENIED  Galley', c: '#ff6b5e' }, { t: '03:27 DENIED  Hydro', c: '#ff6b5e' }, { t: '03:24 DENIED  Crew Q', c: '#ff6b5e' }, { t: '... who, and when?', c: '#ffb347' }], { seed: 9, fg: '#ff8a7e', bg: '#1a0707', title: null });
  const rl = sph(.05, glow(0xff3b2e, 1.6)); rl.position.set(.62, 1.6, -.2); sec.add(rl); env.anim.push(t => rl.material.color.setHex(0xff3b2e).multiplyScalar(Math.sin(t * 5) > 0 ? 1.8 : .25));
  put(g, sec, 95, R - .5, 0); clues.hatchconsole = beaconAt(sec, 0, 1.62, -.2);
  // commander's chair: directly behind you, facing forward
  const ch = new THREE.Group(), cm = std(0x1f2731, .6, .4), pad = std(0x3a4654, .9, 0);
  ch.add(at(cyl(.3, .36, .12, cm, 20), 0, .06, 0), at(cyl(.07, .07, .4, std(0x8a9099, .3, .9)), 0, .3, 0), at(box(.6, .12, .6, pad), 0, .55, 0), at(box(.6, .95, .12, pad), 0, 1.05, -.3, -.12), at(box(.34, .2, .12, pad), 0, 1.62, -.37, -.12));
  for (const s of [-1, 1]) ch.add(at(box(.1, .06, .5, cm), s * .36, .8, .02), at(box(.08, .25, .08, cm), s * .36, .67, -.15));
  ch.add(at(box(.5, .02, .02, std(0x4fd8ff, .5, .2, { emissive: 0x1a6f8a })), 0, 1.5, -.235, -.12), at(box(.02, .8, .02, std(0x10151c)), -.15, 1.05, -.232, -.12), at(box(.02, .8, .02, std(0x10151c)), .15, 1.05, -.232, -.12));
  const arm = tablet(.3, .2, ['WHO IS AWAKE?', '', 'shift: Night', 'sort: A-Z'], { fg: '#ffb347', size: 44, w: 512 }); arm.position.set(.36, .9, .22); arm.rotation.x = -1.0; ch.add(arm);
  model('commander_chair', ch); put(g, ch, 180, 1.45, 0); clues.chair = beaconAt(ch, .36, 1.05, .22);
  // station hologram overhead, behind-left: look up
  const holo = new THREE.Group(), hm = new THREE.MeshBasicMaterial({ color: 0x4fd8ff, wireframe: true, transparent: true, opacity: .75, toneMapped: false }), ho = new THREE.MeshBasicMaterial({ color: 0xff8a3d, wireframe: true, toneMapped: false });
  const hmodel = new THREE.Group(); hmodel.add(new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .8, 10, 3), hm)); for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .18, 10, 1), i === 1 || i === 3 ? ho : hm); m.position.y = -.36 + i * .18; m.scale.setScalar(1.25); hmodel.add(m); }
  const tr = new THREE.Mesh(new THREE.BoxGeometry(1.2, .03, .03, 6, 1, 1), hm); hmodel.add(tr); for (const s of [-1, 1]) for (const z of [-1, 1]) { const pn = new THREE.Mesh(new THREE.PlaneGeometry(.2, .42, 2, 4), s * z > 0 ? hm : ho); pn.rotation.x = Math.PI / 2; pn.position.set(s * .48, 0, z * .26); hmodel.add(pn); }
  hmodel.rotation.z = .5; holo.add(hmodel); const baseR = tor(.34, .02, glow(0x4fd8ff, 1.4), 32); baseR.rotation.x = Math.PI / 2; baseR.position.y = .62; holo.add(baseR, at(cyl(.3, .36, .08, std(0x1f2731, .5, .7), 24), 0, .68, 0));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.6, 1.1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: .06, side: THREE.DoubleSide, depthWrite: false })); cone.position.y = .08; holo.add(cone);
  env.anim.push((t, dt) => { hmodel.rotation.y += dt * .5; ho.color.setHex(0xff8a3d).multiplyScalar(.6 + .6 * Math.abs(Math.sin(t * 3))); });
  holo.position.set(...pol(215, 1.0, H - .75)); g.add(holo); clues.holomap = beaconAt(holo, 0, -.52, 0);
  const h = hatch(env, { sign: 'POD BAY  ·  BONUS', code: 'H-05', color: 0xffb347, tunnel: '#ffd08a' }); put(g, h.obj, 250, R - .07, 1.45);
  // star chart wall, comms racks, floor light ring, overhead frame
  put(g, display(1.5, .9, [{ t: 'ORBIT TRACK', b: 1 }, { graph: .9 }, { graph: .9, c: '#ffb347' }, 'next sunrise  00:21:10', { t: 'LOCKDOWN: OVERRIDE REQUIRED', c: '#ff6b5e', b: 1 }], { fg: '#4fd8ff', w: 800, h: 480, size: 34 }), 150, R - .04, 1.7);
  put(g, display(.8, .46, [{ t: 'CREW STATUS', b: 1 }, 'aboard     14', 'awake       ?', { bar: .43, c: '#ffb347' }], { fg: '#4fd8ff' }), 210, R - .04, 2.7);
  const rack = grp(box(.9, 2.2, .4, std(0x1a2028, .5, .7))); rack.add(at(ledBank(env, .7, 1.8, 160, [0x4fd8ff, 0x5fe3a1, 0xffb347, 0xff5a4d]), 0, 0, .205)); for (let i = 0; i < 6; i++) rack.add(at(box(.8, .012, .01, std(0x3a4654)), 0, -.9 + i * .36, .206)); put(g, rack, 280, R - .32, 1.15);
  const fr = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.56, 64), glow(0x4fd8ff, 1.1)); fr.rotation.x = -Math.PI / 2; fr.position.y = .012; g.add(fr);
  const cr = tor(1.3, .04, std(0x141a22, .4, .8), 48); cr.rotation.x = Math.PI / 2; cr.position.y = H - .25; g.add(cr); const cr2 = tor(1.3, .012, glow(0x4fd8ff, 1.2), 48); cr2.rotation.x = Math.PI / 2; cr2.position.y = H - .3; g.add(cr2);
  for (const dg of [315, 345, 15, 45]) put(g, at(box(.1, .1, 1.7, std(0x141a22, .4, .8)), 0, 0, 0, .0), dg, R - .1, H - .22).rotation.z = Math.PI / 2;
  return { clues, hatch: h };
};

/* ---- Bonus. Pod Bay: white, hazard yellow, emergency red ---- */
ROOMS.rb = (g, env) => {
  const pal = { base: '#b8bdc2', top: '#d5d9dc', accent: '#f2c230', seed: 97, rib: 0x30363d, strip: 0xff5a4d, light: 0xffd6d0, lightK: 1.0, cable: 0xf2c230,
    floor: { base: '#3a4048', accent: '#f2c230', hazard: true, tag: 'POD BAY' }, ceil: { base: '#7c838a', accent: '#ff5a4d' }, facets: { 8: { win: [.2, .18, .6, .34] }, 9: { win: [.2, .18, .6, .34] }, 10: { win: [.2, .18, .6, .34] } }, rails: [[40, 60], [120, 140]] };
  shell(g, pal); lights(g, { sky: 0xf2e6e2, ground: 0x1c2026, hemi: .6, points: [[0xffe9e0, 6, 0, 2.7, 0], [0xff5a4d, 5, 0, 1.4, 2.2], [0xf2c230, 3, 2.2, 1.2, 0], [0x9fc6ff, 3, -2.4, 1.6, 0]] });
  const clues = {};
  // the escape pod hatch: big, behind you, with glove marks and a pod visible through the port
  const ph = new THREE.Group(), dk = std(0x2a3038, .45, .8);
  ph.add(at(cyl(1.15, 1.15, .14, dk, 44), 0, 0, 0, Math.PI / 2)); const dr = at(new THREE.Mesh(new THREE.CircleGeometry(.98, 44), new THREE.MeshStandardMaterial({ roughness: .5, metalness: .5, map: ctex(512, 512, (c, w) => { c.fillStyle = '#d7dbde'; c.fillRect(0, 0, w, w); rnd = mulberry(3); noise(c, w, w, 5000, .07); c.strokeStyle = '#f2c230'; c.lineWidth = 34; c.beginPath(); c.arc(256, 256, 215, 0, 7); c.stroke(); c.strokeStyle = '#14161a'; c.lineWidth = 34; c.setLineDash([30, 30]); c.beginPath(); c.arc(256, 256, 215, 0, 7); c.stroke(); c.setLineDash([]); c.fillStyle = '#b3261e'; c.font = '700 56px system-ui'; c.textAlign = 'center'; c.fillText('ESCAPE POD 1', 256, 150); c.font = '700 26px system-ui'; c.fillStyle = '#14161a'; c.fillText('EMERGENCY USE ONLY', 256, 400); for (let i = 0; i < 9; i++) { c.fillStyle = 'rgba(40,30,20,.16)'; c.beginPath(); c.ellipse(330 + rr(-50, 50), 270 + rr(-60, 60), 26, 12, rr(-1, 1), 0, 7); c.fill(); } }) })), 0, 0, .075); ph.add(dr);
  ph.add(at(new THREE.Mesh(new THREE.CircleGeometry(.26, 28), glow(0xffd08a, 1.1)), 0, .0, .115), at(tor(.27, .04, std(0xb8bec8, .3, .9), 28), 0, 0, .12));
  const wheel = grp(tor(.42, .03, std(0xc0392b, .4, .5), 32)); for (let i = 0; i < 4; i++) wheel.add(at(box(.84, .03, .03, std(0xc0392b, .4, .5)), 0, 0, 0, 0, 0, i * Math.PI / 4)); wheel.position.z = .2; wheel.scale.setScalar(.78); ph.add(wheel); env.anim.push(t => { wheel.rotation.z = Math.sin(t * .4) * .08; });
  for (let i = 0; i < 16; i++) { const b = cyl(.035, .035, .06, std(0x8a9099, .3, .9), 8); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(i * Math.PI / 8) * 1.07, Math.sin(i * Math.PI / 8) * 1.07, .08); ph.add(b); }
  ph.add(at(labelPlate('WHO WAS HERE LAST?', 1.2, .14, '#14161a', '#ffb347'), 0, 1.33, .05));
  put(g, ph, 180, R - .09, 1.45); clues.podhatch = beaconAt(ph, 0, 1.5, .1);
  // EVA suit rack on the right; one suit half-prepped
  const rack = new THREE.Group(), white = std(0xeef0ee, .85, .05);
  rack.add(at(box(2.3, .08, .5, std(0x59646a, .4, .8)), 0, 2.5, 0), at(box(2.3, .1, .6, std(0x59646a, .4, .8)), 0, .05, 0));
  [-0.72, 0, .72].forEach((x, i) => {
    const s = new THREE.Group(); s.add(at(cap(.22, .5, white), 0, 1.35, 0), at(sph(.2, white, 18, 14), 0, 1.98, 0), at(sph(.15, new THREE.MeshStandardMaterial({ color: 0xd9a12b, roughness: .25, metalness: .5, emissive: 0x6b4a10 }), 16, 12), 0, 1.98, .09), at(box(.36, .5, .2, std(0xd5d9dc, .7, .2)), 0, 1.42, -.2));
    for (const sd of [-1, 1]) { s.add(at(cap(.08, .5, white), sd * .32, 1.38, 0, 0, 0, sd * .18), at(cap(.1, .55, white), sd * .12, .62, 0), at(box(.14, .1, .26, std(0x8a9099, .6, .3)), sd * .12, .22, .04), at(sph(.085, std(0x8a9099, .7, .2), 10, 8), sd * .37, 1.05, 0)); }
    s.add(at(box(.22, .14, .04, std(0x1a2028)), 0, 1.48, .21), at(plane(.16, .08, glow(i === 1 ? 0xffb347 : 0x5fe3a1, 1.2)), 0, 1.48, .233), at(box(.1, .03, .01, std(0xb3261e)), -.12, 1.68, .2));
    s.add(at(cyl(.012, .012, .4, std(0x8a9099, .3, .9), 8), 0, 2.3, 0)); s.position.x = x; rack.add(s);
    if (i === 1) { s.add(at(cyl(.07, .07, .4, std(0x2d7d46, .4, .6), 14), .3, .5, .3, 0, 0, .3), at(crate(.3, .2, .22, 0xf1f1ea, '+ MED'), -.32, .22, .34)); }
  });
  model('eva_suit_rack', rack); put(g, rack, 90, R - .42, 0); clues.suitrack = beaconAt(rack, 0, 2.62, .2);
  // oxygen racks, tool cart, launch rails, rotating warning lights, pod window
  const o2 = new THREE.Group(); o2.add(at(box(1.5, .06, .4, std(0x59646a, .4, .8)), 0, .05, 0), at(box(1.5, .04, .06, std(0x59646a, .4, .8)), 0, .8, .18)); for (let i = 0; i < 6; i++) { o2.add(at(cyl(.1, .1, 1.1, std(i % 2 ? 0x2d7d46 : 0xdfe5e8, .4, .6), 16), -.6 + i * .24, .65, 0), at(sph(.1, std(i % 2 ? 0x2d7d46 : 0xdfe5e8, .4, .6), 14, 8), -.6 + i * .24, 1.2, 0), at(cyl(.03, .03, .1, std(0xb8a03a, .3, .9), 8), -.6 + i * .24, 1.33, 0)); } o2.add(at(labelPlate('O2  ·  12 TANKS', .7, .09, '#2d7d46', '#ffffff'), 0, .45, .11)); put(g, o2, 40, R - .35, 0);
  const cart = grp(at(box(.7, .5, .45, std(0xc0392b, .5, .4)), 0, .5, 0), at(box(.74, .03, .49, std(0x2a3038)), 0, .76, 0)); for (let i = 0; i < 3; i++) cart.add(at(box(.6, .12, .02, std(0x8f2a20, .5, .4)), 0, .34 + i * .15, .235), at(box(.2, .02, .03, std(0xcfd6de, .3, .9)), 0, .34 + i * .15, .25)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) cart.add(at(cyl(.05, .05, .04, std(0x15181d), 12), sx * .28, .05, sz * .18, 0, 0, Math.PI / 2), at(box(.03, .22, .03, std(0x2a3038)), sx * .28, .16, sz * .18)); model('tool_cart', cart); put(g, cart, 135, R - .7, 0, .3);
  for (const s of [-1, 1]) { const rl = box(.08, .08, 6.2, std(0xf2c230, .5, .4)); rl.position.set(s * .5, H - .1, 0); g.add(rl); }
  for (const dg of [0, 120, 240]) { const wl = grp(cyl(.07, .07, .1, glow(0xff3b2e, 1.5), 14), at(cyl(.09, .09, .03, std(0x2a3038), 14), 0, -.06, 0)); wl.position.set(...pol(dg + 60, 2.2, H - .1)); g.add(wl); env.anim.push(t => wl.children[0].material.color.setHex(0xff3b2e).multiplyScalar(.3 + 1.5 * Math.max(0, Math.sin(t * 3 + dg)))); }
  put(g, display(.9, .5, [{ t: 'POD 1 · READY', b: 1, c: '#5fe3a1' }, 'launcher   ONLINE', 'seats      4', { t: '03:13 DENIED', c: '#ff6b5e' }, { t: '02:58 OPEN', c: '#ffb347' }], { fg: '#ffd6d0' }), 215, R - .04, 1.75);
  put(g, display(.9, .5, [{ t: 'AIRLOCK', b: 1 }, 'pressure  101 kPa', { bar: .98, c: '#5fe3a1' }, 'outer door SEALED'], { fg: '#ffd6d0' }), 330, R - .04, 1.8);
  const helmet = grp(sph(.2, std(0xeef0ee, .8, .05), 18, 14), at(sph(.15, new THREE.MeshStandardMaterial({ color: 0xd9a12b, roughness: .25, metalness: .5, emissive: 0x6b4a10 }), 16, 12), 0, 0, .09)); helmet.position.set(...pol(300, 1.9, 1.7)); g.add(helmet); floaty(env, helmet, .06, .4, .3);
  const hz = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 48), new THREE.MeshBasicMaterial({ map: hazardTex() })); hz.rotation.x = -Math.PI / 2; hz.position.y = .011; g.add(hz);
  return { clues, hatch: null };
};
