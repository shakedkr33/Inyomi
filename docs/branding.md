# Launch branding

Checkpoint status (2026-10-19): branding is implemented with local asset checks;
new native builds and iPhone/Android launcher QA, Android notification-icon QA
and Profile/sign-in visual QA remain pending. No Production verification is
claimed. No-build/no-commit statements below describe the earlier implementation
sessions; the approved checkpoint creates local commits only, without a build,
deployment or push.

## Current installed icons — transparent-symbol update

The only symbol source for installed icons is
`assets/images/branding/y-symbol-transparent.png` (1254 × 1254). The requested
`iy-symbol-transparent.png` filename was not present; the supplied file has the
matching transparent blue symbol. Source pixels are unchanged.

- `assets/images/branding/inyomi-app-icon-master.png`: opaque RGB 1024 × 1024,
  uniform #EDE8E2 background, no embedded rounding. Visible symbol bounds are
  centered, scaled proportionally to 736 pixels high. Transparent margins alone
  were trimmed; colors were not recolored. Alpha-aware resampling avoids hidden
  transparent RGB bleeding into edges. No old flattened artwork was used.
- `assets/images/branding/inyomi-launcher-foreground.png`: 1024 × 1024 transparent
  adaptive layer. All visible pixels fit the centered 66/108 safe circle with
  additional resampling clearance.
- `assets/images/branding/inyomi-launcher-monochrome.png`: same alpha silhouette,
  white RGB, for Android themed launchers only.
- app.json references these three new files. Existing adaptive background remains
  #EDE8E2 in both Expo and native colors.xml.
- Native AppIcon is updated for both Xcode Debug and Release. Android main/res
  regular, round, adaptive foreground and monochrome launcher images are updated
  in all five densities. No flavor-specific overrides were found. EAS profiles
  share these tracked native resources; no EAS configuration was changed.
- Android resources are actual lossless WebP. Regular launcher alpha is explicitly
  opaque (Expo image generation can round composited alpha to 254). Round launcher
  transparency is the intentional legacy circular mask; the master is square.

The paragraphs below describe previous branding work; this section supersedes
prior decisions about the installed icon. Internal screens remain unchanged.

### Asset reference audit

Still used and preserved byte-for-byte:

- `assets/images/icon.png`: premium onboarding (two Image references).
- `assets/branding/inyomi-mark.png`: Sign-In.
- `assets/branding/inyomi-logo-horizontal.png`: Welcome and Profile/Settings.
- `assets/images/inyomi-native-splash-logo.png`: Expo splash and React splash.
- Native splash image sets/drawables and storyboard: existing splash flow.
- `assets/images/notification-icon.png` and five native notification drawables:
  Expo notifications plugin plus FCM/local-notification manifest references.
- `assets/images/favicon.png`: web favicon.

Previous `adaptive-icon.png` and `adaptive-icon-monochrome.png` now have no active
launcher references. Older logo variants and the flattened `logo inyomi.png` are
retained as well. No old assets were deleted, including unused ones.

### Validation and remaining QA

`node /tmp/inyomi-verify-final.cjs` checks exact cream pixels outside the symbol,
master opacity and RGB PNG format, compositing against the new source-derived
layer, native iOS pixel equality, all 20 Android dimensions/WebP formats, native
background samples, adaptive safe-circle containment and monochrome alpha parity.
It also compares every pre-existing repository file against its pre-task hash,
allowing only the listed icon/config/documentation changes. The script is local
to this session. No source TS/TSX changed; no application test suite was needed.

Asset previews were inspected, with no visible old-background halo. This is not
device verification. New native builds/installations are required on both iPhone
and Android, followed by launcher/App Library, round-mask and themed-icon QA.
No build, deployment, commit or push was performed.

### Exact files changed in this update

- `app.json`
- `docs/branding.md`
- `assets/images/branding/inyomi-app-icon-master.png`
- `assets/images/branding/inyomi-launcher-foreground.png`
- `assets/images/branding/inyomi-launcher-monochrome.png`
- `ios/InYomi/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp`

## Previous branding implementation (historical)

The launcher icon now uses the blue InYomi mark from the supplied artwork.
The matching original was located at
`/Users/shaked/Desktop/shaked/לוגו איניומי/לוגו סופי ציור/icon.png`;
the sibling `app icon no back.png` supplied the transparent mark. Runtime assets
are copied/exported into this repository and do not depend on that local folder.

## Asset ownership

- `assets/images/icon.png`: opaque RGB 1024 × 1024 primary iOS icon and premium
  onboarding artwork. Preserves the supplied rounded tile and white margin.
  The rounded-square artwork is explicitly approved; preserve it on installed
  app surfaces without redesigning or replacing it.
- `assets/branding/inyomi-mark.png`: cropped transparent mark for sign-in.
- `assets/branding/inyomi-logo-horizontal.png`: transparent symbol, wordmark and
  English tagline for Profile/Settings and the existing Welcome screen. Profile
  uses `contain` in its existing 132 × 90 frame; spacing and RTL remain unchanged.
- `assets/images/adaptive-icon.png`: transparent Android foreground, padded so
  its bounds fit inside the centered 66/108 safe circle.
- `assets/images/adaptive-icon-monochrome.png`: matching white alpha silhouette
  for themed launcher icons. Background is `#EDE8E2`, independently configured
  from the unchanged splash background.
- `assets/images/favicon.png`: 64 × 64 export of the new primary artwork.
- Native iOS AppIcon and Android regular/round/foreground/monochrome assets are
  generated with the installed Expo icon helpers. Both native trees are tracked;
  changing app.json alone does not update these existing native projects.

Welcome already uses the blue horizontal wordmark
`assets/branding/inyomi-logo-horizontal.png` and remains unchanged. Legacy unused
logo files remain for historical compatibility; no active non-splash UI references
`logo-inyomi.png` or `logo-inyomi-current.png`. Illustrations, paywall hero,
third-party attribution and navigation icons remain unchanged.

## Splash and notifications

All splash artwork, native splash resources, startup code and splash configuration
remain unchanged. In particular, Android `drawable/ic_launcher_background.xml`
is a splash resource despite its name and must not be replaced with launcher art.

`assets/images/notification-icon.png` is a dedicated white-on-transparent 96 × 96
notification symbol, derived from the existing transparent mark without redrawing
it. Artwork fits inside 80 × 80 pixels, leaving at least 8 pixels of padding.
The Expo notifications plugin references it; the native manifest references
`@drawable/notification_icon` for both FCM and Expo local notifications. Native
exports are 24/36/48/72/96 pixels across mdpi through xxxhdpi. Channels, permissions,
delivery code and notification color remain unchanged. No additional asset is
required. See
[Expo notification guidance](https://docs.expo.dev/push-notifications/faq/).

## Validation (2026-10-19)

Implementation complete; verification pending: new native builds and iPhone/Android
visual checks (launcher, round masks, themed icons, Profile, sign-in, premium
onboarding and unchanged splash). No build or device verification was performed.

Passed:

- `node /tmp/inyomi-verify-branding.cjs`: hash comparison of splash assets/code,
  splash/plugin config preservation, existing Profile edits preserved, RGB iOS
  icon identical to primary asset, Android foreground inside safe zone,
  monochrome alpha match, all 20 Android density asset dimensions.
- `bun --no-env-file x --no-install biome check 'app/(auth)/sign-in.tsx' 'app/(authenticated)/profile.tsx'`:
  both files passed with no fixes.

The temporary verification script is session-local, not a project dependency.
No business logic changed; no new test suite or dependencies were added.

## Exact files changed for the initial update (historical)

- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp`
- `android/app/src/main/res/values/colors.xml`
- `app.json`
- `app/(auth)/sign-in.tsx`
- `app/(authenticated)/profile.tsx`
- `assets/branding/inyomi-mark.png`
- `assets/images/adaptive-icon-monochrome.png`
- `assets/images/adaptive-icon.png`
- `assets/images/favicon.png`
- `assets/images/icon.png`
- `docs/branding.md`
- `ios/InYomi/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`

## Focused Profile and notification correction

Only the Profile Image source was changed from the standalone mark to the existing
horizontal logo matching the supplied symbol/wordmark/tagline composition. The
logo file itself was not modified. This also preserves Welcome's shared asset.
No Sign-In, Splash, Welcome, Onboarding, launcher icons, website, Google Places
or event-link changes were made during this correction.

Checks passed:

- `bun --no-env-file run type-check` (`tsc --noEmit`).
- `bun --no-env-file x --no-install biome check 'app/(authenticated)/profile.tsx'`.
- `node /tmp/inyomi-check-correction.cjs`: 549 out-of-scope existing files identical
  to the pre-correction snapshot; Profile differs only by its image reference;
  app.json differs only by notification icon configuration; logo transparency and
  proportions; all six notification PNGs have white RGB, transparent padding and
  expected dimensions. Script is session-local.
- Focused `git diff --check`; reviewed Profile and manifest changes against the
  pre-correction files, preserving earlier uncommitted work.

Profile needs a Metro reload in development; the Android notification resource
requires a new native build/install. No build, deployment, commit or push was run.
Device QA remains pending: Profile logo/tagline readability and RTL on iPhone and
Android, and local/push notification small icons in Android status bar and shade.

Exact files changed in this correction:

- `app/(authenticated)/profile.tsx`
- `app.json`
- `android/app/src/main/AndroidManifest.xml`
- `assets/images/notification-icon.png`
- `android/app/src/main/res/drawable-mdpi/notification_icon.png`
- `android/app/src/main/res/drawable-hdpi/notification_icon.png`
- `android/app/src/main/res/drawable-xhdpi/notification_icon.png`
- `android/app/src/main/res/drawable-xxhdpi/notification_icon.png`
- `android/app/src/main/res/drawable-xxxhdpi/notification_icon.png`
- `docs/branding.md`
