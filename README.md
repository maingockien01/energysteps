# EnergySteps

A one-day office running-event app. Participants sign up to run on a machine for
a chosen duration; the system assigns each to the shortest-wait queue and
estimates their check-in window. Participants look up their status by email.
Moderators run a live console (PIN-gated) to check runners in/out, log results,
hand out gifts, manage queues, and export data.

- **Frontend:** Vite + React + TypeScript + Tailwind (static SPA, deploys to Netlify)
- **Backend:** Supabase (Postgres + Realtime). All data access goes through
  Row-Level-Security-protected SQL functions; participant emails are never
  exposed to anonymous REST reads. See `docs/ADR.md` for the key decisions.

## Run locally

You need a Supabase project (free tier is fine). See `RELEASE.md` step 1 to
create one and run the migration.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   then edit .env and set:
#     VITE_SUPABASE_URL=...        (base project URL, NOT the /rest/v1 endpoint)
#     VITE_SUPABASE_ANON_KEY=...   (anon/public key, NOT service_role)
#     VITE_MODERATOR_PINS=1234     (comma-separated; keep in sync with the DB)

# 3. Start the dev server
npm run dev
#   open http://localhost:5173
```

Routes:
- `/` — public sign-up
- `/status` — public status lookup (by email)
- `/moderator` — moderator console (enter a PIN from `VITE_MODERATOR_PINS`)

> The moderator console needs the same PIN to exist in the database
> `moderator_pins` table (the migration seeds `1234`). Keep `VITE_MODERATOR_PINS`
> and that table in sync — see `RELEASE.md` step 5.

## Build

```bash
npm run build      # type-checks (tsc, strict) then builds to dist/
npm run preview    # serve the production build locally
```

## Automated tests

The queue/projection/slot-timer math is the most error-prone part and is unit
tested:

```bash
npm test           # runs Vitest once (src/lib/queueLogic.test.ts)
```

These tests are pure and need no env vars or network. The rest of the app is
verified with the manual checklist in `TEST_PLAN.md`.

## Documentation

- `RELEASE.md` — step-by-step deploy guide (Supabase → GitHub → Netlify)
- `FEATURES.md` — plain-English behavior of every feature (incl. the
  intentional "idle machines / no rebalancing" behavior)
- `TEST_PLAN.md` — manual test checklist with expected results
- `docs/ADR.md` — architecture decisions made during the build
- `supabase/migrations/0001_init.sql` — the full schema, RLS policies, and RPCs
