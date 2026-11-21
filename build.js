// node build.js : assemble app.html + data.js + recognize.js + solver.js en un seul fichier
// docs/index.html (publié par GitHub Pages ; partageable tel quel, marche hors ligne et depuis un fichier).
'use strict';
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let html = read('app.html');
for (const [mark, file] of [['/*__DATA__*/', 'data.js'], ['/*__RECOGNIZE__*/', 'recognize.js'], ['/*__SOLVER__*/', 'solver.js']]) {
  const src = read(file);
  if (src.includes('</script')) throw new Error(file + ' contient </script>');
  if (!html.includes(mark)) throw new Error('marqueur absent : ' + mark);
  html = html.replace(mark, () => src);
}
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
const out = path.join(__dirname, 'docs', 'index.html');
fs.writeFileSync(out, html);
console.log(out, Math.round(html.length / 1024) + ' Ko');
