      // ─── MICRO-INTERACTIONS ──────────────────────────────────────────────────────
      document.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("touchstart", () => (btn.style.opacity = ".88"), {
          passive: true,
        });
        btn.addEventListener("touchend", () => (btn.style.opacity = ""), {
          passive: true,
        });
      });

      // ─── NOTIFICATION & SOUND SYSTEM ────────────────────────────────────────────

      const NOTIF_RADIUS_KM = 10;   // fallback notify radius
      // Grid system radii (km) — mirrors backend constants:
      const RISK_RADIUS_KM = { critical: 5, high: 3, medium: 2, low: 2 };
      const SOS_RADIUS_KM = 7;          // SOS alerts notify everyone within 7km
      const RESOURCE_RADIUS_KM = 10;    // resources are visible within 10km
      const COMMUNITY_RADIUS_KM = 30;   // communities are shown within 30km
      let _knownAlertIds    = new Set();
      let _knownResourceIds = new Set();
      let _knownSosIds      = new Set();
      let _sosAlarmInterval = null;
      let _pollInterval     = null;
      let _audioCtx         = null;
      let _notifList        = [];    // in-memory list newest-first

      function _getAudioCtx() {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return _audioCtx;
      }

      // Play a short beep: freq Hz, duration ms, volume 0-1
      function _beep(freq, dur, vol = 0.35, startAt = 0) {
        try {
          const ctx = _getAudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(vol, ctx.currentTime + startAt);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + dur / 1000);
          osc.start(ctx.currentTime + startAt);
          osc.stop(ctx.currentTime + startAt + dur / 1000 + 0.05);
        } catch(e) {}
      }

      // Double-beep for new alert
      function _soundAlert() {
        _beep(880, 180, 0.4, 0);
        _beep(880, 180, 0.4, 0.28);
      }

      // Single soft beep for new resource
      function _soundResource() {
        _beep(660, 220, 0.3, 0);
      }

      // 3 loud beeps repeated every 3s for SOS
      function _startSosAlarm() {
        if (_sosAlarmInterval) return; // already running
        const play = () => {
          _beep(1100, 200, 0.6, 0.0);
          _beep(1100, 200, 0.6, 0.3);
          _beep(1100, 200, 0.6, 0.6);
        };
        play();
        _sosAlarmInterval = setInterval(play, 3000);
        // Show a persistent SOS banner in notif panel
        document.getElementById('sos-alarm-banner').style.display = 'flex';
      }

      function stopSosAlarm() {
        if (_sosAlarmInterval) { clearInterval(_sosAlarmInterval); _sosAlarmInterval = null; }
        document.getElementById('sos-alarm-banner').style.display = 'none';
      }

      // Add a notification item to the panel
      function _pushNotif(icon, iconColor, title, body, onClick) {
        const id = Date.now();
        _notifList.unshift({ id, icon, iconColor, title, body, time: new Date(), onClick });
        _renderNotifList();
        // Show badge on bell
        document.getElementById('notif-badge').style.display = 'block';
        document.getElementById('notif-badge').classList.remove('hidden');
      }

      function _renderNotifList() {
        const el = document.getElementById('notif-list');
        if (!_notifList.length) {
          el.innerHTML = '<p class="text-center text-text-muted text-body-md py-8">No notifications yet.</p>';
          return;
        }
        el.innerHTML = _notifList.slice(0, 30).map(n => `
          <div class="flex items-start gap-3 px-4 py-3.5 border-b border-border-base hover:bg-surface-container-low cursor-pointer transition-colors"
               onclick="${n.onClick || ''}">
            <div class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                 style="background:${n.iconColor}1A">
              <span class="material-symbols-outlined text-base" style="color:${n.iconColor};font-variation-settings:'FILL' 1">${n.icon}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-body-md text-on-surface font-semibold leading-snug">${n.title}</p>
              <p class="text-caption text-text-muted mt-0.5 line-clamp-2">${n.body}</p>
              <p class="text-caption text-text-muted font-mono mt-1">${formatTimeAgo(n.time.toISOString())}</p>
            </div>
          </div>`).join('');
      }

      // Distance check using existing calculateDistance helper
      function _isNearby(lat, lng, radiusKm = NOTIF_RADIUS_KM) {
        if (!STATE.userLat || !STATE.userLng || !lat || !lng) return true; // show if no location
        return calculateDistance(STATE.userLat, STATE.userLng, lat, lng) <= radiusKm;
      }

      // Seed known IDs on first load so we don't fire notifs for existing data
      function _seedKnownIds() {
        alertsList.forEach(a => _knownAlertIds.add(a.id));
        resourcesList.forEach(r => _knownResourceIds.add(r.id));
      }

      // Called after every loadData() poll — diff against known sets
      function _checkForNewItems(newAlerts, newResources) {
        // ── New emergencies ──
        newAlerts.forEach(a => {
          const alertRadius = RISK_RADIUS_KM[a.risk_level] || RISK_RADIUS_KM.medium;
          if (!_knownAlertIds.has(a.id) && _isNearby(a.lat, a.lng, alertRadius)) {
            _knownAlertIds.add(a.id);
            const riskLabel = (a.risk_level || 'medium').toUpperCase();
            _soundAlert();
            _pushNotif(
              a.category === 'blood' ? 'bloodtype' : a.category === 'fire' ? 'local_fire_department' : 'warning',
              a.risk_level === 'critical' ? '#EF4444' : a.risk_level === 'high' ? '#F97316' : '#EAB308',
              `[${riskLabel}] ${a.title}`,
              a.description || 'New emergency nearby',
              `switchTab('alerts');toggleNotif()`
            );
          } else {
            _knownAlertIds.add(a.id);
          }
        });

        // ── New resources ──
        newResources.forEach(r => {
          if (!_knownResourceIds.has(r.id) && _isNearby(r.lat, r.lng, RESOURCE_RADIUS_KM)) {
            _knownResourceIds.add(r.id);
            _soundResource();
            _pushNotif(
              'inventory_2',
              '#0062a0',
              `New resource: ${r.title}`,
              r.description || `Type: ${r.type}`,
              `switchTab('community');toggleNotif()`
            );
          } else {
            _knownResourceIds.add(r.id);
          }
        });
      }

      // Poll for new SOS events separately (SOS table, not emergencies)
      async function _pollSOS() {
        try {
          const userId = STATE.user?.id;
          const url = userId ? `/api/sos/active?user_id=${userId}` : '/api/sos/active';
          const res = await fetch(url);
          if (!res.ok) return;
          const events = await res.json();
          let hasNewNearby = false;
          (Array.isArray(events) ? events : []).forEach(s => {
            // Emergency contact in danger: always alert, regardless of distance.
            if (s.is_contact_alert && !_knownSosIds.has(s.id)) {
              _knownSosIds.add(s.id);
              hasNewNearby = true;
              showContactDangerPopup(s);
              _pushNotif(
                'emergency',
                '#EF4444',
                `🆘 ${s.contact_name || 'Your emergency contact'} is in danger!`,
                `They triggered an SOS. Tap to view their location.`,
                `switchTab('map');toggleNotif()`
              );
              return;
            }
            if (!_knownSosIds.has(s.id) && _isNearby(s.lat, s.lng, SOS_RADIUS_KM)) {
              _knownSosIds.add(s.id);
              hasNewNearby = true;
              _pushNotif(
                'emergency',
                '#EF4444',
                '🆘 SOS Alert Nearby!',
                `Someone needs immediate help ${s.lat ? 'near your location' : ''}`,
                `switchTab('map');toggleNotif()`
              );
            } else {
              _knownSosIds.add(s.id);
            }
          });
          if (hasNewNearby) _startSosAlarm();
          // Stop alarm if no more active SOS nearby (or contact alerts)
          const anyActiveNearby = (Array.isArray(events) ? events : []).some(
            s => s.is_active && (s.is_contact_alert || _isNearby(s.lat, s.lng, SOS_RADIUS_KM))
          );
          if (!anyActiveNearby && _sosAlarmInterval) stopSosAlarm();
        } catch(e) {}
      }

      // Full-screen popup shown when one of the user's own emergency
      // contacts has triggered an SOS — regardless of distance.
      function showContactDangerPopup(sosEvent) {
        const nameEl = document.getElementById('contact-danger-name');
        if (nameEl) nameEl.textContent = sosEvent.contact_name || 'Your emergency contact';
        const viewBtn = document.getElementById('contact-danger-view-btn');
        if (viewBtn) {
          viewBtn.onclick = () => {
            closeModal('contact-danger-modal');
            STATE.focusSosLat = sosEvent.lat;
            STATE.focusSosLng = sosEvent.lng;
            switchTab('map');
          };
        }
        openModal('contact-danger-modal');
        try {
          _beep(1200, 250, 0.6, 0);
          _beep(1200, 250, 0.6, 0.35);
          _beep(1200, 250, 0.6, 0.7);
        } catch(e) {}
      }

      // Fetch fresh alerts/resources, refresh the visible UI for the current
      // tab, and then diff against known IDs to fire notifications/sounds.
      // This is what makes new alerts posted by other users show up live.
      async function _pollAlertsAndResources() {
        try {
          const [alerts, resources] = await Promise.all([
            fetch(`/api/emergencies${nearbyQuery(5)}`).then(r => r.ok ? r.json() : []),
            fetch(`/api/resources${nearbyQuery(RESOURCE_RADIUS_KM)}`).then(r => r.ok ? r.json() : []),
          ]);
          const newAlerts = Array.isArray(alerts) ? alerts : [];
          const newResources = Array.isArray(resources) ? resources : [];

          alertsList = newAlerts;
          resourcesList = newResources;

          document.getElementById("stat-alerts").textContent = alertsList.length;
          document.getElementById("stat-resources").textContent = resourcesList.length;

          // "Responding" = alerts the current user has personally responded to
          const myRespondingCount = STATE.user
            ? alertsList.filter(a => (a.responder_user_ids || []).includes(STATE.user.id)).length
            : 0;
          document.getElementById("stat-responding").textContent = myRespondingCount;

          if (STATE.currentTab === "home") {
            initHomeTab();
          } else if (STATE.currentTab === "alerts") {
            renderAlerts("nearby");
          }

          if (STATE.mapInstance) {
            refreshMapMarkers();
          }

          // Fire notifications/sounds for anything new since the last poll
          _checkForNewItems(newAlerts, newResources);
        } catch (e) {
          console.error("Poll alerts/resources failed:", e);
        }
      }

      // Start polling after login
      function startNotifPolling() {
        _seedKnownIds();
        if (_pollInterval) clearInterval(_pollInterval);
        _pollInterval = setInterval(async () => {
          await _pollAlertsAndResources();
          await _pollSOS();
        }, 8000); // poll every 8s for near-instant updates
        // Also poll SOS immediately and every 10s (SOS is urgent)
        _pollSOS();
        setInterval(_pollSOS, 10000);
      }

      function stopNotifPolling() {
        if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
        stopSosAlarm();
      }

