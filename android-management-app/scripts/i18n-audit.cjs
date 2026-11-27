const fs = require('fs');
const path = require('path');

const used = new Map();
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales') walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const re = /\bt\(\s*'([a-zA-Z][\w.]*)'/g;
    let m;
    while ((m = re.exec(src))) {
      if (!used.has(m[1])) used.set(m[1], p + ':' + (src.slice(0, m.index).split('\n').length));
    }
  }
};
walk('src');

const langs = ['en', 'fr', 'ar'];
const have = {};
const leafSet = (o, p = []) => {
  let out = new Set();
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') out = new Set([...out, ...leafSet(v, [...p, k])]);
    else out.add([...p, k].join('.'));
  }
  return out;
};
for (const l of langs) have[l] = leafSet(JSON.parse(fs.readFileSync(`src/locales/${l}/translation.json`, 'utf8')));

const missing = {};
for (const key of used.keys()) for (const l of langs) if (!have[l].has(key)) (missing[l] ||= []).push(key);
for (const l of langs) console.log(`${l}: ${missing[l] ? missing[l].length : 0} used-but-missing`);
const all = [...new Set(langs.flatMap((l) => missing[l] || []))];
console.log('\nkeys needing translations (' + all.length + '):');
console.log(all.map((k) => k + '   [' + used.get(k) + ']').join('\n'));
const unusedForEn = [...have.en].filter((k) => !used.has(k));
console.log('\ndefined-in-en-but-not-used-by-t(): ' + unusedForEn.length);
console.log(unusedForEn.slice(0, 40).join(' | '));
