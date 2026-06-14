// Pure queue math: live projection (status page) and the checkout-anchored
// slot timer (moderator board). NO calls to Date.now() here — callers pass a
// `now` where needed so this stays deterministic and unit-testable.
//
// Spec recap (see <core_logic>):
//   * original_estimated_start is captured at event start and stored on the row
//     (immutable). We never recompute it here.
//   * The LIVE PROJECTION walks the queue from the current real state: the head
//     runner's slot is anchored to the PREVIOUS runner's checkout (or event
//     start for the first runner), then each not-yet-finished person ahead adds
//     (buffer + run_duration). It is display-only and never earlier than the
//     original.

const DONE: ReadonlySet<string> = new Set(["finished", "skipped", "no_show"]);

// Minimal shape shared by Participant and the de-identified QueueMember.
export interface QueueEntry {
  position_in_queue: number;
  run_duration_seconds: number;
  status: string;
  actual_start: string | null;
  actual_finish: string | null;
  original_estimated_start: string | null;
}

function ts(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// The slot anchor for the current head = the latest checkout (actual_finish) of
// any finished runner in the queue, or the event start time if none finished.
export function headAnchorMs(
  queue: QueueEntry[],
  eventStartTime: string | null,
): number | null {
  let anchor = ts(eventStartTime);
  for (const m of queue) {
    const f = ts(m.actual_finish);
    if (f !== null && (anchor === null || f > anchor)) anchor = f;
  }
  return anchor;
}

// Default move-grace (seconds) if the event config hasn't supplied one. Mirrors
// the DB column default in migration 0011.
export const DEFAULT_MOVE_GRACE_SECONDS = 180;

// The EFFECTIVE slot anchor, accounting for an idle machine (request #7).
//
// `headAnchorMs` is purely historical — the last checkout. When a machine sits
// idle (the head is still waiting AND the normal check-in window has already
// elapsed unused: now > anchor + buffer), that anchor is stale and in the past,
// which makes the projection show a past time and the board skip the check-in
// window. In that case we re-anchor the head to `now + moveGrace` so a runner
// arriving onto a free machine gets a fresh window plus a few minutes to walk
// over. Normal handoffs (anchor ≈ now, window not yet elapsed) are untouched,
// and a future anchor (event not started yet) is never pulled earlier.
export function effectiveAnchorMs(
  queue: QueueEntry[],
  eventStartTime: string | null,
  bufferSeconds: number,
  nowMs: number | null,
  moveGraceSeconds: number = DEFAULT_MOVE_GRACE_SECONDS,
): number | null {
  const raw = headAnchorMs(queue, eventStartTime);
  if (raw === null || nowMs === null) return raw;
  const head = activeOrdered(queue)[0];
  // Only a WAITING head on an idle machine is re-anchored. A checked-in (running)
  // head occupies the machine, so its historical anchor still governs the slot.
  if (!head || head.status === "checked_in") return raw;
  const windowElapsed = nowMs > raw + bufferSeconds * 1000;
  if (!windowElapsed) return raw;
  return Math.max(raw, nowMs + moveGraceSeconds * 1000);
}

// Not-yet-done members, in queue order. The first is the current head.
export function activeOrdered(queue: QueueEntry[]): QueueEntry[] {
  return [...queue]
    .filter((m) => !DONE.has(m.status))
    .sort((a, b) => a.position_in_queue - b.position_in_queue);
}

export interface Projection {
  // Live projected check-in time for the target entry (ms epoch), or null if
  // it cannot be computed yet (no event start time, or target already done).
  projectedStartMs: number | null;
  // Position in line for the target: 1 = current head / up next.
  livePosition: number | null;
  // The stored original estimate (ms) if present.
  originalStartMs: number | null;
  // Provisional original-equivalent used when the event hasn't started yet.
  baselineStartMs: number | null;
  // Whether the live projection is later than the baseline (a delay).
  isDelayed: boolean;
  delayMinutes: number; // rounded, >= 0
}

// Compute the live projection for one target entry within its queue.
// `nowMs` (+ optional `moveGraceSeconds`) enables idle-machine re-anchoring
// (request #7); pass null to keep the purely-historical anchor.
export function computeProjection(
  queue: QueueEntry[],
  target: QueueEntry,
  eventStartTime: string | null,
  bufferSeconds: number,
  nowMs: number | null = null,
  moveGraceSeconds: number = DEFAULT_MOVE_GRACE_SECONDS,
): Projection {
  const active = activeOrdered(queue);
  const idx = active.findIndex(
    (m) => m.position_in_queue === target.position_in_queue,
  );

  const originalStartMs = ts(target.original_estimated_start);

  // If the target is already finished/skipped, no forward projection.
  if (idx === -1) {
    return {
      projectedStartMs: null,
      livePosition: null,
      originalStartMs,
      baselineStartMs: originalStartMs,
      isDelayed: false,
      delayMinutes: 0,
    };
  }

  const anchor = effectiveAnchorMs(
    queue,
    eventStartTime,
    bufferSeconds,
    nowMs,
    moveGraceSeconds,
  );
  let projectedStartMs: number | null = null;
  if (anchor !== null) {
    let acc = anchor;
    for (let i = 0; i < idx; i++) {
      acc += (active[i].run_duration_seconds + bufferSeconds) * 1000;
    }
    projectedStartMs = acc;
  }

  // Baseline = stored original estimate if we have it, else a provisional one
  // computed from the event start time (pre-start display).
  let baselineStartMs = originalStartMs;
  if (baselineStartMs === null) {
    const evStart = ts(eventStartTime);
    if (evStart !== null) {
      let acc = evStart;
      for (let i = 0; i < idx; i++) {
        acc += (active[i].run_duration_seconds + bufferSeconds) * 1000;
      }
      baselineStartMs = acc;
    }
  }

  let isDelayed = false;
  let delayMinutes = 0;
  if (projectedStartMs !== null && baselineStartMs !== null) {
    const deltaMs = projectedStartMs - baselineStartMs;
    if (deltaMs > 30_000) {
      // ignore sub-30s noise
      isDelayed = true;
      delayMinutes = Math.round(deltaMs / 60000);
    }
  }

  return {
    projectedStartMs,
    livePosition: idx + 1,
    originalStartMs,
    baselineStartMs,
    isDelayed,
    delayMinutes,
  };
}

export type SlotPhase =
  | "no_start_time"
  | "awaiting_checkin" // head hasn't checked in; buffer window is the check-in window
  | "running" // head checked in; show run countdown
  | "queue_complete"; // nobody left to run

export interface SlotTimer {
  phase: SlotPhase;
  head: QueueEntry | null;
  anchorMs: number | null; // slot start (prev checkout or event start)
  checkInDeadlineMs: number | null; // anchorMs + buffer
  slotEndMs: number | null; // anchorMs + buffer + run  (== where the next slot begins)
}

// The checkout-anchored slot timer for one queue. The component supplies its
// own ticking `now` to render countdowns from these target timestamps. Passing
// `nowMs` also enables idle-machine re-anchoring (request #7) so a runner
// arriving onto a free machine gets a fresh check-in window.
export function computeSlotTimer(
  queue: QueueEntry[],
  eventStartTime: string | null,
  bufferSeconds: number,
  nowMs: number | null = null,
  moveGraceSeconds: number = DEFAULT_MOVE_GRACE_SECONDS,
): SlotTimer {
  const active = activeOrdered(queue);
  const head = active[0] ?? null;

  if (head === null) {
    return {
      phase: "queue_complete",
      head: null,
      anchorMs: null,
      checkInDeadlineMs: null,
      slotEndMs: null,
    };
  }

  const anchorMs = effectiveAnchorMs(
    queue,
    eventStartTime,
    bufferSeconds,
    nowMs,
    moveGraceSeconds,
  );
  if (anchorMs === null) {
    return {
      phase: "no_start_time",
      head,
      anchorMs: null,
      checkInDeadlineMs: null,
      slotEndMs: null,
    };
  }

  const checkInDeadlineMs = anchorMs + bufferSeconds * 1000;
  // Slot end is anchored to the PREVIOUS checkout (anchorMs), NOT to the head's
  // check-in. A late check-in therefore eats into the runner's slot time.
  const slotEndMs = anchorMs + (bufferSeconds + head.run_duration_seconds) * 1000;

  return {
    phase: head.status === "checked_in" ? "running" : "awaiting_checkin",
    head,
    anchorMs,
    checkInDeadlineMs,
    slotEndMs,
  };
}
