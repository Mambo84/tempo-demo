# Tempo build journal

Five lines per session: what shipped, what didn't, what's open, next step, brief updates.

---

## 2026-06-23 — Milestone 1: Supabase setup + auth

- **Shipped:** Supabase client + auth helpers (`src/lib/supabase.js`, `src/lib/auth.js`), `profiles` table migration with auto-create trigger (`supabase/migrations/0001_init.sql`), real email/password signup + login + logout wired into `App.jsx` (replaced the fake seed-lookup login). `.env.local` set; build + dev server green.
- **Didn't:** End-to-end verification against the live project — blocked on two dashboard steps only Brad can do (run the migration in the SQL Editor, disable "Confirm email").
- **Open:** Acceptance criteria not yet walked through on real data. Vercel Preview env vars not yet added. App body still runs on in-memory seed data behind the real-auth gate (by design — Option A; real data lands M3+).
- **Next:** Brad runs migration + disables email confirmation → walk the M1 acceptance criteria locally → add Vercel env vars (Production + Preview) → deploy + confirm on the Preview URL → commit.
- **Brief updates:** None. default_role implemented as initial-view hint only (toggle freely after login), consistent with §6.1 "UI hint, not auth".

---

## 2026-07-07 — Milestone 7 (Part 1): Injuries persistence — read + create + edit (complete)

- **Shipped:** Injuries move from in-memory to Supabase. New `src/lib/data/injuries.js` (`rowToInjury`/`injuryToRow` mappers, `listInjuries`, `listInjuriesForAthletes`, `createInjury`, `updateInjury`; mapper clamps `severity`→1..4 and validates `status` against the CHECK enum). Migration `0012_injury_columns.sql` adds seven nullable columns the demo UI wrote but `0005` never defined (`imaging_findings`, `treatment`, `prevention`, `rom_limitation`, `actual_rtp`, `follow_up`, general `notes`) — additive, no RLS change. Both shells wired: athlete `saveInjury`/`updateInjury` and practitioner `addInjury`/`updateInjury` persist for real users; demo personas stay in-memory (keeping their in-memory concussion auto-link). Commits `13506df` (Part 1) + `ef642f9` (wellnessAvg), pushed to `origin/main` → deployed to production.
- **Bug found + fixed (blank screen):** athlete self-reports leave `injury_type` null (athletes don't make the strain-vs-sprain clinical call — a practitioner classifies on review). The practitioner side crashed on `openInj.injuryType.split(...)` (`App.jsx:6010`). Full null-guard scan of every `inj.`/`openInj.` chain: fixed 6010 (`.split`) and 6005 (`.localeCompare` on nullable `reported_on`); card titles (6954/7141/9935) now fall back to **"Not yet classified"**; verified the rest already guarded (`recurrence`/`activity`/`statusChangedAt`, all `rtpProgress.map`).
- **Also closed:** the M4-ticketed `calc.wellnessAvg` — was averaging over a fixed /6 with `c[f] || 0`, counting disabled fields as 0 and dragging Recovery toward "Fresh". Now divides by answered values only (`v != null`, still admits a real 0). Its own commit `ef642f9`.
- **Verified:** M7 acceptance criteria 1–3 live against production Supabase (practitioner creates → athlete sees; athlete self-reports null-type → practitioner sees "Not yet classified", detail opens, classifying updates everywhere); both sides persist across hard-reload. Jethro's old seeded demo injuries are stale by design (no dedup — he re-enters real ones).
- **Next: M7 Part 2** — per-injury sharing writes (excluded/included + RLS exclusion end-to-end), concussion auto-linking (two-way `linked_injury_id`/`linked_concussion_id`), medical-field read/write gating (`view_medical`). Decisions D1–D8 from the Part-1 plan still stand; D2 (clinical-write needs `view_medical`+`edit_injuries`) and D3 (read gating app-layer, honest non-RLS caveat) are the Part 2 core.

---

## 2026-07-07 — Milestone 6 (Part 2): Cutover to production (complete)

- **Shipped:** Cut the backend over to production. Fast-forwarded `main` → `backend-mvp` (`bc65d5e..41882d6`, 8 commits, no merge commit, no conflicts) and pushed to `origin/main`, which triggered the Vercel Production build on `tempo-demo-mu.vercel.app`. `main` is now the real backend app; the in-memory demo is retired. No code changes this session — pure cutover.
- **Pre-flight:** Confirmed `main` was the clean pre-backend demo base (`bc65d5e`) and a strict ancestor of `backend-mvp` (guaranteed ff). Verified the two client env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are set in Vercel scoped to All Environments (⇒ Production) with values matching the Supabase project. `.env.local` confirmed gitignored (no secrets in repo).
- **Rollback plan (unused):** Recorded rollback target `bc65d5e` (the demo build). Primary path was Vercel Instant Rollback — promote the previous demo deployment back to Production, no git surgery; git-level `reset --hard bc65d5e` reserved for a full cutover revert. Not needed — smoke test passed clean.
- **Verified (production, incognito):** All 7 smoke tests pass on `tempo-demo-mu.vercel.app` — app loads (no blank screen ⇒ env vars reached runtime), auth end-to-end (login/logout), profile creates (M3), workout persists (M4), wellness persists (M4), the real Brad↔Jethro link surfaces (M5/M5.5), coordination note persists across reload (M6). Live against real Supabase.
- **Next:** M7 — injuries (read): surface real injury/concussion data through RLS, app-layer medical-field hiding (deferred from M2). Carry ticket: `calc.wellnessAvg` divide-by-enabled fix.

---

## 2026-07-03 — Milestone 6 (Part 1): Coordination notes persistence (complete)

- **Shipped — client (notes only, no cutover):** new data layer `src/lib/data/notes.js` (`rowToNote`/`noteToRow` mappers — `author_name`→`author`, `author_role`→`role`, `created_at`→`date`; `listNotes`, `listNotesForAthletes`, `createNote`, `acknowledgeNote`, `archiveNote`). Athlete `Promise.all` load gains `listNotes` (dropped the `setCoordinationNotes([])` placeholder); acknowledge/archive are now async — optimistic local update then persist for a real athlete (demo personas stay in-memory). Practitioner roster load replaces `setNotes([])` with `listNotesForAthletes(ids)`; `addNote` is async and calls `createNote` for a real practitioner. `CoordinationNotesPanel` + `NoteComposer` untouched. Build green; `notes.js` lint-clean; App.jsx error count unchanged at 51 (no new errors).
- **No server changes:** M2's `0006_notes_and_files.sql` already provides the `notes` table + RLS (self sees `visibility='athlete'` only; others need `view_notes`, `medical` needs `view_medical`; insert gated on `author_user_id=auth.uid()` AND self/`edit_notes`; self/`edit_notes` can update → ack/archive). No migration needed for M6.
- **One required new UI bit:** `pNoteCard` now shows "✓ Acknowledged · {date}" (green) or "Awaiting acknowledgement" (muted) for `visibility='athlete'` notes — needed for the "practitioner sees acknowledged status" criterion; the demo card had no ack indicator.
- **Decisions (Brad, all three confirmed):** (1) no athlete-side composer — "both ways" = ack/archive flowing back (build athlete→staff messaging later only if pilot surfaces the need); (2) persist all three visibility levels now (composer + RLS already handle them; persisting only 'athlete' would be a silent-drop bug needing re-verification); (3) no archive-status badge on the practitioner side (note staying visible satisfies the criterion).
- **Verified:** All M6 Part-1 acceptance criteria pass live — practitioner writes a note → athlete sees it on home → acknowledges → practitioner reloads and sees "✓ Acknowledged" → athlete archives (leaves athlete home, still visible to practitioner). Staff-only visibility respected (athlete does not see staff notes). DB rows confirmed in Supabase.
- **Next: M6 Part 2 — the cutover.** Dedicated next session: merge `backend-mvp` → `main` (deliberately deferred, not done here). Then M7 — injuries (read). Carry ticket: `calc.wellnessAvg` divide-by-enabled.

---

## 2026-07-02 — Milestone 5.5: Athlete→practitioner invitations (complete)

- **Shipped — server (`0011_athlete_invites.sql`):** `invitations` gains `direction` (p2a|a2p) + nullable `athlete_id` (FK, cascade); INSERT tightened so an athlete may only attach their own profile (`is_athlete_self`). Unified `accept_invitation(id, role?, perms?)` (dropped the M5 1-arg version) branches on direction — a2p: accepter = invited practitioner (grantee), link `athlete_id` from the invite, role/perms from the accept params. `list_my_invitations()` now returns `direction` + athlete name.
- **Shipped — client:** `invitations.js` extended (direction/athleteId on create + mapper; `acceptInvitation(id, role, perms)`). Extracted module-level `STAFF_ROLE_OPTIONS`/`PERM_LABELS`/`permsForRole`/`grantedPermLabels` (single source, from seed `PERM_TEMPLATES`). Athlete: `AthleteAccessView` now has an **invite form** (email + suggested role + optional message, no perm toggles) + a sent-invites list with cancel. Practitioner: loads received a2p invites → roster **banner** → `PractitionerAcceptInvite` screen (role picker pre-filled from the athlete's suggestion, permission preview) → accept reloads the roster (`reloadNonce`). Build green; data file + App.jsx lint-clean (no new errors).
- **Decisions (Brad):** permissions authority = (a) client computes from `PERM_TEMPLATES` on accept (single source, mirrors M5 p2a; athlete's review+revoke in `AthleteAccessView` is the consent backstop; server-side derivation rejected — no real threat model, avoids SQL template duplication). Suggested role pre-fills the practitioner's picker. Recorded as decisions 13–15 in `docs/schema.md`.
- **Deferred:** decline persists nothing (local dismiss); athlete invite has no expiry UI; contact-sharing controls still not wired for real athletes; club-admin bulk invite demo-only. Carried ticket: `calc.wellnessAvg` divide-by-enabled.
- **Verified:** All 5 M5.5 acceptance criteria pass live — athlete invite creates pending `direction=athlete_to_practitioner` → practitioner sees roster banner → accepts with pre-filled suggested role → both sides see the link → athlete revoke removes access on next fetch → M5 p2a direction still works end-to-end. `0011` run in the SQL Editor.
- **Next:** **M6 — coordination notes (the cutover milestone).** Once M6 ships and is tested by Brad + athlete on real accounts, merge `backend-mvp` → `main`. Carry ticket: `calc.wellnessAvg` divide-by-enabled.

---

## 2026-07-02 — Milestone 5: Practitioner→athlete linking (complete)

- **Direction corrected mid-plan:** M5 is **practitioner→athlete** (practitioner invites an athlete by email), not athlete→practitioner (that's M5.5). This drove a schema decision: the invite can't live in `athlete_user_links` (NOT NULL `athlete_id`; the athlete may not exist yet; practitioner isn't an admin) → **Option A: a dedicated `invitations` table** (Brad approved; recorded in `docs/schema.md` decisions 7–12).
- **Shipped — server (`0010_invitations.sql`):** `invitations` table + RLS (inviter-only SELECT/INSERT/UPDATE); `accept_invitation(id)` + `list_my_invitations()` SECURITY DEFINER RPCs (invitee discovery/accept without loosening policies or leaking emails); `shares_athlete_with()` helper + broadened `profiles` SELECT (M2 follow-up); **expiry enforcement** added to the four M2 helpers (`create or replace`).
- **Shipped — client:** data layer `src/lib/data/invitations.js` + `links.js` (+ batch `listWorkoutsForAthletes`/`listWellnessForAthletes`). Practitioner: `PractitionerInviteAthlete` screen (email + role from `PERM_TEMPLATES`), pending-invites list w/ cancel, roster via `listMyAthletes` (feeds existing `accessibleAthleteIds`/`canAccess`/detail unchanged). Athlete: home accept-banner (`listMyInvitations`→`acceptInvitation`) + focused `AthleteAccessView` ("who has access" + revoke, DB-backed). Real vs demo split via `isRealPractitioner` (new `isDemo` tag on switcher personas) / `isRealAthlete`. Build green; new data files lint-clean; no new no-undef/hook errors.
- **Decisions (all six confirmed):** email skipped (in-app discovery); invites always pending; expiry enforced in RLS; `invited_name`/`invited_by_athlete` dropped from links (invitations has own `athlete_name`/`message`); acceptance banner on athlete home; revocation next-fetch. Deferred: athlete-initiated invites (M5.5 — `createLink` guarded for real athletes), contact-sharing controls for real athletes, notes/injuries/tests/files persistence (their milestones), club-admin bulk `TeamAccessScreen` (demo-only).
- **Verified:** All 5 M5 acceptance criteria pass live — practitioner invite → pending row → athlete accepts via banner → link activates → roster shows the athlete with real workouts + wellness → unlinked third account sees nothing → athlete revocation removes access on next fetch. RLS correct across all tests. `0010` run in the SQL Editor.
- **Next — M5.5: athlete→practitioner invites** (athlete initiates, with athlete-chosen permissions). Scope: (1) wire the athlete-side invite (`AthleteInviteFlow`/`createLink`, currently guarded off for real athletes) to persist; (2) extend the `invitations` table/RPCs to the athlete-initiated direction — the grantee is the invited practitioner (by email), not the inviter, so `accept_invitation` and `list_my_invitations` need a direction/grantee notion; (3) restore the athlete-side invite button in place of the M5 "coming soon" guard; (4) let the athlete set per-permission toggles at invite time. Also carry the earlier ticket: `calc.wellnessAvg` → divide by enabled non-null fields.

---

## 2026-07-02 — Milestone 4: Wellness check-ins + settings persistence (complete)

- **Shipped:** New data layer `src/lib/data/wellness.js` (`listWellness`, `saveWellness` upsert on the `athlete_id+date` unique key, row↔UI mappers). `athletes.js` gains `updateWellnessSettings` + a `wellnessToRow` serializer (stores canonical snake_case `enabled_fields`). `AthleteApp` load now fetches wellness alongside workouts (`Promise.all`) for a real athlete; `saveCheckin` upserts to Supabase and replaces any same-date row locally; `AthleteSettings` onChange persists frequency/field toggles to `athletes.wellness_settings`. Recovery card, `wellnessDue`, `todayCheckin`, History all read the now-hydrated `checkins` state unchanged. Build green; new/changed data files lint-clean.
- **Design:** Wellness form is today-only (`existing={todayCheckin}`, submit stamps today) → create + re-do collapse to one upsert; no update/delete endpoints (no UI). `wellness_checkins` has no `created_by`, so nothing stamped. Settings write serializes camel `enabledFields` → snake `enabled_fields` (matches column default); `wellnessToUi` reads either. Settings persist on every toggle (immediate onChange) — fine at pilot scale.
- **Decisions (Brad):** (1) snake_case on write; (2) upsert nulls unsent/disabled fields — accepted; (3) leave the divide-by-6 `wellnessAvg` quirk for M4; (4) no "clear today's check-in" affordance this milestone.
- **Ticketed for M5:** `calc.wellnessAvg` divides by all 6 fields even when some are disabled (disabling questions skews Recovery toward "Fresh"). Change to divide-by-enabled-non-null.
- **Verified:** All 5 M4 acceptance checks pass live (check-in persists across refresh; frequency 'weekly' persists across sessions; disabled fields drop from the form; Recovery card shows the real 7-day average; DB rows confirmed). Practitioner side still seed-backed until M5.
- **Next:** M5 — practitioner role + linking (invite flow, roster, athlete detail via RLS). Also carry the ticketed `wellnessAvg` divide-by-enabled fix into M5.

---

## 2026-07-01 — Milestone 3: Athlete profile + workouts persistence (complete)

- **Shipped:** Data-access layer `src/lib/data/athletes.js` + `src/lib/data/workouts.js` (snake_case↔camelCase mappers, RLS-backed CRUD). First-login profile-creation flow: real athlete-role users with no `athletes` row get `AthleteProfileSetup` (name/position/sport required, team/squad optional), which writes the athlete row **and** the `self` link (full perms). `AthleteApp` now DB-backed for a real athlete — `listWorkouts` on load, `saveWorkout`/`deleteWorkout` async to Supabase (create/update/delete), edits stamp `edited_at`. Root resolves `getMyAthlete` and routes setup vs app. Build green; new data files lint-clean.
- **Design:** Real athlete (DB) vs demo persona (seed) split on `realAthlete` prop / `isRealAthlete`. Demo `IdentitySwitcher` personas stay seed-backed (escape hatch preserved); practitioner side untouched (real linking is M5). max_velocity converts m/s↔km/h in the data layer. Fields without a column (contact/emergency/GP/medical, contactSharing) fold into `profile_extras`; `injuryStatus` defaults to 'available' (injury-derived, M7). CSV import **dropped** from scope (workbook is a forward-looking season planner, not historical data — Brad will hand-enter the ~13 filled sessions).
- **Confirmed (Brad's note):** `calc.monotony`/`strain`/`acwr` read `w.date`/`w.rpe`/`w.duration` only — `rowToWorkout` emits exactly those keys, so the load-calc module works unchanged against DB-read data.
- **Noted for later:** (1) Athlete's workflow uses AM/PM session splits — consider a `time_of_day` field on `workouts` in a future milestone if it proves to matter (not built now). (2) For a real athlete, the GPS-import / privacy / wellness-settings views still run in-memory (no persistence) until M4/M5/M11 migrate them — expected, not a regression.
- **Verified:** M3 acceptance passed live (sign up → create profile → log session → logout/login → persists; edit persists; delete removes). Includes the post-verify fix to `createAthlete` (client-side uuid + no-`.select()` insert then self-link, to dodge the RETURNING command-snapshot RLS trap on the just-inserted row).
- **Next:** Committed together with M4 (both were verified before either was committed; changes interleave in `App.jsx`/`athletes.js`). Then M4.

---

## 2026-06-25 — Milestone 2: Schema + RLS (complete)

- **Shipped:** All §6 tables ran clean in the Supabase SQL Editor across `0002`–`0007` (helpers, athletes+links, training data, injuries+concussion, notes+files, audit). Every table RLS-enabled with policies built on four security-definer helpers (`is_athlete_self`/`has_athlete_access`/`has_athlete_permission`/`has_athlete_admin`) to dodge policy recursion. Included a dev seed (`0008`) + self-contained RLS proof harness (`0009`, impersonates 4 users and asserts row counts) and a full schema + decision log in `docs/schema.md`. Last-minute fix before running: `concussion_baselines` read changed `view_medical`→`view_injuries` to stay symmetric with its `edit_injuries` write gate and match `concussion_incidents`.
- **Decisions worth highlighting:** Medical-field hiding is app-layer (deferred to M7) since RLS is row- not column-level; owner/self always bypasses the `permissions` JSON; admin = owner/self or `role='club_admin'`; CHECK constraints only on well-documented ranges so M3 CSV import isn't rejected. All six logged in `docs/schema.md`.
- **Documented future work (no action now):** M5 — broaden `profiles` SELECT for roster/linking UX; M10 — expand `athlete_files` writes beyond self/admin so linked physios can upload scans. Both flagged in `docs/schema.md` and Brad's journal.
- **Open:** `0008`/`0009` are dev-only (they insert into `auth.users`) — must NOT run in prod. No frontend changes (correct for M2; demo still on in-memory state).
- **Next:** M3 — athlete profile + workouts persistence. Replace in-memory `workouts` state with Supabase reads/writes, auto-create the `athletes` row + `self` link on first athlete login, CSV import for the historical Excel data.

---

## 2026-06-24 — M1 fix: real login no longer auto-picks a demo identity

- **Shipped:** Replaced `demoUserForRole()` (auto-selected first seed user → "Sarah Voss") with `realUserFromSession()` in `App.jsx`. After a real login, `currentUser` is now built from the session's auth metadata (display_name, default_role, title) — synchronous, no profiles fetch, per the "route off session" rule. Added `practitioner: 'Practitioner'` to `ROLE_LABELS`. **Verified live** locally: practitioner + athlete signups both show the real display_name (no Sarah Voss); session persists across reload; wrong password rejected; logout works. Athlete path correctly lands on an empty home screen (M1-correct — no real athlete data until M3). This commit also lands the previously-uncommitted M1 work: Supabase client + auth helpers (`src/lib/`), `profiles` migration (`supabase/`), and the real auth gate.
- **Didn't:** Remove the demo IdentitySwitcher — left in place as a manual escape hatch (proper removal deferred to M3). Vercel Preview env vars: confirm they're set after this push.
- **Open:** Real athlete-role users have no `athleteId`, so an athlete-role login shows an empty seed body until M3 brings real athlete/profile data. Practitioner body still seed-backed by design.
- **Next:** Commit + push `backend-mvp` → walk the same acceptance checks on the Vercel Preview URL → close out M1.
- **Brief updates:** None.
