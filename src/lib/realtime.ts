// Realtime liveness via a single public Supabase Broadcast channel (see
// docs/ADR.md ADR-004). Mutating actions call broadcastChanged(); the board
// and status page call subscribeToChanges() to re-fetch when anything changes.
// This is a Realtime subscription (NOT polling).
import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const TOPIC = "event";
const EVENT = "changed";

// One shared channel per browser tab, joined to the "event" topic. All
// listeners register callbacks; the mutating side sends on the same topic.
let channel: RealtimeChannel | null = null;
let ready: Promise<void> | null = null;
const listeners = new Set<() => void>();

function ensureChannel(): Promise<void> {
  if (ready) return ready;
  // self: true so listeners in the same tab also react (a harmless extra fetch).
  channel = supabase.channel(TOPIC, { config: { broadcast: { self: true } } });
  channel.on("broadcast", { event: EVENT }, () => {
    listeners.forEach((cb) => cb());
  });
  ready = new Promise<void>((resolve) => {
    channel!.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  return ready;
}

// Announce that some data changed so all subscribed clients re-fetch.
export async function broadcastChanged(): Promise<void> {
  try {
    await ensureChannel();
    await channel!.send({ type: "broadcast", event: EVENT, payload: {} });
  } catch {
    // Best-effort: a failed broadcast must never break the mutation itself.
  }
}

// Register a callback fired whenever data changes. Returns an unsubscribe fn.
//
// The callback is DEBOUNCED: under a signup burst a client can receive many
// "changed" events per second, and each one triggers a full re-fetch
// (getStatusByEmail / moderator_get_state). Firing 1:1 with broadcasts is the
// real meltdown vector — N signups x M open clients = N*M expensive RPCs. We
// coalesce to at most one re-fetch per window per client; the trailing fire
// guarantees the latest state is still fetched.
const REFETCH_DEBOUNCE_MS = 1500;

export function subscribeToChanges(onChange: () => void): () => void {
  void ensureChannel();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) return; // a re-fetch is already scheduled within this window
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, REFETCH_DEBOUNCE_MS);
  };
  listeners.add(debounced);
  return () => {
    if (timer) clearTimeout(timer);
    listeners.delete(debounced);
  };
}
