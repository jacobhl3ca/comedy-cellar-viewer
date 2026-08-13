// Universal / app links association files.
//
// Served from an API route rather than as static files under public/.well-known/
// because Apple requires `Content-Type: application/json` on a file with no
// extension, and a static host has no way to know that. It must be a REWRITE in
// vercel.json, never a redirect — Apple's CDN does not follow redirects when it
// fetches the AASA, it just records a failure and the link falls back to Safari.
//
// Verify after deploy:
//   curl -sI https://tonightnyc.com/.well-known/apple-app-site-association | grep -i content-type
//   curl -s  https://tonightnyc.com/.well-known/assetlinks.json
//
// Apple caches this through their CDN; force a refresh on a device with
// Settings → Developer → Associated Domains Development, or reinstall the app.

const TEAM_ID = 'V45QZXMDAW';
const BUNDLE_ID = 'com.jacobhl.tonightnyc';
const ANDROID_PACKAGE = 'com.jacobhl.tonightnyc';

// Paths that must stay in the browser even when the app is installed:
//  - /api/*   the OAuth callbacks land here; swallowing them into the app breaks sign-in
//  - /privacy, /support  App Store review has to be able to read these on the web
const APPLE = {
  applinks: {
    apps: [],
    details: [
      {
        appID: `${TEAM_ID}.${BUNDLE_ID}`,
        appIDs: [`${TEAM_ID}.${BUNDLE_ID}`],
        components: [
          { '/': '/api/*', exclude: true, comment: 'auth callbacks stay in the browser' },
          { '/': '/privacy', exclude: true, comment: 'App Store review reads this on the web' },
          { '/': '/support', exclude: true, comment: 'App Store review reads this on the web' },
          { '/': '/*' },
        ],
        // Legacy key for iOS 12 and earlier. Harmless on modern iOS, which reads
        // `components` and ignores this.
        paths: ['NOT /api/*', 'NOT /privacy', 'NOT /support', '*'],
      },
    ],
  },
};

// Google Play re-signs every upload with an app-signing key that is NOT the local
// upload key in ~/.config/hidescore/upload.env, so the fingerprint cannot be derived
// from the repo. Grab it from Play Console → the app → Test and release → App
// integrity → App signing key certificate → SHA-256, and set it as the Vercel env
// var ANDROID_SHA256_FINGERPRINTS (comma-separated if you also want the upload key
// for local debugging). Until it's set this route 404s, which is exactly what the
// site does today — better than publishing a fingerprint that silently never matches.
function androidPayload() {
  const raw = process.env.ANDROID_SHA256_FINGERPRINTS;
  if (!raw) return null;
  const fingerprints = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!fingerprints.length) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

module.exports = (req, res) => {
  const wantsAndroid = (req.query && req.query.file) === 'assetlinks';

  if (wantsAndroid) {
    const payload = androidPayload();
    if (!payload) {
      res.status(404).json({ error: 'ANDROID_SHA256_FINGERPRINTS not configured' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(JSON.stringify(payload));
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(JSON.stringify(APPLE));
};
