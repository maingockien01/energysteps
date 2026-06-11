// Best-effort attention chimes via the Web Audio API — no audio asset files.
//
// Mobile autoplay policy: an AudioContext must be created/resumed from inside a
// user gesture before it can play programmatically later. Call unlockAudio()
// from a click handler ("Enable alerts" / "Call next") so a subsequent
// playChime() — fired from a poll tick, not a gesture — is allowed to sound.
// Everything here silently no-ops if Web Audio is unavailable or blocked.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

// Resume the audio context from within a user gesture so later programmatic
// chimes are permitted. Safe to call repeatedly.
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

// Play `beeps` short rising tones. Best-effort — no-ops if audio is blocked.
export function playChime(beeps = 2): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const start = c.currentTime;
  for (let i = 0; i < beeps; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880 + i * 220; // each beep a little higher
    const t0 = start + i * 0.3;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  }
}
