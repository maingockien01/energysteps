// Gift-by-duration-tier rules (spec B.5; official rules in docs/RULES.md §"Gift
// structure"). Each run-duration tier awards a specific gift to the first N
// *finishers* in that tier, ranked by finish time.
// The gift's live quantity is read from the DB by matching `giftName`; if no
// such gift row exists, `quantity` here is the expected fallback total.
//
// These match the seeds in supabase/migrations/0003_event_defaults.sql.
export interface GiftTier {
  seconds: number; // run_duration_seconds this tier applies to
  giftName: string; // matched (case-insensitive) against gifts.name
  quantity: number; // expected number of slots
}

export const GIFT_TIERS: readonly GiftTier[] = [
  { seconds: 120, giftName: "Cafe", quantity: 50 }, // 2 min
  { seconds: 180, giftName: "Nước ép", quantity: 30 }, // 3 min
  { seconds: 300, giftName: "Set hoa quả", quantity: 20 }, // 5 min
];

// The gift tier for a given run duration (seconds), or undefined if none.
export function giftTierForSeconds(seconds: number): GiftTier | undefined {
  return GIFT_TIERS.find((t) => t.seconds === seconds);
}
