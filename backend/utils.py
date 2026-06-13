"""
utils.py — Shared helpers, Supabase wrappers, and stat utilities for ResQGrid.
Imported by app.py and all route blueprints.
"""

import os
import math
import logging
import requests
from functools import wraps
from datetime import datetime, timezone

from flask import request, jsonify, g

log = logging.getLogger(__name__)

# ── Config (read from env; populated by app.py after load_dotenv) ─────────────
SUPABASE_URL = ""
SUPABASE_ANON = ""
SUPABASE_SVC = ""


def init_config(url, anon, svc):
    """Called once from app.py after load_dotenv to wire up credentials."""
    global SUPABASE_URL, SUPABASE_ANON, SUPABASE_SVC
    SUPABASE_URL = url
    SUPABASE_ANON = anon
    SUPABASE_SVC = svc


# ── Supabase REST helpers ─────────────────────────────────────────────────────

def supabase_headers(service=False):
    key = SUPABASE_SVC if service else SUPABASE_ANON
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def sb_get(table, params="", service=False):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.get(url, headers=supabase_headers(service), timeout=8)
    r.raise_for_status()
    return r.json()


def sb_post(table, data, service=False):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = requests.post(url, headers=supabase_headers(service), json=data, timeout=8)
    r.raise_for_status()
    return r.json()


def sb_patch(table, match_col, match_val, data, service=False):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_col}=eq.{match_val}"
    r = requests.patch(url, headers=supabase_headers(service), json=data, timeout=8)
    r.raise_for_status()
    return r.json()


def sb_patch_filters(table, params, data, service=False):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.patch(url, headers=supabase_headers(service), json=data, timeout=8)
    r.raise_for_status()
    return r.json()


def sb_delete(table, params, service=False):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.delete(url, headers=supabase_headers(service), timeout=8)
    r.raise_for_status()
    return r.json() if r.content else []


# ── Response helpers ──────────────────────────────────────────────────────────

def error(msg, code=400):
    return jsonify({"error": msg}), code


def success(data, code=200):
    return jsonify(data), code


def require_inserted_row(result, label):
    if result:
        return result[0]
    raise RuntimeError(f"Database did not return inserted {label}")


# ── Decorators & Authentication ───────────────────────────────────────────────

def get_auth_user_id():
    """Extract and verify user ID from authorization token using Supabase Auth endpoint."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    try:
        r = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON, "Authorization": f"Bearer {token}"},
            timeout=8
        )
        if r.status_code == 200:
            return r.json().get("id")
        else:
            log.warning(f"Supabase token verification failed with status {r.status_code}: {r.text}")
    except Exception as e:
        log.error(f"Error verifying token: {e}")
    return None


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user_id = get_auth_user_id()
        if not user_id:
            return error("Unauthorized: Invalid or missing session token", 401)
        g.user_id = user_id
        
        # Verify that the user is not suspended
        try:
            rows = sb_get("users", f"id=eq.{g.user_id}&select=is_suspended", service=True)
            if rows and rows[0].get("is_suspended"):
                return error("Your account has been suspended.", 403)
        except Exception as e:
            log.warning(f"Could not verify suspension status for {g.user_id}: {e}")
            
        return f(*args, **kwargs)
    return wrapper


def require_json(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not request.is_json:
            return error("Content-Type must be application/json")
        return f(*args, **kwargs)
    return wrapper


# ── Geo helpers ───────────────────────────────────────────────────────────────

def _within_radius(lat1, lng1, lat2, lng2, radius_km):
    """Haversine distance check."""
    if lat2 is None or lng2 is None:
        return False
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a)) <= radius_km


def _geohash(lat, lng, precision=6):
    """Simple geohash string for indexing."""
    base32 = "0123456789bcdefghjkmnpqrstuvwxyz"
    lat_range, lng_range = [-90, 90], [-180, 180]
    bits, bit, code = 0, 0, ""
    even = True
    while len(code) < precision:
        if even:
            mid = (lng_range[0] + lng_range[1]) / 2
            if lng >= mid:
                bit = (bit << 1) | 1
                lng_range[0] = mid
            else:
                bit <<= 1
                lng_range[1] = mid
        else:
            mid = (lat_range[0] + lat_range[1]) / 2
            if lat >= mid:
                bit = (bit << 1) | 1
                lat_range[0] = mid
            else:
                bit <<= 1
                lat_range[1] = mid
        even = not even
        bits += 1
        if bits == 5:
            code += base32[bit]
            bits = bit = 0
    return code


# ── User / badge helpers ──────────────────────────────────────────────────────

def _badge_for_score(score):
    if score >= 2000:
        return "Legend"
    if score >= 1000:
        return "Hero"
    if score >= 500:
        return "Guardian"
    if score >= 100:
        return "Helper"
    return "New Helper"


def _bump_user_stats(user_id, score_delta=0, helped_delta=0, resources_delta=0):
    if not user_id:
        return
    for attempt in range(5):
        try:
            rows = sb_get(
                "users",
                f"id=eq.{user_id}&select=score,emergencies_helped,resources_listed",
                service=True,
            )
            if not rows:
                return
            user = rows[0]
            old_score = int(user.get("score") or 0)
            old_helped = int(user.get("emergencies_helped") or 0)
            old_resources = int(user.get("resources_listed") or 0)
            
            new_score = max(0, old_score + score_delta)
            new_helped = max(0, old_helped + helped_delta)
            new_resources = max(0, old_resources + resources_delta)
            
            payload = {
                "score": new_score,
                "badge": _badge_for_score(new_score),
                "emergencies_helped": new_helped,
                "resources_listed": new_resources,
            }
            
            # Optimistic locking
            filters = f"id=eq.{user_id}&score=eq.{old_score}&emergencies_helped=eq.{old_helped}&resources_listed=eq.{old_resources}"
            res = sb_patch_filters("users", filters, payload, service=True)
            if res:
                break
        except Exception as e:
            log.warning(f"OCC attempt {attempt+1} failed to update user stats for {user_id}: {e}")


def _append_emergency_responder_counts(emergencies):
    if not emergencies:
        return emergencies
    try:
        ids = ",".join(str(e.get("id")) for e in emergencies if e.get("id"))
        if not ids:
            return emergencies
        responders = sb_get(
            "responders",
            f"select=emergency_id,user_id,status&emergency_id=in.({ids})",
            service=True,
        )
        counts = {}
        user_ids = {}
        for responder in responders:
            eid = responder.get("emergency_id")
            counts[eid] = counts.get(eid, 0) + 1
            user_ids.setdefault(eid, []).append(responder.get("user_id"))
        for emergency in emergencies:
            eid = emergency.get("id")
            emergency["responder_count"] = counts.get(eid, 0)
            emergency["responder_user_ids"] = [uid for uid in user_ids.get(eid, []) if uid]
    except Exception as e:
        log.warning(f"Could not load responder counts: {e}")
        for emergency in emergencies:
            emergency.setdefault("responder_count", 0)
            emergency.setdefault("responder_user_ids", [])
    return emergencies