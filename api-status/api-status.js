(function () {
  'use strict';

  var BASE = 'https://army-bank.onrender.com';
  var HISTORY_KEY = 'ab_api_uptime_history_v2';
  var HISTORY_LIMIT = 48;

  var endpointRows = document.getElementById('endpoint-rows');
  var tokenInput = document.getElementById('bearer-token');
  var rerunBtn = document.getElementById('rerun-btn');

  var modeButtons = {
    presentation: document.getElementById('mode-presentation'),
    engineer: document.getElementById('mode-engineer')
  };

  var filterMethod = document.getElementById('filter-method');
  var filterState = document.getElementById('filter-state');
  var filterSearch = document.getElementById('filter-search');
  var filterCount = document.getElementById('filter-count');

  var uptimeTrack = document.getElementById('uptime-track');
  var uptimeRatio = document.getElementById('uptime-ratio');
  var uptimeCaption = document.getElementById('uptime-caption');

  var rowsModel = [];
  var uptimeHistory = loadHistory();

  function setText(id, text, className) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('state-ok', 'state-auth', 'state-warn', 'state-bad', 'state-muted');
    if (className) el.classList.add(className);
  }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function methodClass(method) {
    var m = method.toLowerCase();
    if (m === 'get') return 'm-get';
    if (m === 'post') return 'm-post';
    if (m === 'put') return 'm-put';
    if (m === 'patch') return 'm-patch';
    if (m === 'delete') return 'm-delete';
    return '';
  }

  function stateClass(state) {
    if (state === 'ok') return 'state-ok';
    if (state === 'auth') return 'state-auth';
    if (state === 'warn') return 'state-warn';
    if (state === 'bad') return 'state-bad';
    return 'state-muted';
  }

  function hasPathParams(path) {
    return /\{[^}]+\}/.test(path);
  }

  function globalSecurity(spec) {
    return Array.isArray(spec.security) && spec.security.length > 0;
  }

  async function timedFetch(url, options) {
    var start = performance.now();
    var response = await fetch(url, options || {});
    var ms = Math.round(performance.now() - start);
    return { response: response, ms: ms };
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (item) {
        return item && typeof item.state === 'string' && typeof item.ts === 'number';
      }).slice(-HISTORY_LIMIT);
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(uptimeHistory.slice(-HISTORY_LIMIT)));
    } catch (e) {
      // Ignore storage errors in private mode.
    }
  }

  function pushHistory(state, status, ms) {
    uptimeHistory.push({
      state: state,
      status: status,
      ms: ms,
      ts: Date.now()
    });
    if (uptimeHistory.length > HISTORY_LIMIT) {
      uptimeHistory = uptimeHistory.slice(-HISTORY_LIMIT);
    }
    saveHistory();
    renderUptime();
  }

  function stateLabel(state) {
    if (state === 'ok') return 'OK';
    if (state === 'auth') return 'AUTH';
    if (state === 'warn') return 'WARN';
    if (state === 'bad') return 'BAD';
    return 'N/A';
  }

  function renderUptime() {
    if (!uptimeTrack || !uptimeRatio || !uptimeCaption) return;

    var padded = uptimeHistory.slice(-HISTORY_LIMIT);
    while (padded.length < HISTORY_LIMIT) {
      padded.unshift(null);
    }

    uptimeTrack.innerHTML = padded.map(function (point) {
      if (!point) {
        return '<span class="uptime-dot" title="Немає даних"></span>';
      }
      var label = stateLabel(point.state);
      var dt = new Date(point.ts).toLocaleString('uk-UA');
      var tail = typeof point.status === 'number' ? (' · HTTP ' + point.status) : '';
      var ms = typeof point.ms === 'number' ? (' · ' + point.ms + ' ms') : '';
      return '<span class="uptime-dot ' + escapeHtml(point.state) + '" title="' + escapeHtml(label + ' · ' + dt + tail + ms) + '"></span>';
    }).join('');

    var measured = uptimeHistory.length;
    var okCount = uptimeHistory.filter(function (item) { return item.state === 'ok'; }).length;
    var ratio = measured ? ((okCount / measured) * 100).toFixed(1) : '0.0';
    uptimeRatio.textContent = ratio + '% ok (' + okCount + '/' + measured + ')';

    if (!measured) {
      uptimeCaption.textContent = 'Очікування перших вимірювань...';
      return;
    }

    var last = uptimeHistory[uptimeHistory.length - 1];
    uptimeCaption.textContent = 'Остання перевірка: ' + new Date(last.ts).toLocaleString('uk-UA') + ' · ' + stateLabel(last.state) + (typeof last.status === 'number' ? (' · HTTP ' + last.status) : '');
  }

  function setMode(mode) {
    var normalized = mode === 'presentation' ? 'presentation' : 'engineer';
    document.body.classList.remove('mode-presentation', 'mode-engineer');
    document.body.classList.add('mode-' + normalized);

    if (modeButtons.presentation) {
      modeButtons.presentation.classList.toggle('is-active', normalized === 'presentation');
    }
    if (modeButtons.engineer) {
      modeButtons.engineer.classList.toggle('is-active', normalized === 'engineer');
    }

    try {
      localStorage.setItem('ab_api_status_mode', normalized);
    } catch (e) {
      // Ignore storage errors.
    }
  }

  function initModeSwitch() {
    var stored = null;
    try {
      stored = localStorage.getItem('ab_api_status_mode');
    } catch (e) {
      stored = null;
    }
    setMode(stored || 'engineer');

    if (modeButtons.presentation) {
      modeButtons.presentation.addEventListener('click', function () { setMode('presentation'); });
    }
    if (modeButtons.engineer) {
      modeButtons.engineer.addEventListener('click', function () { setMode('engineer'); });
    }
  }

  async function loadCore() {
    var checks = [
      { id: 'health', url: '/health', parser: function () { return 'UP'; }, isUptimeSignal: true },
      { id: 'version', url: '/api/version', parser: function (json) { return (json && (json.api_version || json.version)) || 'ok'; } },
      { id: 'openapi', url: '/api/openapi.json', parser: function (json) { return json && json.paths ? 'loaded' : 'invalid'; } },
      { id: 'docs', url: '/api/docs', parser: function (_, res) { return res.status === 200 ? 'open' : String(res.status); } }
    ];

    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      try {
        var out = await timedFetch(BASE + c.url, { cache: 'no-store' });
        var body = null;
        var ct = out.response.headers.get('content-type') || '';
        if (ct.indexOf('application/json') >= 0) {
          body = await out.response.json();
        }

        var parsed = c.parser(body, out.response);
        var state = out.response.ok ? 'state-ok' : (out.response.status === 401 || out.response.status === 403 ? 'state-auth' : 'state-warn');
        setText('c-' + c.id, parsed, state);
        setText('c-' + c.id + '-ms', out.response.status + ' · ' + out.ms + ' ms', null);

        if (c.isUptimeSignal) {
          var uptimeState = out.response.ok ? 'ok' : (out.response.status === 401 || out.response.status === 403 ? 'auth' : 'bad');
          pushHistory(uptimeState, out.response.status, out.ms);
        }
      } catch (e) {
        setText('c-' + c.id, 'error', 'state-bad');
        setText('c-' + c.id + '-ms', 'мережева помилка', null);

        if (c.isUptimeSignal) {
          pushHistory('bad', null, null);
        }
      }
    }
  }

  function buildRowsFromSpec(spec) {
    var items = [];
    var paths = spec.paths || {};
    var gSec = globalSecurity(spec);

    Object.keys(paths).sort().forEach(function (path) {
      var methods = paths[path] || {};
      Object.keys(methods).forEach(function (method) {
        var op = methods[method] || {};
        var auth = (Array.isArray(op.security) && op.security.length > 0) || (gSec && op.security !== null);
        var checkable = method.toLowerCase() === 'get' && !hasPathParams(path);

        items.push({
          method: method.toUpperCase(),
          path: path,
          auth: auth,
          operationId: op.operationId || '-',
          checkable: checkable,
          checkState: checkable ? 'pending' : 'manual',
          checkText: checkable ? 'pending' : 'manual'
        });
      });
    });

    items.sort(function (a, b) {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

    return items;
  }

  function getFilteredRows() {
    var method = filterMethod ? filterMethod.value : 'ALL';
    var state = filterState ? filterState.value : 'all';
    var search = (filterSearch && filterSearch.value ? filterSearch.value : '').trim().toLowerCase();

    return rowsModel.filter(function (row) {
      if (method !== 'ALL' && row.method !== method) return false;
      if (state !== 'all' && row.checkState !== state) return false;
      if (search && (row.path + ' ' + row.operationId).toLowerCase().indexOf(search) === -1) return false;
      return true;
    });
  }

  function updateFilterCount(count) {
    if (!filterCount) return;
    filterCount.textContent = String(count);
  }

  function renderRows() {
    if (!endpointRows) return;

    if (!rowsModel.length) {
      endpointRows.innerHTML = '<tr><td colspan="5" class="placeholder">OpenAPI не завантажено.</td></tr>';
      updateFilterCount(0);
      return;
    }

    var rows = getFilteredRows();
    updateFilterCount(rows.length);

    if (!rows.length) {
      endpointRows.innerHTML = '<tr><td colspan="5" class="placeholder">Немає записів за цими фільтрами.</td></tr>';
      return;
    }

    endpointRows.innerHTML = rows.map(function (row) {
      return '<tr>' +
        '<td><span class="badge ' + methodClass(row.method) + '">' + escapeHtml(row.method) + '</span></td>' +
        '<td><code>' + escapeHtml(row.path) + '</code></td>' +
        '<td>' + (row.auth ? '<span class="state-auth">required</span>' : '<span class="state-ok">public</span>') + '</td>' +
        '<td><code>' + escapeHtml(row.operationId) + '</code></td>' +
        '<td class="' + stateClass(row.checkState) + '">' + escapeHtml(row.checkText) + '</td>' +
      '</tr>';
    }).join('');
  }

  function setSummary(spec) {
    var paths = spec.paths || {};
    var pathCount = Object.keys(paths).length;
    var methodCount = 0;

    Object.keys(paths).forEach(function (p) {
      Object.keys(paths[p] || {}).forEach(function (m) {
        if (['get', 'post', 'put', 'patch', 'delete'].indexOf(m.toLowerCase()) >= 0) methodCount += 1;
      });
    });

    setText('sum-paths', String(pathCount), null);
    setText('sum-methods', String(methodCount), null);

    var publicCount = 0;
    var protectedCount = 0;
    var autoGetCount = 0;
    var manualCount = 0;

    rowsModel.forEach(function (row) {
      if (row.auth) protectedCount += 1;
      else publicCount += 1;
      if (row.checkable) autoGetCount += 1;
      else manualCount += 1;
    });

    setText('sum-public', String(publicCount), null);
    setText('sum-protected', String(protectedCount), null);
    setText('sum-autoget', String(autoGetCount), null);
    setText('sum-manual', String(manualCount), null);
  }

  async function checkGetEndpoints() {
    var token = tokenInput ? (tokenInput.value || '').trim() : '';
    var checked = 0;

    for (var i = 0; i < rowsModel.length; i++) {
      var row = rowsModel[i];
      if (!row.checkable) continue;

      checked += 1;
      var headers = { Accept: 'application/json' };
      if (token) headers.Authorization = token.indexOf('Bearer ') === 0 ? token : 'Bearer ' + token;

      try {
        var out = await timedFetch(BASE + row.path, { method: 'GET', headers: headers, cache: 'no-store' });
        var s = out.response.status;
        if (s >= 200 && s < 300) {
          row.checkState = 'ok';
          row.checkText = 'ok · ' + s + ' · ' + out.ms + 'ms';
        } else if (s === 401 || s === 403) {
          row.checkState = 'auth';
          row.checkText = 'auth · ' + s + ' · ' + out.ms + 'ms';
        } else if (s === 404 || s === 405) {
          row.checkState = 'warn';
          row.checkText = 'check · ' + s + ' · ' + out.ms + 'ms';
        } else {
          row.checkState = 'bad';
          row.checkText = 'error · ' + s + ' · ' + out.ms + 'ms';
        }
      } catch (e) {
        row.checkState = 'bad';
        row.checkText = 'network error';
      }
    }

    setText('sum-checked', String(checked), null);
    setText('sum-updated', new Date().toLocaleString('uk-UA'), null);
    renderRows();
  }

  function bindFilters() {
    if (filterMethod) {
      filterMethod.addEventListener('change', renderRows);
    }
    if (filterState) {
      filterState.addEventListener('change', renderRows);
    }
    if (filterSearch) {
      filterSearch.addEventListener('input', renderRows);
    }
  }

  async function runChecks() {
    setText('sum-updated', 'перевірка...', null);
    await loadCore();
    if (rowsModel.length) {
      await checkGetEndpoints();
    } else {
      setText('sum-updated', new Date().toLocaleString('uk-UA'), null);
    }
  }

  async function loadAll() {
    setText('sum-updated', 'завантаження...', null);
    renderUptime();

    await loadCore();

    try {
      var api = await timedFetch(BASE + '/api/openapi.json', { cache: 'no-store' });
      var spec = await api.response.json();

      rowsModel = buildRowsFromSpec(spec);
      setSummary(spec);
      renderRows();
      await checkGetEndpoints();
    } catch (e) {
      if (endpointRows) {
        endpointRows.innerHTML = '<tr><td colspan="5" class="placeholder">Не вдалося завантажити OpenAPI.</td></tr>';
      }
      setText('sum-paths', 'н/д', 'state-bad');
      setText('sum-methods', 'н/д', 'state-bad');
      setText('sum-public', 'н/д', 'state-bad');
      setText('sum-protected', 'н/д', 'state-bad');
      setText('sum-autoget', 'н/д', 'state-bad');
      setText('sum-manual', 'н/д', 'state-bad');
      setText('sum-checked', '0', null);
      setText('sum-updated', new Date().toLocaleString('uk-UA'), null);
      updateFilterCount(0);
    }
  }

  if (rerunBtn) {
    rerunBtn.addEventListener('click', function () {
      runChecks();
    });
  }

  initModeSwitch();
  bindFilters();
  renderUptime();
  loadAll();
})();
