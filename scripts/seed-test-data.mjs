// =============================================================================
// Test-data seeder — ~30 participants covering every event-day scenario.
//
// Exercises the REAL RPCs (sign_up, start_event, check_in/out, skip, suggest_gift)
// so it doubles as a production smoke-test. It RESETS the event first, so it
// starts from a clean slate every run. Use the moderator "Restart event data"
// button (or rerun this) to clear the test data before the real event.
//
// Usage:
//   LOCAL (default):
//     node scripts/seed-test-data.mjs
//   PRODUCTION (run it yourself with your real values):
//     SEED_URL="https://<ref>.supabase.co" \
//     SEED_ANON="<anon key>" \
//     SEED_PIN="<moderator PIN>" \
//     node scripts/seed-test-data.mjs
//
// Requires the 0010–0012 migrations to be applied to the target database first.
// Scenarios produced:
//   waiting · running (checked-in) · finished+gift · finished without gift
//   (gift stock exhausted) · skipped · no-show · waitlisted · multi-signup
//   history · one-gift-per-email block · gift auto-select across all tiers ·
//   departments with finishers AND departments/domains with zero · an emptied
//   machine + a late arrival (idle-machine re-anchor, visible once the check-in
//   buffer elapses).
// =============================================================================

const BASE = (process.env.SEED_URL || "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON =
  process.env.SEED_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PIN = process.env.SEED_PIN || "1234";
const REST = `${BASE}/rest/v1`;

async function rpc(fn, body) {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${fn} -> ${res.status} ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DURS = [120, 180, 300];
const DEPTS = [
  "IT",
  "HR",
  "Digital",
  "Agency",
  "Operations",
  "Finance and Investment",
  "Legal and Compliance",
  "Bancassurance",
];

async function checkout(id, distance) {
  // Mirror the moderator flow: ask the backend which gift to auto-select, then
  // award it; fall back to no gift if out of stock / already awarded.
  let giftId = null;
  try {
    giftId = (await rpc("moderator_suggest_gift", { p_pin: PIN, p_participant_id: id }))
      .gift_id;
  } catch {
    /* suggestion is best-effort */
  }
  try {
    await rpc("moderator_check_out", {
      p_pin: PIN,
      p_participant_id: id,
      p_distance: distance,
      p_gift_id: giftId,
    });
    return giftId ? "finished+gift" : "finished(no gift mapped)";
  } catch {
    await rpc("moderator_check_out", {
      p_pin: PIN,
      p_participant_id: id,
      p_distance: distance,
      p_gift_id: null,
    });
    return "finished(no gift - stock out)";
  }
}

async function main() {
  console.log(`Seeding test data → ${BASE}`);

  // 1. Clean slate.
  await rpc("moderator_reset_event", { p_pin: PIN });

  // 2. Config: started 2 min ago, ends in 25 min (so the tail waitlists),
  //    2-min check-in buffer, 3-min idle move grace. We KEEP the existing
  //    machine count (changing it regenerates the queues, which some DBs block).
  const cfg0 = (await rpc("moderator_get_state", { p_pin: PIN })).config;
  await rpc("moderator_update_config", {
    p_pin: PIN,
    p_event_start_time: iso(-2 * 60 * 1000),
    p_event_end_time: iso(25 * 60 * 1000),
    p_buffer_seconds: 120,
    p_allowed_run_durations: DURS,
    p_queue_count: cfg0.queue_count,
    p_move_grace_seconds: 180,
  });

  // 3. Gifts mapped to tiers, with LOW stock so the out-of-stock path triggers.
  await rpc("moderator_create_gift", { p_pin: PIN, p_name: "Cafe", p_quantity: 4, p_duration_seconds: 120 });
  await rpc("moderator_create_gift", { p_pin: PIN, p_name: "Nuoc ep", p_quantity: 4, p_duration_seconds: 180 });
  await rpc("moderator_create_gift", { p_pin: PIN, p_name: "Set hoa qua", p_quantity: 4, p_duration_seconds: 300 });

  // 4. Sign up 30 across departments / durations.
  for (let i = 1; i <= 30; i++) {
    await rpc("sign_up", {
      p_name: `Test User ${String(i).padStart(2, "0")}`,
      p_department: DEPTS[i % DEPTS.length],
      p_email: `test${String(i).padStart(2, "0")}@mblife.vn`,
      p_run_duration_seconds: DURS[i % DURS.length],
    });
  }

  // 5. Start the event (stamps each runner's original estimate).
  await rpc("moderator_start_event", { p_pin: PIN });

  // 6. Drive scenarios off the live state.
  const state = await rpc("moderator_get_state", { p_pin: PIN });
  const queues = [...state.queues].sort((a, b) => a.queue_number - b.queue_number);
  const byQueue = (qid) =>
    state.participants
      .filter((p) => p.assigned_queue_id === qid)
      .sort((a, b) => a.position_in_queue - b.position_in_queue);

  // Machine 0: finish its entire line -> finishers, gift hand-out + exhaustion,
  // and an EMPTY machine for the idle-arrival scenario.
  let d = 0.5;
  for (const p of byQueue(queues[0].id)) {
    await rpc("moderator_check_in", { p_pin: PIN, p_participant_id: p.id });
    await checkout(p.id, Number((d += 0.25).toFixed(2)));
  }

  // The rest (every other machine), in queue/position order. Assign a spread of
  // outcomes by index; everyone past the assigned ones stays waiting.
  const rest = queues
    .slice(1)
    .flatMap((q) => byQueue(q.id))
    .filter((p) => p.status === "signed_up");
  const pick = (i) => rest[i];
  // Two runners currently on the machines (checked-in).
  for (const i of [0, 1]) if (pick(i)) await rpc("moderator_check_in", { p_pin: PIN, p_participant_id: pick(i).id });
  // Two more finished (one ties at 2.50 with a 300s finisher to test tie display).
  for (const [i, dist] of [[2, 2.5], [3, 1.75]]) {
    if (pick(i)) {
      await rpc("moderator_check_in", { p_pin: PIN, p_participant_id: pick(i).id });
      await checkout(pick(i).id, dist);
    }
  }
  if (pick(4)) await rpc("moderator_skip", { p_pin: PIN, p_participant_id: pick(4).id, p_status: "skipped" });
  if (pick(5)) await rpc("moderator_skip", { p_pin: PIN, p_participant_id: pick(5).id, p_status: "no_show" });
  // pick(6)+ stay waiting (incl. a full untouched line on the last machine).

  // 7. Multi-signup history + one-gift-per-email: a finished runner re-registers.
  const finishedWithGift = byQueue(queues[0].id)[0];
  if (finishedWithGift) {
    await rpc("sign_up", {
      p_name: finishedWithGift.name,
      p_department: finishedWithGift.department,
      p_email: finishedWithGift.email, // same email -> history; gift suggestion will be null
      p_run_duration_seconds: 180,
    });
  }

  // 8. Idle-machine arrival: signs up onto the now-empty machine 0. Its estimate
  //    re-anchors to "now + move grace" once the 2-min check-in buffer elapses.
  await rpc("sign_up", {
    p_name: "Idle Late Arrival",
    p_department: "MC/ EXCO",
    p_email: "idle@mblife.vn",
    p_run_duration_seconds: 300,
  });

  // 9. Summary.
  const after = await rpc("moderator_get_state", { p_pin: PIN });
  const counts = {};
  for (const p of after.participants) counts[p.status] = (counts[p.status] || 0) + 1;
  const lb = await rpc("get_leaderboard", {});
  console.log("\nDone. Participant statuses:", counts);
  console.log("Total participants:", after.participants.length);
  console.log(
    "Departments with finishers:",
    lb.departments.map((x) => `${x.department}(${x.total_distance}km)`).join(", ") || "none",
  );
  console.log("\nClear this test data before the real event via Config → Restart event data.");
}

main().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
