// Write pst, feature and search lines into the defaults in naddu.js, so a match can test them:
//   node tooling/apply.js tuned.txt && ./tooling/match.sh
// The lines are what the tuner and walk examples print, e.g.
//   pst n mg <64 values a1..h8>      feature tempo 12      feature mat eg <5 values>
//   feature smother mg <4 values>    search lmr <5 values>
// White's tables (wn) are the defaults too, black is the mirror; black's tables and per colour
// material (bn, wmat, bmat) are skipped. Other lines are ignored.

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'naddu.js');
let src = fs.readFileSync(file, 'utf8');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');

const TABLES = {p: 'PAWN', n: 'KNIGHT', b: 'BISHOP', r: 'ROOK', q: 'QUEEN', k: 'KING'};
const COUNTS = {tempo: 1, phase: 4, shelter: 4, mopup: 3, mat: 5, smother: 4, cuddle: 4,
                rfp: 2, nullmove: 3, futility: 2, lmr: 5, aspiration: 3, time: 5};
let applied = 0;

// replace with a check that the pattern was found exactly once
function replace(re, text, what) {
  const m = src.match(re);
  if (!m || m.length !== 1) {
    console.log('cannot find ' + what + ' in naddu.js');
    process.exit(1);
  }
  src = src.replace(re, text);
  applied++;
}

function ints(tokens, n, what) {
  if (tokens.length !== n) {
    console.log(what + ' takes ' + n + ' values, skipped');
    return null;
  }
  for (let i = 0; i < n; i++) {
    if (!/^-?\d+$/.test(tokens[i])) {
      console.log(what + ': bad value ' + tokens[i] + ', skipped');
      return null;
    }
  }
  return tokens.join(', ');
}

for (let li = 0; li < lines.length; li++) {
  const t = lines[li].trim().toLowerCase().split(/\s+/);
  if (t[0] === 'pst' && (t[2] === 'mg' || t[2] === 'eg')) {
    if (t[1].length === 2 && t[1][0] === 'w')
      t[1] = t[1][1];
    if (!TABLES[t[1]]) {
      console.log(lines[li].slice(0, 20) + ': black tables are the mirror of white, skipped');
      continue;
    }
    const v = t.slice(3);
    if (!ints(v, 64, 'pst ' + t[1] + ' ' + t[2]))
      continue;
    let rows = '';
    for (let rank = 0; rank < 8; rank++) {
      rows += ' ';
      for (let f = 0; f < 8; f++)
        rows += String(v[rank * 8 + f]).padStart(5) + ',';
      rows += '   0, 0, 0, 0, 0, 0, 0, 0,\n';
    }
    const name = TABLES[t[1]] + '_' + t[2].toUpperCase();
    replace(new RegExp('const ' + name + ' = new Int16Array\\(\\[[\\s\\S]*?\\]\\);', 'g'),
            'const ' + name + ' = new Int16Array([\n' + rows + ']);', name);
  }
  else if (t[0] === 'feature' && (t[1] === 'mat' || t[1] === 'smother' || t[1] === 'cuddle') && (t[2] === 'mg' || t[2] === 'eg')) {
    const v = ints(t.slice(3), COUNTS[t[1]], t.slice(0, 3).join(' '));
    if (!v)
      continue;
    if (t[1] === 'mat') {
      const re = /const DEF_MAT = \[\[([^\]]*)\], \[([^\]]*)\]\];/g;
      const m = re.exec(src);
      replace(re, 'const DEF_MAT = [[' + (t[2] === 'mg' ? v : m[1]) + '], [' + (t[2] === 'eg' ? v : m[2]) + ']];', 'DEF_MAT');
    }
    else {
      const re = new RegExp('(\\n\\s*' + t[1] + ':\\s*\\[\\[\\w+, \\w+\\], \\w+, )\\[\\[([^\\]]*)\\], \\[([^\\]]*)\\]\\]', 'g');
      const m = re.exec(src);
      replace(re, m[1] + '[[' + (t[2] === 'mg' ? v : m[2]) + '], [' + (t[2] === 'eg' ? v : m[3]) + ']]', t[1] + ' in PHASED');
    }
  }
  else if ((t[0] === 'feature' || t[0] === 'search') && COUNTS[t[1]] && t[1] !== 'mat' && t[1] !== 'smother' && t[1] !== 'cuddle') {
    const v = ints(t.slice(2), COUNTS[t[1]], t[0] + ' ' + t[1]);
    if (!v)
      continue;
    replace(new RegExp('(\\n\\s*' + t[1] + ':\\s*\\[\\w+, \\w+, )\\[[^\\]]*\\]', 'g'), '$1[' + v + ']', t[1] + ' in ' + (t[0] === 'feature' ? 'FEATURES' : 'SEARCHES'));
  }
  else if (t[0] === 'feature' && (t[1] === 'wmat' || t[1] === 'bmat')) {
    console.log(lines[li].slice(0, 20) + ': per colour material is not a default, skipped');
  }
}

fs.writeFileSync(file, src);
require('child_process').execFileSync('node', [file, 'q']);
console.log(applied + ' defaults written to naddu.js, syntax ok');
