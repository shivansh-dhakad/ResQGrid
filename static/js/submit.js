      // ─── AI CLASSIFY ─────────────────────────────────────────────────────────────
      let aiTimer = null;
      async function aiClassify(text) {
        if (text.length < 15) return;
        clearTimeout(aiTimer);
        aiTimer = setTimeout(async () => {
          const el = document.getElementById("ai-risk-result");
          const txt = document.getElementById("ai-risk-text");
          el.style.display = "flex";
          txt.textContent = "Analysing your emergency…";
          try {
            const r = await fetch("/api/classify-alert", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ description: text }),
            });
            if (r.ok) {
              const d = await r.json();
              const c =
                {
                  critical: "text-danger",
                  high: "text-orange-600",
                  medium: "text-yellow-600",
                  low: "text-success",
                }[d.risk_level] || "text-on-surface";
              txt.innerHTML = `<span class="${c} font-bold">⚠️ ${(d.risk_level || "").toUpperCase()}</span> — ${d.reason || "Classification complete."}`;
            } else
              txt.textContent =
                "AI classification unavailable. Proceed manually.";
          } catch {
            txt.textContent = "AI offline — keyword fallback active.";
          }
        }, 700);
      }

      // ─── SUBMIT ──────────────────────────────────────────────────────────────────
      async function submitAlert() {
        const desc = document.getElementById("alert-desc").value.trim();
        if (!desc) {
          showToast("Please enter description", "error");
          return;
        }

        // Enforce one active alert per user
        const myActiveAlert = alertsList.find(
          (a) => a.user_id === STATE.user.id && a.status !== "resolved"
        );
        if (myActiveAlert) {
          showToast("You already have an active alert. Resolve it first.", "error");
          closeModal("post-alert-modal");
          return;
        }

        const selectedChip = document.querySelector(".cat-chip.selected");
        const category = selectedChip
          ? selectedChip.getAttribute("data-cat")
          : "medical";
        const isAnon = document.getElementById("anon-toggle").checked;

        showToast("Broadcasting alert…", "info");
        try {
          const payload = {
            title: desc.slice(0, 30) + (desc.length > 30 ? "..." : ""),
            description: desc,
            category: category,
            lat: STATE.userLat,
            lng: STATE.userLng,
            is_anonymous: isAnon,
            user_id: STATE.user.id,
          };

          const r = await fetch("/api/emergencies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (r.ok) {
            closeModal("post-alert-modal");
            showToast("🚨 Alert broadcast successfully!", "success");
            document.getElementById("alert-desc").value = "";
            await loadData();
            await loadProfileStats();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to post alert", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to post alert", "error");
        }
      }

      async function submitResource() {
        const type = document.getElementById("res-type").value;
        const title = document.getElementById("res-title").value.trim();
        const desc = document.getElementById("res-desc").value.trim();
        const until = document.getElementById("res-until").value;

        if (!title) {
          showToast("Please enter title", "error");
          return;
        }

        showToast("Listing resource…", "info");
        try {
          const payload = {
            type: type,
            title: title,
            description: desc,
            available_until: until ? new Date(until).toISOString() : null,
            lat: STATE.userLat,
            lng: STATE.userLng,
            user_id: STATE.user.id,
          };

          const r = await fetch("/api/resources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (r.ok) {
            closeModal("post-resource-modal");
            showToast("📍 Resource listed on map!", "success");
            document.getElementById("res-title").value = "";
            document.getElementById("res-desc").value = "";
            document.getElementById("res-until").value = "";
            await loadData();
            await loadProfileStats();
          } else {
            const err = await r.json();
            showToast(err.error || "Failed to list resource", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to list resource", "error");
        }
      }

