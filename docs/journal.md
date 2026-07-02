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
