# Architecture Decision Records

Decisions made autonomously during the build, recorded here for human review.
Each is a deviation from, or a resolution of an ambiguity in, the original spec.

---

## ADR-001 — Tooling versions

**Decision:** Vite 5 + React 18 + TypeScript 5 + Tailwind CSS 3.4 + react-router-dom 6 + @supabase/supabase-js 2. Tailwind v3 (not v4) for stable, well-documented PostCSS config.

**Why:** Spec named the stack but not versions. These are the current stable, mutually-compatible set.

**Reversible?** Yes, low cost.

---

## ADR-002 — Moderator data access cannot be pure client-side PIN (security conflict)

**Context / the conflict:** The spec asks for all three of:
1. RLS that prevents an *anonymous* client from reading the full participant list (with emails).
2. A moderator console that reads that full list live (with names/emails).
3. Moderator auth that is *only* a client-side PIN from `VITE_MODERATOR_PINS`, no accounts, no server identity.

In Supabase these are mutually exclusive: a moderator's browser uses the **same `anon` Postgres role** as the public, so RLS cannot grant moderators more than the public. If anon can SELECT participants, emails leak (violates #1); if it can't, the moderator board can't read them either.

**Decision (recommended resolution):**
- `participants` table: **no anon SELECT/UPDATE/DELETE/INSERT policies at all** → fully locked from direct REST access. This makes criterion #1 unambiguously true.
- All access goes through `SECURITY DEFINER` Postgres functions (RPCs):
  - Public: `sign_up(...)`, `get_status_by_email(...)`.
  - Moderator: `moderator_*` functions that take a `p_pin` argument and validate it against a seeded **`moderator_pins`** table before doing anything.
- The client-side `VITE_MODERATOR_PINS` gate is kept for UX (so the console UI is hidden behind PIN entry), but the **real** authorization is the server-side PIN check in each moderator RPC.

**Consequence for the operator:** The PINs in `VITE_MODERATOR_PINS` (frontend) and in the `moderator_pins` DB table (backend) must be kept identical. RELEASE.md documents this.

**Why this over alternatives:** Service-role key in the frontend is forbidden by the spec and is a severe security hole. Supabase Auth accounts are forbidden by the spec. A PIN-gated `SECURITY DEFINER` RPC is the only design that keeps emails private, keeps moderators functional, and uses no user accounts.

**Reversible?** Moderate cost — it shapes the data layer. Flagged for explicit human review.

**Update:** see ADR-006 — the public status-lookup RPC was further tightened to return no PII.

---

## ADR-003 — Sign-up and queue assignment happen server-side (in the `sign_up` RPC)

**Decision:** Shortest-queue selection, position assignment, and the email-uniqueness check run inside the `sign_up` SECURITY DEFINER function, in a single transaction.

**Why:** (1) Two people signing up at the same instant could otherwise both read the same "shortest" queue and both append to it (a race). Doing it in one DB transaction makes assignment atomic and correct. (2) It keeps the `participants` table locked from direct anon INSERT, so the table has zero anon policies (cleaner security story). The spec's wording ("Allow public INSERT into participants") is satisfied in spirit — the public can still create their own participant row — just via the RPC rather than a raw INSERT policy.

**Reversible?** Yes.

---

## ADR-004 — Liveness via Realtime *broadcast*, not Postgres Changes

**Decision:** A single public Realtime channel named `event`. Every mutating action emits a `{ event: 'changed' }` broadcast on success; the moderator board and the participant status page subscribe to it and re-fetch their data via RPC when it fires. The status page also has a manual Refresh button (per spec).

**Why:** Supabase Realtime "Postgres Changes" respects RLS — since anon has no SELECT on `participants` (ADR-002), Postgres Changes would deliver nothing. Broadcast is a first-class Supabase Realtime subscription (so the "use Realtime, do not hand-roll polling" requirement is met) and is independent of table RLS.

**Reversible?** Yes.

---

## ADR-005 — `queue_count` change is blocked once any sign-up exists

**Decision:** `queue_count` is editable before the event starts (per spec), but if participants already exist, changing it is rejected with a clear error. Once the event starts it is locked entirely (per spec).

**Why:** `assigned_queue_id` is permanent at sign-up (spec). Re-generating queues after people are assigned would orphan their assignments and violate that invariant. Blocking the change protects the invariant. The operator must set the machine count before opening sign-ups.

**Reversible?** Yes.

---

## ADR-006 — `get_status_by_email` returns de-identified data only

**Context:** `get_status_by_email` is callable with the public anon key and no PIN (the status page needs it). It originally returned the full matched participant row, so anyone with a known/guessed email could retrieve that person's name and department — a per-email identity-harvest vector (the anon key is public; corporate emails are guessable).

**Decision:** The RPC now returns ONLY de-identified status fields for the matched runner (`id`, `position_in_queue`, `run_duration_seconds`, `status`, `original_estimated_start`, `actual_start`, `actual_finish`) — never `name`, `department`, or `email`. The status page already displays only machine/estimate/position/status, so no UI change was needed. A known-email probe can still confirm a sign-up exists and see its position/estimate/status (inherent to a no-login lookup feature) but harvests no personal identity.

**Why not require a PIN here too:** that would break the spec's public, no-auth status-lookup feature.

**Reversible?** Yes (single RPC).
