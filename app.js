/* ════════════════════════════════════════════
   ARMYBANK — app.js
   Portfolio redesign v6
════════════════════════════════════════════ */

(function () {
  'use strict';

  /* На Render / localhost — «Відкрити додаток» веде на цей же хост /dashboard */
  if (/onrender\.com$/i.test(location.hostname) || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    document.querySelectorAll('a[href="https://army-bank.onrender.com/dashboard"], a[href="https://army-bank.onrender.com"]').forEach(function (a) {
      a.setAttribute('href', '/dashboard');
      a.removeAttribute('target');
      a.removeAttribute('rel');
    });
  }

  /* ════════════════════════════════════════════
     SMOOTH SCROLL
  ════════════════════════════════════════════ */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href === '#') return;
      var target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ════════════════════════════════════════════
     NAV SCROLL SHADOW
  ════════════════════════════════════════════ */
  var navbar = document.getElementById('navbar');

  function updateNav() {
    if (!navbar) return;
    if (window.scrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  /* ════════════════════════════════════════════
     COUNT-UP ANIMATION (IntersectionObserver)
  ════════════════════════════════════════════ */
  function animateCount(el, target, duration) {
    var start = 0;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease-out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.floor(eased * target);
      el.textContent = current;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target;
      }
    }

    requestAnimationFrame(step);
  }

  var countEls = document.querySelectorAll('[data-count]');

  if ('IntersectionObserver' in window && countEls.length > 0) {
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var target = parseInt(el.getAttribute('data-count'), 10);
          if (!isNaN(target)) {
            animateCount(el, target, 1200);
          }
          countObserver.unobserve(el);
        }
      });
    }, { threshold: 0, rootMargin: '0px 0px -20px 0px' });

    countEls.forEach(function (el) {
      countObserver.observe(el);
    });
  } else {
    // Fallback: just show the numbers immediately
    countEls.forEach(function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      if (!isNaN(target)) el.textContent = target;
    });
  }

  /* ════════════════════════════════════════════
     COPY-TO-CLIPBOARD ON CRED VALUES
  ════════════════════════════════════════════ */
  document.querySelectorAll('.cred-copyable').forEach(function (el) {
    // Inject tooltip element
    var tooltip = document.createElement('span');
    tooltip.className = 'copy-tooltip';
    tooltip.textContent = 'Скопійовано!';
    el.style.position = 'relative';
    el.appendChild(tooltip);

    el.addEventListener('click', function () {
      var value = el.getAttribute('data-copy');
      if (!value) return;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () {
          showCopied(el);
        }).catch(function () {
          fallbackCopy(value);
          showCopied(el);
        });
      } else {
        fallbackCopy(value);
        showCopied(el);
      }
    });
  });

  function showCopied(el) {
    el.classList.add('copied');
    setTimeout(function () {
      el.classList.remove('copied');
    }, 1600);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  /* ════════════════════════════════════════════
     COUNT-UP: animate big numbers when visible
     (already handled above — no entrance hide)
  ════════════════════════════════════════════ */

  /* ════════ HAMBURGER MENU ════════ */
  var burger = document.querySelector('.nav-burger');
  var mobileNav = document.querySelector('.nav-mobile');
  if (burger && navbar) {
    burger.addEventListener('click', function () {
      var isOpen = navbar.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    // Close on link click
    if (mobileNav) {
      mobileNav.querySelectorAll('a').forEach(function(link) {
        link.addEventListener('click', function() {
          navbar.classList.remove('nav-open');
          burger.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  /* ════════ RENDER WARM-UP PING ════════ */
  // Silently wake up the Render backend when the landing page loads.
  // By the time the visitor clicks "Open platform" (~20-40s later), server is ready.
  setTimeout(function () {
    fetch('https://army-bank.onrender.com/api/health', {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store'
    }).catch(function () { /* silent — cold start in progress */ });
  }, 800); // slight delay so it doesn't compete with page render



  /* ════════ LIVE API STATUS (landing) ════════ */
  function setLiveText(id, value, good) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    el.classList.remove('ok', 'bad', 'muted');
    if (good === true) el.classList.add('ok');
    else if (good === false) el.classList.add('bad');
    else el.classList.add('muted');
  }

  function setProbe(prefix, stateText, tone, metaText) {
    var stateEl = document.getElementById(prefix + '-state');
    var metaEl = document.getElementById(prefix + '-meta');

    if (stateEl) {
      stateEl.textContent = stateText;
      stateEl.classList.remove('ok', 'warn', 'bad', 'muted', 'auth');
      stateEl.classList.add(tone || 'muted');
    }

    if (metaEl) {
      metaEl.textContent = metaText || '—';
    }
  }

  function setMiniMetric(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function timedFetch(url, options) {
    var started = performance.now();
    return fetch(url, options || {}).then(function (response) {
      return {
        response: response,
        ms: Math.round(performance.now() - started)
      };
    });
  }

  function timedJson(url) {
    return timedFetch(url, { cache: 'no-store' }).then(function (out) {
      return out.response.json().then(function (json) {
        out.json = json;
        return out;
      }).catch(function () {
        out.json = null;
        return out;
      });
    });
  }

  function markLiveUpdated() {
    var el = document.getElementById('ls-updated');
    if (!el) return;
    el.textContent = new Date().toLocaleString('uk-UA');
  }

  var MODULE_DEFS = [
    { key: 'auth', label: 'Auth', prefixes: ['/api/auth'] },
    { key: 'transactions', label: 'Transactions', prefixes: ['/api/transactions'] },
    { key: 'cards', label: 'Cards', prefixes: ['/api/cards'] },
    { key: 'admin', label: 'Admin', prefixes: ['/api/admin'] },
    { key: 'operator', label: 'Operator', prefixes: ['/api/operator'] },
    { key: 'platform', label: 'Platform', prefixes: ['/api/platform'] },
    { key: 'push', label: 'Push', prefixes: ['/api/push'] },
    { key: 'documents', label: 'Documents', prefixes: ['/api/document', '/api/documents'] }
  ];

  var MODULE_MAP = {};
  for (var mm = 0; mm < MODULE_DEFS.length; mm++) {
    MODULE_MAP[MODULE_DEFS[mm].key] = MODULE_DEFS[mm];
  }

  var MODULE_FILTER_STORAGE_KEY = 'ab_landing_module_filter_v1';
  var PROBE_HISTORY_STORAGE_KEY = 'ab_landing_probe_history_v1';
  var PROBE_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
  var PROBE_HISTORY_LIMIT = 96;
  var PROBE_TIMELINE_POINTS = 24;
  var PROBE_KEYS = ['health', 'version', 'openapi', 'docs'];
  var LIVE_REFRESH_INTERVAL_MS = 60 * 1000;
  var LIVE_AUTO_STORAGE_KEY = 'ab_landing_live_auto_v1';

  var selectedModule = loadStoredModuleFilter();
  var openapiEndpointRows = [];
  var probeHistory = loadProbeHistory();
  var liveAutoEnabled = loadLiveAutoEnabled();
  var liveRefreshIntervalId = null;
  var liveCountdownIntervalId = null;
  var liveCountdownRemainingSec = Math.floor(LIVE_REFRESH_INTERVAL_MS / 1000);
  var isLiveLoading = false;

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getModuleLabel(key) {
    if (key && MODULE_MAP[key]) return MODULE_MAP[key].label;
    return 'Other';
  }

  function detectModuleKey(path) {
    for (var i = 0; i < MODULE_DEFS.length; i++) {
      var mod = MODULE_DEFS[i];
      for (var j = 0; j < mod.prefixes.length; j++) {
        if (String(path).indexOf(mod.prefixes[j]) === 0) return mod.key;
      }
    }
    return 'other';
  }

  function endpointMethodClass(method) {
    var m = String(method || '').toLowerCase();
    if (m === 'get') return 'get';
    if (m === 'post') return 'post';
    if (m === 'put') return 'put';
    if (m === 'patch') return 'patch';
    if (m === 'delete') return 'delete';
    return '';
  }

  function loadStoredModuleFilter() {
    try {
      var saved = localStorage.getItem(MODULE_FILTER_STORAGE_KEY);
      if (saved === 'all' || MODULE_MAP[saved]) return saved;
    } catch (e) {
      // ignore storage errors
    }
    return 'all';
  }

  function loadLiveAutoEnabled() {
    try {
      var saved = localStorage.getItem(LIVE_AUTO_STORAGE_KEY);
      if (saved === 'off') return false;
    } catch (e) {
      // ignore storage errors
    }
    return true;
  }

  function persistLiveAutoEnabled() {
    try {
      localStorage.setItem(LIVE_AUTO_STORAGE_KEY, liveAutoEnabled ? 'on' : 'off');
    } catch (e) {
      // ignore storage errors
    }
  }

  function updateLiveControlsUi() {
    var toggleBtn = document.getElementById('live-auto-toggle');
    var stateEl = document.getElementById('live-auto-state');
    var countdownEl = document.getElementById('live-countdown');

    if (toggleBtn) {
      toggleBtn.textContent = liveAutoEnabled ? 'Пауза realtime' : 'Увімкнути realtime';
      toggleBtn.classList.toggle('is-paused', !liveAutoEnabled);
    }

    if (stateEl) {
      stateEl.textContent = liveAutoEnabled ? (isLiveLoading ? 'realtime on · loading' : 'realtime on') : 'realtime paused';
    }

    if (countdownEl) {
      if (!liveAutoEnabled) {
        countdownEl.textContent = 'paused';
      } else if (isLiveLoading) {
        countdownEl.textContent = '...';
      } else {
        countdownEl.textContent = String(liveCountdownRemainingSec) + 's';
      }
    }
  }

  function clearLiveAutoTimers() {
    if (liveRefreshIntervalId) {
      clearInterval(liveRefreshIntervalId);
      liveRefreshIntervalId = null;
    }
    if (liveCountdownIntervalId) {
      clearInterval(liveCountdownIntervalId);
      liveCountdownIntervalId = null;
    }
  }

  function restartLiveAutoTimers() {
    clearLiveAutoTimers();

    if (!liveAutoEnabled) {
      updateLiveControlsUi();
      return;
    }

    liveCountdownRemainingSec = Math.floor(LIVE_REFRESH_INTERVAL_MS / 1000);
    updateLiveControlsUi();

    liveCountdownIntervalId = setInterval(function () {
      if (!liveAutoEnabled) return;
      if (liveCountdownRemainingSec > 0) {
        liveCountdownRemainingSec -= 1;
      } else {
        liveCountdownRemainingSec = Math.floor(LIVE_REFRESH_INTERVAL_MS / 1000);
      }
      updateLiveControlsUi();
    }, 1000);

    liveRefreshIntervalId = setInterval(function () {
      if (!liveAutoEnabled) return;
      liveCountdownRemainingSec = Math.floor(LIVE_REFRESH_INTERVAL_MS / 1000);
      updateLiveControlsUi();
      loadLiveStatus();
    }, LIVE_REFRESH_INTERVAL_MS);
  }

  function bindLiveControls() {
    var toggleBtn = document.getElementById('live-auto-toggle');
    var refreshBtn = document.getElementById('live-refresh-now');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        liveAutoEnabled = !liveAutoEnabled;
        persistLiveAutoEnabled();
        restartLiveAutoTimers();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        liveCountdownRemainingSec = Math.floor(LIVE_REFRESH_INTERVAL_MS / 1000);
        updateLiveControlsUi();
        loadLiveStatus();
      });
    }

    updateLiveControlsUi();
  }
  function setModuleCard(key, total, publicCount, protectedCount, methodTotal) {
    var totalEl = document.getElementById('mod-' + key + '-total');
    var metaEl = document.getElementById('mod-' + key + '-meta');
    var barEl = document.getElementById('mod-' + key + '-bar');

    if (totalEl) {
      totalEl.textContent = String(total);
    }
    if (metaEl) {
      if (typeof total === 'string') {
        metaEl.textContent = total;
      } else {
        metaEl.textContent = 'public ' + publicCount + ' · protected ' + protectedCount;
      }
    }
    if (barEl) {
      if (typeof total === 'string') {
        barEl.style.width = '0%';
      } else {
        var ratio = methodTotal > 0 ? Math.round((total / methodTotal) * 100) : 0;
        var width = total > 0 && ratio < 5 ? 5 : ratio;
        barEl.style.width = width + '%';
      }
    }
  }

  function renderModuleTelemetry(moduleStats, methodTotal) {
    MODULE_DEFS.forEach(function (mod) {
      var data = moduleStats[mod.key] || { total: 0, publicCount: 0, protectedCount: 0 };
      setModuleCard(mod.key, data.total, data.publicCount, data.protectedCount, methodTotal);
    });
  }

  function resetModuleTelemetry() {
    MODULE_DEFS.forEach(function (mod) {
      setModuleCard(mod.key, 'н/д', 0, 0, 0);
    });
  }

  function renderModuleEndpointRows() {
    var rowsEl = document.getElementById('module-endpoint-rows');
    var countEl = document.getElementById('module-endpoint-count');
    var summaryEl = document.getElementById('module-filter-summary');

    if (!rowsEl) return;

    if (!openapiEndpointRows.length) {
      rowsEl.innerHTML = '<div class="module-endpoint-empty">OpenAPI endpoint-дані ще не завантажені.</div>';
      if (countEl) countEl.textContent = '0';
      if (summaryEl) summaryEl.textContent = 'Немає даних для фільтрації.';
      return;
    }

    var filtered = selectedModule === 'all'
      ? openapiEndpointRows.slice()
      : openapiEndpointRows.filter(function (row) { return row.moduleKey === selectedModule; });

    if (countEl) countEl.textContent = String(filtered.length);

    if (summaryEl) {
      var label = selectedModule === 'all' ? 'All modules' : getModuleLabel(selectedModule);
      summaryEl.textContent = label + ': ' + filtered.length + ' з ' + openapiEndpointRows.length + ' методів';
    }

    if (!filtered.length) {
      rowsEl.innerHTML = '<div class="module-endpoint-empty">Для цього модуля endpoint-методів не знайдено.</div>';
      return;
    }

    var limit = 14;
    var visible = filtered.slice(0, limit);

    rowsEl.innerHTML = visible.map(function (row) {
      return '<div class="module-endpoint-row">' +
        '<span class="me-method ' + endpointMethodClass(row.method) + '">' + escapeHtml(row.method) + '</span>' +
        '<code class="module-endpoint-path" title="' + escapeHtml(row.path) + '">' + escapeHtml(row.path) + '</code>' +
        '<span class="module-endpoint-auth' + (row.auth ? ' protected' : '') + '">' + (row.auth ? 'protected' : 'public') + '</span>' +
        '<span class="module-endpoint-module">' + escapeHtml(getModuleLabel(row.moduleKey)) + '</span>' +
      '</div>';
    }).join('');

    if (filtered.length > limit) {
      rowsEl.innerHTML += '<div class="module-endpoint-empty">Показано перші ' + limit + ' записів із ' + filtered.length + '.</div>';
    }
  }

  function createEmptyProbeHistory() {
    return { health: [], version: [], openapi: [], docs: [] };
  }

  function pruneProbeHistory() {
    var cutoff = Date.now() - PROBE_HISTORY_WINDOW_MS;

    PROBE_KEYS.forEach(function (key) {
      var list = Array.isArray(probeHistory[key]) ? probeHistory[key] : [];
      list = list.filter(function (item) {
        return item && typeof item.ts === 'number' && typeof item.state === 'string' && item.ts >= cutoff;
      });
      if (list.length > PROBE_HISTORY_LIMIT) {
        list = list.slice(-PROBE_HISTORY_LIMIT);
      }
      probeHistory[key] = list;
    });
  }

  function loadProbeHistory() {
    try {
      var raw = localStorage.getItem(PROBE_HISTORY_STORAGE_KEY);
      if (!raw) {
        return createEmptyProbeHistory();
      }
      var parsed = JSON.parse(raw);
      var result = createEmptyProbeHistory();
      PROBE_KEYS.forEach(function (key) {
        if (Array.isArray(parsed[key])) {
          result[key] = parsed[key];
        }
      });
      probeHistory = result;
      pruneProbeHistory();
      return probeHistory;
    } catch (e) {
      return createEmptyProbeHistory();
    }
  }

  function saveProbeHistory() {
    try {
      localStorage.setItem(PROBE_HISTORY_STORAGE_KEY, JSON.stringify(probeHistory));
    } catch (e) {
      // ignore storage errors
    }
  }

  function timelineTone(state) {
    if (state === 'ok') return 'ok';
    if (state === 'warn') return 'warn';
    if (state === 'bad') return 'bad';
    if (state === 'auth') return 'auth';
    return 'muted';
  }

  function renderProbeTimelines() {
    var tracks = {
      health: { track: 'tl-health-track', ratio: 'tl-health-ratio', label: 'Health' },
      version: { track: 'tl-version-track', ratio: 'tl-version-ratio', label: 'Version' },
      openapi: { track: 'tl-openapi-track', ratio: 'tl-openapi-ratio', label: 'OpenAPI' },
      docs: { track: 'tl-docs-track', ratio: 'tl-docs-ratio', label: 'Docs' }
    };

    pruneProbeHistory();

    PROBE_KEYS.forEach(function (key) {
      var config = tracks[key];
      var trackEl = document.getElementById(config.track);
      var ratioEl = document.getElementById(config.ratio);
      if (!trackEl || !ratioEl) return;

      var recent = (probeHistory[key] || []).slice(-PROBE_TIMELINE_POINTS);
      var padded = recent.slice();
      while (padded.length < PROBE_TIMELINE_POINTS) {
        padded.unshift(null);
      }

      trackEl.innerHTML = padded.map(function (point) {
        if (!point) {
          return '<span class="timeline-dot muted" title="Немає даних"></span>';
        }
        var tone = timelineTone(point.state);
        var timeText = new Date(point.ts).toLocaleString('uk-UA');
        return '<span class="timeline-dot ' + tone + '" title="' + escapeHtml(config.label + ' · ' + point.state + ' · ' + timeText) + '"></span>';
      }).join('');

      var measured = recent.length;
      var okCount = recent.filter(function (item) { return item.state === 'ok'; }).length;
      ratioEl.textContent = measured ? (okCount + '/' + measured + ' ok') : 'нема даних';
    });
  }

  function pushProbePoint(key, state) {
    if (PROBE_KEYS.indexOf(key) === -1) return;

    probeHistory[key].push({
      ts: Date.now(),
      state: state
    });

    pruneProbeHistory();
    saveProbeHistory();
    renderProbeTimelines();
  }

  function analyzeOpenApi(spec) {
    var paths = spec && spec.paths ? spec.paths : {};
    var globalSec = Array.isArray(spec && spec.security) && spec.security.length > 0;
    var moduleStats = {};

    MODULE_DEFS.forEach(function (mod) {
      moduleStats[mod.key] = { total: 0, publicCount: 0, protectedCount: 0 };
    });

    var out = {
      pathCount: Object.keys(paths).length,
      methodCount: 0,
      publicCount: 0,
      protectedCount: 0,
      getCount: 0,
      postCount: 0,
      putPatchCount: 0,
      deleteCount: 0,
      moduleStats: moduleStats,
      endpointRows: []
    };

    Object.keys(paths).forEach(function (path) {
      var methods = paths[path] || {};
      Object.keys(methods).forEach(function (method) {
        var m = String(method).toLowerCase();
        if (['get', 'post', 'put', 'patch', 'delete'].indexOf(m) === -1) return;

        out.methodCount += 1;
        if (m === 'get') out.getCount += 1;
        if (m === 'post') out.postCount += 1;
        if (m === 'put' || m === 'patch') out.putPatchCount += 1;
        if (m === 'delete') out.deleteCount += 1;

        var op = methods[method] || {};
        var auth = (Array.isArray(op.security) && op.security.length > 0) || (globalSec && op.security !== null);
        if (auth) out.protectedCount += 1;
        else out.publicCount += 1;

        var modKey = detectModuleKey(path);
        if (MODULE_MAP[modKey] && out.moduleStats[modKey]) {
          out.moduleStats[modKey].total += 1;
          if (auth) out.moduleStats[modKey].protectedCount += 1;
          else out.moduleStats[modKey].publicCount += 1;
        }

        out.endpointRows.push({
          moduleKey: modKey,
          method: String(method).toUpperCase(),
          path: path,
          auth: auth
        });
      });
    });

    out.endpointRows.sort(function (a, b) {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

    return out;
  }
  function renderUnavailableLiveState() {
    setLiveText('ls-version', 'н/д', null);
    setLiveText('ls-health', 'н/д', null);
    setLiveText('ls-paths', 'н/д', null);
    setLiveText('ls-methods', 'н/д', null);
    setLiveText('ls-protected-card', 'н/д', null);
    setLiveText('ls-latency', 'н/д', null);

    setProbe('probe-health', 'n/a', 'muted', '—');
    pushProbePoint('health', 'bad');
    setProbe('probe-version', 'n/a', 'muted', '—');
    pushProbePoint('version', 'bad');
    setProbe('probe-openapi', 'n/a', 'muted', '—');
    pushProbePoint('openapi', 'bad');
    setProbe('probe-docs', 'n/a', 'muted', '—');
    pushProbePoint('docs', 'bad');

    setMiniMetric('ls-public-methods', 'н/д');
    setMiniMetric('ls-protected-methods', 'н/д');
    setMiniMetric('ls-get-methods', 'н/д');
    setMiniMetric('ls-post-methods', 'н/д');
    setMiniMetric('ls-putpatch-methods', 'н/д');
    setMiniMetric('ls-delete-methods', 'н/д');

    var trustMethods = document.getElementById('trust-api-count');
    var trustPaths = document.getElementById('trust-path-count');
    var heroMethods = document.getElementById('hero-api-methods');
    var heroPaths = document.getElementById('hero-api-paths');
    var heroHealth = document.getElementById('hero-api-health');

    if (trustMethods) trustMethods.textContent = 'н/д';
    if (trustPaths) trustPaths.textContent = 'н/д';
    if (heroMethods) heroMethods.textContent = 'н/д';
    if (heroPaths) heroPaths.textContent = 'н/д';
    if (heroHealth) heroHealth.textContent = 'n/a';

    resetModuleTelemetry();
    openapiEndpointRows = [];
    renderModuleEndpointRows();
    markLiveUpdated();
  }

  function loadLiveStatus() {
    if (!document.getElementById('ls-version')) return Promise.resolve();
    if (isLiveLoading) return Promise.resolve();

    isLiveLoading = true;
    updateLiveControlsUi();

    var base = 'https://army-bank.onrender.com';

    return Promise.allSettled([
      timedJson(base + '/api/version'),
      timedJson(base + '/health'),
      timedJson(base + '/api/openapi.json'),
      timedFetch(base + '/api/docs', { cache: 'no-store' })
    ]).then(function (results) {
      var versionRes = results[0];
      var healthRes = results[1];
      var openapiRes = results[2];
      var docsRes = results[3];
      var latencies = [];

      if (versionRes.status === 'fulfilled') {
        var vOut = versionRes.value;
        var vResp = vOut.response;
        var vJson = vOut.json || {};
        var versionText = vJson.api_version || vJson.version || (vResp.ok ? 'ok' : 'HTTP ' + vResp.status);

        setLiveText('ls-version', versionText, vResp.ok);
        setProbe('probe-version', vResp.ok ? 'ok' : ('HTTP ' + vResp.status), vResp.ok ? 'ok' : 'warn', vResp.status + ' · ' + vOut.ms + ' ms');
        latencies.push(vOut.ms);
        pushProbePoint('version', vResp.ok ? 'ok' : 'warn');
      } else {
        setLiveText('ls-version', 'н/д', null);
        setProbe('probe-version', 'n/a', 'muted', '—');
        pushProbePoint('version', 'bad');
      }

      if (healthRes.status === 'fulfilled') {
        var hOut = healthRes.value;
        var hResp = hOut.response;
        var hJson = hOut.json || {};
        var isUp = !!hResp.ok && (typeof hJson.ok === 'undefined' || !!hJson.ok);
        var healthText = isUp ? 'UP (' + hResp.status + ')' : ('DOWN (' + hResp.status + ')');

        setLiveText('ls-health', healthText, isUp);
        setProbe('probe-health', isUp ? 'up' : 'down', isUp ? 'ok' : 'bad', hResp.status + ' · ' + hOut.ms + ' ms');
        latencies.push(hOut.ms);
        pushProbePoint('health', isUp ? 'ok' : 'bad');

        var heroHealth = document.getElementById('hero-api-health');
        if (heroHealth) heroHealth.textContent = isUp ? 'UP' : 'DOWN';
      } else {
        setLiveText('ls-health', 'н/д', null);
        setProbe('probe-health', 'n/a', 'muted', '—');
        pushProbePoint('health', 'bad');

        var heroHealthFail = document.getElementById('hero-api-health');
        if (heroHealthFail) heroHealthFail.textContent = 'n/a';
      }

      if (openapiRes.status === 'fulfilled') {
        var oOut = openapiRes.value;
        var oResp = oOut.response;
        var spec = oOut.json || {};

        if (oResp.ok && spec.paths) {
          var stats = analyzeOpenApi(spec);

          setLiveText('ls-paths', String(stats.pathCount), true);
          setLiveText('ls-methods', String(stats.methodCount), true);
          setLiveText('ls-protected-card', String(stats.protectedCount), stats.protectedCount > 0 ? true : null);

          setMiniMetric('ls-public-methods', String(stats.publicCount));
          setMiniMetric('ls-protected-methods', String(stats.protectedCount));
          setMiniMetric('ls-get-methods', String(stats.getCount));
          setMiniMetric('ls-post-methods', String(stats.postCount));
          setMiniMetric('ls-putpatch-methods', String(stats.putPatchCount));
          setMiniMetric('ls-delete-methods', String(stats.deleteCount));
          renderModuleTelemetry(stats.moduleStats, stats.methodCount);
          openapiEndpointRows = stats.endpointRows.slice();
          renderModuleEndpointRows();

          setProbe('probe-openapi', 'loaded', 'ok', oResp.status + ' · ' + oOut.ms + ' ms');
          latencies.push(oOut.ms);
          pushProbePoint('openapi', 'ok');

          var trustMethods = document.getElementById('trust-api-count');
          var trustPaths = document.getElementById('trust-path-count');
          var heroMethods = document.getElementById('hero-api-methods');
          var heroPaths = document.getElementById('hero-api-paths');

          if (trustMethods) trustMethods.textContent = String(stats.methodCount);
          if (trustPaths) trustPaths.textContent = String(stats.pathCount);
          if (heroMethods) heroMethods.textContent = String(stats.methodCount);
          if (heroPaths) heroPaths.textContent = String(stats.pathCount);
        } else {
          setLiveText('ls-paths', 'н/д', null);
          setLiveText('ls-methods', 'н/д', null);
          setLiveText('ls-protected-card', 'н/д', null);
          setMiniMetric('ls-public-methods', 'н/д');
          setMiniMetric('ls-protected-methods', 'н/д');
          setMiniMetric('ls-get-methods', 'н/д');
          setMiniMetric('ls-post-methods', 'н/д');
          setMiniMetric('ls-putpatch-methods', 'н/д');
          setMiniMetric('ls-delete-methods', 'н/д');
          resetModuleTelemetry();
          openapiEndpointRows = [];
          renderModuleEndpointRows();
          setProbe('probe-openapi', 'invalid', 'warn', oResp.status + ' · ' + oOut.ms + ' ms');
          pushProbePoint('openapi', 'warn');

          var trustMethodsFail = document.getElementById('trust-api-count');
          var trustPathsFail = document.getElementById('trust-path-count');
          var heroMethodsFail = document.getElementById('hero-api-methods');
          var heroPathsFail = document.getElementById('hero-api-paths');

          if (trustMethodsFail) trustMethodsFail.textContent = 'н/д';
          if (trustPathsFail) trustPathsFail.textContent = 'н/д';
          if (heroMethodsFail) heroMethodsFail.textContent = 'н/д';
          if (heroPathsFail) heroPathsFail.textContent = 'н/д';
        }
      } else {
        setLiveText('ls-paths', 'н/д', null);
        setLiveText('ls-methods', 'н/д', null);
        setLiveText('ls-protected-card', 'н/д', null);
        setMiniMetric('ls-public-methods', 'н/д');
        setMiniMetric('ls-protected-methods', 'н/д');
        setMiniMetric('ls-get-methods', 'н/д');
        setMiniMetric('ls-post-methods', 'н/д');
        setMiniMetric('ls-putpatch-methods', 'н/д');
        setMiniMetric('ls-delete-methods', 'н/д');
        resetModuleTelemetry();
        openapiEndpointRows = [];
        renderModuleEndpointRows();
        setProbe('probe-openapi', 'n/a', 'muted', '—');
        pushProbePoint('openapi', 'bad');
      }

      if (docsRes.status === 'fulfilled') {
        var dOut = docsRes.value;
        var dResp = dOut.response;
        var docsTone = dResp.ok ? 'ok' : (dResp.status === 401 || dResp.status === 403 ? 'auth' : 'warn');
        var docsState = dResp.ok ? 'open' : ('HTTP ' + dResp.status);

        setProbe('probe-docs', docsState, docsTone, dResp.status + ' · ' + dOut.ms + ' ms');
        latencies.push(dOut.ms);
        pushProbePoint('docs', docsTone);
      } else {
        setProbe('probe-docs', 'n/a', 'muted', '—');
        pushProbePoint('docs', 'bad');
      }

      if (latencies.length > 0) {
        var sum = latencies.reduce(function (acc, ms) { return acc + ms; }, 0);
        var avg = Math.round(sum / latencies.length);
        setLiveText('ls-latency', avg + ' ms', avg <= 450 ? true : avg >= 1200 ? false : null);
      } else {
        setLiveText('ls-latency', 'н/д', null);
      }

      markLiveUpdated();
    }).catch(function () {
      renderUnavailableLiveState();
    }).finally(function () {
      isLiveLoading = false;
      updateLiveControlsUi();
    });
  }
  bindLiveControls();
  bindModuleFilterControls();
  renderModuleEndpointRows();
  renderProbeTimelines();
  loadLiveStatus().finally(function () {
    restartLiveAutoTimers();
  });

  /* ════════ FAQ ACCORDION ════════ */
  document.querySelectorAll('.faq-trigger').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.faq-item');
      if (!item) return;
      var open = !item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function (other) {
        if (other !== item) {
          other.classList.remove('open');
          var b = other.querySelector('.faq-trigger');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  console.log('ArmyBank v1.9.0 — portfolio project by Viacheslav Munister');
})();
