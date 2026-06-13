# ResQGrid

**ResQGrid** is a community-powered emergency response platform for India. It
connects individuals, volunteers, NGOs, and community organizations on a
shared map so that nearby emergencies, resources, and SOS alerts can be seen
and acted on in real time.

---

## Core Idea

When something goes wrong — an accident, a fire, a flood, someone needing
blood or shelter — speed and proximity matter most. ResQGrid lets anyone
post an emergency or resource request, automatically classifies its
urgency with AI, and surfaces it to the people who are actually nearby and
able to help — whether that's an individual responder, a local NGO, or a
registered community organization.

---

## Key Features

- **Live emergency map** (Leaflet.js) showing nearby emergencies, available
  resources, and active SOS alerts, with grid-based proximity radii so
  different alert types are visible at different distances.
- **AI risk classification** — every posted alert is run through an LLM
  (via Groq) that returns a risk level (`critical / high / medium / low`),
  category (blood, fire, flood, medical, transport, food, shelter, etc.),
  and a short reason, and flags it as an SOS if the poster is in immediate
  danger.
- **SOS system** — one-tap distress signal that notifies nearby users and a
  personal list of SOS contacts, with a persistent on-screen + audio alarm
  until resolved.
- **In-app navigation** — turn-by-turn routing to an emergency or resource
  using OSRM, with a fallback straight-line route if routing is unavailable.
- **Resource sharing** — individuals and organizations can list resources
  (medical supplies, shelter, food, transport, etc.) that others can
  request via a built-in chat thread.
- **Community / NGO accounts** — organizations can manage members, approve
  join requests, assign responders to emergencies, and track contribution
  rankings ("defaulters" / leaderboard).
- **Gamified responder profiles** — users earn points, badges (New Helper →
  Helper → Guardian → Hero → Legend), and stats for emergencies helped and
  resources listed.
- **Polling-based notifications** — periodic checks for new emergencies,
  resources, and SOS events, with sound alerts.
- **Admin panel** — protected by a secret token, with stats, user
  management (suspend/unsuspend), emergency/resource oversight, reports,
  and activity logs.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask (modular Blueprints), Flask-CORS |
| Database / Auth | Supabase (Postgres + Auth + REST API), Row-Level Security |
| AI | Groq API (LLM-based risk classification) |
| Frontend | HTML, Tailwind CSS (CDN), vanilla JavaScript |
| Maps & Routing | Leaflet.js, OpenStreetMap, OSRM (routing), Nominatim (place search) |
| Fonts | Sora, JetBrains Mono, Material Symbols |

---

## Project Structure

```
resqgrid/
├── app.py                  # Flask entry point — config, blueprint registration, page routes
├── utils.py                # Shared helpers: Supabase REST wrappers, auth, geo, badge/score logic
├── routes/
│   ├── auth.py              # /api/auth — signup, login
│   ├── grid.py               # emergencies, resources, SOS, messages, leaderboard, AI classification
│   ├── community.py          # /api/communities — NGO/community management
│   └── admin.py              # /api/admin — admin panel (token-protected)
├── templates/
│   ├── index.html            # Main app shell (auth, dashboard, map, alerts, community, settings)
│   ├── community.html        # Community/NGO management page
│   └── partials/              # Modular HTML includes (screens, tabs, modals)
├── static/
│   ├── css/styles.css         # Custom design system (warm off-white + burnt orange theme)
│   ├── js/                    # Feature-split JS modules (core, auth, map, alerts, sos, admin, ...)
│   └── assets/                # Logos, icons
└── .env                       # Environment configuration (not committed)
```

---

## Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public API key |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (server-side only, full DB access) |
| `GROQ_API_KEY` | API key for Groq LLM used in risk classification |
| `GROQ_MODEL` | Groq model name (default: `llama3-8b-8192`) |
| `ADMIN_SECRET_KEY` | Secret token required in `X-Admin-Token` header for `/api/admin/*` |
| `ALLOWED_ORIGINS` | CORS allowed origins for `/api/*` routes |
| `PORT` | Port to run the Flask server on (default `5000`) |
| `FLASK_DEBUG` | `true`/`false` — enables Flask debug mode |

---

## Database (Supabase) — Key Tables

- **`users`** — profile data, `user_type` (`individual` / `ngo`), score, badge,
  `emergencies_helped`, `resources_listed`, suspension status.
- **`emergencies`** — posted alerts (location, category, risk level, status).
- **`responders`** — links users to emergencies they're responding to.
- **`resources`** — listed resources (medical, food, shelter, transport, etc.).
- **`resource_threads`** / messages — chat between resource owners and requesters.
- **`sos_events`** — active/cancelled SOS signals.
- **`sos_contacts`** — a user's personal emergency contacts.
- **`communities`** / **`community_memberships`** — NGO/org accounts and their members.
- **`reports`**, **`activity_log`** — moderation and audit data for the admin panel.

All server-side writes use the Supabase **service key** via `utils.py`'s
`sb_get` / `sb_post` / `sb_patch` / `sb_delete` helpers. Row-Level Security
policies protect direct client access via the anon key.

---

## Running Locally

1. Create a `.env` file in the project root with the variables above.
2. Install dependencies:
   ```bash
   pip install flask flask-cors python-dotenv requests
   ```
3. Run the app:
   ```bash
   python app.py
   ```
4. Open `http://localhost:5000` for the main app, and
   `http://localhost:5000/community.html` for the community/NGO panel.

---

## API Overview

| Prefix | Blueprint | Purpose |
|---|---|---|
| `/api/auth` | `auth.py` | Signup, login (proxies Supabase Auth + creates profile row) |
| `/api/emergencies`, `/api/resources`, `/api/sos*`, `/api/leaderboard`, `/api/classify-alert`, `/api/users/*` | `grid.py` | Core emergency/resource/SOS lifecycle, AI classification, user stats |
| `/api/communities/*` | `community.py` | NGO membership, alert assignment, resource assignment, rankings |
| `/api/admin/*` | `admin.py` | Admin stats, user moderation, reports, activity, SOS oversight (requires `X-Admin-Token`) |
| `/api/health` | `app.py` | Health check |

---

## Frontend Architecture

`index.html` is a single-page app split into "screens" (`auth`, `app`,
`admin`) and, within the main app screen, five tab panels (`home`, `map`,
`alerts`, `community`, `settings`) toggled via `switchTab()`. The page is
built from small Jinja `{% include %}` partials and modular JS files so each
file stays focused and easy to navigate — see `static/js/` for the
feature-by-feature breakdown (auth, map, alerts, community, SOS, admin,
notifications, etc.).

---

## Status

ResQGrid is an actively developed student/personal project (CPL2026
submission) — features and schema may continue to evolve.
