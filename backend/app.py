"""
app.py — ResQGrid Flask entry point.

This file is intentionally thin: it only sets up the Flask app, loads
environment config, wires the route blueprints, and starts the server.

Route logic lives in:
  routes/auth.py       — signup & login
  routes/grid.py       — emergencies, resources, SOS, messages, leaderboard
  routes/community.py  — NGO / community management
  routes/admin.py      — admin-protected panel routes

Shared utilities (Supabase helpers, geo functions, stat bumps) are in:
  utils.py
"""

import os
import logging

from flask import Flask, render_template, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

# ── Environment ───────────────────────────────────────────────────────────────
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# ── App setup ─────────────────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR   = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)
CORS(app, resources={r"/api/*": {"origins": os.getenv("ALLOWED_ORIGINS", "*")}})

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL    = os.getenv("GROQ_MODEL", "llama3-8b-8192")
SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SVC  = os.getenv("SUPABASE_SERVICE_KEY", "")
ADMIN_SECRET  = os.getenv("ADMIN_SECRET_KEY", "resqgrid-admin-2024")
PORT          = int(os.getenv("PORT", 5000))
DEBUG         = os.getenv("FLASK_DEBUG", "false").lower() == "true"

RISK_SYSTEM_PROMPT = """
You are an emergency risk classification AI for ResQGrid, an emergency response platform in India.
Given a short description of an emergency situation, classify it and return ONLY valid JSON:
{
  "risk_level": "critical|high|medium|low",
  "category": "blood|transport|medical|food|shelter|fire|flood|other",
  "reason": "<one short sentence explaining the risk level>",
  "is_sos": false
}
Guidelines:
- critical: life-threatening, immediate danger (heart attack, accident with injuries, fire, drowning, active violence)
- high: serious but not immediately fatal (accident without injuries, urgent blood need, child missing)
- medium: important but can wait 1-2 hours (food shortage, shelter needed, medicine unavailable)
- low: helpful but not urgent (general resource request, minor inconvenience)
- is_sos: true only if person says they are in immediate personal danger
Respond ONLY with the JSON object, no markdown, no extra text.
"""

# ── Wire up shared utilities ──────────────────────────────────────────────────
import utils
utils.init_config(SUPABASE_URL, SUPABASE_ANON, SUPABASE_SVC)

# ── Register blueprints ───────────────────────────────────────────────────────
from routes.auth import auth_bp
from routes.grid import grid_bp, init_grid_config
from routes.community import community_bp
from routes.admin import admin_bp, init_admin_config

init_grid_config(GROQ_API_KEY, GROQ_MODEL, RISK_SYSTEM_PROMPT, ADMIN_SECRET)
init_admin_config(ADMIN_SECRET)

app.register_blueprint(auth_bp)
app.register_blueprint(grid_bp)
app.register_blueprint(community_bp)
app.register_blueprint(admin_bp)

# ── Frontend routes ───────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/community.html")
@app.route("/community")
def community_page():
    return render_template("community.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)

# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    from utils import success
    return success({
        "status":   "ok",
        "service":  "ResQGrid API",
        "version":  "1.0.0",
        "groq":     bool(GROQ_API_KEY),
        "supabase": bool(SUPABASE_URL),
    })


# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    log.info(f"ResQGrid starting on port {PORT} | debug={DEBUG}")
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)