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
  event_end_time: string | null; // ISO timestamptz; capacity bound (P0-2)
  buffer_seconds: number;
  queue_count: number;
  allowed_run_durations: number[]; // seconds
  event_started: boolean;
  started_at: string | null;
  move_grace_seconds: number; // #7 — grace to reach an idle machine (seconds)
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
  duration_seconds: number | null; // run-duration tier this gift is awarded for
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
  waitlisted: boolean; // P0-2: projected finish past event end; not promised
  // Run length (seconds) granted at a LATE (post-buffer) check-in, measured from
  // actual_start. null = normal check-in. See migration 0017 / queueLogic.
  granted_run_seconds: number | null;
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
  // Run length granted at a late check-in (re-anchors the slot). null = normal.
  granted_run_seconds: number | null;
  created_at: string; // sign-up time — drives the idle-machine move grace (#7)
}

// The matched runner's own status — QueueMember plus their own (non-identity)
// result fields (P2-1) and the waitlist flag (P0-2).
export interface MyStatus extends QueueMember {
  distance_logged: number | null;
  gift_name: string | null;
  waitlisted: boolean;
}

// ---- RPC return shapes ----

export interface SignUpResult {
  participant: Participant;
  queue: Queue;
  estimated_start: string | null;
  event_start_time: string | null;
  buffer_seconds: number;
  waitlisted: boolean; // P0-2
  // Sign-ups still in the running for a gift in this runner's duration tier,
  // INCLUDING this one — counts signed_up + checked_in + finished, EXCLUDES
  // no-shows and skips. Used for the "gifts still waiting" nudge.
  tier_signup_count: number;
  // True if this email has ALREADY received a gift on a prior participation
  // (one gift per person, ever). Drives the confirmation gift message. Absent on
  // deployments before migration 0015 — treat a missing value as false.
  already_awarded?: boolean;
}

// One past/current participation for an email, returned by get_status_by_email
// so a multi-time runner can see ALL their results (P—multi-signup history).
export interface ParticipationHistoryEntry {
  id: string;
  position_in_queue: number;
  run_duration_seconds: number;
  status: ParticipantStatus;
  original_estimated_start: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  distance_logged: number | null;
  gift_name: string | null;
  queue_name: string | null;
  created_at: string;
}

export interface StatusResult {
  found: boolean;
  // De-identified: the matched runner's OWN status fields only (no name/email).
  me?: MyStatus;
  queue?: Queue;
  config?: EventConfig;
  queue_members?: QueueMember[];
  // Every participation for the looked-up email, newest first. Present once the
  // 0010 migration is applied; absent on older deployments (handled gracefully).
  history?: ParticipationHistoryEntry[];
}

// P1-5 — public leaderboard (de-identified to a friendly handle).
export interface LeaderboardEntry {
  display_name: string;
  department: string;
  distance: number;
  duration: number; // run_duration_seconds — leaderboard is categorized by this
}
export interface DepartmentTotal {
  department: string;
  total_distance: number;
  finishers: number;
}
export interface LeaderboardResult {
  individuals: LeaderboardEntry[];
  departments: DepartmentTotal[];
}

// P1-4 — moderator audit-log entry.
export interface ActionLogEntry {
  id: string;
  pin_label: string | null;
  action: string;
  participant_id: string | null;
  participant_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
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
  | "INVALID_NAME"
  | "INVALID_STATUS"
  | "GIFT_ALREADY_AWARDED"
  | "GIFT_OUT_OF_STOCK"
  | "INVALID_DISTANCE"
  | "QUEUE_COUNT_LOCKED"
  | "QUEUE_COUNT_HAS_SIGNUPS"
  | "ALREADY_STARTED"
  | "NO_START_TIME"
  | "UNDO_NOT_APPLICABLE"
  | "QUEUE_NOT_FREE"
  | "NOT_FOUND"
  | "NOT_CHECKED_IN"
  | "UNKNOWN";
