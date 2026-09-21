const fs = require('fs');
const path = process.argv[2] || 'src/EskimoLeads.jsx';
let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { console.error("Can't read " + path); process.exit(1); }
if (s.includes('"Closed"')) { console.error('Already patched. No changes made.'); process.exit(1); }
if (!s.includes('"Lost"')) { console.error('ABORT: "Lost" not found.'); process.exit(1); }
const orig = s;
s = s.split('"Lost"').join('"Closed"');
const reps = [
  ['· {lost} lost</>', '· {lost} closed</>'],
  ['· lost shown separately', '· closed shown separately'],
  ['>Lost</div>', '>Closed</div>'],
  ['>Lost</th>', '>Closed</th>'],
  ['Lost is shown apart', 'Closed is shown apart'],
];
for (const [f, r] of reps) { if (s.includes(f)) s = s.replace(f, r); }
fs.writeFileSync(path + '.bak', orig);
fs.writeFileSync(path, s);
console.log('Patched EskimoLeads.jsx — Lost renamed to Closed.');
