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
- **Event types.** An event type is a name plus *plain-text guidance* — "30
  minute intro calls, weekdays 9am–5pm, next 2 weeks". On save, the agent reads
  the guidance and derives concrete rules (duration, days, hours, timezone,
  horizon, notice, buffer, per-day cap), which the UI shows back to you so you
  can check the reading. Slot generation itself is deterministic, so booking
  pages never wait on a model call.
- **Booking links.** Every event type gets a URL containing a 16-character
  random slug (`/book/rTnmGfNGS3sL6tRP`), generated with a CSPRNG. The page is
  public — no sign-in — and shows only the event name, host display name,
  duration, and open slots. The owner's email and guidance are never exposed.
- **Booking.** A visitor picks a slot, gives a name and email, and submits. The
  agent re-checks the calendar (the slot may have gone in the meantime), creates
  the event on the owner's primary calendar with the visitor as a guest, and
  Google emails the invitation to both.
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
| GET | `/api/bookings` | user | Bookings taken on your event types |
| GET | `/api/book/:slug` | **public** | Booking page data + open slots |
| POST | `/api/book/:slug` | **public** | Book a slot; creates the calendar event |
| GET | `/api/orgs` | user | List organizations |
| POST | `/api/orgs` | user | Create an organization |
| PUT | `/api/orgs/:id` | org admin/creator/admin | Rename an organization |
| DELETE | `/api/orgs/:id` | org admin/creator/admin | Delete an organization |
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
- `allowed-domains.json` — extra domains permitted to sign in
- `super-admins.json` — super admin emails (see `super-admins.example.json`)
