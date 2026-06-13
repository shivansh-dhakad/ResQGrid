      // ─── AUTH ────────────────────────────────────────────────────────────────────
      function switchAuthTab(tab) {
        document.getElementById("tab-login").className =
          tab === "login" ? "auth-tab-btn active" : "auth-tab-btn";
        document.getElementById("tab-register").className =
          tab === "register" ? "auth-tab-btn active" : "auth-tab-btn";
        document.getElementById("auth-login").style.display =
          tab === "login" ? "block" : "none";
        document.getElementById("auth-register").style.display =
          tab === "register" ? "block" : "none";
      }
      function selectRegType(type) {
        document.getElementById("rtype-individual").className =
          type === "individual"
            ? "py-3 rounded-lg border-2 border-primary-container bg-orange-50 text-primary text-body-md font-bold transition-all"
            : "py-3 rounded-lg border-2 border-border-base bg-white text-on-surface-variant text-body-md font-semibold transition-all";
        document.getElementById("rtype-ngo").className =
          type === "ngo"
            ? "py-3 rounded-lg border-2 border-primary-container bg-orange-50 text-primary text-body-md font-bold transition-all"
            : "py-3 rounded-lg border-2 border-border-base bg-white text-on-surface-variant text-body-md font-semibold transition-all";
        document.getElementById("org-fields").style.display =
          type === "ngo" ? "block" : "none";
      }

      async function handleLogin() {
        const email = document.getElementById("login-email").value;
        const pass = document.getElementById("login-password").value;
        if (!email || !pass) {
          showToast("Please fill all fields", "error");
          return;
        }

        showToast("Initializing session…", "info");
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: pass }),
          });
          const result = await response.json();
          if (!response.ok) {
            showToast(result.error || "Login failed", "error");
            return;
          }

          STATE.user = result.user;
          STATE.token = result.access_token;

          // Persist session so user stays logged in on refresh
          localStorage.setItem("rq_token", result.access_token);
          localStorage.setItem("rq_user", JSON.stringify(result.user));

          if (result.user.is_admin || result.user_type === "admin") {
            STATE.isAdmin = true;
            showScreen("screen-admin");
            renderAdminOverview();
          } else if (result.user.user_type === "ngo") {
            // Community leaders get their own dashboard, not the individual app
            showToast("Logged in successfully", "success");
            window.location.href = `/community.html?ngo_id=${result.user.id}`;
            return;
          } else {
            STATE.isAdmin = false;
            enterApp();
          }
          showToast("Logged in successfully", "success");
        } catch (err) {
          console.error(err);
          showToast("Failed to connect to auth service", "error");
        }
      }

      async function handleRegister() {
        const firstName = document.getElementById("reg-firstname").value.trim();
        const lastName = document.getElementById("reg-lastname").value.trim();
        const email = document.getElementById("reg-email").value.trim();
        const phone = document.getElementById("reg-phone").value.trim();
        const password = document.getElementById("reg-password").value;

        const isNgo =
          document.getElementById("org-fields").style.display !== "none";
        const userType = isNgo ? "ngo" : "individual";
        const orgName = isNgo
          ? document.getElementById("reg-orgname").value.trim()
          : "";
        const orgType = isNgo
          ? document.getElementById("reg-orgtype").value
          : "";
        const orgRegNum = isNgo
          ? document.getElementById("reg-orgreg").value.trim()
          : "";

        if (!firstName || !email || !password || !phone) {
          showToast("Please fill out all required fields", "error");
          return;
        }
        if (password.length < 8) {
          showToast("Password must be at least 8 characters", "error");
          return;
        }
        if (isNgo && !orgName) {
          showToast("Please enter organisation name", "error");
          return;
        }

        showToast("Creating account…", "info");
        try {
          const payload = {
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone: phone,
            password: password,
            user_type: userType,
            org_name: orgName,
            org_type: orgType,
            org_reg_number: orgRegNum,
          };

          const response = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const result = await response.json();
          if (!response.ok) {
            showToast(result.error || "Registration failed", "error");
            return;
          }

          showToast("Account created! Logging in…", "success");
          setTimeout(async () => {
            document.getElementById("login-email").value = email;
            document.getElementById("login-password").value = password;
            await handleLogin();
          }, 1000);
        } catch (err) {
          console.error(err);
          showToast("Failed to connect to registration service", "error");
        }
      }

      async function enterApp() {
        // Show the screen immediately — don't block on network/location
        showScreen("screen-app");

        const fullName =
          STATE.user.full_name || STATE.user.display_name || STATE.user.email || "";
        const initials = getUserInitials(fullName);

        document.getElementById("profile-name").textContent = fullName;
        document.getElementById("profile-avatar").textContent = initials;

        // Populate stats from the login payload right away (no extra request needed)
        const score = STATE.user.score || 0;
        document.getElementById("profile-rank-pts").textContent = `${score} pts`;
        document.getElementById("profile-stat-helped").textContent = STATE.user.emergencies_helped || 0;
        document.getElementById("profile-stat-resources").textContent = STATE.user.resources_listed || 0;

        const h = new Date().getHours();
        const greet =
          h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
        document.getElementById("home-greeting").textContent =
          `${greet}, ${fullName}`;

        // Run location + data fetches in parallel, don't block the UI
        updateUserLocationFromBrowser().then(() => {
          loadData().then(() => startNotifPolling());
        });

        // Load detailed profile stats separately (non-blocking)
        loadProfileStats();
      }

      function handleLogout() {
        STATE.user = null;
        STATE.token = null;
        STATE.isAdmin = false;
        sosSearchResults = [];
        stopNotifPolling();
        _knownAlertIds.clear();
        _knownResourceIds.clear();
        _knownSosIds.clear();
        _notifList = [];
        _renderNotifList();
        // Clear persisted session
        localStorage.removeItem("rq_token");
        localStorage.removeItem("rq_user");
        document.getElementById("sos-contact-input").value = "";
        const resultEl = document.getElementById("sos-user-search-result");
        if (resultEl) { resultEl.innerHTML = ""; resultEl.classList.add("hidden"); }
        showScreen("screen-auth");
        showToast("Signed out", "info");
      }

      function showScreen(id) {
        document
          .querySelectorAll(".screen")
          .forEach((s) => s.classList.remove("active"));
        document.getElementById(id).classList.add("active");
        // Clear any lingering toast when switching screens
        clearTimeout(toastTimer);
        const t = document.getElementById("toast");
        if (t) t.classList.remove("show");
      }

      // ─── TAB SWITCHING ───────────────────────────────────────────────────────────
      function switchTab(tab) {
        STATE.currentTab = tab;
        document
          .querySelectorAll(".tab-panel")
          .forEach((p) => p.classList.remove("active"));
        document.querySelectorAll("nav .nav-item").forEach((n) => {
          n.classList.remove("active");
          n.querySelector(".nav-icon-ms").className = n
            .querySelector(".nav-icon-ms")
            .className.replace(/text-primary/g, "text-secondary");
          n.querySelector(".nav-label").className = n
            .querySelector(".nav-label")
            .className.replace(/text-primary/g, "text-secondary");
        });
        document.getElementById("panel-" + tab).classList.add("active");
        const navBtn = document.getElementById("nav-" + tab);
        navBtn.classList.add("active");
        navBtn.querySelector(".nav-icon-ms").className = navBtn
          .querySelector(".nav-icon-ms")
          .className.replace(/text-secondary/g, "text-primary");
        navBtn.querySelector(".nav-label").className = navBtn
          .querySelector(".nav-label")
          .className.replace(/text-secondary/g, "text-primary");
        if (tab === "map") setTimeout(initMap, 80);
        if (tab === "alerts") renderAlerts("nearby");
        if (tab === "community") renderCommunity();
      }

