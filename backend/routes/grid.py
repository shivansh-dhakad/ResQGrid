"""
routes/grid.py — Core grid routes: emergencies, resources, SOS, messages,
                  SOS contacts, leaderboard, user stats & profile.

These are the real-time, location-aware features that power the ResQGrid map.
"""

import logging
import json
import requests
from datetime import datetime, timezone
from flask import Blueprint, request, g

from utils import (
    error, success, require_json, require_auth,
    sb_get, sb_post, sb_patch, sb_patch_filters, sb_delete,
    _within_radius, _geohash, _bump_user_stats,
    _append_emergency_responder_counts, _badge_for_score,
    require_inserted_row,
)

log = logging.getLogger(__name__)
grid_bp = Blueprint("grid", __name__)

# Proximity radii (km) — kept here so they travel with the routes that use them
RISK_RADIUS_KM = {"critical": 5, "high": 3, "medium": 2, "low": 2}
DEFAULT_RISK_RADIUS_KM = 2

# Points awarded to each responder when the emergency they helped with is resolved.
# Separate from the small "I clicked respond" bonus — this is the real reward.
RISK_RESOLVE_POINTS = {"critical": 200, "high": 100, "medium": 50, "low": 20}
SOS_RADIUS_KM = 7
RESOURCE_RADIUS_KM = 10

# Filled in by app.py via init_grid_config()
_GROQ_API_KEY = ""
_GROQ_MODEL = "llama3-8b-8192"
_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
_RISK_SYSTEM_PROMPT = ""
_ADMIN_SECRET = ""


def init_grid_config(groq_key, groq_model, risk_prompt, admin_secret):
    global _GROQ_API_KEY, _GROQ_MODEL, _RISK_SYSTEM_PROMPT, _ADMIN_SECRET
    _GROQ_API_KEY = groq_key
    _GROQ_MODEL = groq_model
    _RISK_SYSTEM_PROMPT = risk_prompt
    _ADMIN_SECRET = admin_secret


def _radius_for_risk(risk_level):
    return RISK_RADIUS_KM.get((risk_level or "").lower(), DEFAULT_RISK_RADIUS_KM)


# ══════════════════════════════════════════════════════════════════════════════
#  AI — risk classification
# ══════════════════════════════════════════════════════════════════════════════

def _rule_classify(text):
    """Keyword-based fallback classifier used when Groq is unavailable."""
    text = text.lower()
    critical_kw = [
        "heart attack", "cardiac", "unconscious", "not breathing", "fire",
        "drowning", "bleeding heavily", "collapsed", "stabbed", "shot",
        "accident", "critical", "dying", "dead", "flood", "trapped",
    ]
    high_kw = [
        "blood needed", "surgery", "injured", "broken", "fracture",
        "missing child", "ambulance", "hospital", "urgent", "emergency",
        "help needed",
    ]
    medium_kw = ["food", "shelter", "medicine", "insulin", "stranded", "no transport", "stuck"]

    if any(k in text for k in critical_kw):
        return {"risk_level": "critical", "category": "medical",
                "reason": "Keywords indicate life-threatening situation.", "is_sos": False}
    if any(k in text for k in high_kw):
        return {"risk_level": "high", "category": "medical",
                "reason": "Serious emergency requiring prompt response.", "is_sos": False}
    if any(k in text for k in medium_kw):
        return {"risk_level": "medium", "category": "other",
                "reason": "Moderate urgency — assistance needed.", "is_sos": False}
    return {"risk_level": "low", "category": "other",
            "reason": "General request — not immediately critical.", "is_sos": False}


def _groq_classify(description):
    """Attempt Groq AI classification; fall back to rule-based on any error."""
    if not _GROQ_API_KEY:
        return _rule_classify(description)
    try:
        resp = requests.post(
            _GROQ_API_URL,
            headers={"Authorization": f"Bearer {_GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": _GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": _RISK_SYSTEM_PROMPT},
                    {"role": "user", "content": description},
                ],
                "temperature": 0.1,
                "max_tokens": 150,
            },
            timeout=10,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        result = json.loads(raw)
        result.setdefault("risk_level", "medium")
        result.setdefault("category", "other")
        result.setdefault("reason", "AI assessment complete.")
        result.setdefault("is_sos", False)
        return result
    except requests.exceptions.Timeout:
        return _rule_classify(description)
    except Exception as e:
        log.error(f"Groq classify error: {e}")
        return _rule_classify(description)


@grid_bp.route("/api/classify-alert", methods=["POST"])
@require_auth
@require_json
def classify_alert():
    body = request.get_json()
    description = (body.get("description") or "").strip()
    if len(description) < 5:
        return error("Description too short")
    return success(_groq_classify(description))


# ══════════════════════════════════════════════════════════════════════════════
#  EMERGENCIES
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/emergencies", methods=["GET"])
@require_auth
def get_emergencies():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    status = request.args.get("status", "active")
    requesting_user_id = g.user_id
    try:
        params = f"select=*,user:users!emergencies_user_id_fkey(id,full_name,display_name,score,badge,user_type,is_verified)&status=eq.{status}&order=created_at.desc&limit=50"
        data = sb_get("emergencies", params, service=True)
        if lat is not None and lng is not None:
            data = [
                e for e in data
                if _within_radius(lat, lng, e.get("lat"), e.get("lng"),
                                  _radius_for_risk(e.get("risk_level")))
            ]
        data = _append_emergency_responder_counts(data)

        # ── Visibility filter ────────────────────────────────────────────────
        # Once someone claims an emergency, it disappears from everyone else's
        # feed so only one person responds at a time. It reappears if they drop.
        visible = []
        for e in data:
            is_poster    = requesting_user_id and e.get("user_id") == requesting_user_id
            is_responder = requesting_user_id and requesting_user_id in (
                e.get("responder_user_ids") or []
            )
            is_claimed   = (e.get("responder_count") or 0) > 0

            # Show the alert only if it is unclaimed, or if this user is
            # directly involved (poster or active responder).
            if is_claimed and not is_poster and not is_responder:
                continue

            # Mask exact coordinates for non-involved viewers
            if not is_poster and not is_responder:
                e["lat"] = None
                e["lng"] = None

            visible.append(e)

        return success(visible)
    except Exception as e:
        log.error(f"Get emergencies: {e}")
        return error("Could not fetch emergencies", 503)


@grid_bp.route("/api/emergencies", methods=["POST"])
@require_auth
@require_json
def post_emergency():
    body = request.get_json()
    for f in ["title", "description", "category"]:
        if not body.get(f):
            return error(f"Field '{f}' is required")

    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return error("Location coordinates (lat, lng) are required")
    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return error("Invalid coordinates format")

    user_id = g.user_id

    # One active alert per user at a time
    if user_id:
        try:
            existing = sb_get(
                "emergencies",
                f"user_id=eq.{user_id}&status=eq.active&select=id&limit=1",
                service=True,
            )
            if existing:
                return error(
                    "You already have an active alert. Resolve it before posting a new one.",
                    409,
                )
        except Exception as e:
            log.warning(f"Could not check existing alerts for {user_id}: {e}")

    classification = _groq_classify(body["description"])
    payload = {
        "user_id":      user_id,
        "title":        body["title"],
        "description":  body["description"],
        "category":     body["category"],
        "risk_level":   classification.get("risk_level", "medium"),
        "risk_reason":  classification.get("reason", ""),
        "lat":          lat,
        "lng":          lng,
        "geohash":      _geohash(lat, lng),
        "is_anonymous": body.get("is_anonymous", False),
        "blood_group":  body.get("blood_group"),
        "status":       "active",
    }
    try:
        result = sb_post("emergencies", payload, service=True)
        return success(require_inserted_row(result, "emergency"), 201)
    except Exception as e:
        log.error(f"Post emergency: {e}")
        return error("Could not post emergency", 503)


@grid_bp.route("/api/emergencies/<eid>/respond", methods=["POST"])
@require_auth
@require_json
def respond_to_emergency(eid):
    body = request.get_json()
    user_id = g.user_id

    # Cannot respond to your own alert
    try:
        erows = sb_get("emergencies", f"id=eq.{eid}&select=user_id,status&limit=1", service=True)
        if not erows:
            return error("Emergency not found", 404)
        em = erows[0]
        if em.get("user_id") == user_id:
            return error("You cannot respond to your own alert", 403)
        if em.get("status") == "resolved":
            return error("This alert has already been resolved", 409)
    except Exception:
        pass

    # NGO accounts cannot respond directly
    try:
        urows = sb_get("users", f"id=eq.{user_id}&select=user_type&limit=1", service=True)
        if urows and urows[0].get("user_type") == "ngo":
            return error("Community accounts cannot directly respond to alerts", 403)
    except Exception:
        pass

    # ── One responder per alert ───────────────────────────────────────────────
    # Block new responders if anyone is already responding OR assigned.
    try:
        all_responders = sb_get(
            "responders",
            f"emergency_id=eq.{eid}&status=in.(responding,assigned)&select=user_id,status&limit=2",
            service=True,
        )
        already_mine = any(r.get("user_id") == user_id for r in (all_responders or []))
        if already_mine:
            return success({"message": "Already responding", "responder": all_responders[0]})
        if all_responders:
            return error(
                "Someone is already responding to this alert. "
                "Only one responder is allowed per request.",
                409,
            )
    except Exception as e:
        log.warning(f"Could not check existing responders for {eid}: {e}")

    # ── One active response per user ─────────────────────────────────────────
    # A user can only respond to one alert at a time.
    try:
        active_responses = sb_get(
            "responders",
            f"user_id=eq.{user_id}&status=eq.responding"
            "&select=emergency_id&limit=1",
            service=True,
        )
        if active_responses:
            return error(
                "You are already responding to another alert. "
                "Please complete or withdraw from that one first.",
                409,
            )
    except Exception as e:
        log.warning(f"Could not check active responses for user {user_id}: {e}")

    payload = {
        "emergency_id": eid,
        "user_id": user_id,
        "lat": body.get("lat"),
        "lng": body.get("lng"),
        "status": "responding",
    }
    try:
        result = sb_post("responders", payload, service=True)
        inserted_responder = require_inserted_row(result, "responder")

        # Concurrency Post-Insert Check
        try:
            current_responders = sb_get(
                "responders",
                f"emergency_id=eq.{eid}&status=eq.responding&order=created_at.asc",
                service=True,
            )
            if current_responders and current_responders[0].get("user_id") != user_id:
                # We were not first! Delete our responder row to roll back
                sb_delete("responders", f"id=eq.{inserted_responder['id']}", service=True)
                return error(
                    "Someone else responded to this alert just before you. "
                    "Only one responder is allowed per request.",
                    409,
                )
        except Exception as e:
            log.error(f"Race condition check failed: {e}")

        # Small "I'm on my way" bonus — scales with risk level.
        # The bigger reward comes when the emergency is actually resolved.
        RISK_RESPOND_BONUS = {"critical": 40, "high": 25, "medium": 15, "low": 10}
        try:
            erow = sb_get("emergencies", f"id=eq.{eid}&select=risk_level&limit=1", service=True)
            risk = (erow[0].get("risk_level") or "medium").lower() if erow else "medium"
        except Exception:
            risk = "medium"
        respond_bonus = RISK_RESPOND_BONUS.get(risk, 25)
        _bump_user_stats(user_id, score_delta=respond_bonus, helped_delta=1)

        # Award community points if the user is an approved NGO member
        community_id = body.get("community_id")
        if not community_id:
            try:
                memberships = sb_get(
                    "ngo_memberships",
                    f"user_id=eq.{user_id}&status=eq.approved&select=ngo_id&limit=1",
                    service=True,
                )
                if memberships:
                    community_id = memberships[0].get("ngo_id")
            except Exception as e:
                log.warning(f"Could not look up community membership for {user_id}: {e}")

        community_name = None
        if community_id:
            try:
                ngo_rows = sb_get("users", f"id=eq.{community_id}&select=score,org_name,display_name&limit=1", service=True)
                if ngo_rows:
                    community_name = ngo_rows[0].get("org_name") or ngo_rows[0].get("display_name")
                    new_score = int(ngo_rows[0].get("score") or 0) + 10
                    sb_patch("users", "id", community_id, {"score": new_score}, service=True)
            except Exception:
                pass

        resp = {"message": "Response registered", "responder": inserted_responder}
        if community_name:
            resp["community_name"] = community_name
        return success(resp, 201)
    except Exception as e:
        log.error(f"Respond error: {e}")
        return error("Could not register response", 503)


@grid_bp.route("/api/emergencies/<eid>/resolve", methods=["POST"])
@require_auth
@require_json
def resolve_emergency(eid):
    """Only the original poster may mark their alert as resolved.

    On resolution, every active responder (status='responding') is awarded
    points based on the emergency's risk level:
        critical → 200 pts   high → 100 pts
        medium   →  50 pts   low  →  20 pts

    Community (NGO) accounts of those responders each get a 20-pt bonus too.
    """
    body = request.get_json()
    user_id = g.user_id
    try:
        rows = sb_get("emergencies", f"id=eq.{eid}&select=user_id,status,risk_level&limit=1", service=True)
        if not rows:
            return error("Emergency not found", 404)
        em = rows[0]
        if em.get("user_id") != user_id:
            return error("Only the poster can resolve this alert", 403)
        if em.get("status") == "resolved":
            return success({"message": "Already resolved"})

        sb_patch("emergencies", "id", eid, {"status": "resolved"}, service=True)

        # ── Award points to every active responder ────────────────────────────
        risk_level = (em.get("risk_level") or "medium").lower()
        resolve_pts = RISK_RESOLVE_POINTS.get(risk_level, 50)
        rewarded_count = 0
        try:
            responders = sb_get(
                "responders",
                f"emergency_id=eq.{eid}&status=eq.responding&select=user_id",
                service=True,
            )
            for row in (responders or []):
                rid = row.get("user_id")
                if not rid or rid == user_id:   # skip the poster if somehow listed
                    continue
                _bump_user_stats(rid, score_delta=resolve_pts)
                rewarded_count += 1

                # Bonus points to the responder's NGO community
                try:
                    memberships = sb_get(
                        "ngo_memberships",
                        f"user_id=eq.{rid}&status=eq.approved&select=ngo_id&limit=1",
                        service=True,
                    )
                    if memberships:
                        ngo_id = memberships[0].get("ngo_id")
                        ngo_rows = sb_get("users", f"id=eq.{ngo_id}&select=score&limit=1", service=True)
                        if ngo_rows:
                            new_score = int(ngo_rows[0].get("score") or 0) + 20
                            sb_patch("users", "id", ngo_id, {"score": new_score}, service=True)
                except Exception as ce:
                    log.warning(f"Could not award community points for responder {rid}: {ce}")
        except Exception as re:
            log.warning(f"Could not award resolve points for emergency {eid}: {re}")

        return success({
            "message": "Alert resolved. It has been removed from the public feed.",
            "responders_rewarded": rewarded_count,
            "points_awarded": resolve_pts,
            "risk_level": risk_level,
        })
    except Exception as e:
        log.error(f"Resolve emergency {eid}: {e}")
        return error("Could not resolve emergency", 503)


@grid_bp.route("/api/emergencies/<eid>/withdraw", methods=["POST"])
@require_auth
@require_json
def withdraw_from_emergency(eid):
    """Lets a responder withdraw from an alert, freeing it for someone else.

    Penalty policy:
      - Reverses the original 'on my way' respond bonus.
      - Applies an additional 50-point abandonment penalty for dropping mid-response.
      - Score is floored at 0 by _bump_user_stats (no negative totals).
    """
    body = request.get_json()
    user_id = g.user_id
    try:
        # Verify that the user is actually responding to this emergency
        existing = sb_get(
            "responders",
            f"emergency_id=eq.{eid}&user_id=eq.{user_id}&select=id,status&limit=1",
            service=True,
        )
        if not existing:
            return error("You are not responding to this emergency", 400)

        sb_delete(
            "responders",
            f"emergency_id=eq.{eid}&user_id=eq.{user_id}",
            service=True,
        )

        # Determine original respond bonus for this risk level
        try:
            erow = sb_get("emergencies", f"id=eq.{eid}&select=risk_level&limit=1", service=True)
            risk = (erow[0].get("risk_level") or "medium").lower() if erow else "medium"
        except Exception:
            risk = "medium"

        RISK_RESPOND_BONUS = {"critical": 40, "high": 25, "medium": 15, "low": 10}
        respond_bonus   = RISK_RESPOND_BONUS.get(risk, 25)
        # Total penalty = undo original bonus + 50-point abandonment penalty
        ABANDONMENT_PENALTY = 50
        total_penalty = -(respond_bonus + ABANDONMENT_PENALTY)

        _bump_user_stats(user_id, score_delta=total_penalty, helped_delta=-1)
        return success({
            "message": (
                f"You have withdrawn from this alert. "
                f"-{respond_bonus + ABANDONMENT_PENALTY} points applied "
                f"({respond_bonus} bonus reversed + {ABANDONMENT_PENALTY} abandonment penalty)."
            ),
            "penalty": respond_bonus + ABANDONMENT_PENALTY,
        })
    except Exception as e:
        log.error(f"Withdraw from emergency {eid}: {e}")
        return error("Could not withdraw from alert", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  MESSAGES (emergency chat)
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/emergencies/<eid>/messages", methods=["GET"])
@require_auth
def get_messages(eid):
    try:
        # Verify user is authorized to view this chat (must be poster or responder or NGO coordinating the response)
        erows = sb_get("emergencies", f"id=eq.{eid}&select=user_id", service=True)
        if not erows:
            return error("Emergency not found", 404)
        em = erows[0]
        
        allowed = (em.get("user_id") == g.user_id)
        if not allowed:
            responders = sb_get("responders", f"emergency_id=eq.{eid}&user_id=eq.{g.user_id}", service=True)
            allowed = bool(responders)
        if not allowed:
            # Check if current user is an NGO and has an approved member responding to this emergency
            try:
                member_responders = sb_get("responders", f"emergency_id=eq.{eid}&select=user_id", service=True)
                if member_responders:
                    responder_ids = ",".join(r["user_id"] for r in member_responders if r.get("user_id"))
                    if responder_ids:
                        memberships = sb_get(
                            "ngo_memberships",
                            f"ngo_id=eq.{g.user_id}&user_id=in.({responder_ids})&status=eq.approved&limit=1",
                            service=True,
                        )
                        allowed = bool(memberships)
            except Exception as ngo_err:
                log.warning(f"Could not check NGO responder authorization for chat read: {ngo_err}")
            
        if not allowed:
            return error("You are not authorized to view this emergency chat", 403)

        data = sb_get("messages", f"emergency_id=eq.{eid}&order=created_at.asc&limit=100", service=True)
        return success(data)
    except Exception as e:
        log.error(f"Get messages: {e}")
        return error("Could not fetch messages", 503)


@grid_bp.route("/api/emergencies/<eid>/messages", methods=["POST"])
@require_auth
@require_json
def post_message(eid):
    body = request.get_json()
    content = (body.get("content") or "").strip()
    if not content:
        return error("Message content required")
        
    try:
        # Verify user is authorized to post (must be poster or responder or NGO coordinating the response)
        erows = sb_get("emergencies", f"id=eq.{eid}&select=user_id", service=True)
        if not erows:
            return error("Emergency not found", 404)
        em = erows[0]
        
        allowed = (em.get("user_id") == g.user_id)
        if not allowed:
            responders = sb_get("responders", f"emergency_id=eq.{eid}&user_id=eq.{g.user_id}", service=True)
            allowed = bool(responders)
        if not allowed:
            # Check if current user is an NGO and has an approved member responding to this emergency
            try:
                member_responders = sb_get("responders", f"emergency_id=eq.{eid}&select=user_id", service=True)
                if member_responders:
                    responder_ids = ",".join(r["user_id"] for r in member_responders if r.get("user_id"))
                    if responder_ids:
                        memberships = sb_get(
                            "ngo_memberships",
                            f"ngo_id=eq.{g.user_id}&user_id=in.({responder_ids})&status=eq.approved&limit=1",
                            service=True,
                        )
                        allowed = bool(memberships)
            except Exception as ngo_err:
                log.warning(f"Could not check NGO responder authorization for chat write: {ngo_err}")
            
        if not allowed:
            return error("You are not authorized to chat in this emergency", 403)
    except Exception as e:
        return error("Authorization check failed", 500)

    payload = {
        "emergency_id": eid,
        "content": content,
        "display_name": body.get("display_name", "User"),
        "user_id": g.user_id,
    }
    try:
        result = sb_post("messages", payload, service=True)
        return success(require_inserted_row(result, "message"), 201)
    except Exception as e:
        log.error(f"Post message: {e}")
        return error("Could not send message", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  RESOURCES
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/resources", methods=["GET"])
@require_auth
def get_resources():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius_km = request.args.get("radius", RESOURCE_RADIUS_KM, type=float)
    rtype = request.args.get("type")
    mine = request.args.get("mine", "").lower() == "true"
    user_id = g.user_id if mine else request.args.get("user_id")
    try:
        params = "select=*,user:users(id,full_name,display_name,score,badge,user_type,is_verified)&is_available=eq.true&order=created_at.desc&limit=50"
        if rtype:
            params += f"&type=eq.{rtype}"
        if mine:
            params += f"&user_id=eq.{user_id}"
        data = sb_get("resources", params, service=True)
        if lat is not None and lng is not None:
            data = [r for r in data if _within_radius(lat, lng, r.get("lat"), r.get("lng"), radius_km)]
        return success(data)
    except Exception as e:
        log.error(f"Get resources: {e}")
        return error("Could not fetch resources", 503)


@grid_bp.route("/api/resources", methods=["POST"])
@require_auth
@require_json
def post_resource():
    body = request.get_json()
    for f in ["type", "title"]:
        if not body.get(f):
            return error(f"Field '{f}' is required")
            
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return error("Location coordinates (lat, lng) are required")
    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return error("Invalid coordinates format")

    user_id = g.user_id
    payload = {
        "user_id":          user_id,
        "type":             body["type"],
        "title":            body["title"],
        "description":      body.get("description", ""),
        "quantity":         body.get("quantity"),
        "blood_group":      body.get("blood_group"),
        "available_until":  body.get("available_until"),
        "lat":              lat,
        "lng":              lng,
        "geohash":          _geohash(lat, lng),
        "is_available":     True,
    }
    try:
        result = sb_post("resources", payload, service=True)
        _bump_user_stats(user_id, score_delta=10, resources_delta=1)
        return success(require_inserted_row(result, "resource"), 201)
    except Exception as e:
        log.error(f"Post resource: {e}")
        return error("Could not list resource", 503)


@grid_bp.route("/api/resources/<rid>", methods=["PATCH"])
@require_auth
@require_json
def update_resource(rid):
    body = request.get_json()
    user_id = g.user_id
    allowed = ["type", "title", "description", "quantity", "blood_group", "available_until", "is_available"]
    payload = {k: body.get(k) for k in allowed if k in body}
    if "title" in payload and not str(payload["title"]).strip():
        return error("Title is required", 400)
    if not payload:
        return error("No resource fields to update", 400)
    try:
        existing = sb_get("resources", f"id=eq.{rid}&user_id=eq.{user_id}&select=id&limit=1", service=True)
        if not existing:
            return error("Resource not found or not owned by user", 404)
        result = sb_patch("resources", "id", rid, payload, service=True)
        return success(require_inserted_row(result, "resource"))
    except Exception as e:
        log.error(f"Update resource: {e}")
        return error("Could not update resource", 503)


@grid_bp.route("/api/resources/<rid>", methods=["DELETE"])
@require_auth
def delete_resource(rid):
    user_id = g.user_id
    try:
        existing = sb_get(
            "resources",
            f"id=eq.{rid}&user_id=eq.{user_id}&is_available=eq.true&select=id&limit=1",
            service=True,
        )
        if not existing:
            return error("Resource not found or not owned by user", 404)
        sb_patch("resources", "id", rid, {"is_available": False}, service=True)
        _bump_user_stats(user_id, score_delta=0, resources_delta=-1)
        return success({"message": "Resource removed"})
    except Exception as e:
        log.error(f"Delete resource: {e}")
        return error("Could not delete resource", 503)


# ── Resource threads (private resource conversations) ─────────────────────────

def _get_resource_thread(thread_id, user_id=None):
    params = (
        "select=*,resource:resources(id,title,type,user_id,is_available),"
        "owner:users!resource_threads_owner_id_fkey(id,full_name,display_name,phone,is_verified),"
        "requester:users!resource_threads_requester_id_fkey(id,full_name,display_name,phone,is_verified)"
        f"&id=eq.{thread_id}&limit=1"
    )
    if user_id:
        params += f"&or=(owner_id.eq.{user_id},requester_id.eq.{user_id})"
    rows = sb_get("resource_threads", params, service=True)
    return rows[0] if rows else None


@grid_bp.route("/api/resource-threads", methods=["GET"])
@require_auth
def get_resource_threads():
    user_id = g.user_id
    try:
        threads = sb_get(
            "resource_threads",
            "select=*,resource:resources(id,title,type,user_id,is_available),"
            "owner:users!resource_threads_owner_id_fkey(id,full_name,display_name,phone,is_verified),"
            "requester:users!resource_threads_requester_id_fkey(id,full_name,display_name,phone,is_verified)"
            f"&or=(owner_id.eq.{user_id},requester_id.eq.{user_id})&order=updated_at.desc&limit=100",
            service=True,
        )
        if not threads:
            return success([])
        thread_ids = ",".join(t["id"] for t in threads if t.get("id"))
        messages = (
            sb_get(
                "resource_messages",
                f"select=id,thread_id,user_id,content,display_name,created_at,read_at"
                f"&thread_id=in.({thread_ids})&order=created_at.desc",
                service=True,
            )
            if thread_ids
            else []
        )
        by_thread, unread = {}, {}
        for msg in messages:
            tid = msg.get("thread_id")
            by_thread.setdefault(tid, msg)
            if msg.get("user_id") != user_id and not msg.get("read_at"):
                unread[tid] = unread.get(tid, 0) + 1
        for thread in threads:
            tid = thread.get("id")
            thread["last_message"] = by_thread.get(tid)
            thread["unread_count"] = unread.get(tid, 0)
        return success(threads)
    except Exception as e:
        log.error(f"Get resource threads: {e}")
        return error("Could not fetch resource conversations", 503)


@grid_bp.route("/api/resources/<rid>/threads", methods=["POST"])
@require_auth
@require_json
def get_or_create_resource_thread(rid):
    body = request.get_json()
    requester_id = g.user_id
    try:
        resources = sb_get("resources", f"id=eq.{rid}&is_available=eq.true&select=id,user_id,title&limit=1", service=True)
        if not resources:
            return error("Resource not found", 404)
        owner_id = resources[0].get("user_id")
        if not owner_id:
            return error("Resource owner unavailable", 400)
        if owner_id == requester_id:
            return error("Open a requester conversation from notifications or My Resources", 400)
        existing = sb_get(
            "resource_threads",
            f"resource_id=eq.{rid}&owner_id=eq.{owner_id}&requester_id=eq.{requester_id}&select=id&limit=1",
            service=True,
        )
        if existing:
            return success(_get_resource_thread(existing[0]["id"], requester_id))
        result = sb_post(
            "resource_threads",
            {"resource_id": rid, "owner_id": owner_id, "requester_id": requester_id},
            service=True,
        )
        return success(_get_resource_thread(require_inserted_row(result, "resource thread")["id"], requester_id), 201)
    except Exception as e:
        log.error(f"Create resource thread: {e}")
        return error("Could not open resource conversation", 503)


@grid_bp.route("/api/resource-threads/<thread_id>/messages", methods=["GET"])
@require_auth
def get_resource_messages(thread_id):
    user_id = g.user_id
    try:
        thread = _get_resource_thread(thread_id, user_id)
        if not thread:
            return error("Conversation not found", 404)
        messages = sb_get(
            "resource_messages",
            f"thread_id=eq.{thread_id}&order=created_at.asc&limit=100",
            service=True,
        )
        sb_patch_filters(
            "resource_messages",
            f"thread_id=eq.{thread_id}&user_id=neq.{user_id}&read_at=is.null",
            {"read_at": datetime.now(timezone.utc).isoformat()},
            service=True,
        )
        return success(messages)
    except Exception as e:
        log.error(f"Get resource messages: {e}")
        return error("Could not fetch resource messages", 503)


@grid_bp.route("/api/resource-threads/<thread_id>/messages", methods=["POST"])
@require_auth
@require_json
def post_resource_message(thread_id):
    body = request.get_json()
    user_id = g.user_id
    content = (body.get("content") or "").strip()
    if not content:
        return error("Message content required", 400)
    try:
        thread = _get_resource_thread(thread_id, user_id)
        if not thread:
            return error("Conversation not found", 404)
        payload = {
            "thread_id":    thread_id,
            "user_id":      user_id,
            "content":      content,
            "display_name": body.get("display_name", "User"),
        }
        result = sb_post("resource_messages", payload, service=True)
        sb_patch(
            "resource_threads", "id", thread_id,
            {"updated_at": datetime.now(timezone.utc).isoformat()},
            service=True,
        )
        return success(require_inserted_row(result, "resource message"), 201)
    except Exception as e:
        log.error(f"Post resource message: {e}")
        return error("Could not send resource message", 503)


# ── SOS ───────────────────────────────────────────────────────────────────────

@grid_bp.route("/api/sos", methods=["POST"])
@require_auth
@require_json
def trigger_sos():
    body = request.get_json()
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return error("Location required for SOS")
    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return error("Invalid coordinates format")

    payload = {
        "user_id": g.user_id,
        "lat": lat,
        "lng": lng,
        "is_active": True,
        "cancelled_within_60s": False,
    }
    try:
        result = sb_post("sos_events", payload, service=True)
        log.warning(f"SOS triggered at {lat},{lng}")
        return success(
            {"message": "SOS broadcast sent", "sos_id": result[0].get("id") if result else None},
            201,
        )
    except Exception as e:
        log.error(f"SOS error: {e}")
        return error("SOS service error", 503)


@grid_bp.route("/api/sos/<sos_id>/cancel", methods=["POST"])
@require_auth
def cancel_sos(sos_id):
    try:
        sos_rows = sb_get("sos_events", f"id=eq.{sos_id}&select=user_id,created_at", service=True)
        if not sos_rows:
            return error("SOS event not found", 404)
        event = sos_rows[0]
        if event.get("user_id") != g.user_id:
            return error("You can only cancel your own SOS", 403)

        # Calculate time elapsed
        created_at = datetime.fromisoformat(event.get("created_at").replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        cancelled_within_60s = (now - created_at).total_seconds() <= 60.0

        sb_patch("sos_events", "id", sos_id, {"is_active": False, "cancelled_within_60s": cancelled_within_60s}, service=True)
        return success({"message": "SOS cancelled"})
    except Exception as e:
        log.error(f"Cancel SOS: {e}")
        return error("Could not cancel SOS", 503)


@grid_bp.route("/api/sos/active", methods=["GET"])
@require_auth
def get_active_sos():
    """Active SOS events. Flags events from known contacts regardless of distance."""
    from datetime import timedelta
    user_id = g.user_id
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    try:
        cutoff = (
            (datetime.now(timezone.utc) - timedelta(minutes=30))
            .strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
        )
        data = sb_get(
            "sos_events",
            f"select=id,lat,lng,user_id,created_at&is_active=eq.true"
            f"&created_at=gte.{cutoff}&order=created_at.desc&limit=100",
            service=True,
        )
        contact_ids = set()
        if user_id and data:
            try:
                contacts = sb_get(
                    "sos_contacts",
                    f"contact_user_id=eq.{user_id}&select=user_id",
                    service=True,
                )
                contact_ids = {c.get("user_id") for c in contacts if c.get("user_id")}
                if contact_ids:
                    ids_param = ",".join(contact_ids)
                    users = sb_get("users", f"id=in.({ids_param})&select=id,full_name,display_name", service=True)
                    name_by_id = {
                        u["id"]: (u.get("display_name") or u.get("full_name") or "Your emergency contact")
                        for u in users
                    }
                    for s in data:
                          if s.get("user_id") in contact_ids:
                              s["is_contact_alert"] = True
                              s["contact_name"] = name_by_id.get(s.get("user_id"), "Your emergency contact")
            except Exception as e:
                log.warning(f"Could not check SOS contacts for {user_id}: {e}")

        # Filter SOS events: must be within 7km OR from a contact
        filtered_data = []
        for s in data:
            is_contact = s.get("user_id") in contact_ids
            is_close = lat is not None and lng is not None and _within_radius(lat, lng, s.get("lat"), s.get("lng"), SOS_RADIUS_KM)
            if is_contact or is_close:
                filtered_data.append(s)

        return success(filtered_data[:20])
    except Exception as e:
        log.error(f"Get active SOS: {e}")
        return error("Could not fetch SOS events", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  SOS CONTACTS
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/sos-contacts", methods=["GET"])
@require_auth
def get_sos_contacts():
    user_id = g.user_id
    try:
        data = sb_get(
            "sos_contacts",
            f"user_id=eq.{user_id}&select=id,contact_user_id,created_at,"
            "contact:users!sos_contacts_contact_user_id_fkey(id,full_name,display_name,phone,is_verified)",
            service=True,
        )
        return success(data)
    except Exception as e:
        log.error(f"Get SOS contacts: {e}")
        return error("Could not fetch SOS contacts", 503)


@grid_bp.route("/api/sos-contacts", methods=["POST"])
@require_auth
@require_json
def add_sos_contact():
    body = request.get_json()
    user_id = g.user_id
    contact_user_id = body.get("contact_user_id")
    if not contact_user_id:
        return error("contact_user_id required", 400)
    if user_id == contact_user_id:
        return error("Cannot add yourself as a contact", 400)
    try:
        result = sb_post("sos_contacts", {"user_id": user_id, "contact_user_id": contact_user_id}, service=True)
        return success(require_inserted_row(result, "SOS contact"), 201)
    except Exception as e:
        msg = str(e)
        if "duplicate" in msg.lower() or "unique" in msg.lower():
            return error("This user is already in your SOS contacts", 409)
        log.error(f"Add SOS contact: {e}")
        return error("Could not add SOS contact", 503)


@grid_bp.route("/api/sos-contacts/<contact_id>", methods=["DELETE"])
@require_auth
def remove_sos_contact(contact_id):
    import requests as req_lib
    from utils import supabase_headers, SUPABASE_URL
    user_id = g.user_id
    try:
        url = f"{SUPABASE_URL}/rest/v1/sos_contacts?id=eq.{contact_id}&user_id=eq.{user_id}"
        r = req_lib.delete(url, headers=supabase_headers(service=True), timeout=8)
        r.raise_for_status()
        return success({"message": "Contact removed"})
    except Exception as e:
        log.error(f"Remove SOS contact: {e}")
        return error("Could not remove SOS contact", 503)


@grid_bp.route("/api/users/search", methods=["GET"])
@require_auth
def search_users():
    q = (request.args.get("q") or "").strip()
    if len(q) < 3:
        return error("Query must be at least 3 characters", 400)
    try:
        params = (
            f"select=id,full_name,display_name,phone,email,is_verified,user_type"
            f"&or=(phone.ilike.*{q}*,email.ilike.*{q}*,full_name.ilike.*{q}*)&limit=5"
        )
        data = sb_get("users", params, service=True)
        safe = [
            {
                "id": u["id"],
                "full_name": u.get("full_name"),
                "display_name": u.get("display_name"),
                "phone": (
                    u.get("phone", "")[-4:].rjust(len(u.get("phone", "")), "*")
                    if u.get("phone")
                    else ""
                ),
                "is_verified": u.get("is_verified", False),
                "user_type": u.get("user_type"),
            }
            for u in data
        ]
        return success(safe)
    except Exception as e:
        log.error(f"Search users: {e}")
        return error("Could not search users", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  REPORTS
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/reports", methods=["POST"])
@require_auth
@require_json
def submit_report():
    body = request.get_json()
    payload = {
        "reported_by":   g.user_id,
        "emergency_id":  body.get("emergency_id"),
        "reported_user": body.get("reported_user"),
        "reason":        body.get("reason", ""),
        "description":   body.get("description", ""),
        "status":        "pending",
    }
    try:
        sb_post("reports", payload, service=True)
        return success({"message": "Report submitted for review"}, 201)
    except Exception as e:
        log.error(f"Report error: {e}")
        return error("Could not submit report", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  LEADERBOARD & USER PROFILE
# ══════════════════════════════════════════════════════════════════════════════

@grid_bp.route("/api/leaderboard", methods=["GET"])
@require_auth
def get_leaderboard():
    try:
        data = sb_get(
            "users",
            "select=id,display_name,full_name,org_name,badge,score,emergencies_helped,user_type"
            "&order=score.desc&limit=20",
            service=True,
        )
        return success(data)
    except Exception as e:
        log.error(f"Leaderboard: {e}")
        return error("Could not fetch leaderboard", 503)


@grid_bp.route("/api/users/<user_id>/stats", methods=["GET"])
@require_auth
def get_user_stats(user_id):
    try:
        rows = sb_get(
            "users",
            f"id=eq.{user_id}&select=id,score,badge,emergencies_helped,resources_listed",
            service=True,
        )
        if not rows:
            return error("User not found", 404)
        user = rows[0]
        leaders = sb_get("users", "select=id,score&order=score.desc&limit=1000", service=True)
        rank = next((idx + 1 for idx, row in enumerate(leaders) if row.get("id") == user_id), None)

        # Look up the user's community (a member can only belong to one).
        community_id = None
        community_name = None
        community_status = None
        try:
            memberships = sb_get(
                "ngo_memberships",
                f"user_id=eq.{user_id}&select=ngo_id,status&order=created_at.desc&limit=1",
                service=True,
            )
            if memberships:
                community_id = memberships[0].get("ngo_id")
                community_status = memberships[0].get("status")
                ngo_rows = sb_get(
                    "users",
                    f"id=eq.{community_id}&select=org_name,display_name&limit=1",
                    service=True,
                )
                if ngo_rows:
                    community_name = ngo_rows[0].get("org_name") or ngo_rows[0].get("display_name")
        except Exception as e:
            log.warning(f"Could not look up community for {user_id}: {e}")

        return success({
            "score":              user.get("score") or 0,
            "badge":              user.get("badge") or _badge_for_score(int(user.get("score") or 0)),
            "emergencies_helped": user.get("emergencies_helped") or 0,
            "resources_listed":   user.get("resources_listed") or 0,
            "rank":               rank,
            "community_id":       community_id,
            "community_name":     community_name,
            "community_status":  community_status,
        })
    except Exception as e:
        log.error(f"User stats {user_id}: {e}")
        return error("Could not fetch user stats", 503)


@grid_bp.route("/api/users/<user_id>", methods=["PATCH"])
@require_auth
def update_user_profile(user_id):
    if user_id != g.user_id:
        return error("You can only edit your own profile", 403)
    body = request.get_json(silent=True) or {}
    allowed = {"full_name", "phone", "city", "state_region", "display_name"}
    update_data = {k: v for k, v in body.items() if k in allowed}
    if not update_data:
        return error("No valid fields provided", 400)
    if "full_name" in update_data and "display_name" not in update_data:
        first = update_data["full_name"].split()[0] if update_data["full_name"].strip() else ""
        if first:
            update_data["display_name"] = first
    try:
        resp = sb_patch("users", "id", user_id, update_data, service=True)
        if resp:
            return success(resp[0])
        rows = sb_get("users", f"id=eq.{user_id}&select=*&limit=1", service=True)
        if rows:
            return success(rows[0])
        return error("User not found or update failed", 404)
    except Exception as e:
        log.error(f"Update user profile {user_id}: {e}")
        return error("Could not update profile", 503)