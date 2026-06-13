"""
routes/admin.py — Admin-only routes, protected by X-Admin-Token header.

Provides stats, user management, and read access to emergencies, reports,
activity logs, and SOS events for the admin panel.
"""

import logging
from functools import wraps

from flask import Blueprint, request
from utils import error, success, sb_get, sb_patch

log = logging.getLogger(__name__)
admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

_ADMIN_SECRET = ""


def init_admin_config(admin_secret: str):
    global _ADMIN_SECRET
    _ADMIN_SECRET = admin_secret


# ── Guard decorator ───────────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not _ADMIN_SECRET or request.headers.get("X-Admin-Token", "") != _ADMIN_SECRET:
            return error("Unauthorized", 401)
        return f(*args, **kwargs)
    return wrapper


# ── Routes ────────────────────────────────────────────────────────────────────

@admin_bp.route("/stats", methods=["GET"])
@admin_required
def admin_stats():
    try:
        users     = sb_get("users",       "select=count", service=True)
        emerg     = sb_get("emergencies", "select=count", service=True)
        resources = sb_get("resources",   "select=count", service=True)
        sos       = sb_get("sos_events",  "select=count&is_active=eq.true", service=True)
        return success({
            "total_users":        users[0].get("count") if users else 0,
            "total_emergencies":  emerg[0].get("count") if emerg else 0,
            "total_resources":    resources[0].get("count") if resources else 0,
            "active_sos":         sos[0].get("count") if sos else 0,
        })
    except Exception as e:
        log.error(f"Admin stats: {e}")
        return error("Stats unavailable", 503)


@admin_bp.route("/users", methods=["GET"])
@admin_required
def admin_users():
    try:
        search = request.args.get("search", "")
        params = (
            "select=id,full_name,email,phone,user_type,is_verified,is_suspended,"
            "score,badge,emergencies_helped,created_at&order=created_at.desc&limit=100"
        )
        if search:
            params += f"&or=(full_name.ilike.*{search}*,email.ilike.*{search}*,phone.ilike.*{search}*)"
        data = sb_get("users", params, service=True)
        return success(data)
    except Exception as e:
        log.error(f"Admin users: {e}")
        return error("Could not fetch users", 503)


@admin_bp.route("/users/<uid>/suspend", methods=["POST"])
@admin_required
def admin_suspend_user(uid):
    try:
        sb_patch("users", "id", uid, {"is_suspended": True}, service=True)
        return success({"message": f"User {uid} suspended"})
    except Exception as e:
        return error(str(e), 503)


@admin_bp.route("/users/<uid>/unsuspend", methods=["POST"])
@admin_required
def admin_unsuspend_user(uid):
    try:
        sb_patch("users", "id", uid, {"is_suspended": False}, service=True)
        return success({"message": f"User {uid} unsuspended"})
    except Exception as e:
        return error(str(e), 503)


@admin_bp.route("/emergencies", methods=["GET"])
@admin_required
def admin_emergencies():
    try:
        params = request.args.get("params", "order=created_at.desc&limit=200")
        data = sb_get("emergencies", params, service=True)
        return success(data)
    except Exception as e:
        log.error(f"Admin emergencies: {e}")
        return error("Could not fetch emergencies", 503)


@admin_bp.route("/reports", methods=["GET"])
@admin_required
def admin_reports():
    try:
        data = sb_get("reports", "order=created_at.desc&limit=100", service=True)
        return success(data)
    except Exception as e:
        log.error(f"Admin reports: {e}")
        return error("Could not fetch reports", 503)


@admin_bp.route("/activity", methods=["GET"])
@admin_required
def admin_activity():
    try:
        data = sb_get("activity_log", "order=created_at.desc&limit=200", service=True)
        return success(data)
    except Exception as e:
        log.error(f"Admin activity: {e}")
        return error("Could not fetch activity", 503)


@admin_bp.route("/sos", methods=["GET"])
@admin_required
def admin_sos():
    try:
        data = sb_get("sos_events", "order=created_at.desc&limit=50", service=True)
        return success(data)
    except Exception as e:
        log.error(f"Admin SOS: {e}")
        return error("Could not fetch SOS events", 503)