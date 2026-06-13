      // ─── ADMIN ───────────────────────────────────────────────────────────────────
      function switchAdminTab(tab, btn) {
        document.querySelectorAll(".admin-chip").forEach((c) => {
          c.className =
            "whitespace-nowrap px-4 py-2 rounded-full text-label-bold font-bold bg-surface-container text-on-surface-variant admin-chip";
        });
        btn.className =
          "whitespace-nowrap px-4 py-2 rounded-full text-label-bold font-bold bg-primary-container text-white admin-chip";
        STATE.currentAdminTab = tab;
        ({
          overview: renderAdminOverview,
          users: renderAdminUsers,
          reports: renderAdminReports,
          activity: renderAdminActivity,
          sos: renderAdminSOS,
        })[tab]?.();
      }

      function adminMetric(val, label, color, delta, up) {
        return `<div class="bg-white border border-border-base rounded-xl p-4 shadow-card">
    <p class="text-caption text-text-muted uppercase font-bold mb-1">${label}</p>
    <p class="text-stat-lg font-extrabold" style="color:${color}">${val}</p>
    ${delta ? `<p class="text-caption mt-1 ${up ? "text-success" : "text-danger"} font-bold">${up ? "↑" : "↓"} ${delta}</p>` : ""}
  </div>`;
      }

      async function renderAdminOverview() {
        const contentEl = document.getElementById("admin-content");
        contentEl.innerHTML = `<p class="text-center py-10 text-text-muted">Loading overview metrics…</p>`;

        try {
          const stats = await fetchJsonOrThrow(
            "/api/admin/stats",
            { headers: { "X-Admin-Token": STATE.token } },
            "admin stats",
          );

          const emergencies = await fetchJsonOrThrow(
            "/api/admin/emergencies",
            { headers: { "X-Admin-Token": STATE.token } },
            "admin emergencies",
          );

          contentEl.innerHTML = `
      <div class="grid grid-cols-2 gap-3 mb-5">
        ${adminMetric(stats.total_users || 0, "Total Users", "#0097a7", "", "")}
        ${adminMetric(stats.total_emergencies || 0, "Total Alerts", "#EF4444", "", "")}
        ${adminMetric(stats.total_resources || 0, "Total Resources", "#10B981", "", "")}
        ${adminMetric(stats.active_sos || 0, "Active SOS Events", "#EF4444", "", "")}
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <h3 class="text-body-lg font-bold text-on-surface mb-3">Recent Alerts</h3>
          <div class="bg-white border border-border-base rounded-xl overflow-hidden shadow-card overflow-x-auto">
            <table class="admin-table">
              <thead><tr><th>Title</th><th>Risk</th><th>Status</th></tr></thead>
              <tbody>${
                emergencies.length
                  ? emergencies
                      .slice(0, 5)
                      .map(
                        (a) => `<tr>
                <td class="text-on-surface font-medium max-w-32 truncate">${a.title}</td>
                <td><span class="risk-pill ${getRiskBg(a.risk_level)}">${a.risk_level}</span></td>
                <td><span class="flex items-center gap-1 text-success text-caption font-bold"><span style="width:6px;height:6px;border-radius:50%;background:#10B981;display:inline-block"></span>${a.status}</span></td>
              </tr>`,
                      )
                      .join("")
                  : '<tr><td colspan="3" class="text-center py-4 text-text-muted">No emergencies found</td></tr>'
              }</tbody>
            </table>
          </div>
        </div>
        
        <div>
          <h3 class="text-body-lg font-bold text-danger mb-3">⚠️ Unusual Activities</h3>
          <div class="space-y-3">
            <div class="flex items-start gap-2.5 p-3 rounded-xl bg-orange-50 border border-orange-100 shadow-sm">
              <span class="material-symbols-outlined text-danger text-lg mt-0.5">warning</span>
              <div class="flex-1 min-w-0">
                <p class="text-body-md text-on-surface-variant leading-snug">No unusual security anomalies detected on the platform currently.</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;
        } catch (err) {
          console.error(err);
          contentEl.innerHTML = `<p class="text-center py-10 text-danger">Failed to load admin overview</p>`;
        }
      }

      async function renderAdminUsers() {
        const contentEl = document.getElementById("admin-content");
        contentEl.innerHTML = `<p class="text-center py-10 text-text-muted">Loading user accounts…</p>`;

        try {
          const r = await fetch("/api/admin/users", {
            headers: { "X-Admin-Token": STATE.token },
          });
          if (!r.ok) throw new Error("Unauthorized or server error");
          const users = await r.json();

          const reportedUsers = users
            .filter((u) => (u.strikes || 0) > 0 || u.is_suspended)
            .sort((a, b) => (b.strikes || 0) - (a.strikes || 0));

          contentEl.innerHTML = `
      <div class="flex gap-2 mb-4">
        <input id="admin-user-search" class="flex-1 px-4 py-2.5 rounded-lg border border-border-base bg-white text-body-md text-on-surface" placeholder="🔍 Search by name, email, phone…" oninput="filterAdminUsersList(this.value)">
      </div>
      
      <!-- Flagged Accounts Box -->
      <div class="mb-5 bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span class="material-symbols-outlined text-danger">report</span>
          <h4 class="text-body-lg font-bold text-danger">Flagged Accounts / Strikes</h4>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${
            reportedUsers.length
              ? reportedUsers
                  .slice(0, 4)
                  .map(
                    (ru) => `
            <div class="bg-white border border-red-100 rounded-lg p-3 flex justify-between items-center shadow-sm">
              <div class="flex items-center gap-2.5 min-w-0">
                ${userAvatar(ru, "w-9 h-9")}
                <div class="min-w-0">
                  <p class="text-body-md text-on-surface font-bold truncate">${ru.full_name || ru.display_name}</p>
                  <p class="text-caption font-bold text-danger">${ru.strikes || 0} strikes recorded</p>
                </div>
              </div>
              <div style="display:flex;gap:4px;">
                ${!ru.is_suspended ? `<button onclick="adminActionUser('${ru.id}', 'suspend')" class="px-2.5 py-1 bg-yellow-100 text-yellow-800 text-caption font-bold rounded hover:bg-yellow-200">Suspend</button>` : `<button onclick="adminActionUser('${ru.id}', 'unsuspend')" class="px-2.5 py-1 bg-green-100 text-green-800 text-caption font-bold rounded hover:bg-green-200">Activate</button>`}
              </div>
            </div>
          `,
                  )
                  .join("")
              : '<p class="text-caption text-text-muted">No flagged accounts at this moment.</p>'
          }
        </div>
      </div>
      
      <!-- Complete Users List -->
      <h4 class="text-body-md font-bold text-on-surface mb-2.5">All Accounts (Individuals & Communities)</h4>
      <div class="bg-white border border-border-base rounded-xl overflow-hidden shadow-card overflow-x-auto">
        <table class="admin-table">
          <thead><tr><th>User</th><th>Type</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="admin-users-table-body">${users
            .map((u) => {
              let statusText = u.is_suspended ? "Suspended" : "Active";
              let statusColor = u.is_suspended
                ? "text-yellow-600"
                : "text-success";
              return `<tr class="admin-user-row" data-name="${(u.full_name || u.display_name || "").toLowerCase()}" data-email="${(u.email || "").toLowerCase()}">
              <td><div class="flex items-center gap-2">${userAvatar(u, "w-7 h-7")}<div><p class="text-on-surface font-semibold">${u.full_name || u.display_name}</p><p class="text-caption text-text-muted font-mono">${u.phone || u.email || ""}</p></div></div></td>
              <td><span class="text-caption font-bold ${u.user_type === "ngo" ? "bg-blue-100 text-tertiary" : "bg-green-100 text-success"} px-2 py-0.5 rounded-full">${u.user_type === "ngo" ? "Community" : "Individual"}</span></td>
              <td class="font-bold text-text-muted font-mono">${u.score || 0}</td>
              <td><span class="text-caption font-bold ${statusColor}">● ${statusText}</span></td>
              <td>
                <div class="flex gap-2">
                  ${u.is_suspended ? `<button onclick="adminActionUser('${u.id}', 'unsuspend')" class="text-success text-caption font-bold hover:underline">Activate</button>` : `<button onclick="adminActionUser('${u.id}', 'suspend')" class="text-yellow-600 text-caption font-bold hover:underline">Suspend</button>`}
                </div>
              </td>
            </tr>`;
            })
            .join("")}</tbody>
        </table>
      </div>`;
        } catch (err) {
          console.error(err);
          contentEl.innerHTML = `<p class="text-center py-10 text-danger">Failed to load users list</p>`;
        }
      }

      function filterAdminUsersList(val) {
        const query = val.toLowerCase().trim();
        document.querySelectorAll(".admin-user-row").forEach((row) => {
          const name = row.getAttribute("data-name");
          const email = row.getAttribute("data-email");
          if (name.includes(query) || email.includes(query)) {
            row.style.display = "";
          } else {
            row.style.display = "none";
          }
        });
      }

      async function adminActionUser(userId, action) {
        showToast(
          `${action === "suspend" ? "Suspending" : "Activating"} user…`,
          "info",
        );
        try {
          const r = await fetch(`/api/admin/users/${userId}/${action}`, {
            method: "POST",
            headers: { "X-Admin-Token": STATE.token },
          });
          if (r.ok) {
            showToast(`User account updated successfully`, "success");
            await renderAdminUsers();
          } else {
            showToast("Failed to update user status", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to update user status", "error");
        }
      }

      async function renderAdminReports() {
        const contentEl = document.getElementById("admin-content");
        contentEl.innerHTML = `<p class="text-center py-10 text-text-muted">Loading pending reports…</p>`;

        try {
          const reports = await fetchJsonOrThrow(
            "/api/admin/reports",
            { headers: { "X-Admin-Token": STATE.token } },
            "admin reports",
          );

          contentEl.innerHTML = `
      <h3 class="text-body-lg font-bold text-on-surface mb-3">Pending Incident & Abuse Reports</h3>
      <div class="bg-white border border-border-base rounded-xl overflow-hidden shadow-card overflow-x-auto">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Reason</th><th>Description</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>${
            reports.length
              ? reports
                  .map(
                    (rep) => `<tr>
            <td class="font-mono text-caption">${rep.id.slice(0, 8)}...</td>
            <td class="text-on-surface font-semibold">${rep.reason}</td>
            <td class="text-on-surface-variant max-w-xs truncate">${rep.description || ""}</td>
            <td><span class="text-caption font-bold text-yellow-600">● ${rep.status}</span></td>
            <td class="text-text-muted font-mono">${formatTimeAgo(rep.created_at)}</td>
          </tr>`,
                  )
                  .join("")
              : '<tr><td colspan="5" class="text-center py-6 text-text-muted">No pending reports found.</td></tr>'
          }</tbody>
        </table>
      </div>`;
        } catch (err) {
          console.error(err);
          contentEl.innerHTML = `<p class="text-center py-10 text-danger">Failed to load reports</p>`;
        }
      }

      async function renderAdminActivity() {
        const contentEl = document.getElementById("admin-content");
        contentEl.innerHTML = `<p class="text-center py-10 text-text-muted">Loading activity log…</p>`;

        try {
          const logs = await fetchJsonOrThrow(
            "/api/admin/activity",
            { headers: { "X-Admin-Token": STATE.token } },
            "admin activity",
          );

          contentEl.innerHTML = `
      <h3 class="text-body-lg font-bold text-on-surface mb-3">Platform Activity Log</h3>
      <div class="bg-white border border-border-base rounded-xl overflow-hidden shadow-card overflow-x-auto mb-5">
        <table class="admin-table">
          <thead><tr><th>Action</th><th>Location</th><th>Time</th></tr></thead>
          <tbody>${
            logs.length
              ? logs
                  .map(
                    (l) => `<tr>
            <td class="text-on-surface">${l.action}</td>
            <td class="font-mono text-caption">${l.lat ? l.lat.toFixed(4) + ", " + l.lng.toFixed(4) : "-"}</td>
            <td class="font-mono text-caption">${formatTimeAgo(l.created_at)}</td>
          </tr>`,
                  )
                  .join("")
              : '<tr><td colspan="3" class="text-center py-6 text-text-muted">No activities recorded in log.</td></tr>'
          }</tbody>
        </table>
      </div>`;
        } catch (err) {
          console.error(err);
          contentEl.innerHTML = `<p class="text-center py-10 text-danger">Failed to load activity logs</p>`;
        }
      }

      async function renderAdminSOS() {
        const contentEl = document.getElementById("admin-content");
        contentEl.innerHTML = `<p class="text-center py-10 text-text-muted">Loading SOS events…</p>`;

        try {
          const sosEvents = await fetchJsonOrThrow(
            "/api/admin/sos",
            { headers: { "X-Admin-Token": STATE.token } },
            "admin SOS events",
          );

          contentEl.innerHTML = `
      <h3 class="text-body-lg font-bold text-on-surface mb-3">SOS Emergency Broadcasts</h3>
      <div class="bg-white border border-border-base rounded-xl overflow-hidden shadow-card overflow-x-auto">
        <table class="admin-table">
          <thead><tr><th>Event ID</th><th>Status</th><th>Location</th><th>Time</th><th>Cancelled?</th></tr></thead>
          <tbody>${
            sosEvents.length
              ? sosEvents
                  .map(
                    (e) => `<tr>
            <td class="font-mono text-caption">${e.id.slice(0, 8)}...</td>
            <td><span class="text-caption font-bold ${e.is_active ? "text-danger" : "text-success"}">● ${e.is_active ? "Active" : "Inactive"}</span></td>
            <td class="font-mono text-caption">${e.lat.toFixed(4) + ", " + e.lng.toFixed(4)}</td>
            <td class="font-mono text-caption">${formatTimeAgo(e.created_at)}</td>
            <td>${e.cancelled_within_60s ? "Yes (&lt;60s)" : "No"}</td>
          </tr>`,
                  )
                  .join("")
              : '<tr><td colspan="5" class="text-center py-6 text-text-muted">No SOS events recorded.</td></tr>'
          }</tbody>
        </table>
      </div>`;
        } catch (err) {
          console.error(err);
          contentEl.innerHTML = `<p class="text-center py-10 text-danger">Failed to load SOS events</p>`;
        }
      }

