      // ─── INTERCEPTOR ──────────────────────────────────────────────────────────
      const originalFetch = window.fetch;
      window.fetch = async function (resource, config) {
        config = config || {};
        const newConfig = { ...config };
        newConfig.headers = new Headers(config.headers || {});
        const token = localStorage.getItem("rq_token");
        if (token && typeof resource === 'string' && resource.startsWith("/api")) {
            newConfig.headers.set("Authorization", "Bearer " + token);
        }
        return await originalFetch(resource, newConfig);
      };

      // ─── DATA ───────────────────────────────────────────────────────────────────
      let alertsList = [];
      let resourcesList = [];
      let communitiesList = [];
      let leaderboardList = [];
      let sosSearchResults = [];
      let myMemberships = {}; // { ngo_id: "pending"|"approved" }
      let toastTimer;
      let editingResourceId = null;
      let resourceThreadsList = [];
      let latestResourceMessageIds = new Set();

      const STATE = {
        user: null,
        token: null,
        isAdmin: false,
        currentTab: "home",
        currentAdminTab: "overview",
        currentMapFilter: "all",
        mapInstance: null,
        mapInit: false,
        userLat: null,
        userLng: null,
      };

      // ─── SESSION RESTORE ────────────────────────────────────────────────────────
      function restoreSession() {
        try {
          const token = localStorage.getItem("rq_token");
          const userRaw = localStorage.getItem("rq_user");
          if (!token || !userRaw) return false;
          const user = JSON.parse(userRaw);
          if (!user || !user.id) return false;
          STATE.token = token;
          STATE.user = user;
          if (user.is_admin) {
            STATE.isAdmin = true;
            showScreen("screen-admin");
            renderAdminOverview();
          } else if (user.user_type === "ngo") {
            // Community leaders get their own dashboard, not the individual app
            window.location.href = `/community.html?ngo_id=${user.id}`;
            return true;
          } else {
            STATE.isAdmin = false;
            enterApp();
          }
          return true;
        } catch (e) {
          localStorage.removeItem("rq_token");
          localStorage.removeItem("rq_user");
          return false;
        }
      }

      // ─── PASSWORD VISIBILITY TOGGLE ─────────────────────────────────────────────
      function togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        const icon = btn.querySelector(".material-symbols-outlined");
        if (input.type === "password") {
          input.type = "text";
          icon.textContent = "visibility_off";
          btn.style.color = "#0097a7";
        } else {
          input.type = "password";
          icon.textContent = "visibility";
          btn.style.color = "#6b8a96";
        }
      }

      // ─── CALL HELPER ────────────────────────────────────────────────────────────
      function callUser(phone, name) {
        if (!phone) {
          showToast("No phone number available for this user", "error");
          return;
        }
        const clean = phone.replace(/[\s\-\(\)]/g, "");
        window.location.href = `tel:${clean}`;
      }

      // ─── GEOLOCATION HELPERS ────────────────────────────────────────────────────
      function calculateDistance(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
        const R = 6371; // Radius of the earth in km
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      }

      function formatTimeAgo(dateStr) {
        if (!dateStr) return "just now";
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return "just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHrs = Math.floor(diffMins / 60);
        if (diffHrs < 24) return `${diffHrs}h ago`;
        const diffDays = Math.floor(diffHrs / 24);
        return `${diffDays}d ago`;
      }

      function getUserInitials(name) {
        if (!name) return "?";
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
          return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return parts[0].slice(0, 2).toUpperCase();
      }

      function getUserColor(userId) {
        const colors = [
          "#f5700a",
          "#0062a0",
          "#10B981",
          "#9d4400",
          "#565e74",
          "#ba1a1a",
          "#8B5CF6",
          "#EC4899",
        ];
        if (!userId) return colors[0];
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
          hash = userId.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % colors.length;
        return colors[index];
      }

      function userAvatar(user, size = "w-10 h-10") {
        if (!user)
          return `<div class="${size} rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style="background:#888">?</div>`;
        const name =
          user.full_name || user.display_name || user.org_name || "User";
        const initials = getUserInitials(name);
        const color = getUserColor(user.id);
        return `<div class="${size} rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style="background:${color}">${initials}</div>`;
      }

      function hasUserLocation() {
        return Number.isFinite(STATE.userLat) && Number.isFinite(STATE.userLng);
      }

      function updateUserLocationFromBrowser(timeout = 5000) {
        if (!navigator.geolocation) return Promise.resolve(false);
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              STATE.userLat = pos.coords.latitude;
              STATE.userLng = pos.coords.longitude;
              resolve(true);
            },
            () => resolve(false),
            { timeout },
          );
        });
      }

      function nearbyQuery(radiusKm = 50) {
        if (!hasUserLocation()) return STATE.user?.id ? `?user_id=${STATE.user.id}` : "";
        const uid = STATE.user?.id ? `&user_id=${STATE.user.id}` : "";
        return `?lat=${STATE.userLat}&lng=${STATE.userLng}&radius=${radiusKm}${uid}`;
      }

      // ─── HELPERS ────────────────────────────────────────────────────────────────
      const getRiskColor = (r) =>
        ({
          critical: "#EF4444",
          high: "#F97316",
          medium: "#EAB308",
          low: "#10B981",
        })[r] || "#64748B";
      const getRiskBg = (r) =>
        ({
          critical: "bg-red-100 text-red-700",
          high: "bg-orange-100 text-orange-700",
          medium: "bg-yellow-100 text-yellow-700",
          low: "bg-green-100 text-green-700",
        })[r] || "bg-slate-100 text-slate-600";

      async function fetchJsonOrThrow(url, options = {}, label = "data") {
        const response = await fetch(url, options);
        if (!response.ok) {
          let message = `Failed to load ${label}`;
          try {
            const body = await response.json();
            message = body.error || message;
          } catch (err) {
            // Keep the generic message when the server did not return JSON.
          }
          throw new Error(message);
        }
        return response.json();
      }

      // Logo click secret admin access
      let logoClicks = 0;
      function handleLogoClick() {
        logoClicks++;
        if (logoClicks >= 5) {
          logoClicks = 0;
          showToast("🔑 Administrative Access Triggered", "success");
          const secretKey = prompt("Enter Admin Secret Key:");
          if (secretKey) {
            fetchJsonOrThrow(
              "/api/admin/stats",
              { headers: { "X-Admin-Token": secretKey } },
              "admin database access",
            )
              .then(() => {
                STATE.token = secretKey;
                STATE.isAdmin = true;
                STATE.user = null;
                showScreen("screen-admin");
                renderAdminOverview();
              })
              .catch((err) => {
                console.error(err);
                showToast("Invalid admin key or database unavailable", "error");
              });
          }
        } else if (logoClicks >= 2) {
          showToast(`Tap ${5 - logoClicks} more times for Admin Login`, "info");
        }
      }

