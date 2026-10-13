# AGENTS.md — InYomi Engineering Instructions

This file defines engineering rules and product-safety guidelines for AI coding agents working on InYomi.

InYomi is an active product, not a generic React Native template.

Understand the existing implementation before editing it. Preserve unrelated behavior and user changes. Do not invent product decisions.

This file provides instructions; it does not prove that any feature is implemented or tested.

---

## 1. Product Context

InYomi is a Hebrew-first personal and family life-management mobile application.

Core areas include:

- Personal and family calendars
- Events, tasks, reminders and assignments
- Family profiles, including children
- Home / daily command center
- Communities, community events and RSVP
- Push notifications
- Google Calendar import
- Deep links and shared event links
- Authentication
- Subscriptions and RevenueCat

The product should feel warm, calm, trustworthy, simple and practical.

Prioritize:

1. Incorrect data, broken flows and permission failures.
2. Core launch requirements.
3. Notification reliability and platform consistency.
4. Friction in frequently used flows.
5. Subscription readiness.
6. Retention improvements.
7. Optional enhancements.

Do not expand scope simply because an improvement seems useful.

Existing code may contain legacy behavior, incomplete features, temporary solutions, duplication and known bugs. It does not automatically represent desired product behavior.

---

## 2. Source of Truth and Conflicts

Determine intended behavior using:

1. The user's explicit current task and confirmed decisions.
2. Relevant, current, approved product specifications.
3. Other explicit documented product decisions in the repository.
4. Tests that represent intentional behavior.
5. Existing implementation.

Existing implementation is evidence of current behavior, not necessarily product intent.

A document's location under `docs` does not prove that it is current or approved. A recent modification date alone does not prove that its product decisions supersede earlier decisions.

For relevant documentation:

- Distinguish approved requirements from proposals and historical notes.
- Check for superseding decisions and contradictory statements.
- Use repository history when needed to resolve a material conflict.
- Do not treat planned work as implemented.
- Do not treat implementation as verified merely because a document says so.

When code conflicts with an explicit requirement:

- Identify the conflict.
- Implement the requested behavior.
- Report which existing behavior changes.
- Update affected documentation where appropriate.

When documentation conflicts with code:

- Investigate whether the code is wrong or the documentation is stale.
- Do not change code solely to match an unverified historical description.
- Do not rewrite intended behavior merely to match a bug.

Resolve routine technical choices autonomously. Ask only when an unresolved product ambiguity materially affects behavior, permissions or data safety.

Never change instructions to bypass permissions or justify an otherwise unauthorized action.

---

## 3. Before Editing

For every non-trivial task:

- Read applicable repository instructions.
- Inspect the working tree and relevant existing diffs.
- Read the relevant product documentation.
- Trace the affected implementation.
- Identify shared consumers and regression risks.

Trace as applicable:

- UI entry points and form state
- Components, hooks and helpers
- Shared types
- Queries, mutations and actions
- Persisted records and schema
- Scheduled functions and notifications
- Navigation and deep links
- Existing tests

Determine:

- What currently happens.
- What should happen.
- Which code owns the behavior.
- Whether business logic or stored representations are duplicated.
- Which other flows depend on it.
- Whether the relevant documentation is missing or outdated.

Do not begin by editing the first matching file.

Keep investigation proportional to the task. Do not audit the entire repository for a focused fix.

---

## 4. Scope and Change Safety

Make the smallest safe change that fully satisfies the requirement.

Do not:

- Refactor unrelated code.
- Rename unrelated files or functions.
- Reformat large unrelated sections.
- Replace working architecture for stylistic reasons.
- Add abstractions without a concrete need.
- Change unrelated product behavior.
- Implement deferred features during a bug fix.

If an unrelated issue is discovered, report it separately. Fix it only if it blocks the requested work, and explain the dependency.

Before completion:

- Review the final diff, including newly created files.
- Separate your changes from pre-existing changes.
- Check for accidental edits and formatting churn.
- Verify the requirement and affected shared consumers.
- Run relevant checks.
- Report remaining limitations.

---

## 5. Destructive Operations and Existing Work

Never discard user work.

Do not execute destructive repository or filesystem operations unless explicitly authorized and their consequences are understood.

Examples include:

- `git reset --hard`
- `git clean -fd`
- Destructive `rm -rf` commands
- Deleting `.env` files
- Commands that destroy uncommitted changes

Never use force push.

Before editing a file with existing changes, inspect its diff and preserve unrelated work.

Do not revert changes merely because they were created outside the current task.

Do not expose secrets while inspecting files or command output.

---

## 6. Git Discipline

Do not commit, push, merge, rebase, reset or switch branches unless explicitly requested.

Review the actual diff rather than relying on memory of edits.

Before suggesting a commit, confirm:

- Your changes are limited to the intended scope.
- Pre-existing changes remain preserved.
- No temporary debugging code was introduced.
- No unintended generated files were added.
- No unrelated formatting churn occurred.
- Relevant checks passed, or failures are clearly documented.

Do not claim that the working tree is clean if unrelated uncommitted changes remain.

Do not include unrelated work in a commit without authorization.

---

## 7. Package Manager and Commands

Use the package manager, lockfile and scripts configured in the repository.

Inspect `package.json` before assuming project commands exist.

If Bun is configured, prefer Bun commands.

Do not:

- Switch package managers during unrelated work.
- Modify lockfiles unnecessarily.
- Add dependencies for problems the existing stack can solve cleanly.

If a dependency is necessary, explain its purpose and verify compatibility with the project's Expo / React Native versions.

Use focused commands and avoid exposing environment secrets.

---

## 8. Architecture

The expected primary stack is:

- React Native
- Expo
- Expo Router
- TypeScript
- Convex
- Convex Auth
- RevenueCat

Verify relevant details against current repository configuration.

Follow established project architecture.

Do not introduce an alternative routing, state-management, backend, authentication or styling framework as part of unrelated work.

If the architecture description is outdated, report and correct the factual documentation within the authorized scope.

---

## 9. Expo Router and Navigation

Before changing navigation:

- Inspect route files and parameter handling.
- Identify the canonical destination.
- Verify back navigation.
- Verify authenticated routing.
- Inspect external entry points and deep links where relevant.

Do not create duplicate routes for an existing canonical flow without a product requirement.

For changed navigation, consider both iPhone and Android.

---

## 10. Convex and Persisted Data

Treat backend changes as potentially cross-cutting.

Search relevant consumers before changing:

- Schema or indexes
- Query and mutation arguments
- Return shapes
- Authentication and authorization checks
- Scheduled functions
- Persistence semantics

When changing stored data behavior:

- Consider existing records and legacy optional fields.
- Preserve unrelated data and stable entity IDs.
- Distinguish omitted updates from explicit clearing.
- Inspect migration and backward-compatibility implications.
- Check concurrent updates where relevant.
- Avoid partial writes across logically related changes.

Do not make broad schema changes to solve a narrow UI issue.

Identify the actual authoritative data and derived representations before choosing a fix. Do not assume a particular table is the sole source of truth without inspection.

Do not use polling, forced refreshes or duplicated synchronization to conceal a persistence bug.

---

## 11. Authentication and Authorization

Use the existing authentication implementation and helpers.

Authentication and authorization are separate concerns.

For community, family and shared-data changes:

- Verify server-side permissions.
- Do not rely only on hidden or disabled UI controls.
- Check access to the specific entity being modified.
- Preserve distinctions between owner, admin, creator and member.
- Test unauthorized access when relevant.

Do not redesign authentication during unrelated work.

---

## 12. RevenueCat and Subscriptions

Use existing subscription abstractions and entitlement logic.

Before modifying subscription behavior, inspect:

- RevenueCat integration
- Subscription context
- Entitlement checks
- Upgrade and paywall flows
- Personal and Family differences

Do not change pricing, product identifiers, entitlement names, offerings or plan limits unless explicitly requested.

Do not assume historical pricing or plan decisions are final.

Never hardcode production secrets.

---

## 13. Hebrew, Inclusive Copy and Platforms

InYomi is Hebrew-first. RTL is a core requirement.

All new or edited user-facing copy must be suitable for all genders.

Prefer neutral wording, plural forms or naturally inclusive Hebrew. Do not default to feminine-only or masculine-only wording when a natural inclusive alternative exists.

Apply this to:

- Buttons and labels
- Onboarding
- Notifications
- Errors and empty states
- Subscription screens
- Accessibility text

For UI changes, verify as applicable:

- Hebrew alignment and layout direction
- Icon placement and row order
- Chevron direction
- Spacing and touch targets
- Truncation and wrapping
- Mixed Hebrew, English and numbers
- Dates and times
- Modals, bottom sheets and headers

Do not mechanically apply `row-reverse` or `text-right`.

Follow existing RTL helpers where they implement the intended layout correctly.

Consider iPhone and Android unless the task is explicitly platform-specific. If either platform cannot be tested, report that limitation.

---

## 14. Accessibility

Preserve meaningful accessibility semantics.

Consider:

- `accessibilityLabel`
- `accessibilityRole`
- `accessibilityHint` when useful
- Touch target size
- Disabled and loading states
- Screen-reader interpretation

Labels should explain the action or information, not merely satisfy a check.

---

## 15. TypeScript

Maintain strong type safety.

Prefer:

- Domain types
- Type narrowing
- Existing shared types
- Predictable return contracts

Avoid:

- Unnecessary `any`
- Unsafe casts that hide errors
- Duplicated frontend/backend contracts
- Assertions used only to silence the compiler

If types reveal a real contract mismatch, fix the contract.

---

## 16. React and Performance

Do not optimize mechanically.

Use memoization only when it solves a concrete rendering, dependency or performance problem.

Prefer readable, correct code.

Follow existing list-component conventions. Avoid expensive repeated calculations during rendering when a simpler appropriate location exists.

Do not introduce broad performance refactoring during a focused fix.

---

## 17. Styling and Images

Follow the styling and image infrastructure used in the affected area.

Reuse existing:

- Design tokens
- Shared components
- Typography and spacing
- Colors and border radii
- Image-loading and caching patterns

Do not convert whole components between styling systems during unrelated work.

For images, consider loading, errors, aspect ratio and accessibility when relevant.

---

## 18. Dates and Time

Date/time behavior is product-critical.

Inspect as applicable:

- Timezones and local device time
- Stored timestamps
- All-day events
- Recurrence
- Hebrew dates
- Past and upcoming classification
- External calendar imports
- Notification scheduling

Never use formatted display strings for chronological comparison.

Check relevant midnight, daylight-saving and timezone boundaries.

---

## 19. Personal, Family and Community Contexts

Shared entities may appear in multiple contexts.

Before modifying shared behavior, determine the effect on:

- Personal users
- Family users
- Family profiles and children
- Community members
- Community owners and admins
- Event creators
- Participants and non-participants

Do not assume a rule correct for one context is correct for all contexts.

Inspect significant consumers of changed shared logic.

---

## 20. Communities and RSVP

Community role, event participation and personal calendar inclusion are distinct concepts.

Do not infer participation merely from administrative privileges.

Preserve intentional distinctions between:

- Owner
- Admin
- Creator
- Member
- Participant
- Non-participant

When changing RSVP or calendar inclusion:

- Identify the canonical state and current approved rules.
- Inspect filters, counters and cards.
- Inspect event details and Home surfaces.
- Inspect notification dependencies.
- Preserve explicit user choices and relevant opt-outs.

Do not independently reinterpret RSVP in individual screens.

Do not assume calendar inclusion means an RSVP was submitted.

---

## 21. Event Tasks and Assignments

When changing task assignment, trace:

- Initial persisted state
- Form initialization
- Local assignment changes
- Save payload
- Backend mutation
- Persisted assignment fields
- Queries and derived counts
- Every affected display surface

Distinguish:

- Unsaved form changes
- Successfully saved changes
- Failed saves
- Persisted state after reopening

For assignment removal or reassignment:

- Verify all relevant assignment fields.
- Preserve task identity and unrelated data.
- Verify the previous assignee's read paths.
- Verify the new assignee's read paths when applicable.
- Inspect related notification lifecycle behavior.
- Preserve server-side permissions.
- Consider concurrent claims or edits where relevant.

Different surfaces may intentionally display different subsets of tasks.

A task remaining visible as unassigned does not mean it remains assigned to the previous user.

Similarly, removing an assignment does not necessarily remove the event from a calendar if another inclusion rule applies.

Use current approved domain specifications for precise visibility, counting and completion rules. Do not invent these rules from a single screen.

---

## 22. Event Details and Deep Links

Identify all relevant event-detail entry points.

Where parity is required, preserve consistent information and actions across in-app and externally opened views.

Inspect as applicable:

- Title, description and image
- Date, time and Hebrew date
- Location and meeting link
- RSVP and calendar actions
- Tasks and assignments
- Edit and delete permissions
- Community actions

For deep links, verify:

- Generation and parsing
- Authentication
- Correct destination
- Missing or deleted entities
- Permission failures
- Back navigation
- Cold-start and background opening

Do not casually change shared-link formats. Consider previously shared links.

---

## 23. Google Calendar Import

When modifying import behavior, trace:

External response → parsing → normalization → types → persistence → display/editing.

Preserve useful supported event information.

For meeting links, inspect relevant Google Meet, Zoom and Microsoft Teams representations, including Google `conferenceData` and `hangoutLink` where applicable.

Do not assume meeting-link import is already implemented.

For new imported fields, verify:

- Persistence
- Editing and display
- Join/open-link behavior
- Missing or malformed input
- Compatibility with existing imported records

Do not expand import scope beyond the task.

---

## 24. Push Notification Specifications

Use the current dedicated push specification when available.

For the notification being changed, identify:

- Identifier and trigger
- Recipients and exclusions
- Timing
- Scheduling and cancellation
- Rescheduling
- Deduplication
- Suppression conditions
- Copy and payload
- Deep link and actions
- Platform behavior
- Test scenarios

If the specification is missing or incomplete, use the explicit task requirements and report the documentation gap.

Do not assume a documented notification is implemented or verified.

---

## 25. Push Infrastructure and Lifecycle

Trace existing shared infrastructure before implementing notifications.

Inspect as relevant:

- Device token registration
- Expo, APNs and FCM handling
- Backend sender
- Scheduled functions
- Recipient resolution
- Payload contracts
- Action categories
- Deep-link routing
- Permission preferences
- Foreground, background and cold-start behavior

Reuse shared infrastructure where appropriate.

For scheduled notifications, consider what happens when an entity is:

- Edited or rescheduled
- Completed
- Cancelled or deleted
- Reassigned
- Declined
- Removed from a user's context

Determine whether existing schedules must be preserved, updated, cancelled or replaced.

Avoid duplicates and make scheduling idempotent where practical.

Recipient rules must explicitly determine who receives the notification and who must not, including whether the actor receives their own notification.

Do not assume registering an action category means its behavior is wired end-to-end.

---

## 26. Push Validation

Verify as applicable:

- Correct trigger and timing
- Correct recipients and exclusions
- Copy, payload and destination
- Action behavior
- Duplicate prevention
- Cancellation and rescheduling
- Deleted or inaccessible entity handling
- Permission-denied behavior
- Relevant automated tests
- iPhone and Android delivery and interaction

For multiple notifications, report each one separately.

Separate implementation status from validation status.

For example:

- Implementation: implemented / partial / blocked
- Automated checks: passed / failed / not run
- iPhone: verified / not verified
- Android: verified / not verified

Do not declare the suite fully verified when device checks remain outstanding.

---

## 27. Home and Shared Business Logic

Home aggregates multiple domains.

Before changing visibility, inspect source queries and shared logic rather than only rendered cards.

Consider:

- Events and tasks
- Community data
- Cancellations and dismissals
- Reminders
- Family-profile filters
- Date classification
- Personal assignment counts

Before creating a helper, search for existing canonical logic.

Before changing a shared helper, inspect its consumers.

Do not create competing definitions of participation, assignment, due state, event inclusion or recipient eligibility.

Share domain rules where appropriate while preserving intentional presentation differences between surfaces.

---

## 28. Tests and Validation

Tests should protect product behavior.

For bug fixes:

- Reproduce the actual regression when practical.
- Test the affected production path.
- Include material nearby edge cases.
- Prefer mutation/persistence coverage for persistence bugs.
- Do not merely copy implementation logic into a test.

Do not weaken tests solely to make a change pass unless approved behavior has changed.

Start with the smallest useful checks. Broaden testing when shared behavior or remaining risks justify it.

Use existing project scripts.

Report exact commands and actual results.

Distinguish:

- Passed checks
- New failures
- Confirmed pre-existing failures
- Failures whose origin is not yet established
- Checks not run

Do not label a failure pre-existing without evidence.

Passing automated tests does not prove visual, device or two-user behavior.

For relevant manual QA, identify:

- iPhone and Android
- User roles
- New and existing users
- Personal and shared data
- Foreground, background and closed-app states
- Subscription and notification-permission states
- Hebrew RTL

Only include scenarios relevant to the change.

---

## 29. Errors, Logging and Secrets

Do not swallow errors or show false success.

For save operations:

- Surface failure appropriately.
- Do not imply persistence succeeded when it did not.
- Preserve recoverable user input where appropriate.

Do not leave temporary debugging logs.

Do not log:

- Secrets
- Authentication tokens
- Private environment values
- Sensitive user content unnecessarily

Do not delete `.env` files or hardcode secrets.

`EXPO_PUBLIC_*` values are client-visible and must not contain secrets.

---

## 30. External Integrations

Handle optional and malformed external data safely.

Preserve backward compatibility where practical.

Do not assume third-party responses are complete.

Keep parsing and domain behavior separate where appropriate.

Verify relevant current integration contracts rather than relying on an old template or remembered API behavior.

---

## 31. Autonomous Work and Communication

The product owner may not manually review every line of code.

Therefore:

- Explain meaningful changes in plain language.
- Distinguish facts, assumptions and recommendations.
- Report changed files and actual verification.
- Avoid unnecessary low-level decisions for the user.
- Continue when the next step is clear, authorized and safe.
- Ask when a genuine unresolved product decision blocks safe progress.

For substantial work:

1. Inspect implementation and documentation.
2. Establish current and expected behavior.
3. Identify shared dependencies and risks.
4. Implement a focused change.
5. Test relevant behavior.
6. Update relevant documentation.
7. Review the final diff.
8. Report results and remaining checks.

Do not describe work as fully tested when manual or device verification remains.

---

## 32. Large Tasks and Parallel Safety

For a set of related features, identify shared infrastructure before implementing individual cases.

Work in logical batches and validate between batches where useful.

Do not assume tasks are safe to run concurrently because their descriptions differ.

Check overlap in:

- Files and components
- Hooks and helpers
- Backend functions and schema
- Shared types
- Generated files
- Package and configuration files
- Tests
- Business rules

Prefer sequential work when shared mutable infrastructure overlaps.

Parallel execution must follow the user's authorization and applicable environment rules.

For multi-item tasks, provide an item-by-item status report.

---

## 33. Documentation Responsibilities

Documentation maintenance is part of meaningful implementation work.

### Before implementation

Read the documentation relevant to the affected behavior.

Check whether it:

- Describes approved behavior or a proposal.
- Matches the current task's confirmed decisions.
- Contains known outdated statements.
- Conflicts with another relevant document.
- Distinguishes intended behavior from implementation status.

Do not audit unrelated documentation for every task.

### After implementation

If a durable behavior or system contract changed:

- Update the existing canonical domain document.
- Preserve unrelated decisions.
- Explain the new intended behavior accurately.
- Distinguish implemented behavior from unverified behavior.
- Do not mark deferred work complete.

If no suitable document exists and the change establishes a significant shared rule, create a concise domain document under the repository's existing documentation structure.

Examples include assignment semantics, calendar inclusion, RSVP rules, permissions and notification lifecycle behavior.

Do not create a new document for every small fix.

If a fix only restores already documented behavior, no specification rewrite is required. Report that the documentation remains accurate.

If a documentation conflict cannot be resolved from evidence, report it explicitly rather than silently choosing or rewriting a product rule.

### Documentation structure

- `AGENTS.md`: stable working instructions and concise navigation.
- Domain documentation: approved behavior and relevant architecture.
- Status/backlog documents: implementation progress, pending QA and deferred work.

Reuse existing canonical documents before creating new ones.

Do not create a Markdown file beside every source file.

Do not maintain duplicate descriptions of the same rule.

Do not invent document paths or links. Verify referenced files exist.

---

## 34. Maintaining AGENTS.md

Do not rewrite this file after every task.

Update it when:

- A stable engineering rule changes.
- A factual architecture statement is confirmed outdated.
- A recurring agent mistake requires a clear instruction.
- A verified documentation reference should be added or corrected.

Do not add:

- Temporary TODO lists
- Current test counts
- Commit-by-commit history
- Rapidly changing backlog status
- Unverified implementation claims
- Detailed feature specifications better kept in domain documents

Do not remove safeguards merely because they make a task inconvenient.

When changing this file, report what changed and why.

Reading this file is not the same as verifying that all its factual references remain current.

---

## 35. Product Rules, Bugs and Backlog

Keep these concepts distinct:

- Product rule: intended behavior to preserve until explicitly changed.
- Current implementation: what the code currently does.
- Bug: implementation contradicts intended behavior.
- Launch requirement: required before the release.
- Deferred item: desired work intentionally outside the current scope.
- Verified behavior: supported by checks actually performed.

Do not implement deferred work merely because it appears useful.

Do not mark implementation as verified without evidence.

---

## 36. Completion Report

After substantial work, provide a concise report containing:

### Summary
What changed and why.

### Root Cause
For bugs, the confirmed cause and relevant code path.

### Files Changed
Your meaningful changes and their purpose. Distinguish pre-existing work.

### Product Behavior
The resulting behavior and any intentional change to existing behavior.

### Tests and Checks
Exact commands, results and any failures or checks not run.

### Manual and Device Verification
What was actually verified, on which platform and with which relevant roles.
List outstanding checks separately.

### Documentation
- Relevant documentation reviewed.
- Documents updated or created and why.
- If no update was needed, explain briefly.
- Any unresolved documentation gap or conflict.

### Risks and Remaining Work
Material limitations, pending QA and deliberately deferred items.

### Diff and Git Status
Confirm that your diff was reviewed and unrelated changes were preserved.
State whether a commit or push occurred.

For multi-item tasks, include separate implementation and validation status for each item.

Avoid opening with "everything is clean and fully tested" when exceptions or pending checks exist.

---

## 37. Definition of Done

Implementation is ready for review when:

- The requested behavior is implemented.
- Affected shared flows were inspected.
- Relevant automated checks passed, or blockers are disclosed.
- Documentation was reviewed and updated where needed.
- The final diff was reviewed.
- Unrelated work was preserved.
- Remaining risks and manual checks are explicit.

The task is fully verified only when required manual, device and multi-user checks have also passed.

When those checks cannot be performed, report:

"Implementation complete; verification pending: ..."

Do not claim launch readiness based only on code changes or automated tests.

---

## 38. Final Principle

Treat InYomi as a real evolving product with accumulated decisions and existing users.

Optimize for:

1. Correctness
2. Product consistency
3. Regression safety
4. Maintainability
5. Simplicity
6. Performance

Prefer focused changes that deliver real user value.

Do not optimize for the amount of code, documentation or testing produced.