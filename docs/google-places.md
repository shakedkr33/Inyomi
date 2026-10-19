# Google Places authenticated proxy

Checkpoint status (2026-10-19): the founder reports that Google Places and the
event-link backend fixes were deployed successfully to Convex Development, and
core Places QA plus the four event fixes passed on both iPhone and Android.
This supersedes the earlier deployment/device-pending statements below, which
record the implementation sessions rather than the current checkpoint status.
Hosted concurrency, historical retention/compliance and Production verification
are not established by that report. Storage cleanup remains disabled and
unapproved. The checkpoint session performs no deployment, migration or push.

## Architecture and behavior

Previously `LocationCard` called Legacy Autocomplete/Details REST directly with
`EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`. Details omitted `fields`; the client had
no server-enforced usage budget or Google attribution. Confirmed against code.

Now the shared personal/community editor uses authenticated Convex actions
`googlePlaces.autocomplete({ input, sessionToken })` and
`googlePlaces.details({ placeId, sessionToken })`. Both first call an internal
mutation that validates the live session/user via `sessionAuth.getAuthUserId`
and reserves request capacity transactionally. Clients cannot supply a user ID,
URL, Google endpoint, language, field mask or key. There is no public HTTP proxy.
JWT verification remains Convex's responsibility; missing/deleted/mismatched/
expired sessions and disabled/deleted users fail before Google. Revocation after
admission cannot retract an already-issued external request.

The key is read only on the server from `GOOGLE_PLACES_API_KEY`. The mobile
component has no public-key fallback and imports the server suggestion contract
as a TypeScript type only. `_generated/api.d.ts` has a minimal local declaration
addition for this module; no hosted code generation was run.

Autocomplete accepts 2–200 characters, rejects control characters, and returns
at most five `{ placeId, description }` values. Place IDs are 1–512 URL-safe
alphanumeric/underscore/hyphen characters. Tokens must be UUID v4. Legacy
endpoints and Hebrew language preference remain, preserving search ranking
behavior for Hebrew and English. Details requests only `geometry/location` and
returns finite, in-range `{ lat, lng }`. No provider bodies/errors are returned.
If Details includes additional third-party attribution, coordinates are withheld
rather than displaying unattributed data; the selected address remains usable.

The 250 ms debounce remains. UUID tokens span autocomplete requests and the
selected Details request; selection, dismissal, empty input and unmount abandon
the session. React cleanup and synchronous invalidation ignore stale responses
when typing, selecting, switching mode, closing or unmounting. Convex actions
already sent cannot be cancelled by the device: cancellation is local response
suppression, with server requests capped by a five-second abort deadline. No
automatic retries. Quota, configuration, timeout, HTTP, network and malformed
response failures return a bounded error code, with an inclusive Hebrew manual-
entry fallback. No application logs include credentials, queries or locations.
Convex/provider operational logging and retention require separate review.

The official unmodified Google Maps PNG is bundled locally and appears in a
fixed footer in both inline and screen-level suggestion lists, with its original
aspect ratio, 18 dp height, clear space and accessible label. Source:
[official attribution asset archive](https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip).
No image generation or runtime image service is involved.

## Approved persistent event-location contract

The product owner approved persistent human-readable `events.location` for the
whole event lifetime: no 30-day disappearance, mandatory reselection or silent
provider-driven address rewrite. This includes the existing selected description
for POIs, but no new rich Places fields or suggestion arrays are persisted.

Optional `locationSource` is `manual`, `imported`, `google` or `unknown`.
Absent metadata means unknown legacy provenance, not manual or Google.
Optional `googlePlaceId` stores the ID chosen from autocomplete. `LocationCard`
emits text + source + ID atomically; the existing Details call completes the
Legacy autocomplete session, but its transient coordinates are discarded. No
Details response can change the selected text or the persisted destination.
No Details call is made for navigation. Debounce/stale-response guards remain.

`events.create` and `events.update` use `lib/eventLocation.ts` to normalize
persistence. New records never receive permanent coordinates, including writes
from old clients. Unchanged saves preserve existing metadata/legacy `geo:`;
changing the address, selecting another place, switching to a link or clearing
location clears obsolete coordinates/ID. Nullable metadata arguments encode
explicit clearing over JSON; Convex stores missing fields, not null. Old clients
omitting metadata still work: changed text has unknown provenance and cannot
inherit an old ID. Unrelated updates preserve metadata, including imported data. The editor tracks
local `locationDirty` intent and omits location fields unless they were edited;
this also preserves imported events containing both address and meeting link.
Manual typing is explicitly marked manual; Google Calendar imports are marked
imported at their known import entry point. Duplication copies text and known
Google ID but never copies historical coordinates into a new event.

The create and edit routes carry metadata through the shared EventScreen for
personal, family-shared and community events. Existing authorization remains.
Community-list and linked-event projections pass navigation metadata. Public
share preview continues exposing the address through its existing limited
contract; no new public endpoint or extra public fields were added. Linked
snapshots retain their existing address-only behavior when the source is gone.

Navigation uses the shared helper and picker from Home, Calendar, full details
and the details sheet. Google uses `query` + `query_place_id`; Waze uses a text
query, never a Google ID. Manual/imported/unknown addresses have text fallback.
Legacy coordinates remain readable. Meeting URLs are excluded from physical
navigation; existing Join/Open Link paths remain. Technical URL contracts:
[Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started),
[Waze deep links](https://developers.google.com/waze/deeplinks).

## Abuse budgets and compatibility

Both endpoints share these conservative initial fixed-window ceilings:

| Scope | Per minute | Per UTC day |
| --- | ---: | ---: |
| Authenticated user, across sessions | 60 | 1,000 |
| Entire deployment | 600 | 10,000 |

Admission precedes Google, and failed/invalid attempts consume admitted capacity.
All four counters are read and incremented in one Convex mutation; a denied
request increments none. Convex OCC serializes competing reservations, including
creation of a previously absent indexed bucket. Fixed windows permit a boundary
burst of up to twice the minute cap. These are request limits, not a monetary
budget or a promise about provider prices. Global exhaustion affects all users;
manual entry continues. Account creation/auth abuse and provider-level quotas
remain separate operational controls.

`placesRateLimits` is the only added table (`key`, `count`, `expiresAt`, index
`by_key`). Keys contain user IDs for user buckets, plus window duration/start;
there are no searches, coordinates, place IDs, session tokens or credentials.
Each new bucket schedules its own internal deletion at window end (maximum
24 hours plus scheduler delay). Cleanup is idempotent. No cron/full-table scan.
This deletes only new abuse-counter records, never event locations.

Storage Stage 1 tables/fields and the existing uncommitted account-deletion work
are preserved. Counter rows have no storage references or required foreign-key
relationships, so deleting a user does not fail; live auth prevents further
requests. Account deletion does **not** synchronously erase these transient
counters: their scheduled expiry still applies. This residual user-ID linkage,
provider logs and backups must be included in the operational privacy review;
this is not a claim of complete immediate erasure. Local regression tests cover
existing Storage/deletion flows; hosted schema/OCC/scheduler verification remains
pending.

## Retention and licensing — launch blocker

Reviewed Google documentation on 2026-10-19:

- [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies): place IDs may be retained indefinitely; other content is restricted. A narrow exception exists for an end-user street address that the user could have supplied fully and accurately without autocomplete, for that transaction. It does not cover POI lookup or all suggestions/coordinates. It is unsafe to treat every selected place as user-authored content.
- [Service-specific terms, section 14 (Legacy and New)](https://cloud.google.com/maps-platform/terms/maps-service-terms): non-EEA terms permit temporary Places coordinate caching for up to 30 consecutive days, after which cached coordinates must be deleted; they also restrict use with a non-Google map. The billing-account region and actual applicable agreement have not been verified. EEA terms differ.
- [Legacy session tokens](https://developers.google.com/maps/documentation/places/web-service/legacy/session-tokens) and [Details fields](https://developers.google.com/maps/documentation/places/web-service/legacy/details) support the implemented same-project session token and compound field selection. A token is not a guarantee of zero autocomplete cost, especially for abandoned sessions.

The approved contract above supersedes the earlier proposal to expire or
re-resolve event labels. This task does not reopen a licensing audit or claim
that persisting selected descriptions establishes compliance. Historical
`locationUrl` coordinates remain on existing records with no reliable source or
fetch timestamp; compatibility does not resolve their retention. Any historical
transition needs a separately approved plan. No migration, backfill, event
expiry, automatic Storage cleanup or bulk rewrite is implemented or authorized.
The applicable agreement, historical coordinates and public policy coverage
remain separate release considerations; they are not an unapproved requirement
to erase event addresses for Development QA.

## Development setup (operator steps, not executed)

1. In Convex Dashboard, select the existing InYomi **Development** deployment
   `dev:sincere-panther-608`. Confirm the deployment identity before any write.
2. Obtain a dedicated, never-client-exposed server credential from the operator.
   Do not copy `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`. The operator must verify its
   project supports the existing **Places API (Legacy)** endpoints, billing and
   appropriate API restrictions/quotas. A new project may not support Legacy;
   in that case stop and plan an explicit API migration. Do not silently mix
   Legacy autocomplete with New Details or reuse a leaked key.
3. Deployment Settings → Environment Variables: set **`GOOGLE_PLACES_API_KEY`**
   to that dedicated credential. Do not add it to Expo/EAS public variables,
   source files, shell history, documentation or screenshots. A local `.env`
   value alone does not configure a hosted Convex action.
4. **Stop before hosted testing if this credential is absent or unverified.**
   Its hosted availability was not inspected in this local-only task.
5. In a separately authorized deployment session, deploy reviewed backend/schema
   changes to Development first, then start the matching updated client. The new
   client needs these actions/table; an old hosted backend cannot run this flow.
   This worktree contains unrelated uncommitted work: do not deploy it wholesale
   without reviewing that work. No deploy command is authorized by this document.
6. Confirm the client targets `https://sincere-panther-608.convex.cloud`, then
   execute the QA below. Configure monitoring and provider quotas through a
   separately authorized operator task. Production `prod:peaceful-cricket-429`
   remains untouched. Existing public keys/configuration have not been removed,
   revoked, restricted or rotated; older distributed clients still expose them.

## Validation and device QA

Automated tests exercise registered action/mutation handlers with synthetic DB
records and mocked Google responses; the component tests execute real React
handlers with deferred transport; persistence tests execute the edit route,
shared form and real update mutation with serialization that omits `undefined`.
The concurrent-request fixture serializes mutations to model Convex transactions;
it does not verify the hosted OCC engine. No real Google request was made.

Before release, on **both iPhone and Android**, test personal and community
creation/editing (creator and community admin; unauthorized editor denied):

1. Hebrew/English search, 1/2/200/>200 character boundaries, rapid typing,
   at most five suggestions; scroll the list above/below the keyboard and verify
   RTL, logo visibility, screen-reader labels and selection touch targets.
2. Select a place, save, reopen and navigate; manually edit and ensure the former
   coordinates do not return. Repeat for an existing event, address-only legacy
   event, closing location and switching physical ↔ online modes.
3. Select twice rapidly; dismiss, change mode or leave while requests are pending.
   Late responses must not overwrite current text or destination.
4. Offline, quota exhaustion, denied/missing key, timeout and malformed response:
   no false success or private diagnostics; manual input remains available.
5. Anonymous/expired/revoked session and disabled/deleted account: no Google call.
   Multiple devices/sessions for one user share limits. Verify global caps and
   scheduled bucket expiry in an authorized Development environment.
6. Rebuild/bundle inspection: no Places credential in the new client. Validate
   real Google billing/session behavior and navigation against the approved
   product contract. Older clients can read/save addresses but coordinate-gated
   navigation buttons may be absent for new coordinate-free events. QA needs
   the matching updated client, not just the new backend.

Implementation complete; verification pending: hosted credentials/schema/actions,
real provider behavior, hosted concurrency/cleanup, iPhone and Android QA,
historical-data/compliance review. See the task completion report for exact local
commands and results; automated success is not launch readiness.

## Combined Development deployment surface (local inspection)

This is a review of the current worktree relative to HEAD, not a proof of equality
with hosted function bodies. Previous Development CLI metadata access returned
`401 MissingAccessToken`; no Production credential, revoked key, hosted write or
deploy was used to bypass it. Deployment baseline comparison remains pending.

- New event fields: optional `locationSource`, `googlePlaceId`; no event index
  removals or changes. New counter table: `placesRateLimits.by_key`.
- Pre-existing Storage Stage 1 additions: `storageUploadIntents` (`by_user`,
  `by_storage_id`), `storageFiles` (`by_storage_id`), `storageReferences`
  (`by_storage_id`, `by_parent`, `by_parent_storage`). These track references;
  they introduce no scheduled Storage deletion or cleanup endpoint.
- Places actions: new `googlePlaces.autocomplete`, `googlePlaces.details`;
  internal mutations `reserve`, `expireBucket`. Counter expiry is explicitly
  approved for Development and only deletes expired rate-limit rows.
- This location task changes `events.create/update`,
  `events.listCommunityEventsForDate`, `googleImport.importGoogleCalendar` via
  its insertion helper, and `linkedEvents.getLinkedEventsForSpace` via resolution.
- Pre-existing combined changes: new `events.createStorageUploadIntent` and
  `events.registerStorageUpload`; reference tracking in `events.create/update`,
  `deleteEvent`, `deleteCancelledEventsPastGracePeriod`; restore-expiry enforcement
  in `events.restorePersonalEvent` and `tasks.restoreTask`. Task reference/attachment
  behavior changes in `tasks.create/update/remove/setSubtaskAttachment/removeSubtask`,
  `getTaskDetails/getTaskAttachmentUrl`, and the shared task sanitization helper.
  `users.updateMyProfile` / `onboarding.finishOnboarding` minimize contact emails.
  Account-deletion plan/execution and `accountDeletionPreview.previewAccountDeletion`
  include existing family-transfer/closure and retention work.
- Existing public functions are retained. Added location arguments are optional;
  explicit null is accepted only by mutations and normalized before persistence.
  Old writes remain accepted but new coordinates are deliberately discarded;
  older coordinate-only navigation UI cannot navigate new coordinate-free records.
  New clients require backend/schema first. Preview adds fields rather than removing
  them; existing restore rules deliberately reject expired trash restoration.
- No automatic Storage cleanup, backfill, location expiry or migration is added.
  Existing explicit deletion behavior is preserved; it was not executed here.

## Local implementation files for the persistent-location task

| File | Purpose |
| --- | --- |
| `lib/eventLocation.ts` | Canonical persistence normalization and navigation URLs |
| `lib/types/event.ts` | Optional form metadata and explicit clears |
| `convex/schema.ts` | Optional persisted location metadata |
| `convex/events.ts` | Normalize create/update and project community navigation ID |
| `convex/googleImport.ts` | Mark newly imported location provenance |
| `convex/linkedEvents.ts` | Pass source ID through existing linked-event reads |
| `lib/components/event/LocationCard.tsx` | Persist chosen ID; discard Details coordinates; clear stale metadata |
| `lib/components/event/EventScreen.tsx` | Carry metadata through form state |
| `app/(authenticated)/event/new.tsx` | Personal/community create payloads and duplicate initialization |
| `app/(authenticated)/event-edit/[id].tsx` | Initialize and serialize metadata/clears |
| `lib/eventDuplication.ts` | Retain ID/text without copying old coordinates |
| `components/NavigationPickerModal.tsx` | Shared Google/Waze URL handling and address fallback |
| `components/EventDetailsBottomSheet.tsx` | Address/ID navigation eligibility and projection |
| `app/(authenticated)/event/[id].tsx` | Full-details navigation without coordinate dependency |
| `app/(authenticated)/index.tsx` | Home projections, eligibility and picker state |
| `app/(authenticated)/calendar.tsx` | Calendar/linked/community projections and picker state |
| `tests/convex/eventLocation.test.ts` | Actual mutations, transitions, import, duplication and URL tests |
| `tests/convex/googlePlacesEventPersistence.test.ts` | Actual edit route/form/mutation/reopen regression tests |
| `lib/services/__tests__/googlePlacesLocation.test.tsx` | Actual selector response/race and no-coordinate assertions |
| `lib/services/__tests__/eventNavigation.test.tsx` | Actual picker launches supported Google/Waze URLs |
| `docs/google-places.md` | Approved contract, deployment surface, limitations and checks |

Pre-existing proxy, Storage, account-deletion, privacy and task changes are preserved.
Documentation reviewed: repository instructions, this domain document,
authentication-session validity and the existing deployment/retention notes.
No new broad legal review was performed. No commit or push.

## Local verification

Results and exact commands are recorded below after the final checks. Device,
hosted provider, concurrency and end-to-end sharing checks remain pending.

```sh
bun test tests/convex/googlePlaces.test.ts tests/convex/googlePlacesEventPersistence.test.ts tests/convex/eventLocation.test.ts lib/services/__tests__/googlePlacesLocation.test.tsx lib/services/__tests__/eventNavigation.test.tsx tests/convex/eventDuplication.test.ts tests/convex/googleImportDates.test.ts tests/convex/googleImportAccess.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/taskSpaceAuthorization.test.ts tests/convex/finalWriteAuthorization.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/sessionEntryPoints.test.ts tests/convex/storageReferenceTracking.test.ts tests/convex/accountDeletion.test.ts tests/convex/retentionLifecycle.test.ts
# 1186 passed; 1 known historical failure; 3238 assertions across 17 files.
# Failure: taskSpaceAuthorization — explicit family and cross-space event shares
# are preserved. Its fixture removes the viewing user from the users table;
# live-session validation rejects it. The fixture/auth behavior exists in HEAD.
# Product owner explicitly accepted this known failure for Development QA.

bun test tests/convex/eventLocation.test.ts lib/services/__tests__/eventNavigation.test.tsx tests/convex/googlePlacesEventPersistence.test.ts tests/convex/personalEventPackage1.test.ts
# Final rerun after shared-projection and editor-intent review: 229 passed,
# 0 failed, 793 assertions across 4 files. Includes linked live/deleted-source
# privacy and unchanged Google/imported-with-meeting-link editor saves.

bun run type-check
bunx tsc --noEmit -p convex/tsconfig.json
# Both passed after final implementation changes.

bunx biome check --max-diagnostics=50 lib/eventLocation.ts lib/types/event.ts lib/components/event/LocationCard.tsx components/NavigationPickerModal.tsx lib/eventDuplication.ts tests/convex/eventLocation.test.ts tests/convex/googlePlacesEventPersistence.test.ts lib/services/__tests__/googlePlacesLocation.test.tsx lib/services/__tests__/eventNavigation.test.tsx convex/events.ts convex/schema.ts convex/googleImport.ts convex/linkedEvents.ts 'app/(authenticated)/event-edit/[id].tsx' 'app/(authenticated)/event/new.tsx' 'app/(authenticated)/event/[id].tsx' 'app/(authenticated)/index.tsx' 'app/(authenticated)/calendar.tsx' components/EventDetailsBottomSheet.tsx lib/components/event/EventScreen.tsx
# 20 files: 6 errors / 7 warnings remain in existing code.
# Existing formatting/import issues: calendar, event/[id], EventScreen.
# HEAD copies reproduce these five errors. Sixth: Calendar's unchanged
# myImportantItemChecks debug useEffect dependency (same source in HEAD).
# Existing unused variables/imports/parameters and suppression warnings remain.
# New standalone helpers/components/tests have no lint errors or warnings.
# No unrelated formatting or old debug code was changed to make lint pass.

git diff --check
# Passed. Final changes reviewed with pre-existing work preserved.
```

Locally ready for a controlled Development QA release with a matching updated
client. This is not hosted verification or Production readiness. The next step
is a read-only Development preflight using valid normal Development access,
without requiring unavailable proof that hosted function bodies are identical.
No deployment was performed. No credential/cloud/Production/website changes,
hosted writes, cleanup execution, migrations, commits or pushes occurred.

## QA fixes: meeting links, Home actions and tab drafts (2026-10-19)

The founder reports that the preceding Places package is already deployed to
`dev:sincere-panther-608` and the temporary key was revoked. The following fixes
are local only; no credential, deployment or hosted write was attempted.

### Confirmed code causes

1. The link input and event mutations had no URL validation. Full event details
   passed the raw value to `Linking.openURL` and swallowed rejection with an
   empty catch. This explains the silent failure path for unsupported values;
   the device-specific cause of a particular valid HTTPS failure has not been
   reproduced on a device here.
2. Actual personal Home renders `HomeDailyCommandCenter`, not only the older
   JSX branches in `index.tsx`. Its `homeEventNavigation` predicate still
   required `geo:` and the parent callbacks omitted `googlePlaceId`. Compact
   cards also offered navigation only, omitting a meeting-link action. The old
   tests asserted that manual addresses were not navigable; that expectation
   is intentionally replaced by the current approved address-navigation rule.
3. `LocationCard.switchMode` emitted empty values for both tabs. There was no
   independent inactive draft, so returning to a tab could not recover input.

### Current behavior

- `lib/meetingLink.ts` validates HTTP/HTTPS or a scheme-less domain (prefixed
  with HTTPS), rejects free text/unsafe schemes/malformed hosts/credentials,
  whitespace, backslashes, control characters and malformed percent escapes.
  Validation uses URL parsing but returns the original trimmed candidate, so
  invitation paths, query strings, escaping and fragments are not reserialized.
  Error copy is **יש להזין קישור תקין**. No provider allowlist is imposed.
- EventScreen validates the active newly entered/edited link before save.
  `normalizeEventLocation`, already called by `events.create/update`, enforces
  the same rule on new/changed submitted URLs, including callers bypassing UI.
  An omitted or unchanged legacy URL is not rewritten or rejected on unrelated
  updates. Import parsing and historical records are unchanged.
- `openMeetingLink` uses the existing React Native `Linking.openURL` mechanism,
  normalizes at opening time, rejects unsafe legacy values, shows a Hebrew
  failure alert and suppresses repeated taps while opening is pending. Full
  details and Home's existing meeting-link handlers use it. No link opens
  automatically. Real native provider handoff still needs device QA.
- Home's actual featured/compact cards use address eligibility without a geo
  requirement, and pass Place IDs through every navigation callback. Valid
  links show **הצטרפות לפגישה**, physical locations show **ניווט**. Empty/unsafe
  links do not become physical destinations. Existing active/upcoming temporal
  rules and community behavior remain; the RSVP compact branch retains its
  controls and can display the same location action.
- LocationCard stores separate address+metadata and link drafts in local refs
  for this editor session. Switching emits only the active tab's save payload;
  it cancels stale search work but does not destroy the inactive draft or call
  any backend mutation. Manual edits invalidate the selected Google ID.
  New `onlineUrlEdited` is local form intent only, not a schema field.
- Only the selected type is validated/persisted. Saving a link clears physical
  metadata/coordinates; saving an address clears the old link. Failed saves
  preserve both drafts for correction/retry. Successful create and explicit
  discard remount the local draft card; reopening initializes from persisted
  data, including historical imported records with both fields. Untouched
  historical data is not migrated. Google proxy, session completion, attribution,
  stale-response guards and no-new-permanent-coordinate behavior are preserved.

### Files changed for these three bugs

| File | Purpose |
| --- | --- |
| `lib/meetingLink.ts` (new) | Shared pure validation, normalization and injectable opener |
| `lib/openMeetingLink.ts` (new) | Native Linking/Alert adapter and pending-open guard |
| `lib/eventLocation.ts` | Backend URL enforcement and active-type clearing |
| `lib/homeEventNavigation.ts` | Remove obsolete coordinate-only rule; allow valid meeting CTA |
| `lib/types/event.ts` | Local edited-link flag |
| `lib/components/event/LocationCard.tsx` | Separate session drafts, preserve metadata and invalidate stale selections |
| `lib/components/event/EventScreen.tsx` | Active-link validation, pass metadata/edit intent, reset session after save/discard |
| `app/(authenticated)/event-edit/[id].tsx` | Initialize both drafts from saved fields |
| `app/(authenticated)/event/[id].tsx` | Safe meeting-link opening with errors |
| `app/(authenticated)/index.tsx` | Safe Home meeting-link handlers |
| `components/home/HomeDailyCommandCenter.tsx` | Correct real card CTAs and forward Place ID |
| `tests/convex/meetingLink.test.ts` (new) | URLs, opener failures/repeated taps and actual mutation validation |
| `tests/convex/locationDrafts.test.ts` (new) | Actual card/form/edit route/mutation, switches, save failure/retry and cancel |
| `tests/convex/homeEventNavigation.test.ts` | Approved manual/address navigation expectations |
| `tests/convex/helpers/personalEventEditorHarness.ts` | Optional real LocationCard for integration coverage |
| `lib/services/__tests__/homeLocationAction.test.tsx` (new) | Real featured/compact cards and full Home callback forwarding |
| `lib/services/__tests__/googlePlacesLocation.test.tsx` | Controlled link state and selected-ID survival across switching |
| `docs/google-places.md` | Canonical behavior, evidence and QA update |

### Verification and deployment

```sh
bun test tests/convex/meetingLink.test.ts tests/convex/locationDrafts.test.ts tests/convex/homeEventNavigation.test.ts lib/services/__tests__/homeLocationAction.test.tsx lib/services/__tests__/googlePlacesLocation.test.tsx tests/convex/googlePlacesEventPersistence.test.ts tests/convex/eventLocation.test.ts tests/convex/googlePlaces.test.ts tests/convex/personalEventPackage1.test.ts tests/convex/personalEventTaskSecurity.test.ts tests/convex/privacyAuthorization.test.ts tests/convex/taskSpaceAuthorization.test.ts tests/convex/googleImportDates.test.ts
# 763 pass, 1 historical failure, 2210 assertions across 13 files.
# Same taskSpaceAuthorization fixture failure documented above; no new regression.

bun test lib/services/__tests__/homeLocationAction.test.tsx lib/services/__tests__/googlePlacesLocation.test.tsx tests/convex/locationDrafts.test.ts tests/convex/meetingLink.test.ts
# 62 passed, 0 failed, 189 assertions across 4 files.

bun run type-check
bunx tsc --noEmit -p convex/tsconfig.json
# Final results recorded after completion below.
```

These tests mock native rendering, transport and database records; they do not
prove actual iPhone/Android opening or hosted validation. No live Google request,
deployment, migration, cleanup, credential change, commit or push was performed.
All pre-existing work remains preserved.

A new **Development backend deployment is required** to activate create/update
validation. Metro refresh is sufficient for the JavaScript UI changes in the
existing Development Builds (no new native dependency), but is insufficient to
validate server enforcement. No deployment was performed or authorized here.

Device QA on **both iPhone and Android**, in Hebrew RTL:

1. Personal create/edit: choose a Google address, enter a link, switch back and
   forth; verify text/ID and both drafts survive, including after failed save.
2. Save once in each tab; reopen and verify only the saved type returns. Cancel
   a changed editor and verify the saved event is unchanged.
3. Try free text and unsafe schemes: exact validation message, no save/open.
   Try Meet/Zoom/Teams HTTP/HTTPS and scheme-less URLs with invitation tokens.
4. Tap Join in details and Home, including repeated taps and unavailable opening;
   confirm correct destination or visible error and no duplicate handoff.
5. Home featured/compact/all-day cards: Google/manual/imported/legacy address,
   meeting link and no location; verify CTA and Google Place ID/Waze fallback.
6. Existing legacy-link unrelated edit, family-shared event and community
   creator/admin edit: verify unchanged permissions, draft behavior and CTAs.

Implementation complete; verification pending: native iPhone/Android QA and the
new server enforcement after a separately authorized Development deployment.

Final checks for this QA-fix task:

- `bun run type-check`: passed.
- `bunx tsc --noEmit -p convex/tsconfig.json`: passed.
- Focused Biome command below: 17 files checked, **3 existing errors and 3
  existing warnings**. Errors are unchanged formatting in `event/[id].tsx`
  and import-order/formatting in `EventScreen.tsx`; unrelated code was not
  reformatted to remove them. No new helper/component/test lint failures.
- `git diff --check`: passed. Task delta reviewed against a pre-task snapshot
  as well as Git diff, preserving earlier uncommitted changes.

```sh
bunx biome check --max-diagnostics=40 lib/meetingLink.ts lib/openMeetingLink.ts lib/eventLocation.ts lib/homeEventNavigation.ts lib/types/event.ts lib/components/event/LocationCard.tsx lib/components/event/EventScreen.tsx 'app/(authenticated)/event-edit/[id].tsx' 'app/(authenticated)/event/[id].tsx' 'app/(authenticated)/index.tsx' components/home/HomeDailyCommandCenter.tsx tests/convex/meetingLink.test.ts tests/convex/locationDrafts.test.ts tests/convex/homeEventNavigation.test.ts tests/convex/helpers/personalEventEditorHarness.ts lib/services/__tests__/homeLocationAction.test.tsx lib/services/__tests__/googlePlacesLocation.test.tsx
git diff --check
```
