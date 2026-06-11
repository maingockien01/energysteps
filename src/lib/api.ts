// Typed wrappers around the Supabase RPCs. UI code should ONLY talk to the
// data layer through these functions (never raw supabase.from(...) on the
// participants table — it's RLS-locked; see docs/ADR.md ADR-002).
import { supabase } from "./supabase";
import { broadcastChanged } from "./realtime";
import type {
  ApiErrorCode,
  ModeratorState,
  SignUpResult,
  StatusResult,
} from "./types";

const KNOWN_CODES: ApiErrorCode[] = [
  "EMAIL_TAKEN",
  "INVALID_DURATION",
  "INVALID_EMAIL_DOMAIN",
  "INVALID_PIN",
  "INVALID_STATUS",
  "QUEUE_COUNT_LOCKED",
  "QUEUE_COUNT_HAS_SIGNUPS",
  "ALREADY_STARTED",
  "NO_START_TIME",
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
      return "That email is already signed up. Each email can only register once.";
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
  buffer_seconds: number;
  event_started: boolean;
}> {
  const { data, error } = await supabase
    .from("event_config")
    .select("allowed_run_durations,event_start_time,buffer_seconds,event_started")
    .eq("id", 1)
    .single();
  if (error) throw toApiError(error);
  return data as {
    allowed_run_durations: number[];
    event_start_time: string | null;
    buffer_seconds: number;
    event_started: boolean;
  };
}

// ---- Moderator (all take the validated PIN) ----

export async function moderatorGetState(pin: string): Promise<ModeratorState> {
  const { data, error } = await supabase.rpc("moderator_get_state", { p_pin: pin });
  if (error) throw toApiError(error);
  return data as ModeratorState;
}

export async function moderatorCheckIn(pin: string, participantId: string) {
  const { error } = await supabase.rpc("moderator_check_in", {
    p_pin: pin,
    p_participant_id: participantId,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorCheckOut(
  pin: string,
  participantId: string,
  distance: number | null,
  giftId: string | null,
) {
  const { error } = await supabase.rpc("moderator_check_out", {
    p_pin: pin,
    p_participant_id: participantId,
    p_distance: distance,
    p_gift_id: giftId,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorSkip(
  pin: string,
  participantId: string,
  status: "skipped" | "no_show",
) {
  const { error } = await supabase.rpc("moderator_skip", {
    p_pin: pin,
    p_participant_id: participantId,
    p_status: status,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorUpdateParticipant(
  pin: string,
  id: string,
  fields: { name: string; department: string; email: string; run_duration_seconds: number },
) {
  const { error } = await supabase.rpc("moderator_update_participant", {
    p_pin: pin,
    p_id: id,
    p_name: fields.name,
    p_department: fields.department,
    p_email: fields.email,
    p_run_duration_seconds: fields.run_duration_seconds,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorCreateGift(pin: string, name: string, quantity: number) {
  const { error } = await supabase.rpc("moderator_create_gift", {
    p_pin: pin,
    p_name: name,
    p_quantity: quantity,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorUpdateGift(
  pin: string,
  id: string,
  fields: { name: string; total_quantity: number; remaining_quantity: number },
) {
  const { error } = await supabase.rpc("moderator_update_gift", {
    p_pin: pin,
    p_id: id,
    p_name: fields.name,
    p_total_quantity: fields.total_quantity,
    p_remaining_quantity: fields.remaining_quantity,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorDeleteGift(pin: string, id: string) {
  const { error } = await supabase.rpc("moderator_delete_gift", { p_pin: pin, p_id: id });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorUpdateConfig(
  pin: string,
  cfg: {
    event_start_time: string | null;
    buffer_seconds: number;
    allowed_run_durations: number[];
    queue_count: number;
  },
) {
  const { error } = await supabase.rpc("moderator_update_config", {
    p_pin: pin,
    p_event_start_time: cfg.event_start_time,
    p_buffer_seconds: cfg.buffer_seconds,
    p_allowed_run_durations: cfg.allowed_run_durations,
    p_queue_count: cfg.queue_count,
  });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

export async function moderatorStartEvent(pin: string) {
  const { error } = await supabase.rpc("moderator_start_event", { p_pin: pin });
  if (error) throw toApiError(error);
  await broadcastChanged();
}

// Restart event data: clears all participants, restores gift counts, un-starts.
export async function moderatorResetEvent(pin: string) {
  const { error } = await supabase.rpc("moderator_reset_event", { p_pin: pin });
  if (error) throw toApiError(error);
  await broadcastChanged();
}
