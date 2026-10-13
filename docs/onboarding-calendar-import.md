# Onboarding: Calendar Import step

Status: implemented; device/manual verification pending (see "Verification").

## Product rule

The Google Calendar import is the **last onboarding step before the first Home**:

Welcome → onboarding questions → OTP → profile setup / family join (if needed)
→ **Calendar Import (import or skip)** → Home.

`onboardingCompleted` is unchanged — it still becomes `true` in
`finishOnboarding` exactly as before. The Calendar step is tracked separately.

## State (server-side, `users`)

| Field | Meaning |
| --- | --- |
| `calendarImportPromptRequiredAt` | Stamped only by `finishOnboarding` (both the family-join and normal path). Marks a user who went through the new flow. |
| `calendarImportPromptResolvedAt` | Set by `resolveCalendarImportPrompt` when the user imported **or** skipped. It does **not** mean "Google import completed" — that is `googleImportStatus`. |

Pending = required **and not** resolved
(`isCalendarImportPromptPending`, `lib/calendarImportOnboarding.ts`), exposed
as `getCurrentUserStatus().calendarImportPromptPending`.

### Existing users

No backfill. Users onboarded before this feature (and the Apple Review account)
have no `calendarImportPromptRequiredAt`, so they are never pending and are
never routed into the step. Users who were mid-onboarding at deploy time finish
through `finishOnboarding` and therefore do see the step.

## Routing

`app/(authenticated)/_layout.tsx`: once `resolvePostAuthOnboardingRoute` returns
`'normal'` and the flag is pending, the layout `router.replace`s to
`/(authenticated)/import-calendar` (splash stays up; Home never renders). It
runs from server state, so cold start respects it. When the flag flips to
resolved, the layout itself navigates to Home (`router.navigate`), never
`router.back()` from the screen.

## Import screen

`import-calendar.tsx` is reused. Onboarding mode = `calendarImportPromptPending`
(server flag, not a route param). Settings/Home entries are never pending and
behave as before. In onboarding mode: intro copy + `דילוג`, header skip, no back
button, hidden tab bar, and "continue without import" in denied / error / empty
states. Already-imported users are resolved automatically (no second import).

## Verification

Automated: `tests/convex/calendarImportOnboarding.test.ts` (pure gate logic +
source-inspection of the layout, screen and mutations). Not yet verified on
device: iPhone/Android, RTL rendering, cold start, foreground/background,
offline skip.

## Deferred (not part of this change)

Home empty-state "copy events" CTA and the Home first-visit notice.

## Google all-day import dates (approved MVP scope)

All-day `start.date` and exclusive `end.date` from Google are anchored to
**Asia/Jerusalem midnight**, independently for each date. The conversion
resolves the IANA offset at midnight itself, not at noon. A missing end means
midnight on the next calendar date, not 24 elapsed hours later. A single day
at the 2026 DST transitions therefore lasts 23 hours (March 27) or 25 hours
(October 25); multi-day ranges retain their exclusive end date. An unresolved
midnight fails the import instead of silently saving a shifted date.

Timed RFC3339 timestamps, preview formatting, ownership/sharing, deduplication
and the one-time import lock are unchanged. Existing imported records are not
rewritten or unlocked. The stored shape remains `startTime`, `endTime`, `allDay`.

**International limitation:** the import still anchors all-day dates to
Jerusalem, regardless of the source calendar's timezone. Calendar/Home use
device-local date boundaries; an all-day date is **not guaranteed to remain the
same on devices in other timezones**. This is not full international support.
Preserving floating calendar dates across zones requires a separate approved
storage/display design. Existing multi-day display/query behavior is unchanged;
this fix preserves the stored range, not rendering on every intervening day.

Local regression coverage: `tests/convex/googleImportDates.test.ts` invokes the
real import/status handlers with a synthetic in-memory DB and a mocked Google
response for preview-to-import coverage. It checks both DST boundaries, explicit
and missing ends, multi-day ranges, leap/year boundaries, timed offsets, retry
locking and metadata. The adapter does not verify Convex transaction/concurrency
behavior. Deployed backend and iPhone/Android verification remain pending.

## Import destination authorization

`importGoogleCalendar` derives identity from server authentication. After the
existing one-time lock check, it keeps `resolveMySpaceId` selection and calls
`requireSpaceWriteAccess`: the resolved space must exist and the caller must have
an access-kind row for it (including established legacy inference). An entity,
phone match or default-space pointer is not sufficient. Rejection occurs before
writing events or the completion lock. An already-completed import still returns
idempotently without new writes, even after membership changes.

Both normal `finishOnboarding` and its `executeFamilyJoin` branch create access
before the calendar step. Real-handler regression tests exercise personal and
family creation and the pending-match family-join branch through import. No
legitimate new-user entity-only import state was found. Historical entity-only
records are rejected; if a stale entity outranks an admin access row in another
space, import fails closed rather than silently changing its destination. No
membership repair, resolver redesign or personal/family separation is included.
The date conversion, OAuth, selection, preview and imported fields are unchanged.

See [final write authorization review](audits/final-write-authorization.md) for
local verification, known test failures and required device QA.
