// Shared domain types. Mirror of the DB schema in supabase/migrations/0001_init.sql.

export type ParticipantStatus =
  | "signed_up"
  | "checked_in"
  | "finished"
  | "skipped"
  | "no_show";

export interface EventConfig {
  id: number;
  event_start_time: string | null; // ISO timestamptz
  buffer_seconds: number;
  queue_count: number;
  allowed_run_durations: number[]; // seconds
  event_started: boolean;
  started_at: string | null;
}

export interface Queue {
  id: string;
  queue_number: number;
  name: string;
}

export interface Gift {
  id: string;
  name: string;
  total_quantity: number;
  remaining_quantity: number;
}

export interface Participant {
  id: string;
  name: string;
  department: string;
  email: string;
  run_duration_seconds: number;
  assigned_queue_id: string;
  position_in_queue: number;
  status: ParticipantStatus;
  original_estimated_start: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  distance_logged: number | null;
  gift_id: string | null;
  created_at: string;
}

// De-identified queue member returned by get_status_by_email (no name/email).
export interface QueueMember {
  id: string;
  position_in_queue: number;
  run_duration_seconds: number;
  status: ParticipantStatus;
  original_estimated_start: string | null;
  actual_start: string | null;
  actual_finish: string | null;
}

// ---- RPC return shapes ----

export interface SignUpResult {
  participant: Participant;
  queue: Queue;
  estimated_start: string | null;
  event_start_time: string | null;
  buffer_seconds: number;
}

export interface StatusResult {
  found: boolean;
  // De-identified: the matched runner's OWN status fields only (no name/email).
  me?: QueueMember;
  queue?: Queue;
  config?: EventConfig;
  queue_members?: QueueMember[];
}

export interface ModeratorState {
  config: EventConfig;
  queues: Queue[];
  gifts: Gift[];
  participants: Participant[];
}

// Friendly error codes raised by the RPCs (see migration).
export type ApiErrorCode =
  | "EMAIL_TAKEN"
  | "INVALID_DURATION"
  | "INVALID_EMAIL_DOMAIN"
  | "INVALID_PIN"
  | "INVALID_STATUS"
  | "QUEUE_COUNT_LOCKED"
  | "QUEUE_COUNT_HAS_SIGNUPS"
  | "ALREADY_STARTED"
  | "NO_START_TIME"
  | "UNKNOWN";
