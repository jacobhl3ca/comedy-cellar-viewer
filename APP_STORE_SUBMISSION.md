# Tonight NYC — App Store Submission Pack

Everything you need to copy-paste into App Store Connect for the v1.0 submission.

## Identity
- **App name (max 30 chars):** `Tonight NYC`
- **Subtitle (max 30 chars):** `NYC comedy lineups, your way`
- **Bundle ID:** `com.jacobhl.tonightnyc`
- **Primary category:** Entertainment
- **Secondary category:** Lifestyle
- **Age rating:** 12+ (Infrequent/Mild Profanity, Mature/Suggestive Themes — comedy clubs)

## Description (max 4000 chars)
```
Every NYC comedy show. Filtered your way.

Tonight NYC pulls live lineups from the Comedy Cellar, The Stand, Big Shows at Madison Square Garden, Beacon, Town Hall, and dozens more — all in one app, sorted by what you actually want to see.

WHAT YOU CAN DO:
• Browse tonight's lineups across every NYC comedy venue
• Mark comedians as Favorites or Skips — see "your show" highlighted
• Get notified when your favorite comics are booked in upcoming lineups
• See real-time sold-out status — never tap through to find a closed show
• Browse 800+ comedians with full bios and headshots
• Big Shows tab tracks arena/theater bookings months in advance
• Filter by neighborhood, time, or sold-out availability
• Share your filtered lineup with friends — copy a link with all your picks

NO ACCOUNT REQUIRED.
Your favorites, skips, and notifications stay on your device. No tracking, no signup. Optional email subscription only if you want push-style alerts when a comedian gets booked.

VENUES TRACKED:
Comedy Cellar (MacDougal, Village Underground, Fat Black Pussycat) · The Stand · New York Comedy Club · Gotham Comedy Club · Carolines · Madison Square Garden · Beacon Theatre · Town Hall · Apollo · Gramercy · Sony Hall · Strand Book Store · Radio City · and more via Ticketmaster + SeatGeek.

Built by an NYC comedy fan who got tired of checking 8 different websites every Friday night.
```

## Keywords (max 100 chars, comma-separated)
```
comedy,nyc,standup,comedy cellar,the stand,tickets,lineup,shows,manhattan,bookings
```

## Promotional Text (max 170 chars — can be updated without re-submission)
```
Every NYC comedy lineup in one place. Filter by your favorite comics, hide skips, get notified when they're booked. Updated live from 30+ venues.
```

## What's New in This Version (v1.0)
```
First release.
```

## Support URL
`https://tonightnyc.com/support`

## Marketing URL (optional)
`https://tonightnyc.com`

## Privacy Policy URL
`https://tonightnyc.com/privacy`

## Copyright
`© 2026 Jacob Heifetz Licht`

---

## Privacy Nutrition Labels (App Store Connect → App Privacy)

### Data NOT collected
- Contact info, financial info, location, search history, browsing history,
  user content, sensitive info, health info, contacts.

### Data collected
**Email Address** (optional)
- Used for: App Functionality (notification subscriptions only when user opts in)
- Linked to user: No
- Used for tracking: No

**Identifiers — Device ID** (Vercel Analytics + Speed Insights, no IDFA)
- Used for: Analytics
- Linked to user: No
- Used for tracking: No

**Usage Data — Product Interaction** (Vercel Web Analytics page hits)
- Used for: Analytics
- Linked to user: No
- Used for tracking: No

**Diagnostics — Performance Data** (Vercel Speed Insights)
- Used for: App Functionality, Analytics
- Linked to user: No
- Used for tracking: No

### Tracking
**Does this app track users? NO.**
(Tracking = combining data with third parties for advertising or sharing with data brokers. Vercel Analytics is first-party only.)

---

## Screenshots required

Apple requires at minimum a 6.9" set (iPhone 16/17 Pro Max — 1320 × 2868). Submit 3–10 screenshots in the order you want them displayed in the App Store gallery.

**Recommended order (highest CTR placement first):**
1. `dark-01-all-venues.png` — hero, schedule view with My Comedians filter active
2. `dark-02-comedy-cellar.png` — Cellar tab with comedian photos
3. `dark-03-the-stand.png` — Stand tab
4. `dark-04-big-shows.png` — Big Shows view (Madison Square Garden, Beacon, etc.)
5. `dark-05-comedians-directory.png` — 800+ comedian browse view (proves bio depth)
6. `dark-06-show-detail.png` — expanded show with bio
7. `dark-07-my-comedians.png` — settings modal with rated comedians

To capture:
1. Boot the sim (already booted with Tonight NYC installed): `xcrun simctl launch booted com.jacobhl.tonightnyc`
2. Manually tap to navigate to the view you want
3. From repo root: `./scripts/cap-screenshot.sh dark-02-comedy-cellar` (or whatever name)

---

## Build & Submit (Xcode workflow)

1. **Pull latest web bundle into iOS** (Capacitor uses `server.url` to load https://tonightnyc.com live, so the bundle inside the .ipa is just a fallback — but still sync it):
   ```
   cd "/Users/jacob/Cellar Tonight/comedy-cellar-viewer"
   npm run build
   npx cap sync ios
   ```

2. **Open Xcode**:
   ```
   open ios/App/App.xcworkspace
   ```
   (If only `.xcodeproj` opens, that's fine for this single-target project.)

3. **Set the build target to "Any iOS Device (arm64)"** (top bar device dropdown).

4. **Archive**: Product menu → Archive. Wait ~2 min.

5. **Distribute**: Window → Organizer → select the new archive → Distribute App → App Store Connect → Upload. Xcode handles signing if your team `V45QZXMDAW` has a valid Apple Developer + provisioning profile. If signing fails, run **Automatically manage signing** in the project's Signing & Capabilities tab.

6. **App Store Connect** (https://appstoreconnect.apple.com):
   - Create app: same Bundle ID `com.jacobhl.tonightnyc`, name "Tonight NYC", primary lang English (US)
   - Paste the metadata above into the relevant fields
   - Upload screenshots from `screenshots-app-store/`
   - Fill out App Privacy with the answers above
   - Select build (the one Xcode just uploaded — appears 5–15 min after upload finishes)
   - **Submit for Review**

7. **TestFlight first (recommended for v1.0)**: instead of submitting directly, add yourself as an internal tester first. Validate the live app on a real device for a few days, then promote the build to App Store review.

---

## Post-submit checklist

- [ ] Reply to App Review's automated email if they have questions (usually 24-48h turnaround)
- [ ] Monitor crashes via Xcode → Window → Organizer → Crashes
- [ ] Set up TestFlight feedback form
- [ ] Prepare v1.1 hotfix branch (in case Review surfaces a blocker)

## Known things to mention if Review asks

- **Why is the app loading a website?** Capacitor server.url points to https://tonightnyc.com so users always get the latest data and bug fixes without app store updates. The fallback bundle inside the .ipa renders the same UI offline.
- **Where is the privacy policy?** /privacy on tonightnyc.com (also linked in About section in-app)
- **Email collection** is optional — only if user explicitly opts into upcoming-show notifications. Stored in Upstash Redis, used only by the daily cron at /api/cron/check-alerts.
