# Tempo — Athlete Load Monitoring App

## What this is
A React/Vite app being migrated from in-memory demo state to a real backend (Supabase). The existing `src/App.jsx` is a ~15,000 line single-file prototype. We are incrementally replacing in-memory state with real persistence, real auth, and real multi-user behaviour — without breaking the UI.

## Stack
- Frontend: React + Vite, deployed via Vercel
- Backend: Supabase (Postgres + Auth + RLS + Storage)
- Hosting: Vercel (frontend), Supabase (backend)
- Branch: working on `backend-mvp` until cutover at Milestone 6

## Current milestone
Milestone 1 — Supabase setup + auth. A user can sign up, log in, log out. Nothing else.

## Product principles (non-negotiable)

1. The athlete UI stays calm. Low-friction, under 10 sec to check wellness, under 15 sec to log a session. Never feels like sports science software.
2. Consent flows from the athlete. Athletes decide what to share. Wellness can be turned off entirely. Per-injury sharing overrides default permissions.
3. Never claim what we can't deliver. ACWR is context, not injury prediction. Flags are signals worth a closer look, not diagnoses.
4. Collaboration over hierarchy. Injuries are not owned by one person. Anyone with edit access can update milestones; the system records who and when.
5. Honest tradeoffs over hidden defaults. When an athlete makes a choice with consequences, the consequences are stated clearly. No nag screens.
6. No useless data capture. Every feature must earn its place by answering "what does the user do with this?"
7. Schema is more durable than UI. Add columns generously; don't expose them in the UI without a real reason.

## Working notes for Claude Code

- The full build brief is in `docs/build-brief.md` — read it for any milestone-level context.
- The schema is defined in section 6 of the brief. Don't deviate without flagging it.
- Milestones are ordered for dependency. Don't reorder.
- When tempted to add scope, re-read the brief's section 5 (Out of Scope) and section 3 (Principles), then check with Brad.
- Verify each milestone by walking through its acceptance criteria before declaring it done.
- Keep a session journal in `docs/journal.md` — five lines at the end of each session.

## Brad's context

- Working part-time, evenings and weekends, ~3-4 hours per week in 2-3 unbroken blocks
- 16-week realistic timeline
- New to backend development; comfortable with React from the frontend build
- First real user: Brad himself + one athlete (a footballer with stress-injury history)
- After Milestone 12: real season usage for that athlete
