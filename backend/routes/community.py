"""
routes/community.py — Community / NGO routes.

Covers: listing communities, setting location, join requests, member management,
alert assignment, resource assignment, community leaderboard, and rank endpoints.
"""

import logging

from flask import Blueprint, request, g
from utils import (
    error, success, require_json, require_auth,
    sb_get, sb_post, sb_patch, sb_delete,
    _within_radius, _geohash, require_inserted_row,
    _append_emergency_responder_counts,
)

log = logging.getLogger(__name__)
community_bp = Blueprint("community", __name__, url_prefix="/api/communities")

# Radius within which a community is visible to nearby users (km)
COMMUNITY_RADIUS_KM = 30


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_ngo(ngo_id):
    rows = sb_get("users", f"id=eq.{ngo_id}&select=*,org_name,lat,lng,user_type&limit=1", service=True)
    return rows[0] if rows else None


def _get_resource_thread(thread_id, user_id=None):
    """Thin copy of the grid helper needed for community resource assignment."""
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


def _append_member_responders(emergencies, ngo_id):
    """Attach a `member_responders` list to each emergency with the community's
    own members who are responding or assigned to it."""
    if not emergencies:
        return emergencies
    try:
        members = sb_get(
            "ngo_memberships",
            f"select=user:users!ngo_memberships_user_id_fkey(id,full_name,display_name)&ngo_id=eq.{ngo_id}&status=eq.approved&limit=500",
            service=True,
        )
        member_map = {m["user"]["id"]: m["user"] for m in members if m.get("user")}
        if not member_map:
            for e in emergencies:
                e["member_responders"] = []
            return emergencies

        ids = ",".join(str(e.get("id")) for e in emergencies if e.get("id"))
        if not ids:
            return emergencies
        responders = sb_get(
            "responders",
            f"select=emergency_id,user_id,status&emergency_id=in.({ids})",
            service=True,
        )
        by_emergency = {}
        for r in responders:
            user = member_map.get(r.get("user_id"))
            if user:
                by_emergency.setdefault(r["emergency_id"], []).append({
                    "id":     user["id"],
                    "name":   user.get("display_name") or user.get("full_name"),
                    "status": r.get("status"),
                })
        for e in emergencies:
            e["member_responders"] = by_emergency.get(e.get("id"), [])
    except Exception as e:
        log.warning(f"Could not load member responders: {e}")
        for e in emergencies:
            e.setdefault("member_responders", [])
    return emergencies


# ══════════════════════════════════════════════════════════════════════════════
#  DISCOVERY
# ══════════════════════════════════════════════════════════════════════════════

@community_bp.route("", methods=["GET"])
def get_communities():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    try:
        params = "select=id,org_name,org_type,city,lat,lng,score,is_verified&user_type=eq.ngo&limit=200"
        data = sb_get("users", params, service=True)
        if lat is not None and lng is not None:
            data = [
                c for c in data
                if _within_radius(lat, lng, c.get("lat"), c.get("lng"), COMMUNITY_RADIUS_KM)
            ]
        return success(data)
    except Exception as e:
        log.error(f"Get communities: {e}")
        return error("Could not fetch communities", 503)


@community_bp.route("/<ngo_id>/location", methods=["POST"])
@require_auth
@require_json
def set_community_location(ngo_id):
    """Leader sets/updates their community's centre location.
    Once set, the community is visible to users within COMMUNITY_RADIUS_KM.
    """
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    body = request.get_json()
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return error("lat and lng are required", 400)
    try:
        existing = sb_get("users", f"id=eq.{ngo_id}&user_type=eq.ngo&select=id&limit=1", service=True)
        if not existing:
            return error("Community not found", 404)
        result = sb_patch("users", "id", ngo_id, {"lat": lat, "lng": lng}, service=True)
        return success(require_inserted_row(result, "community"))
    except Exception as e:
        log.error(f"Set community location: {e}")
        return error("Could not update community location", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  MEMBERSHIP
# ══════════════════════════════════════════════════════════════════════════════

@community_bp.route("/memberships", methods=["GET"])
@require_auth
def get_user_memberships():
    """Return a map of { ngo_id: status } for all of a user's community
    membership records (pending or approved). Used by the individual app
    to render join-button state and to detect if the user already
    belongs to a community."""
    user_id = g.user_id
    try:
        rows = sb_get(
            "ngo_memberships",
            f"select=ngo_id,status&user_id=eq.{user_id}&limit=20",
            service=True,
        )
        if not isinstance(rows, list):
            rows = []
        return success({r["ngo_id"]: r["status"] for r in rows if r.get("ngo_id")})
    except Exception as e:
        log.error(f"Get user memberships: {e}")
        return error("Could not fetch memberships", 503)


@community_bp.route("/<ngo_id>/join", methods=["POST"])
@require_auth
@require_json
def join_community(ngo_id):
    user_id = g.user_id
    try:
        existing = sb_get(
            "ngo_memberships",
            f"select=id,ngo_id,status&user_id=eq.{user_id}&limit=20",
            service=True,
        )
        if not isinstance(existing, list):
            existing = []

        # Already have a membership record (pending/approved/rejected) with this community
        same = next((m for m in existing if m.get("ngo_id") == ngo_id), None)
        if same:
            status = same.get("status", "submitted")
            if status in ("approved", "pending"):
                return success({"message": f"Join request already {status}", "status": status})
            # status == "rejected" -> allow re-requesting by updating the row
            sb_patch("ngo_memberships", "id", same["id"], {"status": "pending"}, service=True)
            return success({"message": "Join request submitted", "status": "pending"}, 201)

        # A member can only belong to one community at a time
        other = next((m for m in existing if m.get("status") in ("approved", "pending")), None)
        if other:
            msg = (
                "You're already a member of a community"
                if other.get("status") == "approved"
                else "You already have a pending join request with another community"
            )
            return error(f"{msg}. Leave it before joining a new one.", 409)

        sb_post("ngo_memberships", {"ngo_id": ngo_id, "user_id": user_id, "status": "pending"}, service=True)
        return success({"message": "Join request submitted", "status": "pending"}, 201)
    except Exception as e:
        log.error(f"Join community: {e}")
        return error("Could not submit join request", 503)


@community_bp.route("/<ngo_id>/leave", methods=["POST"])
@require_auth
@require_json
def leave_community(ngo_id):
    """A member voluntarily leaves their community (or withdraws a pending request)."""
    user_id = g.user_id
    try:
        sb_delete("ngo_memberships", f"ngo_id=eq.{ngo_id}&user_id=eq.{user_id}", service=True)
        return success({"message": "You have left the community"})
    except Exception as e:
        log.error(f"Leave community: {e}")
        return error("Could not leave community", 503)


@community_bp.route("/<ngo_id>/members", methods=["GET"])
@require_auth
def get_community_members(ngo_id):
    try:
        members = sb_get(
            "ngo_memberships",
            f"select=id,user_id,user:users!ngo_memberships_user_id_fkey(id,full_name,display_name,score,emergencies_helped)"
            f"&ngo_id=eq.{ngo_id}&status=eq.approved&order=created_at.desc&limit=200",
            service=True,
        )
        if not isinstance(members, list):
            members = []
        # Rank members within this community by score (descending). Members
        # are kept in their original (join-order) order; each one just gets
        # a `rank` field added based on the score-sorted position.
        ranked = sorted(members, key=lambda m: int((m.get("user") or {}).get("score") or 0), reverse=True)
        for idx, m in enumerate(ranked):
            m["rank"] = idx + 1
        return success(members)
    except Exception as e:
        log.error(f"Get community members: {e}")
        return error("Could not fetch community members", 503)


@community_bp.route("/<ngo_id>/requests", methods=["GET"])
@require_auth
def get_community_requests(ngo_id):
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        reqs = sb_get(
            "ngo_memberships",
            f"select=id,user_id,user:users!ngo_memberships_user_id_fkey(id,full_name,display_name,phone,city)"
            f"&ngo_id=eq.{ngo_id}&status=eq.pending&order=created_at.desc&limit=200",
            service=True,
        )
        if not isinstance(reqs, list):
            reqs = []
        return success(reqs)
    except Exception as e:
        log.error(f"Get community requests: {e}")
        return error("Could not fetch join requests", 503)


@community_bp.route("/<ngo_id>/requests/<req_id>/approve", methods=["POST"])
@require_auth
@require_json
def approve_join_request(ngo_id, req_id):
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        sb_patch("ngo_memberships", "id", req_id, {"status": "approved"}, service=True)
        return success({"message": "Member approved"})
    except Exception as e:
        log.error(f"Approve join request: {e}")
        return error("Could not approve request", 503)


@community_bp.route("/<ngo_id>/requests/<req_id>/reject", methods=["POST"])
@require_auth
@require_json
def reject_join_request(ngo_id, req_id):
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        sb_patch("ngo_memberships", "id", req_id, {"status": "rejected"}, service=True)
        return success({"message": "Member rejected"})
    except Exception as e:
        log.error(f"Reject join request: {e}")
        return error("Could not reject request", 503)


@community_bp.route("/<ngo_id>/members/<member_id>/remove", methods=["POST"])
@require_auth
@require_json
def remove_community_member(ngo_id, member_id):
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        sb_delete("ngo_memberships", f"ngo_id=eq.{ngo_id}&user_id=eq.{member_id}", service=True)
        return success({"message": "Member removed"})
    except Exception as e:
        log.error(f"Remove member: {e}")
        return error("Could not remove member", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  ALERTS (community view)
# ══════════════════════════════════════════════════════════════════════════════

@community_bp.route("/<ngo_id>/alerts", methods=["GET"])
@require_auth
def get_community_alerts(ngo_id):
    """Emergencies within 30 km of the community centre, with member responder info."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        ngo = _get_ngo(ngo_id)
        if not ngo:
            return error("Community not found", 404)
        lat, lng = ngo.get("lat"), ngo.get("lng")
        if lat is None or lng is None:
            return error("Community location not set", 400)
        data = sb_get(
            "emergencies",
            "select=*,user:users(*)&status=eq.active&order=created_at.desc&limit=200",
            service=True,
        )
        nearby = [e for e in data if _within_radius(lat, lng, e.get("lat"), e.get("lng"), 30)]
        nearby = _append_emergency_responder_counts(nearby)
        _append_member_responders(nearby, ngo_id)

        # Mirror the main-feed visibility rule: hide emergencies already claimed
        # by an outside responder. Show unclaimed ones, OR ones where this NGO's
        # own member is responding/assigned.
        nearby = [
            e for e in nearby
            if (e.get("responder_count") or 0) == 0
            or len(e.get("member_responders") or []) > 0
        ]

        return success(nearby)
    except Exception as e:
        log.error(f"Get community alerts: {e}")
        return error("Could not fetch community alerts", 503)


@community_bp.route("/<ngo_id>/alerts/<eid>/nearby-members", methods=["GET"])
@require_auth
def get_nearby_members_for_alert(ngo_id, eid):
    """Return approved community members sorted by proximity to the alert location.
    Each member gets a `distance_km` field so the leader can see who is closest."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        # Fetch the emergency to get its coordinates
        emerg_rows = sb_get(
            "emergencies",
            f"select=id,lat,lng,title&id=eq.{eid}&limit=1",
            service=True,
        )
        if not emerg_rows:
            return error("Emergency not found", 404)
        emerg = emerg_rows[0]
        elat, elng = emerg.get("lat"), emerg.get("lng")
        if elat is None or elng is None:
            return error("Emergency has no location", 400)

        # Fetch approved members with their location
        members = sb_get(
            "ngo_memberships",
            f"select=user_id,user:users!ngo_memberships_user_id_fkey"
            f"(id,full_name,display_name,phone,score,emergencies_helped,lat,lng)"
            f"&ngo_id=eq.{ngo_id}&status=eq.approved&limit=500",
            service=True,
        )
        if not isinstance(members, list):
            members = []

        # Check which members are already responding to this emergency
        responders_rows = sb_get(
            "responders",
            f"select=user_id,status&emergency_id=eq.{eid}",
            service=True,
        )
        responder_map = {r["user_id"]: r["status"] for r in responders_rows if r.get("user_id")}

        import math
        def haversine_km(lat1, lng1, lat2, lng2):
            if lat2 is None or lng2 is None:
                return None
            R = 6371
            dlat = math.radians(lat2 - lat1)
            dlng = math.radians(lng2 - lng1)
            a = (math.sin(dlat/2)**2 +
                 math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
                 math.sin(dlng/2)**2)
            return round(2 * R * math.asin(math.sqrt(a)), 2)

        result = []
        for m in members:
            u = m.get("user") or {}
            if not u.get("id"):
                continue
            dist = haversine_km(elat, elng, u.get("lat"), u.get("lng"))
            result.append({
                "id": u["id"],
                "display_name": u.get("display_name") or u.get("full_name") or "Member",
                "phone": u.get("phone"),
                "score": u.get("score", 0),
                "emergencies_helped": u.get("emergencies_helped", 0),
                "lat": u.get("lat"),
                "lng": u.get("lng"),
                "distance_km": dist,
                "responder_status": responder_map.get(u["id"]),
            })

        # Sort: members with known location first (closest first), then unknown
        result.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 9999))
        return success(result)
    except Exception as e:
        log.error(f"Nearby members for alert: {e}")
        return error("Could not fetch nearby members", 503)


@community_bp.route("/<ngo_id>/alerts/<eid>/assign", methods=["POST"])
@require_auth
@require_json
def assign_alert_to_member(ngo_id, eid):
    """Leader assigns an alert to a community member (creates/updates responder row)
    and posts a notification message in the emergency chat."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    body = request.get_json()
    member_id = body.get("member_id")
    if not member_id:
        return error("member_id required", 400)
    try:
        # Verify that the member is actually an approved member of this community
        membership = sb_get(
            "ngo_memberships",
            f"ngo_id=eq.{ngo_id}&user_id=eq.{member_id}&status=eq.approved&select=id&limit=1",
            service=True,
        )
        if not membership:
            return error("User is not an approved member of this community", 400)
        # Fetch emergency title/location for the notification message
        emerg_rows = sb_get(
            "emergencies",
            f"select=id,title,lat,lng&id=eq.{eid}&limit=1",
            service=True,
        )
        if not emerg_rows:
            return error("Emergency not found", 404)
        emerg = emerg_rows[0]

        # Fetch member display name
        member_rows = sb_get(
            "users",
            f"select=id,display_name,full_name&id=eq.{member_id}&limit=1",
            service=True,
        )
        member_name = "A member"
        if member_rows:
            u = member_rows[0]
            member_name = u.get("display_name") or u.get("full_name") or "A member"

        # Fetch leader (NGO) name
        ngo_rows = sb_get(
            "users",
            f"select=org_name,display_name,full_name&id=eq.{ngo_id}&limit=1",
            service=True,
        )
        ngo_name = "Community"
        if ngo_rows:
            n = ngo_rows[0]
            ngo_name = n.get("org_name") or n.get("display_name") or n.get("full_name") or "Community"

        # Create or update the responder row
        existing = sb_get(
            "responders",
            f"select=id&emergency_id=eq.{eid}&user_id=eq.{member_id}&limit=1",
            service=True,
        )
        if existing:
            sb_patch("responders", "id", existing[0]["id"], {"status": "assigned"}, service=True)
            updated = False
        else:
            sb_post("responders", {"emergency_id": eid, "user_id": member_id, "status": "assigned"}, service=True)
            updated = True

        # Post a visible system message in the emergency chat
        try:
            sb_post("messages", {
                "emergency_id": eid,
                "user_id": ngo_id,
                "content": f"🚨 [{ngo_name}] {member_name} has been assigned to respond to this emergency.",
                "display_name": ngo_name,
            }, service=True)
        except Exception as me:
            log.warning(f"Could not post assignment message: {me}")

        return success({
            "message": "Alert assigned" if updated else "Alert assigned (updated)",
            "member_name": member_name,
            "emergency_title": emerg.get("title"),
            "emergency_lat": emerg.get("lat"),
            "emergency_lng": emerg.get("lng"),
        }, 201 if updated else 200)
    except Exception as e:
        log.error(f"Assign alert: {e}")
        return error("Could not assign alert", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  RESOURCES (community-level)
# ══════════════════════════════════════════════════════════════════════════════

@community_bp.route("/<ngo_id>/resources", methods=["POST"])
@require_auth
@require_json
def post_community_resource(ngo_id):
    """Community posts a resource on behalf of the NGO."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    body = request.get_json()
    for f in ["type", "title", "lat", "lng"]:
        if not body.get(f):
            return error(f"Field '{f}' is required")
    payload = {
        "user_id":          ngo_id,
        "type":             body["type"],
        "title":            body["title"],
        "description":      body.get("description", ""),
        "quantity":         body.get("quantity"),
        "blood_group":      body.get("blood_group"),
        "available_until":  body.get("available_until"),
        "lat":              body["lat"],
        "lng":              body["lng"],
        "geohash":          _geohash(body["lat"], body["lng"]),
        "is_available":     True,
    }
    try:
        result = sb_post("resources", payload, service=True)
        return success(require_inserted_row(result, "resource"), 201)
    except Exception as e:
        log.error(f"Post community resource: {e}")
        return error("Could not post community resource", 503)


@community_bp.route("/<ngo_id>/resources/<rid>/assign", methods=["POST"])
@require_auth
@require_json
def assign_resource_to_member(ngo_id, rid):
    """Leader opens (or returns existing) resource thread between the NGO and a member."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    body = request.get_json()
    member_id = body.get("member_id")
    if not member_id:
        return error("member_id required", 400)
    if ngo_id == member_id:
        return error("Cannot assign a resource to yourself", 400)
    try:
        # Verify that the member is actually an approved member of this community
        membership = sb_get(
            "ngo_memberships",
            f"ngo_id=eq.{ngo_id}&user_id=eq.{member_id}&status=eq.approved&select=id&limit=1",
            service=True,
        )
        if not membership:
            return error("User is not an approved member of this community", 400)
        resources = sb_get("resources", f"id=eq.{rid}&select=id,user_id&limit=1", service=True)
        if not resources:
            return error("Resource not found", 404)
        if resources[0].get("user_id") != ngo_id:
            return error("Resource not owned by this community", 403)
        existing = sb_get(
            "resource_threads",
            f"resource_id=eq.{rid}&owner_id=eq.{ngo_id}&requester_id=eq.{member_id}&select=id&limit=1",
            service=True,
        )
        if existing:
            thread = _get_resource_thread(existing[0]["id"], member_id)
            return success({"message": "Assignment opened", "thread": thread})
        result = sb_post(
            "resource_threads",
            {"resource_id": rid, "owner_id": ngo_id, "requester_id": member_id},
            service=True,
        )
        thread = _get_resource_thread(require_inserted_row(result, "resource thread")["id"], member_id)
        return success({"message": "Assignment opened", "thread": thread}, 201)
    except Exception as e:
        log.error(f"Assign resource: {e}")
        return error("Could not assign resource", 503)


# ══════════════════════════════════════════════════════════════════════════════
#  RANKINGS & ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

@community_bp.route("/<ngo_id>/rank", methods=["GET"])
def get_community_rank(ngo_id):
    try:
        rows = sb_get(
            "users",
            "select=id,org_name,user_type,score&user_type=eq.ngo&order=score.desc&limit=1000",
            service=True,
        )
        rank = next((idx + 1 for idx, row in enumerate(rows) if row.get("id") == ngo_id), None)
        return success({"rank": rank, "total": len(rows)})
    except Exception as e:
        log.error(f"Get community rank: {e}")
        return error("Could not compute community rank", 503)


@community_bp.route("/<ngo_id>/members/rank", methods=["GET"])
def get_members_rank(ngo_id):
    try:
        rows = sb_get(
            "ngo_memberships",
            f"select=user:users!ngo_memberships_user_id_fkey(id,full_name,display_name,score,emergencies_helped)"
            f"&ngo_id=eq.{ngo_id}&status=eq.approved&limit=500",
            service=True,
        )
        if not isinstance(rows, list):
            rows = []
        members = [r.get("user") for r in rows if r.get("user")]
        # Sort by score descending in Python (PostgREST can't order by embedded fields)
        members.sort(key=lambda m: int(m.get("score") or 0), reverse=True)
        return success(members)
    except Exception as e:
        log.error(f"Get members rank: {e}")
        return error("Could not fetch members rank", 503)


@community_bp.route("/<ngo_id>/defaulters", methods=["GET"])
@require_auth
def get_community_defaulters(ngo_id):
    """Members with zero emergencies helped — useful for leader follow-up."""
    if g.user_id != ngo_id:
        return error("Unauthorized", 403)
    try:
        rows = sb_get(
            "ngo_memberships",
            f"select=user:users!ngo_memberships_user_id_fkey(id,full_name,display_name,phone,score,emergencies_helped)"
            f"&ngo_id=eq.{ngo_id}&status=eq.approved&limit=500",
            service=True,
        )
        if not isinstance(rows, list):
            rows = []
        defaulters = [
            m["user"] for m in rows
            if m.get("user") and int(m["user"].get("emergencies_helped") or 0) == 0
        ]
        return success(defaulters)
    except Exception as e:
        log.error(f"Get defaulters: {e}")
        return error("Could not fetch defaulters", 503)