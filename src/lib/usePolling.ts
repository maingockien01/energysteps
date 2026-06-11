import { useEffect } from "react";

// Poll `fn` on an interval, but only while the tab is visible — and refetch
// immediately on regaining focus so a returning user sees fresh data. Used by
// the public status + leaderboard pages, which poll (not Realtime) to stay
// under the Supabase Free-tier websocket cap; see StatusPage.tsx for the full
// rationale.
//
// `fn` should be a stable callback (wrap it in useCallback) — the effect
// re-subscribes whenever it changes. Set `enabled: false` to pause polling
// entirely (e.g. before an email has been submitted). `immediate` runs `fn`
// once on mount in addition to starting the interval.
export function useVisibilityPolling(
  fn: () => void,
  opts: { enabled?: boolean; intervalMs?: number; immediate?: boolean } = {},
) {
  const { enabled = true, intervalMs = 30_000, immediate = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(fn, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fn(); // refresh immediately on focus
        start();
      } else {
        stop();
      }
    };

    if (immediate) fn();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fn, enabled, intervalMs, immediate]);
}
