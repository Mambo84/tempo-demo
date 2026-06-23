# Tempo — Claude Code Build Brief

**Athlete load monitoring app · Backend MVP**

Version 1.0 · For Claude Code working with Brad as product owner
Stack: Supabase + React/Vite (existing) + Vercel + GitHub
Estimated timeline: 12–16 weeks at part-time pace
First real user: Brad working with a footballer managing stress-related injuries

---

## How to use this document

This brief is for Claude Code. Brad will paste it (or sections of it) into a Claude Code session as the build progresses. It is not a one-time spec — it's a living reference. Brad will refer back to it constantly. Some milestones will land cleanly; others will need adjustment. When that happens, Brad updates the brief.

Read this document in three modes:

1. **As a primer.** First time through, read sections 1–4 to understand what's being built and why. The product philosophy in section 3 matters more than any technical detail.
2. **As a milestone driver.** When working on a milestone, focus on that milestone's section and the schema sections it touches.
3. **As a guardrail.** When tempted to add scope, re-read section 5 (Out of Scope) and section 3 (Principles). The product fails by accretion of unused features, not by missing them.

---

## 1. What we're building

A backend for an existing single-file React prototype (`src/App.jsx`, ~15,000 lines, deployed at tempo-demo-mu.vercel.app). The prototype works end-to-end as an interactive demo with in-memory state. This build replaces the in-memory state with real persistence, real auth, and real multi-user behaviour, while keeping the UI essentially unchanged.

**At the end of the build, the following must work:**

- A real user signs up, creates an account, logs in
- That user can be an athlete or a practitioner (S&C, physio, coach, etc.)
- Athletes log workouts, wellness check-ins, files, and injuries — and these persist
- Practitioners can be linked to athletes via consent-flow invitations
- Linked practitioners see the athlete's data according to permissions
- Coordination notes flow between practitioner and athlete in real time
- Injury management is collaborative: anyone with edit access can update milestones, the athlete controls who sees what
- Multiple users seeing the same athlete see the same data
- Everything previously demonstrated in the prototype works against real data

**What we're not building yet:** integrations (Strava, Apple Health, TeamBuilder), push notifications, mobile native apps, advanced reports, payment/billing, organisation management beyond the basics. These are documented in section 5.

## 2. Who this is for

### Primary user (first to use it for real)

Brad — the product owner, who is also a working S&C coach with one specific athlete: a footballer with a history of stress-related injuries, planning a local season, then VFL the year after, then aiming higher. Real data exists in an Excel sheet ready to import. Brad will use Tempo to coach this athlete during the local season, which starts in roughly the timeframe this build completes.

This is a real user with real consequences for the product. If Tempo doesn't work for this athlete, Tempo isn't shipping further.

### Triangulation users during the build

- **The athlete himself.** Friendly-pilot bias acknowledged (he'll log because Brad asks). Useful for whether the athlete-side UX holds up, not whether it generates spontaneous adoption.
- **Brad's colleague.** Honest read on whether the product has market scalability. Not a heavy user. Provides perspective on what would work or not work for users beyond Brad's immediate circle.
- **Her football team.** Potential pilot for week 12+ once the MVP is solid — this is the second real test of the product.

### Target market positioning

Validated in pilot scoping with Ryan Plavin (S&C consultant):

> "Semi-elite but not elite. Local footy clubs. Private S&C clients."

This is the segment. Not enterprise clubs with existing data agreements (they're locked out by compliance). Not casual fitness app users (they don't need the depth). The middle band — committed individuals, small clubs, private practitioners — is where Tempo belongs.

## 3. Product principles

These are non-negotiable across the build. They override individual feature decisions. When in doubt, re-read this section.

### 3.1 The athlete UI stays calm

The athlete-facing app must remain low-friction, low-pressure, calm. It should never feel like sports science software. Wellness check-ins under 10 seconds. Session logging under 15 seconds. One recommendation, never multiple. No medical jargon. No injury prediction. No "risk scores."

When tempted to add complexity to the athlete app, ask: does this help adherence, or does it impress practitioners? If the latter, it belongs in the practitioner dashboard.

### 3.2 Consent flows from the athlete

The athlete decides what to share and with whom. Default permissions exist for convenience (a physio defaults to medical access), but the athlete can override per-injury or per-data-type. No staff member can grant themselves access without an active consent link.

This includes the wellness opt-out: athletes can turn off check-ins entirely, choose reduced cadence, or hide specific questions. Staff see "Wellness off" rather than "0% compliance" — opting out is a valid choice, not a problem.

### 3.3 Never claim what we can't deliver

ACWR (acute:chronic workload ratio) is shown as context, never as injury prediction. Monotony scores are shown as "low variation," not as injury risk. Wellness trends are shown as patterns to notice, not as diagnoses. The product is informative, not predictive.

When the practitioner side surfaces flags, the language should always make clear these are signals worth a closer look, not statements of fact.

### 3.4 Collaboration over hierarchy

Injuries are not owned by one person. The athlete reports symptoms. The physio adds diagnosis. The S&C notes training modifications. The coach reads availability. All in one record. Milestone checkboxes are tappable by anyone with edit access — and the system records who marked them and when. Status changes have an audit trail.

This is the product's defining feature relative to existing tools. Smartabase silos. TrainingPeaks is single-user. TeamBuildr is for the coach. Tempo is for the team around the athlete.

### 3.5 Honest tradeoffs over hidden defaults

When the athlete makes a choice with consequences (opting out of wellness, excluding a staff member from an injury), the consequences are stated clearly and without guilt. No nag screens, no dark patterns. The product respects the user's choices and tells them what those choices mean.

### 3.6 No useless data capture

This is the deal-breaker from pilot scoping. Every screen, every input, every notification must earn its existence. If a feature exists, it must answer the question: "what does the user do with this?" If the honest answer is "nothing yet" or "feels comprehensive," remove it.

### 3.7 The schema is more durable than the UI

Build the database to handle features we haven't built yet. Adding a column is cheap; restructuring a schema with real user data is expensive. When uncertain about whether to add a field, add it — but don't expose it in the UI until there's a real reason.

## 4. Architecture overview

### Stack

- **Frontend:** existing React/Vite app, deployed via Vercel
- **Backend:** Supabase (Postgres + Auth + RLS + Storage + Edge Functions)
- **Hosting:** Vercel (frontend), Supabase (backend)
- **Version control:** GitHub, existing repo `Mambo84/tempo-demo`
- **Branch strategy:** `main` keeps the demo until cutover. All backend work on `backend-mvp` branch. Cut over to `main` only once Milestone 6 (multi-user end-to-end) is shipped and tested.

### Why Supabase

Three reasons:
1. **Auth, database, storage, edge functions in one place.** No separate services to integrate.
2. **Row-level security (RLS).** Permission logic lives in the database, not the app. This is the right place for it given the consent model.
3. **Real-time subscriptions built in.** When the backend supports it, we can have the practitioner dashboard update when an athlete logs a session, without polling.

### Constraints

- **Free tier first.** Stay on Supabase free tier and Vercel Hobby until there's actual usage that requires upgrading. Free tier limits: 50,000 monthly active users, 500MB database, 5GB bandwidth, 1GB file storage. None of these will be hit in the pilot.
- **No custom domain initially.** Stay on `tempo-demo-mu.vercel.app` (or a new Vercel URL). Custom domain is a phase 2 cost.
- **No payment processing.** Pilot is free for all users. Stripe etc comes after pilot validates demand.

### Key architectural decisions

**Auth model.** Supabase Auth with email/password. Magic links optional but not default — they're nicer UX but introduce email deliverability as a dependency. Magic links can be added later.

**Single users table, role per link.** A user is just a user. They become an "athlete" or "practitioner" through their links to athlete profiles. One person can be both (e.g. a coach who also trains and tracks their own load). Don't model "athletes" and "practitioners" as separate user types — model them as different relationships to athlete profiles.

**Athlete profile is separate from user account.** An athlete profile can exist before its owner has an account (a club admin might create profiles in bulk). The profile and the account link together via an `athlete_user_links` table. The owning user has role `self`.

**RLS everywhere.** No data access goes through public tables. Every table has RLS policies that check the link table for access. The frontend never trusts itself.

**No service role in frontend.** The frontend uses the public anon key. Server-side operations that need service role (e.g. creating invitations) go through Supabase Edge Functions.

## 5. Out of scope (do not build)

These are explicitly excluded from this build. They have been considered and deferred. When tempted to add them, refer back here.

- **Strava / Apple Health / Garmin integration.** Phase 2 after MVP ships. The compliance problem they solve is real but partial (they don't solve subjective RPE/wellness). Building them now is 6–10 weeks of work better spent on the core.
- **TeamBuilder integration.** Vendor lock-in for a tool only some pilots use. Phase 5 if ever.
- **Push notifications.** Phase 2. The webhook-triggered "How was that run?" prompt is the right shape — it requires integrations to exist first.
- **Reports / PDF exports.** Phase 3. The request came up in pilot feedback but was vague. Validate the use case (when would the user generate the report? who would they show it to?) before building.
- **Native mobile apps.** Web-responsive only. The current React app works well on mobile browsers.
- **Real-time messaging / chat.** Coordination notes are async by design. Chat is feature creep.
- **Video upload, marketplace, public leaderboards, AI coaching, billing.** None of these in this build.
- **Multi-organisation management.** The pilot is small-scale. Adding org switching, billing per org, admin hierarchies — none of these are needed yet.
- **Custom domain.** Phase 2.
- **GDPR/HIPAA compliance work beyond basics.** Privacy controls, audit logging, deletion are in. Formal compliance certification is a phase 4 problem.

## 6. Schema

This section defines the Postgres schema for the backend. Tables, columns, relationships, RLS policies. This is the source of truth. The schema follows from the prototype but cleans up the in-memory shapes.

All tables use `uuid` primary keys generated by Supabase. All have `created_at` and `updated_at` timestamps. All have RLS enabled.

### 6.1 Core tables

**`profiles`** — extends Supabase's auth.users with display info.
```
id              uuid PK (references auth.users.id)
display_name    text
title           text          -- e.g. "Physio", "S&C Coach"
default_role    text          -- 'athlete' | 'practitioner' (UI hint, not auth)
created_at      timestamptz
updated_at      timestamptz
```

**`athletes`** — the athlete profile, may exist before the owning user has an account.
```
id              uuid PK
owner_user_id   uuid FK -> profiles.id NULL  -- the athlete themself, if they have an account
display_name    text NOT NULL
player_id       text                          -- club ID
position        text
team            text
squad           text
date_of_birth   date
sex             text
height_cm       numeric
weight_kg       numeric
sport           text                          -- e.g. "Football", "Tennis"
profile_extras  jsonb                         -- catch-all for less-common fields
wellness_settings jsonb DEFAULT '{"frequency":"daily","enabled_fields":{...}}'
created_by      uuid FK -> profiles.id
created_at      timestamptz
updated_at      timestamptz
```

**`athlete_user_links`** — many-to-many between users and athletes, with role + permissions.
```
id              uuid PK
athlete_id      uuid FK -> athletes.id
user_id         uuid FK -> profiles.id
role            text          -- 'self' | 'head_coach' | 'sc_coach' | 'physio' | 'clinician' | 'consultant' | 'club_admin'
permissions     jsonb         -- { view_basic, view_workouts, view_wellness, view_injuries, view_medical, view_gps, view_hr, view_notes, view_reports, view_export, edit_profile, edit_workouts, edit_injuries, edit_notes }
status          text          -- 'pending' | 'active' | 'revoked'
invited_by      uuid FK -> profiles.id
invited_email   text          -- for pending invites where user doesn't exist yet
accepted_at     timestamptz
revoked_at      timestamptz
expires_at      timestamptz   -- optional, for time-limited access
created_at      timestamptz
updated_at      timestamptz
UNIQUE(athlete_id, user_id)
```

### 6.2 Training data

**`workouts`** — sessions logged by athlete or imported.
```
id                  uuid PK
athlete_id          uuid FK -> athletes.id
date                date NOT NULL
type                text          -- 'Run' | 'Strength' | 'Match' | etc
duration_min        integer
rpe                 integer       -- 0-10
note                text
source              text          -- 'manual' | 'strava' | 'apple' | 'csv' | 'practitioner'
session_load        integer       -- generated: rpe * duration_min
-- Optional GPS/external load fields, all nullable
distance_m              numeric
high_speed_distance_m   numeric
sprint_distance_m       numeric
sprint_efforts          integer
max_velocity_kmh        numeric
accelerations           integer
decelerations           integer
player_load             numeric
-- Optional HR fields
hr_avg                  integer
hr_max                  integer
hr_zones                jsonb    -- { z1, z2, z3, z4, z5 }
-- Metadata
external_id             text     -- for dedup with imports
edited_at               timestamptz
created_by              uuid FK -> profiles.id
created_at              timestamptz
updated_at              timestamptz
```

**`wellness_checkins`** — daily wellness data from athlete.
```
id              uuid PK
athlete_id      uuid FK -> athletes.id
date            date NOT NULL
fatigue         integer       -- 0-7, higher = worse
soreness        integer
sleep           integer
stress          integer
mood            integer
motivation      integer
note            text
created_at      timestamptz
updated_at      timestamptz
UNIQUE(athlete_id, date)
```

### 6.3 Injuries

**`injuries`** — collaborative injury records.
```
id                  uuid PK
athlete_id          uuid FK -> athletes.id
status              text       -- 'out' | 'modified' | 'returned'
body_region         text NOT NULL
side                text       -- 'Left' | 'Right' | 'Both' | 'N/A'
injury_type         text       -- e.g. 'Strain (muscle)', 'Stress fracture'
mechanism           text
contact_mechanism   text       -- 'Contact' | 'Non-contact'
activity            text       -- e.g. 'Match', 'Training'
activity_context    text
severity            integer    -- 1-4
recurrence          text
prior_injury_ref    text
occurred_on         date NOT NULL
reported_on         date
reported_by         text       -- name string for display
self_reported       boolean DEFAULT false
-- Athlete self-report fields
athlete_description text
what_you_felt       text
pain_scale          integer
interventions       text
-- Clinical fields (gated by view_medical)
diagnosis           text
icd10               text
osics_code          text
imaging             text
imaging_date        date
clinician_notes     text
-- RTP progression
rtp_progress        jsonb      -- array of {stage, achieved, date, completed_by}
expected_rtp        date
-- Status change audit
status_changed_at   timestamptz
status_changed_by   text
-- Per-injury sharing overrides
sharing             jsonb      -- {excluded: [user_ids], included: [user_ids]}
-- Concussion linking
linked_concussion_id uuid FK -> concussion_incidents.id NULL
created_by          uuid FK -> profiles.id
created_at          timestamptz
updated_at          timestamptz
```

**`concussion_incidents`** — separate clinical record for concussion management.
```
id                  uuid PK
athlete_id          uuid FK -> athletes.id
date                date NOT NULL
mechanism           text
description         text
sport               text
symptoms            text
rtp_status          text       -- 'stage_1' through 'stage_6'
scat_data           jsonb      -- SCAT5 / 6 form data
linked_injury_id    uuid FK -> injuries.id NULL
auto_created        boolean DEFAULT false
reported_by         text
notes               text
created_at          timestamptz
updated_at          timestamptz
```

**`concussion_baselines`** — per-athlete baseline data for comparison.
```
id              uuid PK
athlete_id      uuid FK -> athletes.id
recorded_on     date NOT NULL
data            jsonb      -- SCAT baseline values
created_at      timestamptz
UNIQUE(athlete_id, recorded_on)
```

### 6.4 Performance testing

**`tests`** — individual test results.
```
id          uuid PK
athlete_id  uuid FK -> athletes.id
test_key    text NOT NULL    -- e.g. 'cmj', 'sprint_10m', 'vo2max'
date        date NOT NULL
value       numeric
unit        text
notes       text
created_by  uuid FK -> profiles.id
created_at  timestamptz
updated_at  timestamptz
```

The test catalog is hardcoded in the frontend (not a database table). Keys must match the catalog. Catalog includes ~75 tests across Aerobic, Speed, Agility, Power, Strength, Body composition (including PHV cluster), Clinical, and Custom.

### 6.5 Notes

**`notes`** — coordination notes, clinical notes, coach notes.
```
id              uuid PK
athlete_id      uuid FK -> athletes.id
author_user_id  uuid FK -> profiles.id
author_name     text       -- denormalised for display
author_role     text       -- denormalised, e.g. "Physio"
type            text       -- 'Coordination' | 'Coach' | 'Clinician' | 'Admin'
visibility      text       -- 'athlete' | 'staff' | 'medical'
text            text NOT NULL
acknowledged    boolean DEFAULT false
acknowledged_at timestamptz
archived        boolean DEFAULT false
created_at      timestamptz
updated_at      timestamptz
```

### 6.6 Files

**`athlete_files`** — uploads (scans, programs, reports).
```
id              uuid PK
athlete_id      uuid FK -> athletes.id
name            text
description     text
file_path       text       -- Supabase Storage path
mime_type       text
size_bytes      integer
uploaded_by     uuid FK -> profiles.id
visibility      text       -- 'athlete' | 'staff' | 'medical'
created_at      timestamptz
updated_at      timestamptz
```

### 6.7 Audit

**`audit_log`** — who saw what when.
```
id          uuid PK
user_id     uuid FK -> profiles.id
athlete_id  uuid FK -> athletes.id
action      text       -- 'view_workouts' | 'view_medical' | etc
detail      text
ip_hash     text       -- hashed for privacy
created_at  timestamptz
```

Audit logging is critical for the consent model. The athlete should be able to see who has looked at their data.

### 6.8 RLS policies — the rules

For each table, the policies enforce:

- **`athletes`**: read if user has an active link to the athlete; write only by `owner_user_id` or by users with `edit_profile` permission on that athlete.
- **`athlete_user_links`**: read if user_id matches the link, OR if user has admin permission on the athlete. Write only by the athlete or by users with admin permission.
- **`workouts`, `wellness_checkins`**: read if active link with view permission. Write by athlete or by users with `edit_workouts`.
- **`injuries`**: read if active link with `view_injuries` AND not in `sharing.excluded`. Medical fields only visible if `view_medical` OR if user is in `sharing.included`. Write by athlete or by users with `edit_injuries`.
- **`notes`**: read if active link with `view_notes` AND visibility allows. Athletes always see `visibility='athlete'` notes for themselves.
- **`audit_log`**: athletes can read their own audit log. Staff can see logs of access they made themselves.

RLS policies live in migration files. They are reviewed line-by-line at Milestone 2.

## 7. Milestones

The build is structured as ~12 milestones, each shippable independently and verifiable end-to-end. Each milestone should result in a deployable version that can be tested against the demo features at parity for what's in scope.

Milestones are ordered for dependency, not priority. Don't reorder without thinking carefully.

### Milestone 1 — Supabase setup + auth

**Goal:** A user can sign up, log in, log out. Nothing else works yet.

**Tasks:**
- Set up Supabase project (free tier)
- Configure environment variables in Vercel and locally
- Install Supabase client SDK
- Create `profiles` table with trigger to auto-create profile row on auth.users insert
- Build minimal signup/login screens (replacing the demo's fake login)
- Add auth state management to the React app
- Deploy and confirm signup/login work end-to-end on production

**Acceptance criteria:**
- Brad creates an account using his real email
- Logs in successfully
- A `profiles` row exists for him
- Logout works, login persists across page reloads
- Wrong password is rejected

**Out of scope:** password reset, email verification, social login. Pure email/password only.

### Milestone 2 — Schema + RLS

**Goal:** All tables exist. All RLS policies are in place. No frontend changes yet — this is database work.

**Tasks:**
- Write migration files for every table in section 6
- Write RLS policies for every table
- Seed at least one fake user and one fake athlete linked to verify policies work
- Use Supabase's policy testing to verify a user cannot access an athlete they're not linked to
- Document the schema in the repo (`docs/schema.md`)

**Acceptance criteria:**
- A user with no links sees no athletes
- A user with one link sees only that athlete
- A user with `view_workouts: false` cannot read workouts even with a valid link
- Brad reviews the RLS policies and signs off

**Out of scope:** frontend changes. The demo still runs on its in-memory state at this milestone.

### Milestone 3 — Athlete profile + workouts

**Goal:** A logged-in user who is themselves an athlete can create their athlete profile, log workouts, and see them persist.

**Tasks:**
- On first login, if user has no athlete profile and selected "athlete" role, prompt them to create one (display name, position, sport, etc.)
- Create the `athletes` row and the `self` link automatically
- Replace the demo's in-memory `workouts` state with Supabase queries
- Workouts logged via the existing form save to the database
- Workouts list and history load from the database
- Edits and deletes work against the database
- Migration helper: a "Import from CSV" button that takes a CSV of Brad's athlete's historical Excel data and creates real workout rows

**Acceptance criteria:**
- Brad's athlete can sign up, create his profile, log a session, log out, log back in, see the session
- Brad imports the Excel sheet into the athlete's account as a one-time migration
- Editing a past session persists
- Deleting a session removes it from the database

### Milestone 4 — Wellness check-ins + settings

**Goal:** Wellness check-ins persist. Athlete wellness settings (frequency, enabled fields) persist. Recovery card works against real data.

**Tasks:**
- Wellness form writes to `wellness_checkins`
- Recovery card on athlete home reads from the database
- Wellness settings screen saves to the `athletes.wellness_settings` JSON column
- All wellness-due logic respects the persisted settings

**Acceptance criteria:**
- Brad's athlete completes a wellness check-in, refreshes, sees it
- Changing frequency to "weekly" persists across sessions
- Disabling specific fields removes them from the form next time
- Recovery card shows the real 7-day average

### Milestone 5 — Practitioner role + linking

**Goal:** Brad can have a practitioner account, link to his athlete, and see the athlete's data.

**Tasks:**
- Implement the invitation flow: an athlete can invite a practitioner by email
- The invitation creates an `athlete_user_links` row with `status='pending'`
- The invited user receives an email (using Supabase's built-in email or a simple Edge Function)
- The invited user signs up / logs in, accepts the invitation, link becomes `status='active'`
- Practitioner-view UI works against real linked athletes (replacing the demo's hardcoded seed athlete list)
- The roster view shows the athlete(s) the practitioner is linked to
- Athlete detail view loads the linked athlete's data via RLS

**Acceptance criteria:**
- Brad invites himself (different email) as a practitioner
- The practitioner account sees Brad's athlete in the roster
- Athlete detail loads workouts and wellness data
- A third unlinked test account sees no athletes
- Revoking the link removes access immediately

**Out of scope:** bulk invites, organisation-level invitations. One-to-one only.

### Milestone 6 — Coordination notes

**Goal:** Notes flow both ways between practitioner and athlete. This is the multi-user end-to-end test.

**Tasks:**
- Notes composer (practitioner side) writes to `notes` table with `visibility='athlete'`
- Athlete home reads athlete-visible notes from the database
- Athlete acknowledges, persists
- Athlete archives, persists
- Practitioner sees acknowledgment status

**Acceptance criteria:**
- Practitioner writes a note "skip conditioning tonight"
- Athlete logs in on a different device and sees the note
- Athlete taps acknowledge
- Practitioner reloads and sees acknowledged status
- Athlete archives, practitioner still sees the note in their history

**This is the cutover milestone.** Once Milestone 6 is shipped and tested by Brad + his athlete using real accounts, merge `backend-mvp` into `main`. The demo is now the backend MVP. From here on, everything is shipped to production.

### Milestone 7 — Injuries (read)

**Goal:** Injury records persist. Both sides see them.

**Tasks:**
- Injuries CRUD via Supabase
- Practitioner injury card loads real data
- Athlete injuries view loads real data
- Per-injury sharing JSON respected by RLS
- Concussion auto-linking works (when an injury with concussion type is added, a concussion_incident is auto-created)

**Acceptance criteria:**
- Brad creates an injury record for his athlete from the practitioner side
- Athlete logs in, sees the injury in their athlete-side injuries view
- Athlete self-reports a new injury, Brad sees it in the practitioner side
- Per-injury sharing: athlete excludes a test third-party account, that account no longer sees the injury

### Milestone 8 — Injuries (collaborative editing)

**Goal:** Multiple users can edit injury records. Audit trail is real.

**Tasks:**
- RTP milestone checkboxes persist toggles with `completed_by` and timestamp
- Status changes persist with `status_changed_by` and timestamp
- Undo confirmations work against persistent state

**Acceptance criteria:**
- Brad ticks a milestone, athlete sees it ticked with Brad's name and date
- Athlete reverses the tick, Brad sees the reversal
- Status change from "out" to "returned" requires confirmation and records who made the change

### Milestone 9 — Performance tests + flags

**Goal:** Test results persist. Significant deviation flag works.

**Tasks:**
- Tests CRUD via Supabase
- Bulk session entry persists
- CSV upload for tests works
- The >20% deviation flag computes against real data

### Milestone 10 — Files + storage

**Goal:** File uploads work through Supabase Storage.

**Tasks:**
- Configure Supabase Storage bucket with RLS
- Upload UI sends files to Storage
- Files list reads from `athlete_files` table
- Per-file sharing respected
- Delete removes both DB row and storage object

**Acceptance criteria:**
- Brad uploads a PDF from the practitioner side
- Athlete sees it (if visibility allows) and can download it
- File storage path is not predictable / not enumerable

### Milestone 11 — Audit log + privacy

**Goal:** The audit log records access. Athletes can see who has accessed their data.

**Tasks:**
- Wrap key access points (viewing medical data, viewing injuries, exporting) with audit log writes
- Athlete privacy screen reads from `audit_log`
- Brad reviews the privacy UX

### Milestone 12 — Polish + production readiness

**Goal:** Production-ready. Onboarding works for non-Brad users.

**Tasks:**
- Error boundaries and user-facing error messages
- Email templates for invitations (replace Supabase defaults)
- Welcome flow for first-time users
- Performance check on athlete page load (should be <2 seconds)
- Mobile Safari spot-check (the original demo had iOS Safari quirks)
- Production environment variables locked down
- Sentry or similar error tracking set up

**Acceptance criteria:**
- A user who has never used the app can sign up, create their profile, invite a practitioner, log a workout, and have it all work without Brad's help
- Errors are caught and explained, not silent failures
- Brad's athlete uses the production version for the full local season

## 8. Working with Claude Code

This section is for Brad — how to actually run the build.

### 8.1 The session structure

Each work session should target one milestone (or a sub-task of a milestone). Don't try to do two milestones in one session. The flow:

1. Open Claude Code in the `tempo-demo` directory
2. Paste the milestone description from this brief
3. Ask Claude Code to outline the work before writing code (this catches misunderstandings early)
4. Review the outline, push back if needed
5. Let Claude Code implement
6. Test against the acceptance criteria
7. Commit and push

### 8.2 Maintaining context

Claude Code reads the repo at the start of each session, but doesn't remember previous sessions. To maintain continuity:

- **Keep this brief in the repo.** Save it as `docs/build-brief.md`. Reference it in each session.
- **Keep a build journal.** A simple `docs/journal.md` that records what was built each session, what worked, what didn't. Update it at the end of each session in five lines.
- **Use a CLAUDE.md file at the repo root.** This is read automatically by Claude Code. It should contain: stack, current milestone, product principles (just section 3 of this brief), and any project-specific conventions.

### 8.3 What to do when Claude Code suggests adding scope

Pause. Re-read section 5 (Out of Scope) and section 3 (Principles). Ask: would this make the current milestone harder to verify? Would it commit us to maintaining a feature we haven't validated? If yes to either, say no and ask Claude Code to stick to scope.

This will happen. It's normal. Claude Code is eager. You're the editor.

### 8.4 Verifying milestones

Each milestone has acceptance criteria. Walk through them by hand at the end of the milestone. If any fail, the milestone isn't done.

Don't move to the next milestone until the current one passes. Half-finished milestones rot.

### 8.5 When to ask for help

If you're stuck for more than 30 minutes on something that feels like it should be working, that's the signal to step back. Either come back to me (Claude chat) with a description of what's happening, or post a focused question in a community (Supabase Discord, Stack Overflow). Don't push through for hours alone — context degrades and frustration compounds.

### 8.6 Subscription budget

Brad is on Max 5x ($100/month) for the build. Estimated cost: $400 for a 16-week build. Track usage with `/usage` in Claude Code. Downgrade to Pro once Milestone 12 ships unless there's ongoing intensive work.

## 9. Risks and how we handle them

Known risks, ranked by likelihood:

### Risk 1: RLS gets complex and slow

Multi-table RLS policies with JSON membership checks (the per-injury sharing list) can become slow at scale. At pilot scale this won't matter. If it ever does, the fix is precomputing access tables. We'll cross that bridge when there are 1000+ users. Document the design choice in `docs/schema.md`.

### Risk 2: Mobile Safari quirks

The original demo had iOS Safari issues with toggle positioning and other small details. The same class of bugs will recur. Test on mobile Safari at every milestone, not just at the end.

### Risk 3: Brad's athlete stops using it

The most likely failure mode is the athlete not using it after the novelty wears off. Mitigations:
- Get the coordination notes feature working early (Milestone 6) — that gives the athlete a reason to open the app even when they don't want to log
- Make session logging genuinely fast (<15 sec)
- Watch the data: if the athlete hasn't logged in 4 days, that's a signal to fix something, not to push harder

### Risk 4: The brief becomes outdated

The product will shift based on what Brad and his athlete learn. This document will need to update as that happens. Brad's responsibility: edit this brief when reality diverges from the plan. Don't pretend the plan still holds when it doesn't.

### Risk 5: Brad runs out of energy

16 weeks is a long time for evenings and weekends. The fix isn't to push harder — it's to keep the work pace sustainable. If you miss a week, that's fine. The product isn't going anywhere. The build only fails if you decide it has.

## 10. After the MVP

This section is for after Milestone 12 ships. Don't act on it during the build.

**Phase 2 candidates:**
- Strava + Apple Health webhook → "How was that session?" push notification
- Reports (only if validated through use)
- Onboarding flow polish for non-Brad users
- Org-level features if Brad's colleague's football team adopts

**Phase 3 candidates:**
- Marketing site (separate Vercel project)
- Pricing page (if monetisation is decided)
- Public landing for "I'm interested in being a pilot"

**Don't decide any of this until the MVP has been used for a real season.** What you learn from real use will reshape the product more than any plan would.

---

## Appendix A — File and folder structure

After Milestone 1, the repo should look approximately:

```
tempo-demo/
├── src/
│   ├── App.jsx              -- main app (gradually refactored)
│   ├── lib/
│   │   ├── supabase.js      -- Supabase client
│   │   ├── auth.js          -- auth helpers
│   │   ├── data/            -- data access functions per table
│   │   │   ├── athletes.js
│   │   │   ├── workouts.js
│   │   │   ├── wellness.js
│   │   │   ├── injuries.js
│   │   │   ├── notes.js
│   │   │   ├── files.js
│   │   │   └── audit.js
│   │   └── utils.js         -- shared helpers
│   └── components/          -- UI components (extracted from App.jsx over time)
├── supabase/
│   └── migrations/          -- SQL migration files
│       ├── 0001_init.sql
│       ├── 0002_rls.sql
│       └── ...
├── docs/
│   ├── build-brief.md       -- this document
│   ├── schema.md            -- schema reference
│   └── journal.md           -- session-by-session log
├── CLAUDE.md                -- repo-level instructions for Claude Code
├── package.json
├── vite.config.js
└── vercel.json
```

The single `App.jsx` will gradually be broken up into components and modules. Don't do this all at once — refactor as natural during milestones. By Milestone 12 it should look much cleaner.

## Appendix B — Glossary

- **ACWR** — Acute:Chronic Workload Ratio. Ratio of recent (7-day) load to longer baseline (28-day). Used as context, never as injury prediction.
- **RLS** — Row Level Security. Postgres feature where access rules live in the database.
- **RTP** — Return to Play. The process of bringing an injured athlete back to full availability.
- **RPE** — Rate of Perceived Exertion. Athlete's subjective rating of how hard a session was, 0–10.
- **Self link** — The link in `athlete_user_links` where role='self', representing the athlete's own access to their own data.
- **Practitioner** — Any non-athlete user. Coaches, physios, S&Cs, clinicians, club admins.
- **Pilot** — A user who is using Tempo for real, not testing. Different from a tester.

---

**End of brief.**

Last updated: [date]
Maintained by: Brad
For questions during the build: Claude chat (the conversation that produced this).
