const fs = require('fs');
const path = process.argv[2] || 'src/EskimoLeads.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error(`Can't read ${path} — run from the my-dashboard folder.`); process.exit(1); }
if (s.includes('Unassigned / Other')) { console.error('Already patched. No changes made.'); process.exit(1); }
const edits = [
  { find: '<option value="">Sales &amp; purchasers</option>', repl: '<option value="">All leads</option>' },
  { find: '<option value="Purchasers">Purchasers</option>', repl: '<option value="Purchasers">Purchasers</option>\n          <option value="Unassigned / Other">Unassigned / Other</option>' },
];
for (const e of edits) { const n = s.split(e.find).length - 1; if (n !== 1) { console.error(`ABORT: found ${n} matches (need 1) for: ${e.find.slice(0,45)}`); process.exit(1); } }
fs.writeFileSync(path + '.bak', s);
for (const e of edits) s = s.replace(e.find, e.repl);
fs.writeFileSync(path, s);
console.log('Patched EskimoLeads.jsx — "All leads" + "Unassigned / Other" filter options added.');
