      // ─── ALERTS ──────────────────────────────────────────────────────────────────
      function renderAlerts(seg) {
        let list = [];
        if (seg === "mine") {
          list = alertsList.filter((a) => a.user_id === STATE.user.id);
        } else if (seg === "responding") {
          list = alertsList.filter((a) =>
            (a.responder_user_ids || []).includes(STATE.user.id),
          );
        } else {
          list = alertsList;
        }

        document.getElementById("alerts-list").innerHTML = list.length
          ? list.map((a) => alertCardHTML(a)).join("")
          : `<div class="text-center py-12 text-text-muted"><span class="material-symbols-outlined text-5xl block mb-3">inbox</span><p class="text-body-md">No alerts in this view</p></div>`;
      }

      function switchAlertSeg(seg, btn) {
        document.querySelectorAll("#panel-alerts .flex button").forEach((b) => {
          b.className =
            "flex-1 py-2 rounded-lg text-label-bold font-bold text-on-surface-variant hover:bg-surface-container-high transition-all";
        });
        if (btn)
          btn.className =
            "flex-1 py-2 rounded-lg text-label-bold font-bold text-primary bg-white shadow-sm transition-all";
        renderAlerts(seg);
      }

      // ─── ALERT DETAIL ────────────────────────────────────────────────────────────
      function openAlertDetail(id) {
        const a = alertsList.find((x) => x.id === id);
        if (!a) return;
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

        document.getElementById("alert-detail-content").innerHTML = `
    <div class="flex items-start gap-2 mb-4">
      <h2 class="text-headline-md text-on-surface font-bold flex-1">${a.title}</h2>
      <span class="risk-pill ${riskBg} flex-shrink-0">${(a.risk_level || "medium").toUpperCase()}</span>
    </div>
    <p class="text-body-md text-on-surface-variant mb-4">${a.description}</p>
    <div class="flex flex-wrap gap-2 mb-4">
      <span class="text-caption font-bold bg-blue-50 text-tertiary px-3 py-1 rounded-full">📍 ${dist} km away</span>
      <span class="text-caption font-bold bg-orange-50 text-primary px-3 py-1 rounded-full">🕐 ${timeStr}</span>
      ${(() => {
        const iAmResponding = (a.responder_user_ids || []).includes(STATE.user.id);
        const isTaken = responderCount > 0;
        if (iAmResponding)
          return `<span class="text-caption font-bold bg-green-50 text-success px-3 py-1 rounded-full">✅ You're responding</span>`;
        if (isTaken)
          return `<span class="text-caption font-bold bg-surface-container text-text-muted px-3 py-1 rounded-full">🔒 Taken</span>`;
        return `<span class="text-caption font-bold bg-blue-50 text-tertiary px-3 py-1 rounded-full">🙋 Needs responder</span>`;
      })()}
    </div>

    <!-- Poster contact card -->
    <div class="bg-surface-container-low border border-outline-variant rounded-xl p-4 mb-4">
      <p class="text-caption text-text-muted font-bold uppercase mb-2">Posted By</p>
      ${
        a.is_anonymous
          ? `<div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center"><span class="material-symbols-outlined text-outline">person</span></div><div><p class="text-body-md text-on-surface font-semibold">Anonymous</p><p class="text-caption text-text-muted">Identity hidden by poster</p></div></div>`
          : `<div class="flex items-center gap-3">${userAvatar(user, "w-10 h-10")}<div class="flex-1"><p class="text-body-md text-on-surface font-semibold">${user.full_name || user.display_name}</p>
            ${
              (a.user_id === STATE.user.id || (a.responder_user_ids || []).includes(STATE.user.id))
                ? `<p class="text-caption text-text-muted font-mono">${user.phone || "No phone on file"}</p>`
                : `<p class="text-caption text-text-muted flex items-center gap-1"><span class="material-symbols-outlined text-xs">lock</span>Phone hidden — respond to reveal</p>`
            }
          </div>${user.is_verified ? '<span class="material-symbols-outlined text-tertiary" style="font-variation-settings:\'FILL\' 1">verified</span>' : ""}</div>
          ${
            (a.user_id === STATE.user.id || (a.responder_user_ids || []).includes(STATE.user.id))
              ? `<div class="flex gap-2 mt-3">
                  <button onclick="callUser('${user.phone}', '${user.full_name || user.display_name}')" class="flex-1 py-2.5 bg-success text-white rounded-lg text-label-bold font-bold active:scale-95 transition-all flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm">call</span>Call</button>
                  <button onclick="openChat('${a.id}')" class="flex-1 py-2.5 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm">chat</span>Message</button>
                </div>`
              : ``
          }`
      }
    </div>

    <div class="grid grid-cols-2 gap-3">
      ${
        a.user_id === STATE.user.id
          ? `<button onclick="resolveAlert('${a.id}');closeModal('alert-detail-modal')" class="press-scale py-3 bg-success text-white rounded-xl font-bold text-body-md flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm">check_circle</span>Mark Resolved</button>`
          : (a.responder_user_ids || []).includes(STATE.user.id)
            ? `<button onclick="navigateToAlert('${a.lat}','${a.lng}','${(a.title||"").replace(/'/g,"")}');closeModal('alert-detail-modal')" class="press-scale py-3 bg-blue-600 text-white rounded-xl font-bold text-body-md flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">navigation</span>Directions</button>
              <button onclick="withdrawFromAlert('${a.id}');closeModal('alert-detail-modal')" class="press-scale py-3 bg-orange-100 text-orange-700 border border-orange-200 rounded-xl font-bold text-body-md flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm">undo</span>Withdraw</button>`
            : (a.responder_count || 0) > 0
              ? `<button disabled class="press-scale py-3 bg-surface-container text-text-muted rounded-xl font-bold text-body-md cursor-not-allowed opacity-60">🔒 Already Taken</button>`
              : `<button onclick="respondToAlert('${a.id}');closeModal('alert-detail-modal')" class="press-scale py-3 bg-primary-container text-white rounded-xl font-bold text-body-md">🙋 Respond</button>`
      }
      <button onclick="reportEmergency('${a.id}', '${a.user_id || ""}');closeModal('alert-detail-modal')" class="press-scale py-3 border border-border-base text-on-surface rounded-xl font-bold text-body-md hover:bg-red-50 hover:border-danger/30 hover:text-danger transition-all">🚩 Report</button>
    </div>`;
        openModal("alert-detail-modal");
      }

      async function respondToAlert(id) {
        showToast("Registering response…", "info");
        try {
          const payload = {
            lat: STATE.userLat,
            lng: STATE.userLng,
            user_id: STATE.user.id,
          };
          const r = await fetch(`/api/emergencies/${id}/respond`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            const data = await r.json();
            showToast(
              data.community_name
                ? `✅ You're responding on behalf of ${data.community_name}!`
                : "✅ You are now responding! Poster's contact is now visible.",
              "success",
            );
            await loadData();
            await loadProfileStats();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to register response", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to register response", "error");
        }
      }

      async function withdrawFromAlert(id) {
        if (!confirm(
          "⚠️ Withdraw from this alert?\n\n" +
          "• The alert will reappear for others to respond to.\n" +
          "• You will lose your response bonus + a 50-point abandonment penalty.\n\n" +
          "Only withdraw if you genuinely cannot help. There is NO penalty for simply not responding to an alert."
        )) return;
        showToast("Withdrawing…", "info");
        try {
          const r = await fetch(`/api/emergencies/${id}/withdraw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: STATE.user.id }),
          });
          if (r.ok) {
            const data = await r.json();
            const penalty = data.penalty || "";
            showToast(
              penalty
                ? `↩ Withdrawn. -${penalty} points applied as abandonment penalty.`
                : "↩ Withdrawn. The alert is open again.",
              "warning"
            );
            await loadData();
            await loadProfileStats();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to withdraw", "error");
          }
        } catch (err) {
          showToast("Failed to withdraw", "error");
        }
      }

      async function resolveAlert(id) {
        if (!confirm("Mark this alert as resolved? It will be removed from the public feed.")) return;
        showToast("Resolving alert…", "info");
        try {
          const r = await fetch(`/api/emergencies/${id}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: STATE.user.id }),
          });
          if (r.ok) {
            showToast("✅ Alert resolved and removed from feed.", "success");
            await loadData();
            await loadProfileStats();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to resolve alert", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to resolve alert", "error");
        }
      }

      async function leaveCommunity() {
        const ngoId = STATE.user?.community_id;
        if (!ngoId) return;
        if (!confirm("Leave this community? You can join a different one afterwards.")) return;
        try {
          const r = await fetch(`/api/communities/${ngoId}/leave`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: STATE.user.id }),
          });
          if (r.ok) {
            delete myMemberships[ngoId];
            STATE.user.community_id = null;
            STATE.user.community_name = null;
            STATE.user.community_status = null;
            updateProfileCommunityBadge();
            showToast("You've left the community", "success");
            if (STATE.currentTab === "community") renderCommunity();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to leave community", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to leave community", "error");
        }
      }

      async function joinCommunity(ngoId) {
        showToast("Submitting join request…", "info");
        try {
          const r = await fetch(`/api/communities/${ngoId}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: STATE.user.id }),
          });
          if (r.ok) {
            const data = await r.json();
            // Optimistically update local state so the button changes immediately
            myMemberships[ngoId] = data.status || "pending";
            showToast("✅ Request sent! Waiting for leader approval.", "success");
            renderCommunity();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to submit join request", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to submit join request", "error");
        }
      }

      async function reportEmergency(eid, posterId) {
        const reason = prompt(
          "Enter reason for reporting (e.g. False Alarm, Spam, Inappropriate):",
        );
        if (!reason) return;
        const desc = prompt("Enter additional details (optional):") || "";

        showToast("Submitting report…", "info");
        try {
          const payload = {
            emergency_id: eid,
            reported_user: posterId || null,
            reason: reason,
            description: desc,
            user_id: STATE.user.id,
          };
          const r = await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            showToast("Report submitted for review", "success");
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to submit report", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to submit report", "error");
        }
      }

      // ─── CHAT MESSAGING ─────────────────────────────────────────────────────────
      let currentChatEmergencyId = null;
      let currentResourceThreadId = null;
      let currentChatMode = "emergency";
      let chatTimer = null;

      async function openChat(emergencyId) {
        closeModal("alert-detail-modal");
        closeMapPopup();

        currentChatMode = "emergency";
        currentChatEmergencyId = emergencyId;
        currentResourceThreadId = null;
        const alertItem =
          alertsList.find((a) => a.id === emergencyId);
        const title = alertItem ? alertItem.title : "Emergency Coordination";
        document.getElementById("chat-title").textContent = title;

        openModal("chat-modal");
        await refreshChatMessages();

        clearInterval(chatTimer);
        chatTimer = setInterval(refreshChatMessages, 4000);
      }

      async function openResourceChat(resourceId) {
        closeModal("alert-detail-modal");
        closeMapPopup();
        currentChatMode = "resource";
        currentChatEmergencyId = null;
        try {
          const r = await fetch(`/api/resources/${resourceId}/threads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: STATE.user.id }),
          });
          if (!r.ok) {
            const err = await r.json();
            throw new Error(err.error || "Could not open resource chat");
          }
          const thread = await r.json();
          await openResourceThread(thread.id);
        } catch (err) {
          console.error(err);
          showToast(err.message || "Failed to open resource chat", "error");
        }
      }

      async function openResourceThread(threadId) {
        closeMapPopup();
        currentChatMode = "resource";
        currentChatEmergencyId = null;
        currentResourceThreadId = threadId;
        const thread =
          resourceThreadsList.find((t) => t.id === threadId) ||
          (await fetchJsonOrThrow(
            `/api/resource-threads?user_id=${STATE.user.id}`,
            {},
            "resource conversations",
          )).find((t) => t.id === threadId);
        if (thread) {
          const other =
            thread.owner_id === STATE.user.id ? thread.requester : thread.owner;
          document.getElementById("chat-title").textContent =
            `${thread.resource?.title || "Resource"} - ${other?.full_name || other?.display_name || "User"}`;
        } else {
          document.getElementById("chat-title").textContent = "Resource Chat";
        }
        openModal("chat-modal");
        await refreshChatMessages();
        clearInterval(chatTimer);
        chatTimer = setInterval(refreshChatMessages, 4000);
      }

      async function refreshChatMessages() {
        if (
          (!currentChatEmergencyId && !currentResourceThreadId) ||
          !document.getElementById("chat-modal").classList.contains("show")
        ) {
          clearInterval(chatTimer);
          return;
        }

        try {
          const url =
            currentChatMode === "resource"
              ? `/api/resource-threads/${currentResourceThreadId}/messages?user_id=${STATE.user.id}`
              : `/api/emergencies/${currentChatEmergencyId}/messages`;
          const r = await fetch(url);
          if (r.ok) {
            const messages = await r.json();
            const chatBody = document.getElementById("chat-messages");
            if (messages.length === 0) {
              chatBody.innerHTML = `<p class="text-center text-text-muted py-10">No messages yet. Send a message to coordinate.</p>`;
              return;
            }

            chatBody.innerHTML = messages
              .map((msg) => {
                const isMe = msg.user_id === STATE.user.id;
                const bubbleBg = isMe
                  ? "bg-primary-container text-white self-end"
                  : "bg-surface-container-high text-on-surface self-start";
                const wrapperClass = isMe
                  ? "flex flex-col items-end"
                  : "flex flex-col items-start";
                const name = isMe ? "You" : msg.display_name;
                const timeStr = new Date(msg.created_at).toLocaleTimeString(
                  [],
                  { hour: "2-digit", minute: "2-digit" },
                );

                return `
          <div class="${wrapperClass} w-full flex-shrink-0">
            <span class="text-caption text-text-muted font-bold px-1 mb-0.5">${name}</span>
            <div class="${bubbleBg} rounded-xl px-3 py-2 max-w-xs text-body-md shadow-sm">
              ${msg.content}
            </div>
            <span class="text-caption text-text-muted font-mono mt-0.5 px-1">${timeStr}</span>
          </div>
        `;
              })
              .join("");

            chatBody.scrollTop = chatBody.scrollHeight;
          }
        } catch (err) {
          console.error("Failed to load chat messages:", err);
        }
      }

      async function sendChatMessage() {
        const inputEl = document.getElementById("chat-input");
        const text = inputEl.value.trim();
        if (!text || (!currentChatEmergencyId && !currentResourceThreadId)) return;

        inputEl.value = "";
        try {
          const url =
            currentChatMode === "resource"
              ? `/api/resource-threads/${currentResourceThreadId}/messages`
              : `/api/emergencies/${currentChatEmergencyId}/messages`;
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: text,
              display_name:
                STATE.user.full_name || STATE.user.display_name || "User",
              user_id: STATE.user.id,
            }),
          });
          if (r.ok) {
            await refreshChatMessages();
          } else {
            showToast("Could not send message", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to send message", "error");
        }
      }

