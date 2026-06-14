// Typed wrappers around the Supabase RPCs. UI code should ONLY talk to the
// data layer through these functions (never raw supabase.from(...) on the
// participants table — it's RLS-locked; see docs/ADR.md ADR-002).
import { supabase } from "./supabase";
import { broadcastChanged } from "./realtime";
import type {
  ActionLogEntry,
  ApiErrorCode,
  Gift,
  LeaderboardResult,
  ModeratorState,
  SignUpResult,
  StatusResult,
} from "./types";

const KNOWN_CODES: ApiErrorCode[] = [
  "EMAIL_TAKEN",
  "INVALID_DURATION",
  "INVALID_EMAIL_DOMAIN",
  "INVALID_PIN",
  "INVALID_NAME",
  "INVALID_STATUS",
  "GIFT_ALREADY_AWARDED",
  "GIFT_OUT_OF_STOCK",
  "INVALID_DISTANCE",
  "QUEUE_COUNT_LOCKED",
  "QUEUE_COUNT_HAS_SIGNUPS",
  "ALREADY_STARTED",
  "NO_START_TIME",
  "UNDO_NOT_APPLICABLE",
  "QUEUE_NOT_FREE",
  "NOT_FOUND",
];

export class ApiError extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

// Map a raw supabase error to a friendly ApiError.
function toApiError(error: { message?: string } | null): ApiError {
  const msg = error?.message ?? "";
  const found = KNOWN_CODES.find((c) => msg.includes(c));
  return new ApiError(found ?? "UNKNOWN", msg);
}

// Human-readable text for each error code (used by forms).
export function errorMessage(code: ApiErrorCode): string {
  switch (code) {
    case "EMAIL_TAKEN":
      return "That email already has an in-progress registration. You can register again after you finish or are skipped.";
    case "GIFT_ALREADY_AWARDED":
      return "This person has already received a gift. Check out with “No gift”.";
    case "GIFT_OUT_OF_STOCK":
      return "That gift is out of stock. Pick another gift, or check out with “No gift”.";
    case "INVALID_DISTANCE":
      return "Distance must be a non-negative number.";
    case "INVALID_DURATION":
      return "That run duration is not allowed. Please pick one from the list.";
    case "INVALID_PIN":
      return "Incorrect PIN.";
    case "QUEUE_COUNT_LOCKED":
      return "The number of machines cannot change after the event has started.";
    case "QUEUE_COUNT_HAS_SIGNUPS":
      return "Cannot change the number of machines once people have signed up.";
    case "ALREADY_STARTED":
      return "The event has already been started.";
    case "NO_START_TIME":
      return "Set an event start time before starting the event.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- Public ----

export async function signUp(input: {
  name: string;
  department: string;
  email: string;
  run_duration_seconds: number;
}): Promise<SignUpResult> {
  const { data, error } = await supabase.rpc("sign_up", {
    p_name: input.name,
    p_department: input.department,
    p_email: input.email,
    p_run_duration_seconds: input.run_duration_seconds,
  });
  if (error) throw toApiError(error);
  // NOTE: intentionally NO broadcastChanged() here. A signup appends the new
  // runner to the tail of a queue and changes nobody else's position or
  // estimate, so there is nothing for other clients to re-fetch. Broadcasting
  // on every signup is the fan-out storm under a 1000-signup burst (every
  // open status page would re-fetch on every signup). Moderator actions
  // (check-in/out/skip/config) still broadcast — those genuinely move the queue.
  return data as SignUpResult;
}

export async function getStatusByEmail(email: string): Promise<StatusResult> {
  const { data, error } = await supabase.rpc("get_status_by_email", {
    p_email: email,
  });
  if (error) throw toApiError(error);
  return data as StatusResult;
}

// Read non-sensitive config directly (anon-readable) — used by the sign-up form.
export async function getPublicConfig(): Promise<{
  allowed_run_durations: number[];
  event_start_time: string | null;
  event_end_time: string | null;
  buffer_seconds: number;
  event_started: boolean;
  move_grace_seconds: number;
}> {
  const { data, error } = await supabase
    .from("event_config")
    .select(
      "allowed_run_durations,event_start_time,event_end_time,buffer_seconds,event_started,move_grace_seconds",
    )
    .eq("id", 1)
    .single();
  if (error) throw toApiError(error);
  return data as {
    allowed_run_durations: number[];
    event_start_time: string | null;
    event_end_time: string | null;
    buffer_seconds: number;
    event_started: boolean;
    move_grace_seconds: number;
  };
}

// Gifts are anon-readable (non-sensitive) — the sign-up form reads them to show
// how many gifts are still waiting for the runner's chosen duration tier.
export async function getPublicGifts(): Promise<Gift[]> {
  const { data, error } = await supabase
    .from("gifts")
    .select("id,name,total_quantity,remaining_quantity,duration_seconds");
  if (error) throw toApiError(error);
  return (data ?? []) as Gift[];
}

// Public leaderboard (P1-5). De-identified to a friendly handle server-side.
export async function getLeaderboard(): Promise<LeaderboardResult> {
  const { data, error } = await supabase.rpc("get_leaderboard");
  if (error) throw toApiError(error);
  return data as LeaderboardResult;
}

// ---- Moderator (all take the validated PIN) ----

// P1-2: the gate validates the PIN against the DB (single source of truth).
export async function moderatorVerifyPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("verify_pin", { p_pin: pin });
  if (error) throw toApiError(error);
  return data === true;
}

export async function moderatorGetState(pin: string): Promise<ModeratorState> {
  const { data, error } = await supabase.rpc("moderator_get_state", { p_pin: pin });
  if (error) throw toApiError(error);
  return data as ModeratorState;
}

// Every moderator mutation has the same shape: call the RPC, surface any error
// as an ApiError, then broadcast so other clients re-fetch the moved queue.
async function moderatorMutation(
  name: string,
  params: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc(name, params);
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export function moderatorCheckIn(pin: string, participantId: string) {
  return moderatorMutation("moderator_check_in", {
    p_pin: pin,
    p_participant_id: participantId,
  });
}

export function moderatorCheckOut(
  pin: string,
  participantId: string,
  distance: number | null,
  giftId: string | null,
) {
  return moderatorMutation("moderator_check_out", {
    p_pin: pin,
    p_participant_id: participantId,
    p_distance: distance,
    p_gift_id: giftId,
  });
}

// Move a waiting (signed_up) runner to a currently-free machine. The RPC
// enforces that the target queue has no active runner (see migration 0007).
export function moderatorMoveParticipant(
  pin: string,
  participantId: string,
  targetQueueId: string,
) {
  return moderatorMutation("moderator_move_participant", {
    p_pin: pin,
    p_participant_id: participantId,
    p_target_queue_id: targetQueueId,
  });
}

// Rename a machine (cosmetic). See migration 0016.
export function moderatorRenameQueue(pin: string, queueId: string, name: string) {
  return moderatorMutation("moderator_rename_queue", {
    p_pin: pin,
    p_queue_id: queueId,
    p_name: name,
  });
}

export function moderatorSkip(
  pin: string,
  participantId: string,
  status: "skipped" | "no_show",
) {
  return moderatorMutation("moderator_skip", {
    p_pin: pin,
    p_participant_id: participantId,
    p_status: status,
  });
}

// P1-3 — undo the last check-in / check-out for a runner.
export function moderatorUndoCheckIn(pin: string, participantId: string) {
  return moderatorMutation("moderator_undo_check_in", {
    p_pin: pin,
    p_participant_id: participantId,
  });
}

export function moderatorUndoCheckOut(pin: string, participantId: string) {
  return moderatorMutation("moderator_undo_check_out", {
    p_pin: pin,
    p_participant_id: participantId,
  });
}

// P1-4 — recent moderator activity (audit view).
export async function moderatorGetActionLog(
  pin: string,
  limit = 50,
): Promise<ActionLogEntry[]> {
  const { data, error } = await supabase.rpc("moderator_get_action_log", {
    p_pin: pin,
    p_limit: limit,
  });
  if (error) throw toApiError(error);
  return data as ActionLogEntry[];
}

export function moderatorUpdateParticipant(
  pin: string,
  id: string,
  fields: { name: string; department: string; email: string; run_duration_seconds: number },
) {
  return moderatorMutation("moderator_update_participant", {
    p_pin: pin,
    p_id: id,
    p_name: fields.name,
    p_department: fields.department,
    p_email: fields.email,
    p_run_duration_seconds: fields.run_duration_seconds,
  });
}

export function moderatorCreateGift(
  pin: string,
  name: string,
  quantity: number,
  durationSeconds: number | null = null,
) {
  return moderatorMutation("moderator_create_gift", {
    p_pin: pin,
    p_name: name,
    p_quantity: quantity,
    p_duration_seconds: durationSeconds,
  });
}

export function moderatorUpdateGift(
  pin: string,
  id: string,
  fields: {
    name: string;
    total_quantity: number;
    remaining_quantity: number;
    duration_seconds: number | null;
  },
) {
  return moderatorMutation("moderator_update_gift", {
    p_pin: pin,
    p_id: id,
    p_name: fields.name,
    p_total_quantity: fields.total_quantity,
    p_remaining_quantity: fields.remaining_quantity,
    p_duration_seconds: fields.duration_seconds,
  });
}

// Backend-driven gift suggestion for check-out: the in-stock gift mapped to the
// participant's run duration (null if none / already awarded). Authoritative
// stock read — see migration 0012.
export async function moderatorSuggestGift(
  pin: string,
  participantId: string,
): Promise<{ gift_id: string | null; gift_name: string | null }> {
  const { data, error } = await supabase.rpc("moderator_suggest_gift", {
    p_pin: pin,
    p_participant_id: participantId,
  });
  if (error) throw toApiError(error);
  return data as { gift_id: string | null; gift_name: string | null };
}

export function moderatorDeleteGift(pin: string, id: string) {
  return moderatorMutation("moderator_delete_gift", { p_pin: pin, p_id: id });
}

export function moderatorUpdateConfig(
  pin: string,
  cfg: {
    event_start_time: string | null;
    event_end_time: string | null;
    buffer_seconds: number;
    allowed_run_durations: number[];
    queue_count: number;
    move_grace_seconds: number;
  },
) {
  return moderatorMutation("moderator_update_config", {
    p_pin: pin,
    p_event_start_time: cfg.event_start_time,
    p_event_end_time: cfg.event_end_time,
    p_buffer_seconds: cfg.buffer_seconds,
    p_allowed_run_durations: cfg.allowed_run_durations,
    p_queue_count: cfg.queue_count,
    p_move_grace_seconds: cfg.move_grace_seconds,
  });
}

export function moderatorStartEvent(pin: string) {
  return moderatorMutation("moderator_start_event", { p_pin: pin });
}

// Restart event data: clears all participants, restores gift counts, un-starts.
export function moderatorResetEvent(pin: string) {
  return moderatorMutation("moderator_reset_event", { p_pin: pin });
}
