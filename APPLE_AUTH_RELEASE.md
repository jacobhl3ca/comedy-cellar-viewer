# Tonight NYC Apple account release gate

Status: implemented and tested locally on 2026-08-05; not configured or released.

## Behavior

- Anonymous use remains the default; local favorites and settings keep working.
- Sign in with Apple creates a signed, HttpOnly, 90-day session.
- `cellar-tonight-prefs` and `tonight-nyc-settings` sync through authenticated endpoints.
- Redis stores only a server-derived user key, the Apple-provided email/relay address, timestamps, and the sync payload.
- Each update retains the preceding server copy for 30 days. A local backup is also written before a remote setup replaces this device's setup.
- Settings provides sign-out and permanent server-side account deletion.

## Apple setup still required

The registered bundle `com.jacobhl.tonightnyc` currently has only In-App Purchase enabled. In Certificates, Identifiers & Profiles:

1. Open the Tonight NYC App ID.
2. Enable Sign in with Apple.
3. Configure it consistently with the existing shared Services ID `com.jacobhl.web.signin` and its primary App ID, so web and native tokens resolve to the same Apple user.
4. Save. Automatic signing must then regenerate the affected provisioning profile.

The Services ID already needs `tonightnyc.com` and `https://tonightnyc.com/api/auth/apple/callback` in its website configuration. Confirm those entries before release.

## Vercel configuration still required

Set these as Production secrets without writing values into the repository:

- `APPLE_SERVICES_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `SESSION_SECRET`
- `APPLE_APP_BUNDLE_ID=com.jacobhl.tonightnyc`
- `APP_ORIGIN=https://tonightnyc.com`

The existing Upstash `KV_REST_API_URL` and `KV_REST_API_TOKEN` back account records and sync data. Until Apple and Redis are both configured, `/api/me` reports Apple unavailable and the UI remains inert.

## Acceptance checks before release

1. Web: complete a real Apple login, reload, sign out, and sign back in.
2. Native: use the Face ID Apple sheet and verify its session lands inside the app WebView.
3. Sync: change a favorite and a setting on device A; verify device B receives both on resume.
4. Authority/deletion: prove account B cannot read account A, then delete account A in-app and verify its current, previous, and user Redis keys are gone.
5. Recovery: export the account keyspace, restore it to a disposable store, and verify a synced setup can be read there.

App Store submission also requires updating the App Privacy answers from “Data Not Collected” to disclose the optional Apple identifier/email and synced preferences. App Privacy is not exposed by the App Store Connect API, so that one disclosure is a manual portal step.
