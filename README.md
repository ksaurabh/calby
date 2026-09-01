# Calby

A scheduling app: sign in with Google, describe your availability in plain
English, and share a booking link that writes real invites to your calendar.

- **Frontend** — React 19 + TypeScript + Tailwind 4, built with Vite.
- **Backend** — Express 5 with Passport (Google OAuth) and session cookies.
- **Storage** — JSON files in `server/` (created on first run, gitignored).
- **Calendar** — Google Calendar API (freeBusy + event insert) over the REST API.
- **Agent** — Claude (`claude-opus-5`) reads each event type's guidance once and
  produces structured scheduling rules.

## Features

- **Google sign-in.** Only accounts on an allowed email domain can use the app.
  `airmdr.com` is always allowed; more domains are added from the Administration
  page (super admin) or by editing `server/allowed-domains.json`.
- **Organizations.** Any signed-in user can list and create organizations.
- **Org admins.** A new org is unclaimed. The first person whose email domain
  matches the org's domain to *sign in* after it was created becomes its admin —
  claiming happens on the Google callback, not on a session refresh, so the
  creator doesn't claim their own org just by having the page open. An org with
  no domain is never claimed; its creator continues to manage it. An org admin
  can rename or delete their org and manage users on its domain, without being a
  platform admin.
- **User management.** Platform admins can add or remove any user; an org admin
  can add or remove users on their own org's domain. Adding a user
  pre-registers the account — they still authenticate with Google, and their
  domain must be allowed for sign-in to work. Removing a user releases any org
  they administered, which the next matching sign-in then claims.
- **Event types.** An event type has an **internal name** (what you call it —
  "Inbound lead — 30m") and an **external name** shown to whoever books
  ("Chat with Kumar"), plus *plain-text guidance* — "30
  minute intro calls, weekdays 9am–5pm, next 2 weeks". On save, the agent reads
  the guidance and derives concrete rules (duration, days, hours, timezone,
  horizon, notice, buffer, per-day cap), which the UI shows back to you so you
  can check the reading. Slot generation itself is deterministic, so booking
  pages never wait on a model call.
- **OK to book over.** An event type can name commitment types whose entries it
  may be booked over — "this 15-minute intro can take my focus time, but never a
  customer call". That time is offered to visitors even though the calendar shows
  it as busy. Anything else keeps blocking, including entries that haven't been
  classified yet, and an overlapping ordinary meeting still protects its part of
  the slot.
- **Commitment-aware slots.** Free/busy answers "when am I free"; it can't answer
  intent like *"never straight after a customer call"*. So after the deterministic
  candidates are generated, they are reviewed once with the surrounding calendar
  entries and their commitment types in context, and the model may **drop** slots
  (never add or move one — a bad answer costs availability, it can't double-book
  you). The preview shows what was dropped and why. The review is cached under
  the guidance, the candidate slots and the classified commitments; public
  booking pages apply a cached review but never trigger a model call themselves,
  so a shared link stays fast and can't be used to run up cost.
- **Availability preview.** "Preview slots" opens a week calendar in the event
  type's timezone showing your existing meetings (grey, with titles) alongside
  what the guidance opened up (green), so you can see the two together before
  sharing the link. All-day events get their own row; the grid widens
  automatically to include meetings outside the bookable window.
- **Multiple durations.** Guidance like "15, 30 or 60 minute calls" produces
  several offered lengths. The booking page then shows a length picker, and slot
  boundaries are recomputed per length off a shared grid, so switching doesn't
  shuffle the start times. Rescheduling keeps the length that was booked.
- **Booking links.** Every event type gets a URL containing a 16-character
  random slug (`/book/rTnmGfNGS3sL6tRP`), generated with a CSPRNG. The page is
  public — no sign-in — and shows only the event name, host display name,
  duration, and open slots. The owner's email and guidance are never exposed.
- **Booking.** A month calendar shows which days have openings (greyed out when
  they don't); picking a day lists that day's times beside it, and choosing one
  leads to a short details form — the Calendly shape. Visitors see times in their
  own timezone by default and can switch to any other, with "your current
  timezone" and the host's pinned at the top of the list. A visitor picks a slot,
  gives a name and email, and submits. The
  agent re-checks the calendar (the slot may have gone in the meantime), creates
  the event on the owner's primary calendar with the visitor as a guest, and
  Google emails the invitation to both.
- **Cancel and reschedule.** Every invite carries two links — `/reschedule/<token>`
  and `/cancel/<token>` — held by a 32-character per-booking token, so the guest
  can change the meeting without an account. Rescheduling patches the existing
  calendar event (Google re-notifies both sides); cancelling deletes it and frees
  the slot. Both pages are also linked from the booking confirmation.
- **Commitment types.** A commitment type is a plain-text condition describing a
  kind of calendar entry ("any meeting with a customer") plus a colour from a
  fixed palette. In the availability preview, Claude labels each existing entry
  with whichever condition it satisfies and the calendar colour-codes
  accordingly, with a legend; unmatched entries stay grey. Without an API key the
  labelling falls back to keyword overlap.
- **Instant paint.** The calendar renders as soon as Google returns, coloured
  from whatever is already cached. Anything still unjudged is classified in the
  background in batches of 15, with a banner above the grid reading
  *"Calculating commitment types of events — N out of K done"*; colours land as
  each batch finishes.
- **Cached verdicts.** Every colour and every per-event report is cached on disk
  under a fingerprint of the event (title, time, organizer, guests, location,
  recurrence) *and* the set of commitment conditions. An unchanged calendar
  re-colours for free — no model call at all. Editing one event re-asks about
  that event alone; editing a condition re-asks about everything, since the
  answers could all change. Pending writes are flushed on shutdown, so a restart
  doesn't throw away verdicts already paid for.
- **Calendar view and assistant.** The commitment types page shows your calendar
  for the last week and the next four, coloured by commitment type. Clicking any
  entry produces a report judging it against *every* commitment type — match or
  not, a confidence, and the evidence used. Alongside it, a chat box answers
  questions about your calendar; the server renders your entries (title, start
  and end, organizer, guests and their responses, location, commitment type) into
  the prompt, and the model sees nothing beyond that.
- **Bring-your-own Anthropic key.** An org admin can set one Anthropic API key
  on the Organizations page, and everyone with an email address on that org's
  domain uses it for every AI feature. Keys are verified against Anthropic before
  being saved, encrypted at rest, and never returned to the browser — only a
  masked hint. Users whose org has no key fall back to the server's
  `ANTHROPIC_API_KEY`.
- **LLM cost.** Every model call is metered — tokens in and out, cache reads and
  writes — and priced at Anthropic's published rates. **Settings** shows the last
  24 hours, the 90-day total, a daily bar chart, and a breakdown by feature, with
  a table view of the same data. Org admins can switch between their own spend
  and the whole organization's.
- **Calendar views.** Every calendar can show 1, 2, 3, 4 days or a full week.
  "Preview slots" opens a page of its own — *Previewing open slots* — that takes
  over everything but the header. Each day appears twice, side by side: the
  schedule as it stands, then the slots that remain bookable — Monday
  (schedule), Monday (open slots), Tuesday (schedule), Tuesday (open slots). One
  grid means one time axis and one scrollbar, so the two views of a day can
  never drift out of line.
- **"Why isn't this open?"** Click any time in an open-slots column — including
  empty space — then *Explain this slot*, and the answer appears in a popup.
  There is only one piece of logic behind both: the generator puts every
  candidate on the grid through `diagnoseSlot`, and a slot is offered exactly
  when that returns no reasons against it. The explanation reads back that same
  verdict, so the grid and the answer cannot disagree. Reasons cover the days and
  hours, the slot grid, the notice period, the horizon, named calendar conflicts,
  buffers, opaque busy blocks, the per-day cap, existing bookings, and removals
  made by the commitment-aware review; the model only phrases them.
- **Roles.** `super_admin` (from `server/super-admins.json`, plus the hardcoded
  bootstrap list in `server/index.js`) > `admin` (granted by a super admin) >
  `user`.
- **Role selection at sign-in.** An account holding `admin` or `super_admin` is
  asked which capacity to act in for the session, and can switch any time from
  the header. The choice is stored on the session and enforced by the API — a
  super admin acting as a member gets 403s from the admin endpoints, not just a
  reduced menu. A choice can only lower privilege, never raise it.

## Run locally

```bash
./run-locally.sh
```

That installs dependencies if needed, copies `.env.example` to `.env` on first
run, then starts both processes:

- Frontend → http://localhost:5178
- Backend  → http://localhost:3005

Ctrl-C stops both. To run them separately: `npm run dev` and `npm run dev:server`.

### Google OAuth setup

Sign-in needs a Google OAuth client. In the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials),
create an **OAuth 2.0 Client ID** (Web application) with **two** authorized
redirect URIs:

```
http://localhost:3005/auth/google/callback     # sign-in
http://localhost:3005/api/calendar/callback    # calendar connect
```

Enable the **Google Calendar API** for the project
(console.cloud.google.com/apis/library/calendar-json.googleapis.com), then put
the credentials in `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the AWS Lightsail setup (nginx + PM2).
After the first deploy, updates are a single `./restart.sh` on the instance.

## API

All routes require an authenticated session on an allowed domain.

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| GET | `/auth/google` | public | Start Google sign-in |
| GET | `/auth/user` | public | Current session + role |
| GET | `/auth/logout` | public | Sign out |
| POST | `/api/session/role` | user | Choose the role to act as this session |
| GET | `/api/calendar/status` | user | Whether a calendar is connected |
| GET | `/api/calendar/connect` | user | Start Google Calendar consent |
| DELETE | `/api/calendar/connect` | user | Disconnect the calendar |
| GET | `/api/event-types` | user | List your event types |
| POST | `/api/event-types` | user | Create one (interprets the guidance) |
| PUT | `/api/event-types/:id` | owner | Update; re-interprets changed guidance |
| DELETE | `/api/event-types/:id` | owner | Delete one |
| GET | `/api/event-types/:id/availability` | owner | Preview your open slots |
| POST | `/api/event-types/:id/slot-explanation` | owner | Why a given time is or isn't offered |
| GET | `/api/bookings` | user | Bookings taken on your event types |
| GET | `/api/calendar/events` | user | Your entries, coloured from cache (no model call) |
| POST | `/api/calendar/classify` | user | Start background classification of the rest |
| GET | `/api/calendar/classify/:jobId` | owner | Progress and colours so far |
| POST | `/api/calendar/ask` | user | Ask a question about your calendar |
| POST | `/api/calendar/explain` | user | Report one entry against every type |
| GET | `/api/usage` | user | LLM cost: last 24h, daily history, by feature |
| GET | `/api/commitment-types` | user | List your commitment types + palette |
| POST | `/api/commitment-types` | user | Create one |
| PUT | `/api/commitment-types/:id` | owner | Update name, condition or colour |
| DELETE | `/api/commitment-types/:id` | owner | Delete one |
| GET | `/api/book/:slug` | **public** | Booking page data + open slots |
| POST | `/api/book/:slug` | **public** | Book a slot; creates the calendar event |
| GET | `/api/booking/:token` | **public** | Booking details + alternative slots |
| POST | `/api/booking/:token/cancel` | **public** | Cancel; deletes the calendar event |
| POST | `/api/booking/:token/reschedule` | **public** | Move to a new slot |
| GET | `/api/orgs` | user | List organizations |
| POST | `/api/orgs` | user | Create an organization |
| PUT | `/api/orgs/:id` | org admin/creator/admin | Rename an organization |
| DELETE | `/api/orgs/:id` | org admin/creator/admin | Delete an organization |
| PUT | `/api/orgs/:id/anthropic-key` | org admin | Set the org's Anthropic key |
| DELETE | `/api/orgs/:id/anthropic-key` | org admin | Remove it |
| GET | `/api/users` | admin, org admin | List users (org admins see their domain only) |
| POST | `/api/users` | admin, org admin | Pre-register a user |
| DELETE | `/api/users/:email` | admin, org admin | Remove a user |
| PUT | `/api/users/:email/role` | super admin | Grant/revoke admin |
| GET | `/api/domains` | admin | List allowed domains |
| POST | `/api/domains` | super admin | Allow a domain |
| DELETE | `/api/domains/:domain` | super admin | Disallow a domain |
| GET | `/api/health` | public | Health check |

## Data files

Created under `server/` at first run and excluded from git:

- `orgs.json` — the organizations
- `users.json` — everyone who has signed in
- `event-types.json` — event types, their guidance and derived rules
- `bookings.json` — bookings taken through booking pages
- `commitment-types.json` — commitment conditions and their colours
- `classification-cache.json` — cached commitment verdicts and reports
- `llm-usage.json` — per-call token usage and cost, kept for 90 days
- `allowed-domains.json` — extra domains permitted to sign in
- `super-admins.json` — super admin emails (see `super-admins.example.json`)
