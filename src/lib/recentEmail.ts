// Remembers the email a participant most recently signed up with or looked up,
// so the status page can prefill (and auto-look-up) instead of forcing a retype
// on every visit — the most common return journey is "sign up → when's my turn?".
const KEY = "energysteps.recentEmail";

export function getRecentEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return ""; // privacy mode / SSR
  }
}

export function setRecentEmail(email: string): void {
  try {
    localStorage.setItem(KEY, email);
  } catch {
    // ignore (privacy mode)
  }
}
