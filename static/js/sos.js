      // ─── SOS ─────────────────────────────────────────────────────────────────────
      function selectSosScope(scope, el) {
        document.querySelectorAll(".sos-opt").forEach((o) => {
          o.className =
            "sos-opt border-2 border-border-base bg-white rounded-xl p-4 text-center cursor-pointer transition-all hover:border-danger/40";
        });
        el.className =
          "sos-opt border-2 border-danger bg-red-50 rounded-xl p-4 text-center cursor-pointer transition-all";
      }

      let activeSosId = null;

      async function triggerSOS() {
        closeModal("sos-modal");
        showToast("🆘 Sending SOS…", "info");
        try {
          const r = await fetch("/api/sos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: STATE.userLat,
              lng: STATE.userLng,
              user_id: STATE.user.id,
            }),
          });
          const result = await r.json();
          if (r.ok) {
            activeSosId = result.sos_id;
            showToast("🆘 SOS sent! Emergency services alerted.", "error");

            try {
              const a = new AudioContext(),
                o = a.createOscillator();
              o.frequency.value = 880;
              o.connect(a.destination);
              o.start();
              setTimeout(() => o.stop(), 400);
            } catch {}
          } else {
            showToast(result.error || "Failed to send SOS", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to send SOS", "error");
        }
      }

      async function cancelSOS() {
        if (!activeSosId) return;
        showToast("Cancelling SOS…", "info");
        try {
          const r = await fetch(`/api/sos/${activeSosId}/cancel`, {
            method: "POST",
          });
          if (r.ok) {
            showToast("SOS cancelled successfully", "success");
            activeSosId = null;
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to cancel SOS", "error");
        }
      }

      // ─── MODAL ───────────────────────────────────────────────────────────────────
      async function loadSosContacts() {
        if (!STATE.user?.id) return;
        const listEl = document.getElementById("sos-contacts-list");
        listEl.innerHTML = `<p class="text-center text-text-muted text-body-md py-3">Loading contacts...</p>`;
        try {
          const r = await fetch(`/api/sos-contacts?user_id=${STATE.user.id}`);
          const contacts = r.ok ? await r.json() : [];
          listEl.innerHTML = contacts.length
            ? contacts
                .map((row) => {
                  const user = row.contact || {};
                  const name = user.full_name || user.display_name || "ResQGrid user";
                  return `<div class="user-contact-card">
            ${userAvatar(user, "w-10 h-10")}
            <div class="flex-1 min-w-0">
              <p class="text-body-md font-bold text-on-surface truncate">${name}</p>
              <p class="text-caption text-text-muted font-mono">${user.phone || "No phone"} ${user.is_verified ? ". verified" : ""}</p>
            </div>
            <button onclick="removeSosContact('${row.id}')" class="text-danger"><span class="material-symbols-outlined">delete</span></button>
          </div>`;
                })
                .join("")
            : `<p class="text-center text-text-muted text-body-md py-3" id="sos-contacts-empty">No SOS contacts added yet.</p>`;
        } catch (err) {
          console.error(err);
          listEl.innerHTML = `<p class="text-center text-danger text-body-md py-3">Could not load contacts.</p>`;
        }
      }

      async function searchSosUser() {
        const val = document.getElementById("sos-contact-input").value.trim();
        const resultEl = document.getElementById("sos-user-search-result");
        if (val.length < 3) {
          showToast("Enter at least 3 characters", "error");
          return;
        }
        resultEl.classList.remove("hidden");
        resultEl.innerHTML = `<p class="text-center text-text-muted text-body-md py-3">Searching...</p>`;
        try {
          const r = await fetch(`/api/users/search?q=${encodeURIComponent(val)}`);
          sosSearchResults = r.ok ? await r.json() : [];
          resultEl.innerHTML = sosSearchResults.length
            ? sosSearchResults
                .map((user, index) => {
                  const name = user.full_name || user.display_name || "ResQGrid user";
                  return `<div class="user-contact-card cursor-pointer hover:border-primary-container transition-all" onclick="addSosContact(${index})">
            ${userAvatar(user, "w-10 h-10")}
            <div class="flex-1 min-w-0">
              <p class="text-body-md font-bold text-on-surface truncate">${name}</p>
              <p class="text-caption text-text-muted font-mono">${user.phone || ""} ${user.is_verified ? ". verified" : ""}</p>
            </div>
            <span class="material-symbols-outlined text-primary-container">add_circle</span>
          </div>`;
                })
                .join("")
            : `<p class="text-center text-text-muted text-body-md py-3">No matching registered user found.</p>`;
        } catch (err) {
          console.error(err);
          resultEl.innerHTML = `<p class="text-center text-danger text-body-md py-3">Search failed.</p>`;
        }
      }

      async function addSosContact(index) {
        const user = sosSearchResults[index];
        if (!user) return;
        try {
          const r = await fetch("/api/sos-contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: STATE.user.id,
              contact_user_id: user.id,
            }),
          });
          const result = await r.json().catch(() => ({}));
          if (!r.ok) {
            showToast(result.error || "Could not add SOS contact", "error");
            return;
          }
          document.getElementById("sos-user-search-result").classList.add("hidden");
          document.getElementById("sos-contact-input").value = "";
          showToast("SOS contact added", "success");
          await loadSosContacts();
        } catch (err) {
          console.error(err);
          showToast("Could not add SOS contact", "error");
        }
      }

      async function removeSosContact(contactId) {
        try {
          const r = await fetch(`/api/sos-contacts/${contactId}?user_id=${STATE.user.id}`, {
            method: "DELETE",
          });
          if (r.ok) {
            showToast("SOS contact removed", "success");
            await loadSosContacts();
          } else {
            showToast("Could not remove SOS contact", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Could not remove SOS contact", "error");
        }
      }

      function openModal(id) {
        document.getElementById(id).classList.add("show");
        document.body.style.overflow = "hidden";
        if (id === "sos-contacts-modal") {
          document.getElementById("sos-contact-input").value = "";
          const resultEl = document.getElementById("sos-user-search-result");
          resultEl.innerHTML = "";
          resultEl.classList.add("hidden");
          loadSosContacts();
        }
      }
      function closeModal(id) {
        document.getElementById(id).classList.remove("show");
        document.body.style.overflow = "";
      }
      document.querySelectorAll(".modal-overlay").forEach((m) =>
        m.addEventListener("click", (e) => {
          if (e.target === m) closeModal(m.id);
        }),
      );

      // ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
      function toggleNotif() {
        const panel = document.getElementById("notif-panel");
        panel.classList.toggle("show");
        if (panel.classList.contains("show")) {
          _renderNotifList();
          const badge = document.getElementById("notif-badge");
          badge.style.display = "none";
          badge.classList.add("hidden");
        }
      }

      // ─── TOAST ───────────────────────────────────────────────────────────────────
      function showToast(msg, type = "info") {
        const t = document.getElementById("toast");
        t.textContent = msg;
        t.className = `toast ${type} show`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
      }

      // ─── SELECT CAT ──────────────────────────────────────────────────────────────
      function selectCat(el) {
        document
          .querySelectorAll(".cat-chip")
          .forEach((c) => c.classList.remove("selected"));
        el.classList.add("selected");
      }

