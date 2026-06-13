      // ─── COMMUNITY ───────────────────────────────────────────────────────────────
      function resourceIconMeta(type) {
        return {
          blood: { color: "#EF4444", icon: "bloodtype" },
          transport: { color: "#0062a0", icon: "directions_car" },
          food: { color: "#10B981", icon: "restaurant" },
          shelter: { color: "#D97706", icon: "home_work" },
          medicine: { color: "#9d4400", icon: "local_pharmacy" },
          equipment: { color: "#565e74", icon: "flashlight_on" },
        }[type] || { color: "#565e74", icon: "inventory_2" };
      }

      function resourceCardHTML(r, mode = "public") {
        const user = r.user || { full_name: "Unknown", is_verified: false };
        const meta = resourceIconMeta(r.type);
        const mine = r.user_id === STATE.user.id;
        const ownerName = user.full_name || user.display_name || "User";
        const ownerActions = `
          <button onclick="openEditResourceModal('${r.id}')" class="py-2 px-4 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-sm">edit</span>Edit</button>
          <button onclick="deleteResource('${r.id}')" class="py-2 px-4 border border-red-200 text-danger rounded-lg text-label-bold font-bold hover:bg-red-50 flex items-center gap-1"><span class="material-symbols-outlined text-sm">delete</span>Delete</button>
        `;
        const publicActions = mine
          ? `<button onclick="openMyResourcesModal()" class="py-2 px-4 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-sm">inventory</span>Manage</button>`
          : `<button onclick="callUser('${user.phone || ""}', '${ownerName}')" class="py-2 px-4 bg-success text-white rounded-lg text-label-bold font-bold flex items-center gap-1"><span class="material-symbols-outlined text-sm">call</span>Call</button>
             <button onclick="openResourceChat('${r.id}')" class="py-2 px-4 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-sm">chat</span>Message</button>`;
        return `<div class="bg-white border border-border-base rounded-xl p-4 shadow-card flex items-start gap-3">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style="background:${meta.color}1A">
            <span class="material-symbols-outlined" style="color:${meta.color};font-variation-settings:'FILL' 1">${meta.icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h5 class="text-body-lg text-on-surface font-semibold">${r.title}</h5>
                <p class="text-caption text-text-muted uppercase font-bold">${r.type || "resource"}</p>
              </div>
              ${mode === "mine" ? '<span class="text-caption font-bold bg-green-50 text-success border border-green-200 px-2 py-0.5 rounded-full">Active</span>' : ""}
            </div>
            <p class="text-body-md text-text-muted mt-1">${r.description || ""}</p>
            <div class="flex items-center gap-2 mt-2">
              ${userAvatar(user, "w-6 h-6")}<span class="text-caption text-text-muted">${mode === "mine" ? "Listed by you" : ownerName}</span>
              ${user.is_verified ? '<span class="material-symbols-outlined text-tertiary text-sm" style="font-variation-settings:\'FILL\' 1">verified</span>' : ""}
            </div>
            <div class="flex flex-wrap gap-2 mt-3">
              ${mode === "mine" ? ownerActions : publicActions}
            </div>
          </div>
        </div>`;
      }

      async function openMyResourcesModal() {
        openModal("my-resources-modal");
        await renderMyResources();
      }

      function openNewResourceModal() {
        editingResourceId = null;
        document.getElementById("resource-modal-title").textContent = "List a Resource";
        document.getElementById("resource-submit-btn").textContent = "Pin on Map";
        document.getElementById("res-type").value = "blood";
        document.getElementById("res-title").value = "";
        document.getElementById("res-desc").value = "";
        document.getElementById("res-until").value = "";
        openModal("post-resource-modal");
      }

      function openEditResourceModal(resourceId) {
        const resource = resourcesList.find((r) => r.id === resourceId);
        if (!resource) {
          showToast("Resource not found", "error");
          return;
        }
        editingResourceId = resourceId;
        document.getElementById("resource-modal-title").textContent = "Edit Resource";
        document.getElementById("resource-submit-btn").textContent = "Save Changes";
        document.getElementById("res-type").value = resource.type || "blood";
        document.getElementById("res-title").value = resource.title || "";
        document.getElementById("res-desc").value = resource.description || "";
        document.getElementById("res-until").value = resource.available_until
          ? new Date(resource.available_until).toISOString().slice(0, 16)
          : "";
        openModal("post-resource-modal");
      }

      async function renderMyResources() {
        const el = document.getElementById("my-resources-list");
        el.innerHTML = `<p class="text-center text-text-muted py-6">Loading resources...</p>`;
        try {
          const mine = await fetchJsonOrThrow(
            `/api/resources?mine=true&user_id=${STATE.user.id}`,
            {},
            "my resources",
          );
          resourcesList = [
            ...mine,
            ...resourcesList.filter((r) => r.user_id !== STATE.user.id),
          ];
          const threads = await loadResourceThreads();
          const ownerThreads = threads.filter((t) => t.owner_id === STATE.user.id && t.last_message != null);
          el.innerHTML = `
            <div class="space-y-3">
              ${mine.length ? mine.map((r) => resourceCardHTML(r, "mine")).join("") : '<p class="text-text-muted py-3">You have not listed any active resources.</p>'}
            </div>
            <h3 class="text-headline-md text-on-surface font-bold mt-5 mb-3">Private Requests</h3>
            <div class="space-y-2">
              ${ownerThreads.length ? ownerThreads.map(resourceThreadHTML).join("") : '<p class="text-text-muted py-3">No private requests yet.</p>'}
            </div>
          `;
        } catch (err) {
          console.error(err);
          el.innerHTML = `<p class="text-danger py-4">${err.message || "Failed to load resources"}</p>`;
        }
      }

      async function deleteResource(resourceId) {
        if (!confirm("Delete this resource listing?")) return;
        try {
          const r = await fetch(`/api/resources/${resourceId}?user_id=${STATE.user.id}`, {
            method: "DELETE",
          });
          if (!r.ok) {
            const err = await r.json();
            throw new Error(err.error || "Could not delete resource");
          }
          showToast("Resource deleted", "success");
          await loadData();
          await loadProfileStats();
          await renderMyResources();
        } catch (err) {
          console.error(err);
          showToast(err.message || "Failed to delete resource", "error");
        }
      }

      async function loadResourceThreads() {
        if (!STATE.user?.id) return [];
        try {
          resourceThreadsList = await fetchJsonOrThrow(
            `/api/resource-threads?user_id=${STATE.user.id}`,
            {},
            "resource conversations",
          );
          return resourceThreadsList;
        } catch (err) {
          console.error("Failed to load resource conversations:", err);
          return [];
        }
      }

      function resourceThreadHTML(thread) {
        const other =
          thread.owner_id === STATE.user.id ? thread.requester : thread.owner;
        const name = other?.full_name || other?.display_name || "User";
        const last = thread.last_message;
        const unread = thread.unread_count || 0;
        return `<button onclick="openResourceThread('${thread.id}')" class="w-full text-left bg-white border ${unread ? "border-tertiary" : "border-border-base"} rounded-xl p-3 shadow-card hover:bg-surface-container-low transition-colors">
          <div class="flex items-center gap-3">
            ${userAvatar(other, "w-9 h-9")}
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <p class="text-body-md font-bold text-on-surface truncate">${name}</p>
                ${unread ? `<span class="text-caption font-bold bg-tertiary text-white px-2 py-0.5 rounded-full">${unread}</span>` : ""}
              </div>
              <p class="text-caption text-text-muted truncate">${thread.resource?.title || "Resource request"}</p>
              <p class="text-caption text-text-muted truncate">${last ? last.content : "No messages yet"}</p>
            </div>
          </div>
        </button>`;
      }

      function renderCommunity() {
        const el = document.getElementById("community-content");
            el.innerHTML = `
    <!-- Communities -->
        ${STATE.user && STATE.user.user_type === 'ngo' ? `
        <div class="mb-4">
          <a href="/community.html?ngo_id=${STATE.user.id}" class="inline-block px-4 py-2 bg-primary text-white rounded-lg font-bold">Open Community Dashboard</a>
        </div>
        ` : ''}
    <h3 class="text-headline-md text-on-surface font-bold mb-3">Active Communities</h3>
    <div class="space-y-3 mb-6">
      ${
        communitiesList.length
          ? communitiesList
              .map(
                (c) => `
      <div class="bg-white border border-border-base rounded-xl p-4 shadow-card press-scale cursor-pointer">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-tertiary flex-shrink-0">
            <span class="material-symbols-outlined text-2xl" style="font-variation-settings:'FILL' 1">corporate_fare</span>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-1.5"><h4 class="text-body-lg text-on-surface font-bold">${c.org_name}</h4>${c.is_verified ? '<span class="material-symbols-outlined text-tertiary text-base" style="font-variation-settings:\'FILL\' 1">verified</span>' : ""}</div>
            <p class="text-caption text-text-muted font-mono">${c.id.slice(0, 8)}...</p>
          </div>
          <span class="text-caption font-bold bg-blue-50 text-tertiary border border-secondary-container px-2 py-0.5 rounded-full">${c.org_type || "NGO"}</span>
        </div>
        <div class="flex gap-4 text-caption font-mono text-text-muted mb-3">
          <span><span class="text-primary font-bold">${c.score || 0}</span> Points</span>
        </div>
        ${(() => {
          if (STATE.user?.user_type === 'ngo' && STATE.user?.id === c.id)
            return `<button disabled class="w-full py-2.5 bg-blue-50 text-tertiary border border-secondary-container rounded-lg text-label-bold font-bold cursor-default">Your Community</button>`;
          const ms = myMemberships[c.id];
          if (ms === 'approved')
            return `<button disabled class="w-full py-2.5 bg-green-50 text-success border border-green-200 rounded-lg text-label-bold font-bold cursor-default flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">check_circle</span>Member</button>`;
          if (ms === 'pending')
            return `<button disabled class="w-full py-2.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg text-label-bold font-bold cursor-default flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm">schedule</span>Request Sent</button>`;
          // Already part of (or pending with) a different community — members can only belong to one
          const inAnotherCommunity = Object.values(myMemberships).some((s) => s === 'approved' || s === 'pending');
          if (inAnotherCommunity)
            return `<button disabled title="Leave your current community to join a new one" class="w-full py-2.5 bg-surface-container-low text-text-muted border border-border-base rounded-lg text-label-bold font-bold cursor-not-allowed">Already in a Community</button>`;
          return `<button onclick="joinCommunity('${c.id}')" class="w-full py-2.5 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low transition-all">+ Request to Join</button>`;
        })()}
      </div>`,
              )
              .join("")
          : '<p class="text-text-muted py-4">No active communities found.</p>'
      }
    </div>

    <!-- Leaderboard -->
    <h3 class="text-headline-md text-on-surface font-bold mb-3">🏆 Area Leaderboard</h3>
    <div class="space-y-2 mb-6">
      ${
        leaderboardList.length
          ? leaderboardList
              .map((l, index) => {
                const rank = index + 1;
                const isMe = l.id === STATE.user.id;
                const rankStyle =
                  rank === 1
                    ? "text-yellow-500 font-black text-lg"
                    : rank === 2
                      ? "text-slate-400 font-black text-lg"
                      : rank === 3
                        ? "text-amber-700 font-black text-lg"
                        : "text-text-muted font-bold";
                const rankEmoji =
                  rank === 1
                    ? "🥇"
                    : rank === 2
                      ? "🥈"
                      : rank === 3
                        ? "🥉"
                        : rank;
                const badge =
                  l.badge ||
                  (l.score > 2000
                    ? "Hero"
                    : l.score > 1000
                      ? "Guardian"
                      : "New Helper");
                return `<div class="flex items-center gap-3 p-3.5 bg-white border ${isMe ? "border-primary-container/50 bg-orange-50" : "border-border-base"} rounded-xl shadow-card">
          <div class="w-8 text-center ${rankStyle}">${rankEmoji}</div>
          ${userAvatar(l, "w-10 h-10")}
          <div class="flex-1"><p class="text-body-md text-on-surface font-semibold">${l.full_name || l.display_name}${isMe ? ' <span class="text-caption font-bold bg-orange-100 text-primary px-2 py-0.5 rounded-full">You</span>' : ""}</p><p class="text-caption text-text-muted">${badge}</p></div>
          <p class="text-body-md text-primary font-extrabold">${(l.score || 0).toLocaleString()}</p>
        </div>`;
              })
              .join("")
          : '<p class="text-text-muted py-4">Leaderboard is empty.</p>'
      }
    </div>
    <div class="h-4"></div>
  `;
      }

