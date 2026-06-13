"""
routes/auth.py — Authentication routes (signup, login, password reset).
Proxies Supabase Auth and creates/fetches the public users profile row.
"""

import logging
import requests

from flask import Blueprint, request
from utils import (
    error, success, require_json,
    sb_get, sb_post,
    SUPABASE_URL, SUPABASE_ANON, SUPABASE_SVC
)

log = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ── Sign-up ───────────────────────────────────────────────────────────────────

@auth_bp.route("/signup", methods=["POST"])
@require_json
def auth_signup():
    body = request.get_json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not email or not password:
        return error("Email and password required")
    if len(password) < 8:
        return error("Password must be at least 8 characters")

    try:
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=8,
        )
        data = r.json()
        if r.status_code not in (200, 201):
            return error(data.get("msg") or data.get("message") or "Signup failed", r.status_code)

        user_id = data.get("id") or data.get("user", {}).get("id")
        if user_id:
            profile_payload = {
                "id": user_id,
                "full_name": f"{body.get('first_name', '')} {body.get('last_name', '')}".strip(),
                "display_name": body.get("first_name", "User"),
                "email": email,
                "phone": body.get("phone", ""),
                "user_type": body.get("user_type", "individual"),
                "org_name": body.get("org_name") if body.get("user_type") == "ngo" else None,
                "org_type": body.get("org_type") if body.get("user_type") == "ngo" else None,
                "org_reg_number": body.get("org_reg_number") if body.get("user_type") == "ngo" else None,
                "is_verified": False,
                "is_admin": False,
                "is_suspended": False,
                "score": 0,
                "badge": "New Helper",
                "emergencies_helped": 0,
                "resources_listed": 0,
            }
            try:
                sb_post("users", profile_payload, service=True)
            except Exception as pe:
                log.error(f"Failed to create public user profile: {pe}")
                try:
                    requests.delete(
                        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
                        headers={
                            "apikey": SUPABASE_SVC,
                            "Authorization": f"Bearer {SUPABASE_SVC}",
                        },
                        timeout=8
                    )
                except Exception as de:
                    log.error(f"Failed to cleanup auth user {user_id}: {de}")
                return error("Could not create user profile. Please try again.", 500)

        return success(
            {"message": "Account created. Check email for verification.", "user_id": user_id},
            201,
        )
    except Exception as e:
        log.error(f"Signup error: {e}")
        return error("Signup service unavailable", 503)


# ── Login ─────────────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["POST"])
@require_json
def auth_login():
    body = request.get_json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    try:
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=8,
        )
        data = r.json()
        if r.status_code != 200:
            return error(data.get("error_description") or "Invalid credentials", 401)

        # Supabase returns the auth user under different keys depending on version
        auth_user = data.get("users", {})
        user_id = auth_user.get("id")
        if not user_id:
            auth_user_alt = data.get("user", {})
            user_id = auth_user_alt.get("id") if auth_user_alt else None

        if not user_id:
            return error("Invalid auth response: missing user id", 401)

        # Fetch public profile (try auth_id mapping first, then id mapping)
        user_profile = None
        try:
            rows = sb_get("users", f"auth_id=eq.{user_id}&select=*", service=True)
            if rows:
                user_profile = rows[0]
        except Exception:
            pass

        if not user_profile:
            rows = sb_get("users", f"id=eq.{user_id}&select=*", service=True)
            if rows:
                user_profile = rows[0]

        if not user_profile:
            log.error(f"No database profile found for auth user {user_id}")
            return error(
                "User profile not found in database (set users.auth_id or users.id mapping)",
                404,
            )

        if user_profile.get("is_suspended"):
            return error("Your account has been suspended.", 403)

        return success({
            "access_token": data.get("access_token"),
            "refresh_token": data.get("refresh_token"),
            "user": user_profile,
        })
    except Exception as e:
        log.error(f"Login error: {e}")
        return error("Auth service unavailable", 503)