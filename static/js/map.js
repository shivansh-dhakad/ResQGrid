      // ─── MAP ─────────────────────────────────────────────────────────────────────
      let markerLayer = null;

      function initMap() {
        if (STATE.mapInit) return;
        STATE.mapInit = true;

        // Use user location if available, else fall back to Indore center
        const defaultLat = STATE.userLat ?? 22.7196;
        const defaultLng = STATE.userLng ?? 75.8577;
        const zoom = (STATE.userLat != null) ? 15 : 12;

        const map = L.map("leaflet-map", {
          zoomControl: false,
          attributionControl: true,
        }).setView([defaultLat, defaultLng], zoom);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        L.control.zoom({ position: "bottomright" }).addTo(map);

        STATE.mapInstance = map;
        markerLayer = L.layerGroup().addTo(map);

        // If we don't have location yet, get it and pan the map
        if (STATE.userLat == null) {
          updateUserLocationFromBrowser(8000).then((got) => {
            if (got && STATE.userLat != null) {
              map.setView([STATE.userLat, STATE.userLng], 15);
              addUserMarker(map);
              loadData();
            }
          });
        } else {
          addUserMarker(map);
        }
        refreshMapMarkers();
      }

      function addUserMarker(map) {
        if (STATE.userLat == null || STATE.userLng == null) return;
        const userIcon = L.divIcon({
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#f5700a;border:3px solid #fff;box-shadow:0 2px 8px rgba(245,112,10,0.5)"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          className: "",
        });
        L.marker([STATE.userLat, STATE.userLng], {
          icon: userIcon,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("You are here", { permanent: false, direction: "top" });
        L.circle([STATE.userLat, STATE.userLng], {
          radius: 300,
          color: "#f5700a",
          fillColor: "#f5700a",
          fillOpacity: 0.06,
          weight: 1.5,
        }).addTo(map);
      }

      function refreshMapMarkers() {
        if (!STATE.mapInstance || !markerLayer) return;
        markerLayer.clearLayers();

        const mkMarker = (emoji, color, label = "") =>
          L.divIcon({
            html: `<div style="position:relative; pointer-events: auto;">
      <div class="rq-marker" style="background:${color};font-size:16px">${emoji}</div>
      ${label ? `<div style="position:absolute;top:38px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(255,255,255,0.92);border:1.5px solid #c8dde8;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;color:#0d1f2d;font-family:Sora,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.12);pointer-events:none;">${label}</div>` : ""}
    </div>`,
            iconSize: [36, label ? 58 : 36],
            iconAnchor: [18, 18],
            className: "",
          });

        // Emergency markers
        const riskColors = {
          critical: "#EF4444",
          high: "#F97316",
          medium: "#EAB308",
          low: "#10B981",
        };
        const catEmoji = {
          blood: "🩸",
          transport: "🚗",
          medical: "🏥",
          shelter: "🏠",
          medicine: "💊",
          fire: "🔥",
          flood: "🌊",
          other: "⚠️",
        };
        if (STATE.currentMapFilter === "all" || STATE.currentMapFilter === "emergency") alertsList.forEach((a) => {
          // Location is only revealed to the poster or confirmed responders.
          if (a.lat == null || a.lng == null) return;
          const user = a.user || {
            id: "",
            initials: "?",
            color: "#888",
            full_name: "Anonymous",
          };
          L.marker([a.lat, a.lng], {
            icon: mkMarker(
              catEmoji[a.category] || "⚠️",
              riskColors[a.risk_level] || "#EAB308",
              a.title.slice(0, 18) + "…",
            ),
          })
            .addTo(markerLayer)
            .on("click", () => showMapPopup(a, user, "emergency"));
        });

        // Resource markers
        const resColors = {
          blood: "#EF4444",
          transport: "#0062a0",
          food: "#10B981",
          shelter: "#D97706",
          medicine: "#9d4400",
          equipment: "#565e74",
        };
        const resEmoji = {
          blood: "🩸",
          transport: "🚗",
          food: "🍱",
          shelter: "🏠",
          medicine: "💊",
          equipment: "🔦",
        };
        if (STATE.currentMapFilter === "all" || STATE.currentMapFilter === "resource") resourcesList.forEach((r) => {
          const user = r.user || {
            id: "",
            initials: "?",
            color: "#888",
            full_name: "Unknown",
          };
          L.marker([r.lat, r.lng], {
            icon: mkMarker(
              resEmoji[r.type] || "📦",
              resColors[r.type] || "#565e74",
              r.title.slice(0, 18) + "…",
            ),
          })
            .addTo(markerLayer)
            .on("click", () => showMapPopup(r, user, "resource"));
        });

        // Community markers
        if (STATE.currentMapFilter === "all" || STATE.currentMapFilter === "community") communitiesList.forEach((c) => {
          L.marker([c.lat, c.lng], {
            icon: mkMarker("🏢", "#0062a0", c.org_name.slice(0, 16) + "…"),
          })
            .addTo(markerLayer)
            .on("click", () => showMapPopup(c, null, "community"));
        });
      }

      function recenterMap() {
        if (STATE.mapInstance) {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                STATE.userLat = lat;
                STATE.userLng = lng;
                STATE.mapInstance.setView([lat, lng], 16, { animate: true });
              },
              () =>
                STATE.mapInstance.setView([STATE.userLat, STATE.userLng], 16, {
                  animate: true,
                }),
              { timeout: 4000 },
            );
          } else {
            STATE.mapInstance.setView([STATE.userLat, STATE.userLng], 16, {
              animate: true,
            });
          }
          showToast("📍 Recentred to your location", "info");
        }
      }

      function showMapPopup(item, user, type) {
        const el = document.getElementById("map-popup");
        let html = "";
        if (type === "emergency") {
          const riskBg = getRiskBg(item.risk_level);
          const timeStr = formatTimeAgo(item.created_at);
          html = `
      <div class="flex items-start gap-2 mb-2">
        <h4 class="text-body-lg text-on-surface font-bold flex-1">${item.title}</h4>
        <span class="risk-pill ${riskBg} flex-shrink-0">${(item.risk_level || "medium").toUpperCase()}</span>
      </div>
      <p class="text-body-md text-on-surface-variant mb-3">${item.description}</p>
      <div class="flex items-center gap-2 mb-3">
        ${userAvatar(user, "w-7 h-7")}
        <span class="text-caption text-text-muted">${item.is_anonymous ? "Anonymous" : user.full_name || user.display_name} · ${timeStr}</span>
      </div>
      ${item.user_id === STATE.user.id
        ? `<button onclick="resolveAlert('${item.id}');closeMapPopup()" class="w-full py-2.5 bg-success text-white rounded-lg text-label-bold font-bold flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm">check_circle</span>Mark Resolved</button>`
        : (item.responder_user_ids || []).includes(STATE.user.id)
          ? `<div class="flex gap-2">
              <button onclick="navigateToAlert('${item.lat}','${item.lng}','${(item.title||"").replace(/'/g,"")}');closeMapPopup()" class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-label-bold font-bold flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">navigation</span>Directions</button>
              <button onclick="withdrawFromAlert('${item.id}');closeMapPopup()" class="py-2.5 px-3 bg-orange-100 text-orange-700 border border-orange-200 rounded-lg text-label-bold font-bold" title="Withdraw"><span class="material-symbols-outlined text-sm">undo</span></button>
            </div>`
          : (item.responder_count || 0) > 0
            ? `<button disabled class="w-full py-2.5 bg-surface-container text-text-muted rounded-lg text-label-bold font-bold opacity-60 cursor-not-allowed">🔒 Already Taken</button>`
            : `<button onclick="respondToAlert('${item.id}');closeMapPopup()" class="w-full py-2.5 bg-primary-container text-white rounded-lg text-label-bold font-bold">🙋 Respond Now</button>`
      }`;
        } else if (type === "resource") {
          html = `
      <div class="flex items-center gap-2 mb-2">${userAvatar(user, "w-9 h-9")}<div><h4 class="text-body-lg text-on-surface font-bold">${item.title}</h4><p class="text-caption text-text-muted">${user.full_name || user.display_name}</p></div></div>
      <p class="text-body-md text-on-surface-variant mb-3">${item.description || "No description available."}</p>
      <div class="flex gap-2">
        <button onclick="callUser('${user.phone}', '${user.full_name || user.display_name || "Owner"}');closeMapPopup()" class="flex-1 py-2.5 bg-success text-white rounded-lg text-label-bold font-bold flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm">call</span>Call</button>
        <button onclick="openChat('${item.id}')" class="flex-1 py-2.5 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low">💬 Message</button>
      </div>`;
        } else {
          html = `
      <div class="flex items-center gap-2 mb-2"><div class="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-tertiary"><span class="material-symbols-outlined">corporate_fare</span></div><div><h4 class="text-body-lg text-on-surface font-bold">${item.org_name}</h4><p class="text-caption text-text-muted">${item.org_type || "NGO"}</p></div>${item.is_verified ? '<span class="material-symbols-outlined text-tertiary ml-auto" style="font-variation-settings:\'FILL\' 1">verified</span>' : ""}</div>
      <div class="flex items-center gap-3 text-caption text-text-muted mb-3 font-mono"><span>Score: ${item.score || 0}</span></div>
      ${myMemberships[item.id] === 'approved'
        ? `<button disabled class="w-full py-2.5 bg-green-50 text-success border border-green-200 rounded-lg text-label-bold font-bold cursor-default flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">check_circle</span>Member</button>`
        : myMemberships[item.id] === 'pending'
          ? `<button disabled class="w-full py-2.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg text-label-bold font-bold cursor-default flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-sm">schedule</span>Request Sent</button>`
          : Object.values(myMemberships).some((s) => s === 'approved' || s === 'pending')
            ? `<button disabled title="Leave your current community to join a new one" class="w-full py-2.5 bg-surface-container-low text-text-muted border border-border-base rounded-lg text-label-bold font-bold cursor-not-allowed">Already in a Community</button>`
            : `<button onclick="joinCommunity('${item.id}');closeMapPopup()" class="w-full py-2.5 border border-border-base text-on-surface rounded-lg text-label-bold font-bold hover:bg-surface-container-low">Request to Join</button>`
      }`;
        }
        document.getElementById("map-popup-content").innerHTML = html;
        el.classList.add("show");
      }

      function closeMapPopup() {
        document.getElementById("map-popup").classList.remove("show");
      }

      // ─── IN-APP NAVIGATION (OSRM road routing) ──────────────────────────────────
      let _navRouteLayer = null;
      let _navDestMarker = null;
      let _navMode = 'driving'; // 'driving' | 'walking'
      let _navDest = null;      // {lat, lng, title} saved for mode switch

      // OSRM public demo server — no API key needed
      const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

      async function _fetchOSRMRoute(fromLat, fromLng, toLat, toLng, mode) {
        const profile = mode === 'walking' ? 'foot' : 'driving';
        const url = `${OSRM_BASE}/${profile}/${fromLng},${fromLat};${toLng},${toLat}`
          + `?overview=full&geometries=geojson&steps=false`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`OSRM ${res.status}`);
        const data = await res.json();
        if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');
        const route = data.routes[0];
        // GeoJSON coords are [lng, lat] — flip to Leaflet [lat, lng]
        const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        return { latlngs, distanceM: route.distance, durationS: route.duration };
      }

      function _drawRoute(latlngs, mode) {
        const map = STATE.mapInstance;
        // Outer casing (white)
        const casing = L.polyline(latlngs, {
          color: '#fff', weight: 9, lineCap: 'round', lineJoin: 'round', opacity: 0.7
        }).addTo(map);
        // Inner route line
        const line = L.polyline(latlngs, {
          color: mode === 'walking' ? '#00897B' : '#1a73e8',
          weight: 5, lineCap: 'round', lineJoin: 'round', opacity: 0.95
        }).addTo(map);
        // Return a layer group so stopNavigation can remove both
        return L.layerGroup([casing, line]).addTo(map);
      }

      function _fmtDist(m) {
        return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
      }
      function _fmtTime(s) {
        const m = Math.round(s / 60);
        return m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}m`;
      }

      function navigateToAlert(destLat, destLng, title) {
        if (!STATE.userLat || !STATE.userLng) {
          showToast('📍 Location not available. Enable GPS to navigate.', 'error');
          return;
        }
        destLat = parseFloat(destLat);
        destLng = parseFloat(destLng);
        if (isNaN(destLat) || isNaN(destLng)) {
          showToast('Alert location is not available yet.', 'error');
          return;
        }
        _navDest = { lat: destLat, lng: destLng, title: title || 'Destination' };
        switchTab('map');
        setTimeout(() => {
          if (!STATE.mapInstance) initMap();
          _startRouting(_navDest.lat, _navDest.lng, _navDest.title, _navMode);
        }, 150);
      }

      async function _startRouting(destLat, destLng, title, mode) {
        const map = STATE.mapInstance;
        closeMapPopup();
        stopNavigation(true);

        // Show nav bar immediately with a loading state
        document.getElementById('nav-title').textContent = title;
        document.getElementById('nav-info').textContent = 'Calculating route…';
        document.getElementById('nav-bar').classList.add('show');
        _updateNavModeButtons(mode);

        // Place destination marker right away
        _navDestMarker = L.marker([destLat, destLng], {
          icon: L.divIcon({
            html: '<div class="nav-pulse-marker"></div>',
            iconSize: [24, 24], iconAnchor: [12, 12], className: '',
          }),
          zIndexOffset: 2000,
        }).addTo(map).bindTooltip(title, { permanent: true, direction: 'top', offset: [0, -14] });

        try {
          const { latlngs, distanceM, durationS } = await _fetchOSRMRoute(
            STATE.userLat, STATE.userLng, destLat, destLng, mode
          );

          // Remove any stale route but keep dest marker
          if (_navRouteLayer && map) { map.removeLayer(_navRouteLayer); _navRouteLayer = null; }

          _navRouteLayer = _drawRoute(latlngs, mode);

          // Fit map to route with padding
          map.fitBounds(L.latLngBounds(latlngs).pad(0.18), { maxZoom: 16 });

          const modeIcon = mode === 'walking' ? '🚶' : '🚗';
          document.getElementById('nav-info').textContent =
            `${modeIcon} ${_fmtDist(distanceM)} · ~${_fmtTime(durationS)}`;

          showToast('🧭 Route found — follow the blue path', 'success');
        } catch (err) {
          // OSRM failed — fall back to straight line with a warning
          console.warn('OSRM routing failed:', err);
          if (_navRouteLayer && map) { map.removeLayer(_navRouteLayer); _navRouteLayer = null; }
          _navRouteLayer = L.layerGroup([
            L.polyline([[STATE.userLat, STATE.userLng],[destLat,destLng]], { color:'#fff', weight:9, opacity:0.7, lineCap:'round' }).addTo(map),
            L.polyline([[STATE.userLat, STATE.userLng],[destLat,destLng]], { color:'#1a73e8', weight:5, dashArray:'10,8', lineCap:'round', opacity:0.85 }).addTo(map),
          ]).addTo(map);
          map.fitBounds(L.latLngBounds([[STATE.userLat,STATE.userLng],[destLat,destLng]]).pad(0.3), { maxZoom: 16 });
          const dist = calculateDistance(STATE.userLat, STATE.userLng, destLat, destLng);
          document.getElementById('nav-info').textContent =
            `~${dist.toFixed(1)} km (straight line — road route unavailable)`;
          showToast('⚠️ Road route unavailable — showing straight line', 'info');
        }
      }

      function switchNavMode(mode) {
        if (!_navDest) return;
        _navMode = mode;
        _updateNavModeButtons(mode);
        _startRouting(_navDest.lat, _navDest.lng, _navDest.title, mode);
      }

      function _updateNavModeButtons(mode) {
        const drive = document.getElementById('nav-mode-drive');
        const walk  = document.getElementById('nav-mode-walk');
        if (!drive || !walk) return;
        const activeStyle  = 'background:rgba(255,255,255,0.95);color:#1a73e8;';
        const inactiveStyle = 'background:rgba(255,255,255,0.18);color:#fff;';
        drive.style.cssText = (mode === 'driving'  ? activeStyle : inactiveStyle) + 'border:none;border-radius:9999px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s';
        walk.style.cssText  = (mode === 'walking'  ? activeStyle : inactiveStyle) + 'border:none;border-radius:9999px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s';
      }

      function stopNavigation(silent) {
        if (_navRouteLayer && STATE.mapInstance) {
          STATE.mapInstance.removeLayer(_navRouteLayer);
          _navRouteLayer = null;
        }
        if (_navDestMarker && STATE.mapInstance) {
          STATE.mapInstance.removeLayer(_navDestMarker);
          _navDestMarker = null;
        }
        _navDest = null;
        document.getElementById('nav-bar').classList.remove('show');
        if (!silent) showToast('Navigation stopped', 'info');
      }
      function filterMap(type, btn) {
        document.querySelectorAll(".map-chip").forEach((c) => {
          c.className = c.className.replace(
            /bg-primary-container text-white/g,
            "bg-white text-on-surface-variant border border-border-base",
          );
          if (!c.className.includes("map-chip")) c.className += " map-chip";
        });
        btn.className = btn.className.replace(
          /bg-white text-on-surface-variant border border-border-base/g,
          "bg-primary-container text-white",
        );
        STATE.currentMapFilter = type;
        refreshMapMarkers();
        showToast(`Filter: ${type === "all" ? "All" : type}`, "info");
      }


      // ─── MAP SEARCH (Nominatim place search + navigation) ────────────────────
      let _searchDebounceTimer = null;
      let _placeMarkerLayer = null;   // Leaflet layer for place-search results
      let _placeResults = [];         // cached array of {lat,lng,name,address,type}

      // Icons per place type keyword
      const _placeTypeIcon = (name='',type='') => {
        const n = (name+type).toLowerCase();
        if (n.includes('hospital') || n.includes('clinic') || n.includes('health')) return { emoji: '🏥', color: '#EF4444' };
        if (n.includes('pharmacy') || n.includes('medical store') || n.includes('chemist') || n.includes('drug')) return { emoji: '💊', color: '#9d4400' };
        if (n.includes('blood bank') || n.includes('blood')) return { emoji: '🩸', color: '#EF4444' };
        if (n.includes('fire') || n.includes('fire station')) return { emoji: '🚒', color: '#F97316' };
        if (n.includes('police')) return { emoji: '🚔', color: '#1a73e8' };
        if (n.includes('shelter') || n.includes('relief')) return { emoji: '🏠', color: '#D97706' };
        if (n.includes('food') || n.includes('canteen') || n.includes('kitchen')) return { emoji: '🍱', color: '#10B981' };
        return { emoji: '📍', color: '#1a73e8' };
      };

      function _normalizeMapSearch(s) { return (s || '').toLowerCase().trim(); }

      function clearMapSearch() {
        const input = document.getElementById('map-search-input');
        if (input) input.value = '';
        document.getElementById('map-suggestions-box')?.classList.add('hidden');
        document.getElementById('map-search-clear')?.classList.add('hidden');
        document.getElementById('map-suggestions-categories')?.classList.remove('hidden');
        document.getElementById('map-suggestions-locations').innerHTML = '';
        _clearPlaceMarkers();
        // reset chip to All
        const allChip = document.querySelector("button[onclick^=\"filterMap('all\"]");
        if (allChip) filterMap('all', allChip);
      }

      function showMapSuggestions() {
        const input = document.getElementById('map-search-input');
        const v = _normalizeMapSearch(input?.value);
        if (v.length < 1) return;
        document.getElementById('map-suggestions-box')?.classList.remove('hidden');
        document.getElementById('map-search-clear')?.classList.toggle('hidden', v.length === 0);
      }

      function handleMapSearchInput(value) {
        const v = _normalizeMapSearch(value);
        document.getElementById('map-search-clear')?.classList.toggle('hidden', v.length === 0);
        const box = document.getElementById('map-suggestions-box');

        if (v.length === 0) {
          box?.classList.add('hidden');
          document.getElementById('map-suggestions-categories')?.classList.remove('hidden');
          document.getElementById('map-suggestions-locations').innerHTML = '';
          _clearPlaceMarkers();
          const allChip = document.querySelector("button[onclick^=\"filterMap('all\"]");
          if (allChip) filterMap('all', allChip);
          return;
        }

        // Show dropdown with categories while user types
        box?.classList.remove('hidden');
        // Hide static categories while showing live results
        if (v.length >= 2) {
          document.getElementById('map-suggestions-categories')?.classList.add('hidden');
          // Debounce the Nominatim call
          clearTimeout(_searchDebounceTimer);
          _searchDebounceTimer = setTimeout(() => _runNominatimSearch(v), 450);
        } else {
          document.getElementById('map-suggestions-categories')?.classList.remove('hidden');
          document.getElementById('map-suggestions-locations').innerHTML = '';
        }
      }

      // Strip "near me / nearby / close to me" phrases and return clean query
      function _cleanQuery(raw) {
        return raw
          .replace(/\b(near\s+me|near\s+by|nearby|close\s+to\s+me|around\s+me|in\s+my\s+area|around\s+here)\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }

      // Fetch from Nominatim with a viewbox; bounded=1 means strict area lock
      async function _nominatimFetch(query, lat, lng, radiusDeg, bounded) {
        const vb = `${lng - radiusDeg},${lat - radiusDeg},${lng + radiusDeg},${lat + radiusDeg}`;
        const url = `https://nominatim.openstreetmap.org/search`
          + `?q=${encodeURIComponent(query)}`
          + `&format=json&limit=12&addressdetails=1`
          + `&viewbox=${vb}&bounded=${bounded ? 1 : 0}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        return res.json();
      }

      // Parse raw Nominatim rows → our internal shape, add distKm if user loc known
      function _parseResults(rows, userLat, userLng) {
        return rows.map(r => {
          const lat = parseFloat(r.lat);
          const lng = parseFloat(r.lon);
          const distKm = (userLat != null && userLng != null)
            ? calculateDistance(userLat, userLng, lat, lng)
            : null;
          return {
            lat, lng,
            name: r.name || r.display_name.split(',')[0],
            address: r.display_name,
            type: r.type || '',
            class: r.class || '',
            distKm,
          };
        });
      }

      // Core search: strict 5 km first → relax to 15 km → last resort global
      async function _fetchNearbyPlaces(rawQuery) {
        const query = _cleanQuery(rawQuery);
        const uLat = STATE.userLat;
        const uLng = STATE.userLng;
        const hasLoc = uLat != null && uLng != null;

        let rows = [];
        if (hasLoc) {
          // Pass 1 — strict 5 km radius (bounded=1)
          rows = await _nominatimFetch(query, uLat, uLng, 0.045, true); // ~5 km
          // Pass 2 — relax to ~15 km if too few results
          if (rows.length < 3) {
            rows = await _nominatimFetch(query, uLat, uLng, 0.135, true);
          }
          // Pass 3 — unbounded but still viewbox-biased ~50 km
          if (rows.length < 2) {
            rows = await _nominatimFetch(query, uLat, uLng, 0.45, false);
          }
        } else {
          // No GPS — plain search with India hint
          rows = await _nominatimFetch(query + ' India', 22.7196, 75.8577, 5, false);
        }

        const parsed = _parseResults(rows, uLat, uLng);

        // Sort by distance (closest first) when we have user location
        if (hasLoc) {
          parsed.sort((a, b) => (a.distKm ?? 9999) - (b.distKm ?? 9999));
        }

        // Deduplicate by name+rounded-coords
        const seen = new Set();
        return parsed.filter(r => {
          const key = `${r.name}|${r.lat.toFixed(3)}|${r.lng.toFixed(3)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
      }

      async function _runNominatimSearch(query) {
        _setSearchLoading(true);
        try {
          _placeResults = await _fetchNearbyPlaces(query);
          _renderPlaceSuggestions(_placeResults);
        } catch(e) {
          _renderPlaceSuggestions([]);
        } finally {
          _setSearchLoading(false);
        }
      }

      async function searchPlacesNearby(query) {
        // Called from quick-category buttons in the dropdown
        const input = document.getElementById('map-search-input');
        if (input) input.value = query;
        document.getElementById('map-search-clear')?.classList.remove('hidden');
        document.getElementById('map-suggestions-categories')?.classList.add('hidden');
        document.getElementById('map-suggestions-box')?.classList.remove('hidden');
        _setSearchLoading(true);
        try {
          _placeResults = await _fetchNearbyPlaces(query);
          _renderPlaceSuggestions(_placeResults);
          if (_placeResults.length > 0) _showAllPlaceMarkers(_placeResults);
        } catch(e) {
          _renderPlaceSuggestions([]);
        } finally {
          _setSearchLoading(false);
        }
      }

      function _setSearchLoading(on) {
        document.getElementById('map-search-loading')?.classList.toggle('hidden', !on);
        document.getElementById('map-search-empty')?.classList.add('hidden');
      }

      function _renderPlaceSuggestions(results) {
        const container = document.getElementById('map-suggestions-locations');
        const empty = document.getElementById('map-search-empty');
        container.innerHTML = '';
        if (!results || results.length === 0) {
          empty?.classList.remove('hidden');
          return;
        }
        empty?.classList.add('hidden');
        results.forEach((r, i) => {
          const { emoji, color } = _placeTypeIcon(r.name, r.type);
          const shortAddr = r.address.split(',').slice(1, 3).join(', ');
          const distLabel = r.distKm != null
            ? `<span style="font-size:10px;font-weight:700;color:#1a73e8;background:#e8f0fe;border-radius:9999px;padding:1px 7px;white-space:nowrap;flex-shrink:0">${r.distKm < 1 ? (r.distKm * 1000).toFixed(0) + ' m' : r.distKm.toFixed(1) + ' km'}</span>`
            : '';
          const div = document.createElement('div');
          div.className = 'flex items-center gap-3 px-4 py-2.5 hover:bg-surface-container-low cursor-pointer border-b border-border-base/30 last:border-0';
          div.innerHTML = `
            <div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${emoji}</div>
            <div class="flex-1 min-w-0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <p class="text-body-md font-bold text-on-surface truncate leading-tight" style="margin:0">${r.name}</p>
                ${distLabel}
              </div>
              <p class="text-caption text-text-muted truncate">${shortAddr || r.address.slice(0,60)}</p>
            </div>
            <button onclick="event.stopPropagation();navigateToPlace(${i})" title="Navigate" style="flex-shrink:0;width:30px;height:30px;border-radius:50%;background:#1a73e8;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer">
              <span class="material-symbols-outlined text-white" style="font-size:16px;font-variation-settings:'FILL' 1">navigation</span>
            </button>`;
          div.addEventListener('click', () => focusPlaceOnMap(i));
          container.appendChild(div);
        });
        // Show all on map
        _showAllPlaceMarkers(results);
      }

      function _clearPlaceMarkers() {
        if (_placeMarkerLayer && STATE.mapInstance) {
          STATE.mapInstance.removeLayer(_placeMarkerLayer);
          _placeMarkerLayer = null;
        }
      }

      function _showAllPlaceMarkers(results) {
        if (!STATE.mapInstance) return;
        _clearPlaceMarkers();
        _placeMarkerLayer = L.layerGroup().addTo(STATE.mapInstance);
        results.forEach((r, i) => {
          const { emoji, color } = _placeTypeIcon(r.name, r.type);
          const icon = L.divIcon({
            html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 10px rgba(0,0,0,0.25);cursor:pointer">${emoji}</div>`,
            iconSize: [34, 34], iconAnchor: [17, 17], className: '',
          });
          L.marker([r.lat, r.lng], { icon })
            .addTo(_placeMarkerLayer)
            .on('click', () => focusPlaceOnMap(i));
        });
        // Fit map to results
        if (results.length > 0) {
          const latlngs = results.map(r => [r.lat, r.lng]);
          STATE.mapInstance.fitBounds(L.latLngBounds(latlngs).pad(0.25), { maxZoom: 16 });
        }
      }

      function focusPlaceOnMap(idx) {
        const r = _placeResults[idx];
        if (!r || !STATE.mapInstance) return;
        // Hide suggestions
        document.getElementById('map-suggestions-box')?.classList.add('hidden');
        // Pan & zoom
        STATE.mapInstance.setView([r.lat, r.lng], 17, { animate: true });
        // Show popup card
        const { emoji, color } = _placeTypeIcon(r.name, r.type);
        const dist = (STATE.userLat && STATE.userLng && r.distKm != null)
          ? ` · ${r.distKm < 1 ? (r.distKm * 1000).toFixed(0) + ' m' : r.distKm.toFixed(1) + ' km'} away`
          : '';
        const shortAddr = r.address.split(',').slice(1, 3).join(', ');
        document.getElementById('map-popup-content').innerHTML = `
          <div class="flex items-start gap-3 mb-2">
            <div style="width:38px;height:38px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${emoji}</div>
            <div class="flex-1 min-w-0">
              <h4 class="text-body-lg text-on-surface font-bold leading-tight">${r.name}</h4>
              <p class="text-caption text-text-muted">${shortAddr || r.type}${dist}</p>
            </div>
          </div>
          <p class="text-caption text-text-muted mb-3 leading-relaxed">${r.address}</p>
          <button onclick="navigateToPlace(${idx})" class="w-full py-2.5 bg-blue-600 text-white rounded-lg text-label-bold font-bold flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">navigation</span>
            Navigate Here
          </button>`;
        document.getElementById('map-popup').classList.add('show');
      }

      function navigateToPlace(idx) {
        const r = _placeResults[idx];
        if (!r) return;
        document.getElementById('map-suggestions-box')?.classList.add('hidden');
        navigateToAlert(r.lat, r.lng, r.name);
      }

