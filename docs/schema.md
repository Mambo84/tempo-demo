# Tempo — Schema reference

Source of truth is section 6 of `docs/build-brief.md`. This file documents what
the migrations actually create and, more importantly, the **RLS model** and the
**decisions** taken where the brief left room for interpretation.

Migrations (run in order in the Supabase SQL Editor):

| File | Contents |
|------|----------|
| `0001_init.sql` | `profiles` + auto-create trigger (M1) |
| `0002_rls_helpers.sql` | Security-definer access helpers |
| `0003_athletes_and_links.sql` | `athletes`, `athlete_user_links` + RLS |
| `0004_training_data.sql` | `workouts`, `wellness_checkins`, `tests` + RLS |
| `0005_injuries.sql` | `injuries`, `concussion_incidents`, `concussion_baselines` + RLS |
| `0006_notes_and_files.sql` | `notes`, `athlete_files` + RLS |
| `0007_audit.sql` | `audit_log` + RLS |
| `0008_seed_dev.sql` | Dev-only seed (4 users, 1 athlete, links, workout, injury) |
| `0009_verify_rls_dev.sql` | Dev-only RLS proof harness |

## File-split decision

Tables are grouped by domain (Brad's call) for reviewability, **except** the RLS
helper functions, which are cross-cutting and live in their own file (`0002`) that
loads before any policy referencing them. The helpers are PL/pgSQL, so referencing
tables created in later files is safe — PL/pgSQL resolves table names at call time,
not at `CREATE FUNCTION` time.

## The RLS model

Every table has RLS enabled. Access decisions route through four
`SECURITY DEFINER` helper functions (in `0002`). They run as the migration owner,
so their internal reads of `athletes` / `athlete_user_links` **bypass RLS** — this
is what prevents policy recursion (an `athletes` policy reads links; a links policy
reads athletes).

| Helper | True when… |
|--------|-----------|
| `is_athlete_self(athlete)` | caller is `owner_user_id`, or holds an active `role='self'` link |
| `has_athlete_access(athlete)` | self, or any active link |
| `has_athlete_permission(athlete, perm)` | self (always), or an active link whose `permissions->>perm` is true |
| `has_athlete_admin(athlete)` | self, or an active `role='club_admin'` link |

### Per-table policy summary

| Table | Read | Write (insert/update/delete) |
|-------|------|------------------------------|
| `athletes` | `has_athlete_access` | insert: `created_by = auth.uid()`; update: `edit_profile`; delete: self |
| `athlete_user_links` | own row, or `has_athlete_admin` | `has_athlete_admin` |
| `workouts` | `view_workouts` | `edit_workouts` |
| `wellness_checkins` | `view_wellness` | `edit_workouts` (§6.8 groups wellness writes here) |
| `tests` | `has_athlete_access` † | `edit_workouts` † |
| `injuries` | `view_injuries` AND caller not in `sharing.excluded` (self always) | `edit_injuries` |
| `concussion_incidents` | `view_injuries` | `edit_injuries` |
| `concussion_baselines` | `view_injuries` | `edit_injuries` |
| `notes` | self → `visibility='athlete'` only; others → `view_notes` and visibility allows (`medical` needs `view_medical`) | self or `edit_notes`; author must be caller |
| `athlete_files` | self → all own; others → by visibility (`medical` needs `view_medical`) | self or admin; uploader must be caller ‡ |
| `audit_log` | own access rows, or self (the athlete) | insert only, `user_id = auth.uid()`; no update/delete |

† §6.8 is silent on `tests`. Read = any active link; write = `edit_workouts`
(tests are treated as training data). Revisit if a dedicated permission is wanted.

‡ §6.8 is silent on files. There is no dedicated file permission yet; writes are
gated on self/admin as a placeholder. Tighten in **M10** when Storage + per-file
sharing are built.

## Decisions taken at M2 (Brad signed off)

1. **Medical-field gating is app-layer, not RLS.** RLS is row-level; it cannot
   hide individual columns. The whole injury row is gated on `view_injuries`
   (+ not excluded). Hiding clinical columns (`diagnosis`, `icd10`,
   `clinician_notes`, `osics_code`, `imaging*`) from users without `view_medical`
   is enforced in the data-access layer in **M7**. `sharing.included` governs that
   medical-field visibility, not row access.
2. **Admin = owner/self OR `role='club_admin'`.** There is no `admin` permission
   flag; link administration keys off the role.
3. **Owner/self bypasses the permissions JSON.** The athlete always has full
   read/write to their own data. The `permissions` object governs other linked
   users only.
4. **CHECK constraints** are added only for well-documented ranges: `rpe` 0–10,
   wellness fields 0–7, `severity` 1–4, plus the documented enum sets for
   `default_role`, link `role`, link `status`, and note/file `visibility`. Free-text
   fields (`injury_type`, `side`, status strings on concussion, etc.) are left
   unconstrained so the M3 CSV import isn't rejected by tight enums.
5. **`profiles` SELECT stays owner-only** (from M1). Display names are denormalised
   onto `notes`/`athlete_files`, so linked users don't yet need to read each other's
   profile row. **Known follow-up:** broaden `profiles` SELECT in **M5** so the
   roster/linking UI can show practitioner and athlete names.
6. **`audit_log` inserts** are allowed where `user_id = auth.uid()` (you can only
   log your own access). No service-role function needed at this stage; there is no
   update/delete policy, so the log is immutable through the API.

## Notable schema details

- `workouts.session_load` is a stored generated column: `rpe * duration_min`
  (null if either input is null).
- `injuries.linked_concussion_id` ↔ `concussion_incidents.linked_injury_id` is a
  cyclic FK; both tables are created first, then the two constraints are added.
  Both use `ON DELETE SET NULL`.
- `athletes.owner_user_id` / `created_by` and all `*_by` columns use
  `ON DELETE SET NULL` — deleting a user account never destroys athlete data.
- Child tables FK to `athletes` with `ON DELETE CASCADE`.
- `athlete_user_links.user_id` is nullable (pending email invites carry
  `invited_email` until the user signs up). `UNIQUE(athlete_id, user_id)` still
  holds; multiple NULLs are allowed by Postgres.

## Performance note (brief Risk 1)

The per-injury `sharing.excluded` membership test (`jsonb ?` against
`auth.uid()`) and the link lookups run per row. Fine at pilot scale. If it ever
matters (1000+ users), precompute an access table. Indexes exist on every
`athlete_id` FK and on `athlete_user_links(user_id, athlete_id)`.

## Verifying RLS (M2 acceptance)

Run `0008_seed_dev.sql` then `0009_verify_rls_dev.sql`. The harness impersonates
each seed user under the `authenticated` role and asserts row counts, proving:
a user with no link sees nothing; a linked user sees only their athlete; a
`view_workouts:false` link cannot read workouts; an athlete excluded from an
injury's `sharing` cannot read it. It prints PASS/FAIL notices and raises an
exception if any check fails.
