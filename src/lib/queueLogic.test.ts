import { describe, expect, it } from "vitest";
import {
  activeOrdered,
  computeProjection,
  computeSlotTimer,
  effectiveAnchorMs,
  headAnchorMs,
  type QueueEntry,
} from "./queueLogic";

const START = "2026-06-10T09:00:00.000Z";
const startMs = Date.parse(START);
// Default sign-up time: well before the event start, so a head counts as
// "already queued" (no idle move-grace) unless a test overrides created_at.
const EARLY = "2026-06-10T08:00:00.000Z";

function entry(p: Partial<QueueEntry> & { position_in_queue: number }): QueueEntry {
  return {
    run_duration_seconds: 600,
    status: "signed_up",
    actual_start: null,
    actual_finish: null,
    original_estimated_start: null,
    granted_run_seconds: null,
    created_at: EARLY,
    ...p,
  };
}

describe("headAnchorMs", () => {
  it("is the event start when nobody has finished", () => {
    const q = [entry({ position_in_queue: 1 }), entry({ position_in_queue: 2 })];
    expect(headAnchorMs(q, START)).toBe(startMs);
  });

  it("is the latest checkout once people finish", () => {
    const finish = "2026-06-10T09:12:00.000Z";
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2 }),
    ];
    expect(headAnchorMs(q, START)).toBe(Date.parse(finish));
  });

  it("is null with no event start and no finishes", () => {
    expect(headAnchorMs([entry({ position_in_queue: 1 })], null)).toBeNull();
  });
});

describe("effectiveAnchorMs (idle-machine re-anchoring, #7)", () => {
  const buffer = 120;
  const grace = 180;
  const finish = new Date(startMs + 720 * 1000).toISOString(); // last checkout
  const lateJoin = new Date(startMs + 3600 * 1000).toISOString(); // signed up an hour later

  it("re-anchors a LATE arrival to created_at + grace (fixed, not now-relative)", () => {
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2, created_at: lateJoin }), // joined after machine freed
    ];
    expect(effectiveAnchorMs(q, START, grace)).toBe(Date.parse(lateJoin) + grace * 1000);
  });

  it("does NOT re-anchor a head who was already queued before their turn", () => {
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2, created_at: EARLY }), // waiting since before
    ];
    expect(effectiveAnchorMs(q, START, grace)).toBe(Date.parse(finish));
  });

  it("does NOT re-anchor a running (checked_in) head", () => {
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2, status: "checked_in", created_at: lateJoin }),
    ];
    expect(effectiveAnchorMs(q, START, grace)).toBe(Date.parse(finish));
  });

  it("never pulls a future anchor earlier (event not started yet)", () => {
    const future = "2026-06-10T10:00:00.000Z";
    const q = [entry({ position_in_queue: 1, created_at: EARLY })];
    expect(effectiveAnchorMs(q, future, grace)).toBe(Date.parse(future));
  });

  it("is deterministic — no dependence on the wall clock", () => {
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2, created_at: lateJoin }),
    ];
    // Called twice (any 'now'), the fixed anchor is identical.
    expect(effectiveAnchorMs(q, START, grace)).toBe(effectiveAnchorMs(q, START, grace));
  });

  it("a late arrival gets a real check-in window whose deadline can elapse", () => {
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: finish }),
      entry({ position_in_queue: 2, run_duration_seconds: 600, created_at: lateJoin }),
    ];
    const t = computeSlotTimer(q, START, buffer, grace);
    expect(t.phase).toBe("awaiting_checkin");
    expect(t.anchorMs).toBe(Date.parse(lateJoin) + grace * 1000);
    // Deadline = created_at + grace + buffer — a FIXED point, so a ticking clock
    // crosses it and the window elapses (auto-start / no-show stays functional).
    expect(t.checkInDeadlineMs).toBe(Date.parse(lateJoin) + (grace + buffer) * 1000);
  });
});

describe("participant estimate matches the moderator board (#estimate-bug)", () => {
  const buffer = 120;
  const grace = 180;

  // Idle machine: a finished line, then a LATE arrival signs up onto it. The
  // participant status page (computeProjection) must show the SAME start the
  // board (computeSlotTimer) shows — created_at + move-grace — NOT the stale
  // past checkout. Because the anchor is fixed (not now-relative), both screens
  // agree no matter when each samples the clock.
  const lastFinish = new Date(startMs + 130 * 1000).toISOString();
  const lateJoin = new Date(startMs + 600 * 1000).toISOString(); // signed up after the machine freed
  const idleQueue = [
    entry({ position_in_queue: 1, status: "finished", actual_finish: lastFinish, run_duration_seconds: 300 }),
    entry({ position_in_queue: 2, run_duration_seconds: 180, created_at: lateJoin }), // late head
    entry({ position_in_queue: 3, run_duration_seconds: 300, created_at: lateJoin }),
  ];

  it("head's projected start equals the board anchor (created_at + grace), not the past", () => {
    const board = computeSlotTimer(idleQueue, START, buffer, grace);
    const proj = computeProjection(idleQueue, idleQueue[1], START, buffer, grace);
    expect(proj.projectedStartMs).toBe(board.anchorMs);
    expect(proj.projectedStartMs).toBe(Date.parse(lateJoin) + grace * 1000);
  });

  it("second-in-line projection cascades from the same anchor as the board", () => {
    const proj = computeProjection(idleQueue, idleQueue[2], START, buffer, grace);
    // anchor (created_at + grace) + the head's (180 + 120) slot.
    expect(proj.projectedStartMs).toBe(
      Date.parse(lateJoin) + grace * 1000 + (180 + buffer) * 1000,
    );
  });

  it("an already-queued head (not a late arrival) anchors to the previous checkout", () => {
    const queued = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: lastFinish, run_duration_seconds: 300 }),
      entry({ position_in_queue: 2, run_duration_seconds: 180, created_at: EARLY }),
    ];
    const proj = computeProjection(queued, queued[1], START, buffer, grace);
    expect(proj.projectedStartMs).toBe(Date.parse(lastFinish)); // no grace — they were waiting
  });
});

describe("activeOrdered", () => {
  it("drops finished/skipped/no_show and sorts by position", () => {
    const q = [
      entry({ position_in_queue: 3 }),
      entry({ position_in_queue: 1, status: "finished" }),
      entry({ position_in_queue: 2, status: "skipped" }),
      entry({ position_in_queue: 4, status: "checked_in" }),
    ];
    expect(activeOrdered(q).map((m) => m.position_in_queue)).toEqual([3, 4]);
  });
});

describe("computeProjection", () => {
  const buffer = 120;

  it("projects on schedule before anything happens", () => {
    // queue: [A(600), B(600), C(600)], buffer 120
    const q = [
      entry({ position_in_queue: 1, run_duration_seconds: 600 }),
      entry({ position_in_queue: 2, run_duration_seconds: 600 }),
      entry({ position_in_queue: 3, run_duration_seconds: 600 }),
    ];
    // C is index 2: anchor + 2*(600+120) = +1440s
    const proj = computeProjection(q, q[2], START, buffer);
    expect(proj.projectedStartMs).toBe(startMs + 1440 * 1000);
    expect(proj.livePosition).toBe(3);
    expect(proj.isDelayed).toBe(false);
  });

  it("flags a delay when the head checks out late", () => {
    // A finished 5 min later than planned -> everyone behind is delayed.
    const lateFinish = new Date(startMs + (600 + 120 + 300) * 1000).toISOString();
    const q = [
      entry({
        position_in_queue: 1,
        run_duration_seconds: 600,
        status: "finished",
        actual_finish: lateFinish,
      }),
      entry({
        position_in_queue: 2,
        run_duration_seconds: 600,
        // original estimate captured at start for B: +720s
        original_estimated_start: new Date(startMs + 720 * 1000).toISOString(),
      }),
    ];
    const proj = computeProjection(q, q[1], START, buffer);
    // B is now head (index 0), projected = anchor (lateFinish)
    expect(proj.projectedStartMs).toBe(Date.parse(lateFinish));
    expect(proj.livePosition).toBe(1);
    expect(proj.isDelayed).toBe(true);
    expect(proj.delayMinutes).toBe(5);
  });

  it("returns no projection for a finished runner", () => {
    const q = [entry({ position_in_queue: 1, status: "finished" })];
    const proj = computeProjection(q, q[0], START, buffer);
    expect(proj.projectedStartMs).toBeNull();
    expect(proj.livePosition).toBeNull();
  });

  it("re-anchors the line behind a late check-in granted a custom run time", () => {
    // Head was checked in LATE with a 4-min grant. The machine frees at their
    // check-in + 4 min, NOT at anchor + buffer + run. The next runner's start
    // must follow that re-anchor (and agree with the board slot timer).
    const checkin = new Date(startMs + 500 * 1000).toISOString();
    const q = [
      entry({
        position_in_queue: 1,
        run_duration_seconds: 600,
        status: "checked_in",
        actual_start: checkin,
        granted_run_seconds: 240, // 4 min granted
      }),
      entry({ position_in_queue: 2, run_duration_seconds: 300 }),
    ];
    const proj = computeProjection(q, q[1], START, buffer);
    expect(proj.livePosition).toBe(2);
    // next runner starts when the granted head frees the machine
    expect(proj.projectedStartMs).toBe(Date.parse(checkin) + 240 * 1000);
  });

  it("does NOT flag a delay for a late signup onto a drained machine (board says up next)", () => {
    // Repro of the page-vs-board divergence: everyone ahead has finished long
    // ago, then someone signs up onto the now-idle machine with NO original
    // estimate. The idle-machine rule re-anchors their slot to created_at+grace
    // (≈ now), which the board renders as "up next" — so the status page must
    // NOT report the hour-long idle gap as a delay.
    const lastFinish = new Date(startMs + 90 * 60 * 1000).toISOString(); // +90 min
    const lateJoin = new Date(startMs + 91 * 60 * 1000).toISOString(); // signs up after
    const q = [
      entry({
        position_in_queue: 1,
        status: "finished",
        actual_finish: lastFinish,
        original_estimated_start: START,
      }),
      entry({
        position_in_queue: 2,
        run_duration_seconds: 300,
        status: "signed_up",
        original_estimated_start: null, // late signup — no promised time
        created_at: lateJoin,
      }),
    ];
    const grace = 180;
    const proj = computeProjection(q, q[1], START, buffer, grace);
    // Slot re-anchored to created_at + grace, matching the board's slot timer.
    expect(proj.livePosition).toBe(1);
    expect(proj.projectedStartMs).toBe(Date.parse(lateJoin) + grace * 1000);
    expect(effectiveAnchorMs(q, START, grace)).toBe(proj.projectedStartMs);
    // No original to fall behind → not delayed (was a ~90-min bogus delay before).
    expect(proj.isDelayed).toBe(false);
    expect(proj.delayMinutes).toBe(0);
  });
});

describe("computeSlotTimer", () => {
  const buffer = 120;

  it("awaits check-in for a fresh head anchored to event start", () => {
    const q = [
      entry({ position_in_queue: 1, run_duration_seconds: 600 }),
      entry({ position_in_queue: 2 }),
    ];
    const t = computeSlotTimer(q, START, buffer);
    expect(t.phase).toBe("awaiting_checkin");
    expect(t.anchorMs).toBe(startMs);
    expect(t.checkInDeadlineMs).toBe(startMs + 120 * 1000);
    expect(t.slotEndMs).toBe(startMs + (120 + 600) * 1000);
  });

  it("shows running once the head checks in, slot still anchored to prev checkout", () => {
    const prevFinish = new Date(startMs + 700 * 1000).toISOString();
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: prevFinish }),
      entry({
        position_in_queue: 2,
        run_duration_seconds: 600,
        status: "checked_in",
        actual_start: new Date(startMs + 800 * 1000).toISOString(),
      }),
    ];
    const t = computeSlotTimer(q, START, buffer);
    expect(t.phase).toBe("running");
    // anchored to the previous checkout, NOT to the late check-in
    expect(t.anchorMs).toBe(Date.parse(prevFinish));
    expect(t.slotEndMs).toBe(Date.parse(prevFinish) + (120 + 600) * 1000);
  });

  it("re-anchors a late-checked-in head to check-in + granted run (no buffer)", () => {
    const prevFinish = new Date(startMs + 700 * 1000).toISOString();
    const checkin = new Date(startMs + 1500 * 1000).toISOString(); // checked in late
    const q = [
      entry({ position_in_queue: 1, status: "finished", actual_finish: prevFinish }),
      entry({
        position_in_queue: 2,
        run_duration_seconds: 600,
        status: "checked_in",
        actual_start: checkin,
        granted_run_seconds: 180, // moderator granted 3 min
      }),
    ];
    const t = computeSlotTimer(q, START, buffer);
    expect(t.phase).toBe("running");
    expect(t.anchorMs).toBe(Date.parse(checkin));
    expect(t.checkInDeadlineMs).toBe(Date.parse(checkin));
    // ends 3 min after check-in — buffer is NOT added (they're already here)
    expect(t.slotEndMs).toBe(Date.parse(checkin) + 180 * 1000);
  });

  it("reports queue_complete when nobody is left", () => {
    const q = [entry({ position_in_queue: 1, status: "finished" })];
    expect(computeSlotTimer(q, START, buffer).phase).toBe("queue_complete");
  });
});
