// Replace CACHEBUST placeholder in public/index.html with the git short SHA
// (or epoch seconds if git isn't available — same fallback the previous shell pipeline used).
// Replaces the old `sed -i` invocation, which wasn't portable between BSD (macOS) and GNU sed.
const fs = require('fs');
const { execSync } = require('child_process');

let hash;
try {
  hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch {
  hash = String(Math.floor(Date.now() / 1000));
}

const file = 'public/index.html';
const html = fs.readFileSync(file, 'utf8');
// Idempotent: handle both fresh CACHEBUST tokens and a previous hash from a prior build.
const updated = html
  .replace(/CACHEBUST/g, hash)
  .replace(/(app\.min\.js|style\.min\.css)\?v=[A-Za-z0-9]+/g, `$1?v=${hash}`);
fs.writeFileSync(file, updated);
console.log(`cachebust: stamped ${hash} in ${file}`);
