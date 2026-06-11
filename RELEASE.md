# Release guide — EnergySteps

A complete, non-expert walkthrough from zero to a live URL. Follow top to bottom.

---

## Step 1 — Create the Supabase project + database

1. Go to <https://supabase.com>, sign in, click **New project**.
   - Pick an org, give it a name (e.g. `energysteps`), set a strong database
     password (you won't need it again for this app), choose a region near you.
   - Wait ~2 minutes for it to provision.
2. In the left sidebar open **SQL Editor → New query**.
3. Run **each** file in `supabase/migrations/` **in order**. For each one, open
   it, copy its **entire** contents, paste into the SQL editor, and click **Run**:
   1. `0001_init.sql` — tables, security policies, and the functions the app calls.
   2. `0002_reset_event.sql` — the "Restart event data" function.
   3. `0003_signup_concurrency.sql` — concurrency-safe sign-up.
   4. `0004_event_defaults.sql` — mblife event defaults (durations, machines, gifts).
   5. `0005_improvements.sql` — capacity/waitlist, verify_pin, undo, audit log,
      leaderboard, richer status payload.
   - Each should finish with "Success. No rows returned."
4. Set your real moderator PIN(s). Still in the SQL editor, run (replace with
   your own PINs; one row per PIN):
   ```sql
   delete from public.moderator_pins;            -- remove the default 1234
   insert into public.moderator_pins (pin) values ('4821'), ('7140');
   ```
   These PINs live ONLY here in the database now — the gate validates them via
   the `verify_pin` RPC. There is no frontend PIN env var to keep in sync.
   Optionally label a PIN per station: `update public.moderator_pins set label =
   'Station 1' where pin = '4821';` (the label shows in the dashboard audit log).
5. Get your API credentials. Left sidebar **Project Settings → API**:
   - **Project URL** — copy the value under "Project URL". It looks like
     `https://abcdefghijklmnop.supabase.co`.
     ⚠️ Use this **base URL**, NOT the `.../rest/v1/` endpoint shown elsewhere.
   - **Project API keys → `anon` `public`** — copy this key.
     ⚠️ Use the **anon / public** key, NOT the `service_role` key. The
     service_role key bypasses all security and must never go in a frontend.

You now have: a Project URL, an anon key, and your PIN list.

---

## Step 2 — Push this repo to GitHub

From the project folder in a terminal:

```bash
git init                       # (skip if already a git repo)
git add -A
git commit -m "EnergySteps"
git branch -M main
# create an empty repo on github.com first (no README), then:
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

> `.env` is git-ignored, so your secrets are NOT pushed. Good.

---

## Step 3 — Connect the repo to Netlify

1. Go to <https://app.netlify.com>, sign in, **Add new site → Import an existing
   project → GitHub**, and authorize Netlify to access your repo. Pick the repo.
2. **Build settings** (Netlify usually auto-detects these from `netlify.toml`;
   confirm they read):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
3. **Environment variables** — click **Add environment variables** (or do it
   later under *Site configuration → Environment variables*) and add all three:
   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL from Step 1.5 (the base URL) |
   | `VITE_SUPABASE_ANON_KEY` | your anon/public key from Step 1.5 |

   (There is no longer a `VITE_MODERATOR_PINS` variable — PINs live only in the
   `moderator_pins` table from Step 1.4.)
4. Click **Deploy site**.

---

## Step 4 — Deploy and verify

1. Netlify builds the site (watch the **Deploys** tab). First build takes ~1–2 min.
2. When it says **Published**, open the live URL (e.g.
   `https://your-site.netlify.app`).
3. Verify:
   - `/` shows the **sign-up form**. Sign up a test person → you should see an
     assigned machine and (if you've set a start time in the console) an
     estimated window.
   - `/status` → enter that email → you should see their status.
   - `/moderator` → enter one of your PINs → the console should load.
   - Refreshing on `/status` or `/moderator` should NOT 404 (the SPA redirect in
     `netlify.toml` handles this).
4. If sign-up or the console shows an error, double-check the three env vars in
   Netlify (typos in the URL/key are the usual cause), then **Trigger deploy →
   Clear cache and deploy site** so the new env values are baked in.

> Note: Vite env vars are embedded at **build time**. If you change an env var in
> Netlify, you must redeploy for it to take effect.

---

## Step 5 — Moderators: logging in & how PINs work

- Moderators go to **`/moderator`** on the live site and enter a PIN.
- A PIN is accepted if it appears in the **`moderator_pins` table** in the
  database — the single source of truth. The gate checks it via the `verify_pin`
  RPC, and every privileged operation re-checks it server-side.
- To add/remove a moderator PIN, just update the table in the Supabase SQL editor
  (`insert into public.moderator_pins (pin) values ('newpin');` or `delete`).
  No redeploy needed — the change takes effect immediately.
- Any single valid PIN grants full moderator access (there are no roles). The
  validated PIN is kept in the browser's `sessionStorage` and is cleared when the
  tab closes or the moderator clicks **Lock**.

---

## Pre-event checklist (do this before opening sign-ups)

In the moderator **Config** tab:
1. Set the **number of machines** (`queue_count`). ⚠️ This can only be changed
   **before anyone signs up** and is locked once the event starts.
2. Set the **event start time**, the **buffer** (seconds between runners), and
   the **allowed run durations**.
3. Add your **gifts** (Gifts tab) with quantities.
4. Open sign-ups (share the `/` URL).
5. When you're ready to begin, click **Start event** in Config. This captures
   everyone's immutable original estimate and locks the machine count.
