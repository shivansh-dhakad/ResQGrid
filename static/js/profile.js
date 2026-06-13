      // ─── PROFILE STATS ────────────────────────────────────────────────────────────
      function updateProfileCommunityBadge() {
        const badge = document.getElementById("profile-community-badge");
        const nameEl = document.getElementById("profile-community-name");
        const name = STATE.user && STATE.user.community_name;
        if (name) {
          nameEl.textContent = name;
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      }

      async function loadProfileStats() {
        if (!STATE.user || !STATE.user.id) return;
        try {
          const statsResp = await fetch(`/api/users/${STATE.user.id}/stats`);
          if (!statsResp.ok) throw new Error("Failed to load profile stats");
          if (statsResp.ok) {
            const stats = await statsResp.json();
            STATE.user.score = stats.score ?? 0;
            STATE.user.badge = stats.badge || STATE.user.badge;
            STATE.user.emergencies_helped = stats.emergencies_helped ?? 0;
            STATE.user.resources_listed = stats.resources_listed ?? 0;
            STATE.user.community_id = stats.community_id || null;
            STATE.user.community_name = stats.community_name || null;
            STATE.user.community_status = stats.community_status || null;
            document.getElementById("profile-stat-helped").textContent =
              STATE.user.emergencies_helped;
            document.getElementById("profile-stat-resources").textContent =
              STATE.user.resources_listed;
            document.getElementById("profile-stat-rank").textContent =
              stats.rank ? `#${stats.rank}` : "—";
            document.getElementById("profile-rank-pts").textContent =
              `${STATE.user.score} pts`;
            updateProfileCommunityBadge();
            return;
          }

          document.getElementById("profile-stat-helped").textContent =
            STATE.user.emergencies_helped || 0;
          document.getElementById("profile-stat-resources").textContent =
            STATE.user.resources_listed || 0;
          document.getElementById("profile-stat-rank").textContent = "—";

          // Rank from leaderboard
          if (leaderboardList && leaderboardList.length > 0) {
            const rankIdx = leaderboardList.findIndex(
              (u) => u.id === STATE.user.id,
            );
            document.getElementById("profile-stat-rank").textContent =
              rankIdx >= 0 ? `#${rankIdx + 1}` : "—";
            if (rankIdx >= 0) {
              document.getElementById("profile-rank-pts").textContent =
                `${leaderboardList[rankIdx].score || leaderboardList[rankIdx].points || 0} pts`;
            }
          }
        } catch (e) {
          console.error("loadProfileStats:", e);
          showToast(e.message || "Failed to load profile stats", "error");
        }
      }

      // ─── EDIT PROFILE MODAL ──────────────────────────────────────────────────────
      function openEditProfileModal() {
        if (!STATE.user) return;
        const nameParts = (STATE.user.full_name || "").split(" ");
        document.getElementById("edit-firstname").value = nameParts[0] || "";
        document.getElementById("edit-lastname").value =
          nameParts.slice(1).join(" ") || "";
        document.getElementById("edit-phone").value = STATE.user.phone || "";
        document.getElementById("edit-city").value = STATE.user.city || "";
        document.getElementById("edit-state").value = STATE.user.state_region || STATE.user.state || "";
        openModal("edit-profile-modal");
      }

      async function saveProfileChanges() {
        const firstName = document
          .getElementById("edit-firstname")
          .value.trim();
        const lastName = document.getElementById("edit-lastname").value.trim();
        const phone = document.getElementById("edit-phone").value.trim();
        const city = document.getElementById("edit-city").value.trim();
        const state = document.getElementById("edit-state").value.trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ");
        try {
          const res = await fetch(`/api/users/${STATE.user.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${STATE.token}`,
            },
            body: JSON.stringify({
              full_name: fullName,
              phone,
              city,
              state_region: state,
            }),
          });
          if (res.ok) {
            const updatedUser = await res.json();
            // Merge server response; also sync convenience fields
            STATE.user = { ...STATE.user, ...updatedUser };
            // Ensure display_name tracks full_name first word if server didn't return it
            if (!STATE.user.display_name && STATE.user.full_name) {
              STATE.user.display_name = STATE.user.full_name.split(" ")[0];
            }
            const displayName =
              STATE.user.full_name || STATE.user.display_name || STATE.user.email || "";
            document.getElementById("profile-name").textContent = displayName;
            document.getElementById("profile-avatar").textContent =
              getUserInitials(displayName);
            const h = new Date().getHours();
            const greet =
              h < 12
                ? "Good morning"
                : h < 17
                  ? "Good afternoon"
                  : "Good evening";
            document.getElementById("home-greeting").textContent =
              `${greet}, ${STATE.user.display_name || displayName}`;
            // Persist updated session
            try { localStorage.setItem("resqgrid_user", JSON.stringify(STATE.user)); } catch(e) {}
            showToast("Profile updated ✓", "success");
          } else {
            showToast("Failed to update profile", "error");
          }
        } catch (e) {
          console.error(e);
          showToast("Failed to update profile", "error");
        }
        closeModal("edit-profile-modal");
      }

      // ─── ALERT CARD ──────────────────────────────────────────────────────────────
      function alertCardHTML(a) {
        const user = a.user || {
          full_name: "Anonymous",
          display_name: "Anonymous",
          color: "#888",
          initials: "?",
        };
        const riskBg = getRiskBg(a.risk_level);

        let dist = "0.0";
        if (STATE.userLat && STATE.userLng && a.lat && a.lng) {
          dist = calculateDistance(
            STATE.userLat,
            STATE.userLng,
            a.lat,
            a.lng,
          ).toFixed(1);
        }
        const timeStr = formatTimeAgo(a.created_at);
        const responderCount = a.responder_count || 0;
        const isTaken = responderCount > 0;
        const iAmResponding = STATE.user && (a.responder_user_ids || []).includes(STATE.user.id);
        const iAmPoster = STATE.user && a.user_id === STATE.user.id;

        return `
  <div class="alert-card ${a.risk_level} bg-white border border-border-base rounded-xl overflow-hidden shadow-card hover:shadow-elevated transition-shadow press-scale cursor-pointer" onclick="openAlertDetail('${a.id}')">
    <div class="p-4">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${a.risk_level === "critical" ? "bg-red-100" : a.risk_level === "high" ? "bg-orange-100" : a.risk_level === "medium" ? "bg-yellow-100" : "bg-green-100"}">
          <span class="material-symbols-outlined ${a.risk_level === "critical" || a.risk_level === "high" ? "text-danger" : "text-on-surface-variant"}" style="font-variation-settings:'FILL' 1">${a.category === "blood" ? "bloodtype" : a.category === "transport" ? "directions_car" : a.category === "medical" ? "medical_services" : a.category === "shelter" ? "home_work" : a.category === "fire" ? "local_fire_department" : a.category === "flood" ? "water" : "warning"}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2 mb-1">
            <h5 class="text-body-lg text-on-surface font-semibold leading-snug">${a.title}</h5>
            <span class="risk-pill ${riskBg} flex-shrink-0">${(a.risk_level || "medium").toUpperCase()}</span>
          </div>
          <p class="text-body-md text-on-surface-variant line-clamp-2">${a.description}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-caption text-text-muted font-mono">
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">distance</span>${dist} km</span>
        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">schedule</span>${timeStr}</span>
        ${iAmResponding
          ? `<span class="flex items-center gap-1 text-success font-bold"><span class="material-symbols-outlined text-xs" style="font-variation-settings:'FILL' 1">check_circle</span>You're responding</span>`
          : isTaken
            ? `<span class="flex items-center gap-1 text-text-muted font-bold"><span class="material-symbols-outlined text-xs">lock</span>Taken</span>`
            : `<span class="flex items-center gap-1 text-tertiary font-bold"><span class="material-symbols-outlined text-xs">person_search</span>Needs responder</span>`
        }
      </div>
    </div>
    <div class="flex gap-3 px-4 py-3 border-t border-border-base bg-surface-container-low">
      ${iAmPoster
        ? `<button onclick="event.stopPropagation();resolveAlert('${a.id}')" class="flex-1 py-2.5 bg-success text-white rounded-lg text-label-bold font-bold hover:brightness-110 active:scale-95 transition-all">✅ Mark Resolved</button>`
        : iAmResponding
          ? `<button onclick="event.stopPropagation();navigateToAlert('${a.lat}','${a.lng}','${(a.title||"").replace(/'/g,"")}')" class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-label-bold font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">navigation</span>Directions</button>
            <button onclick="event.stopPropagation();withdrawFromAlert('${a.id}')" class="py-2.5 px-3 bg-orange-100 text-orange-700 border border-orange-200 rounded-lg text-label-bold font-bold active:scale-95 transition-all" title="Withdraw"><span class="material-symbols-outlined text-sm">undo</span></button>`
          : isTaken
            ? `<button disabled class="flex-1 py-2.5 bg-surface-container text-text-muted rounded-lg text-label-bold font-bold cursor-not-allowed opacity-60">Already Taken</button>`
            : `<button onclick="event.stopPropagation();respondToAlert('${a.id}')" class="flex-1 py-2.5 bg-primary-container text-white rounded-lg text-label-bold font-bold hover:brightness-110 active:scale-95 transition-all">🙋 Respond</button>`
      }
      <button onclick="event.stopPropagation();openAlertDetail('${a.id}')" class="px-5 border border-border-base text-on-surface py-2.5 rounded-lg text-label-bold font-bold hover:bg-surface-secondary active:scale-95 transition-all">Details</button>
    </div>
  </div>`;
      }

