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
