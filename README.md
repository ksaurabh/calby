# Calby

A minimal React + Express app: sign in with Google, create organizations.

- **Frontend** — React 19 + TypeScript + Tailwind 4, built with Vite.
- **Backend** — Express 5 with Passport (Google OAuth) and session cookies.
- **Storage** — JSON files in `server/` (created on first run, gitignored).

## Features

- **Google sign-in.** Only accounts on an allowed email domain can use the app.
  `airmdr.com` is always allowed; more domains are added from the Administration
  page (super admin) or by editing `server/allowed-domains.json`.
- **Organizations.** Any signed-in user can list and create organizations. The
  creator — or an admin — can rename or delete one.
- **Roles.** `super_admin` (from `server/super-admins.json`, plus the hardcoded
  bootstrap list in `server/index.js`) > `admin` (granted by a super admin) >
  `user`.

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
create an **OAuth 2.0 Client ID** (Web application) with the authorized redirect
URI `http://localhost:3005/auth/google/callback`, then put the credentials in
`.env`:

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
| GET | `/api/orgs` | user | List organizations |
| POST | `/api/orgs` | user | Create an organization |
| PUT | `/api/orgs/:id` | creator/admin | Rename an organization |
| DELETE | `/api/orgs/:id` | creator/admin | Delete an organization |
| GET | `/api/users` | admin | List users |
| PUT | `/api/users/:email/role` | super admin | Grant/revoke admin |
| GET | `/api/domains` | admin | List allowed domains |
| POST | `/api/domains` | super admin | Allow a domain |
| DELETE | `/api/domains/:domain` | super admin | Disallow a domain |
| GET | `/api/health` | public | Health check |

## Data files

Created under `server/` at first run and excluded from git:

- `orgs.json` — the organizations
- `users.json` — everyone who has signed in
- `allowed-domains.json` — extra domains permitted to sign in
- `super-admins.json` — super admin emails (see `super-admins.example.json`)
