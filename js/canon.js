// Shared by the build script (Node) and the browser. Result fingerprinting so no answers are stored in the clear.
const enc = new TextEncoder();
export function cell(v) {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
export async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function fingerprint(salt, pid, rows, ncols) {
  const lines = rows.map(r => r.map(cell).join('␟'));
  const ordered = await sha(salt + '|' + pid + '|O|' + lines.join('␞'));
  const unordered = await sha(salt + '|' + pid + '|U|' + lines.slice().sort().join('␞'));
  const cols = [];
  for (let i = 0; i < ncols; i++)
    cols.push((await sha(salt + '|' + pid + '|C|' + rows.map(r => cell(r[i])).sort().join('␞'))).slice(0, 24));
  return { ordered, unordered, cols };
}
// returns {pass, reason, ...detail}
export async function check(salt, pid, exp, ncols, rows) {
  if (ncols !== exp.ncols) return { pass: false, reason: 'ncols', want: exp.ncols, got: ncols };
  if (rows.length !== exp.nrows) return { pass: false, reason: rows.length > exp.nrows ? 'toomany' : 'toofew', got: rows.length };
  const f = await fingerprint(salt, pid, rows, ncols);
  const bad = []; f.cols.forEach((h, i) => { if (h !== exp.cols[i]) bad.push(i + 1); });
  if (bad.length) {
    const same = f.cols.slice().sort().join() === exp.cols.slice().sort().join();
    return same ? { pass: false, reason: 'colorder' } : { pass: false, reason: 'cols', bad };
  }
  if (f.unordered !== exp.unordered) return { pass: false, reason: 'values' };
  if (exp.ordered && f.ordered !== exp.ordered_hash) return { pass: false, reason: 'order' };
  return { pass: true };
}
