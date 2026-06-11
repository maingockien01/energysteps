import { describe, expect, it } from "vitest";
import {
  activeOrdered,
  computeProjection,
  computeSlotTimer,
  headAnchorMs,
  type QueueEntry,
} from "./queueLogic";

const START = "2026-06-10T09:00:00.000Z";
const startMs = Date.parse(START);

function entry(p: Partial<QueueEntry> & { position_in_queue: number }): QueueEntry {
  return {
    run_duration_seconds: 600,
    status: "signed_up",
    actual_start: null,
    actual_finish: null,
    original_estimated_start: null,
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

  it("reports queue_complete when nobody is left", () => {
    const q = [entry({ position_in_queue: 1, status: "finished" })];
    expect(computeSlotTimer(q, START, buffer).phase).toBe("queue_complete");
  });
});
