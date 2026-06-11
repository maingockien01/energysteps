# Agent Brief — shared contracts (READ ONLY)

You are implementing ONE feature in an existing, already-compiling Vite + React +
TypeScript + Tailwind app. The foundation is done. **Do NOT edit any shared file**
listed below — only the file(s) named in your task. Do not run `npm install`, do
not change `package.json`, configs, routing (`App.tsx`), or any `src/lib/*`,
`src/moderator/context.tsx`, `ModeratorLayout.tsx`, `ModeratorGate.tsx`, or
`session.ts`. Those are fixed contracts.

When done, your file(s) must pass `npm run build` (tsc strict) with no errors.
`noUnusedLocals`/`noUnusedParameters` are ON — no unused imports/vars.

## Stack & style
- React 18 function components, hooks. TypeScript strict.
- Tailwind CSS 3. Palette: `slate` for neutrals, `slate-900` for primary buttons,
  `emerald` for go/on-schedule, `amber`/`red` for warnings/delays. Rounded cards
  (`rounded-2xl bg-white p-… shadow-sm ring-1 ring-slate-200`). Keep it clean,
  legible, and mobile-friendly. No new dependencies.
- Import types from `../lib/types` (pages) or `./` paths as appropriate.

## Domain types — `src/lib/types.ts`
`ParticipantStatus = 'signed_up' | 'checked_in' | 'finished' | 'skipped' | 'no_show'`
- `EventConfig { id; event_start_time: string|null; buffer_seconds; queue_count; allowed_run_durations: number[]; event_started; started_at: string|null }`
- `Queue { id; queue_number; name }`
- `Gift { id; name; total_quantity; remaining_quantity }`
- `Participant { id; name; department; email; run_duration_seconds; assigned_queue_id; position_in_queue; status; original_estimated_start: string|null; actual_start: string|null; actual_finish: string|null; distance_logged: number|null; gift_id: string|null; created_at }`
- `QueueMember` = de-identified queue entry (no name/email): `{ id; position_in_queue; run_duration_seconds; status; original_estimated_start; actual_start; actual_finish }`
- `SignUpResult { participant; queue; estimated_start: string|null; event_start_time: string|null; buffer_seconds }`
- `StatusResult { found: boolean; me?; queue?; config?; queue_members? }`
- `ModeratorState { config; queues; gifts; participants }`

## Data layer — `src/lib/api.ts` (ALWAYS use these; never touch tables directly)
All async; throw `ApiError { code: ApiErrorCode }` on failure. Use `errorMessage(code)`
for user-facing text. All moderator fns take `pin` as the first arg.
- `signUp({name, department, email, run_duration_seconds}) => SignUpResult`
- `getStatusByEmail(email) => StatusResult`
- `getPublicConfig() => { allowed_run_durations; event_start_time; buffer_seconds; event_started }`
- `moderatorGetState(pin) => ModeratorState`
- `moderatorCheckIn(pin, participantId)`
- `moderatorCheckOut(pin, participantId, distance: number|null, giftId: string|null)`
- `moderatorSkip(pin, participantId, 'skipped' | 'no_show')`
- `moderatorUpdateParticipant(pin, id, {name, department, email, run_duration_seconds})`
- `moderatorCreateGift(pin, name, quantity)`
- `moderatorUpdateGift(pin, id, {name, total_quantity, remaining_quantity})`
- `moderatorDeleteGift(pin, id)`
- `moderatorUpdateConfig(pin, {event_start_time: string|null, buffer_seconds, allowed_run_durations: number[], queue_count})`
- `moderatorStartEvent(pin)`
Catch errors like: `try { ... } catch (e) { if (e instanceof ApiError) setMsg(errorMessage(e.code)); }`
(import `ApiError, errorMessage` from `../lib/api`).

## Realtime — `src/lib/realtime.ts`
- Mutations already broadcast automatically (the api.ts wrappers call it). You do
  NOT need to broadcast.
- To live-update a PUBLIC page: `const unsub = subscribeToChanges(() => refetch()); return unsub;` inside a `useEffect`.

## Pure logic — `src/lib/queueLogic.ts` (use for ALL time math; do not re-derive)
- `computeProjection(queue: QueueEntry[], target: QueueEntry, eventStartTime, bufferSeconds): Projection`
  - `Projection { projectedStartMs: number|null; livePosition: number|null; originalStartMs: number|null; baselineStartMs: number|null; isDelayed: boolean; delayMinutes: number }`
  - Use this on the STATUS page. `queue` = the `queue_members` array; `target` = `me` (both satisfy `QueueEntry`).
- `computeSlotTimer(queue: QueueEntry[], eventStartTime, bufferSeconds): SlotTimer`
  - `SlotTimer { phase: 'no_start_time'|'awaiting_checkin'|'running'|'queue_complete'; head: QueueEntry|null; anchorMs; checkInDeadlineMs; slotEndMs }` (timestamps are ms epoch or null)
  - Use this on the BOARD per queue. `Participant[]` satisfies `QueueEntry[]`.
  - For countdowns: keep a ticking `now` (e.g. `useEffect` + `setInterval(…, 1000)`), then `remaining = (targetMs - now)/1000`. While `awaiting_checkin`, the check-in window counts down to `checkInDeadlineMs`; while `running`, the run countdown counts down to `slotEndMs` (this is why a late check-in shows less remaining run time — slot is anchored to the previous checkout).
- `QueueEntry` minimal shape: `{ position_in_queue; run_duration_seconds; status; actual_start; actual_finish; original_estimated_start }`.

## Formatting — `src/lib/format.ts`
- `formatClock(ms|null)` → "09:30"; `formatClockIso(iso|null)`; `formatDuration(seconds)` → "10 min";
  `formatCountdown(seconds)` → "9:05"; `toDatetimeLocal(iso)` / `fromDatetimeLocal(value)` for `<input type="datetime-local">`.

## Moderator views — shared state hook `src/moderator/context.tsx`
Inside any moderator view: `const { state, loading, error, reload, pin } = useModerator();`
- `state: ModeratorState | null` (null while loading). It auto-reloads on realtime changes.
- After a mutation, the realtime broadcast triggers a reload automatically; you may also `await reload()` if you want an immediate refresh.
- `pin` is the validated PIN to pass to moderator api fns.
- Render a graceful loading state when `state === null`.

## Public page chrome
Public pages (`/` sign-up and `/status`) render their own full-page layout (the
moderator chrome does NOT wrap them). Center content, max-width container, include
a small link between sign-up (`/`) and status (`/status`) via react-router `Link`.
