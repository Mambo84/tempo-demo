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
