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

// support.html carries no versioned asset, but its feedback mailto reads this
// meta so a bug report says which build it came from. Rewriting the whole
// content attribute (not just the CACHEBUST token) keeps it idempotent — after
// the first build there is no token left to match.
const supportFile = 'public/support.html';
const support = fs.readFileSync(supportFile, 'utf8');
const supportTag = /(<meta name="build" content=")[^"]*(">)/;
if (!supportTag.test(support)) {
  console.error(`cachebust: no <meta name="build"> in ${supportFile} — feedback would report build "dev"`);
  process.exit(1);
}
fs.writeFileSync(supportFile, support.replace(supportTag, `$1${hash}$2`));
console.log(`cachebust: stamped ${hash} in ${supportFile}`);
