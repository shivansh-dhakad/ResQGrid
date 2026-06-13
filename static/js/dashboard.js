      // ─── SERVER DATA LOADING ─────────────────────────────────────────────────────
      async function loadData() {
        try {
          alertsList = await fetchJsonOrThrow(
            `/api/emergencies${nearbyQuery(5)}`,
            {},
            "emergencies",
          );

          resourcesList = await fetchJsonOrThrow(
            `/api/resources${nearbyQuery(RESOURCE_RADIUS_KM)}`,
            {},
            "resources",
          );

          communitiesList = await fetchJsonOrThrow(
            `/api/communities${nearbyQuery(COMMUNITY_RADIUS_KM)}`,
            {},
            "communities",
          );

          // Fetch the user's membership statuses so the community list can
          // show the right button state (none / pending / approved).
          if (STATE.user?.id) {
            try {
              const mem = await fetch(`/api/communities/memberships?user_id=${STATE.user.id}`);
              if (mem.ok) myMemberships = await mem.json();
            } catch (_) {}
          }

          leaderboardList = await fetchJsonOrThrow(
            `/api/leaderboard`,
            {},
            "leaderboard",
          );

          document.getElementById("stat-alerts").textContent =
            alertsList.length;
          document.getElementById("stat-resources").textContent =
            resourcesList.length;

          const myRespondingCount = STATE.user
            ? alertsList.filter(a => (a.responder_user_ids || []).includes(STATE.user.id)).length
            : 0;
          document.getElementById("stat-responding").textContent = myRespondingCount;

          if (STATE.currentTab === "home") {
            initHomeTab();
          } else if (STATE.currentTab === "alerts") {
            renderAlerts("nearby");
          } else if (STATE.currentTab === "community") {
            renderCommunity();
          }

          if (STATE.mapInstance) {
            refreshMapMarkers();
          }
        } catch (err) {
          console.error("Error loading data from server:", err);
          showToast(err.message || "Failed to fetch database data", "error");
        }
      }

      function initHomeTab() {
        const h = new Date().getHours();
        const greet =
          h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
        document.getElementById("home-greeting").textContent =
          `${greet}, ${STATE.user.full_name || STATE.user.display_name}`;
        document.getElementById("home-alerts-list").innerHTML =
          alertsList.length
            ? alertsList
                .slice(0, 3)
                .map((a) => alertCardHTML(a))
                .join("")
            : `<p class="text-center py-6 text-text-muted text-body-md">No nearby active emergencies</p>`;
        document.getElementById("home-resources-list").innerHTML =
          resourcesList.length
            ? resourcesList
                .slice(0, 5)
                .map((r) => resourceCardHTML(r))
                .join("")
            : `<p class="text-center py-6 text-text-muted text-body-md">No available resources nearby</p>`;

        // Show the most critical active emergency in the banner if any
        updateDisasterBanner();
      }

      // ─── DISASTER BANNER ─────────────────────────────────────────────────────────
      function updateDisasterBanner() {
        const banner = document.getElementById("disaster-banner");
        if (!alertsList || alertsList.length === 0) {
          banner.style.display = "none";
          return;
        }
        // Pick the highest-risk active emergency
        const priority = ["critical", "high", "medium", "low"];
        const topAlert =
          alertsList.find((a) => a.status !== "resolved") || null;
        if (!topAlert) {
          banner.style.display = "none";
          return;
        }
        const riskLabel = (topAlert.risk_level || "medium").toUpperCase();
        document.getElementById("banner-label").textContent =
          `${riskLabel} Alert`;
        document.getElementById("banner-title").textContent =
          topAlert.title || "Active Emergency";
        document.getElementById("banner-desc").textContent =
          topAlert.description || "";
        document.getElementById("banner-time").textContent = formatTimeAgo(
          topAlert.created_at,
        );
        banner.style.display = "";
      }

