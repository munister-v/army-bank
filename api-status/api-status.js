(function () {
  'use strict';

  var BASE = 'https://army-bank.onrender.com';
  var endpointRows = document.getElementById('endpoint-rows');
  var tokenInput = document.getElementById('bearer-token');
  var rerunBtn = document.getElementById('rerun-btn');
  var rowsModel = [];

  function setText(id, text, className) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('state-ok', 'state-auth', 'state-warn', 'state-bad', 'state-muted');
    if (className) el.classList.add(className);
  }

  function escapeHtml(v) {
    return String(v)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
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

  async function loadCore() {
    var checks = [
      { id: 'health', url: '/health', parser: function () { return 'UP'; } },
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
      } catch (e) {
        setText('c-' + c.id, 'error', 'state-bad');
        setText('c-' + c.id + '-ms', 'мережева помилка', null);
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

  function renderRows() {
    if (!rowsModel.length) {
      endpointRows.innerHTML = '<tr><td colspan="5" class="placeholder">OpenAPI не завантажено.</td></tr>';
      return;
    }

    endpointRows.innerHTML = rowsModel.map(function (row, idx) {
      return '<tr data-row="' + idx + '">' +
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
  }

  async function checkGetEndpoints() {
    var token = (tokenInput.value || '').trim();
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

  async function loadAll() {
    setText('sum-updated', 'завантаження...', null);

    await loadCore();

    try {
      var api = await timedFetch(BASE + '/api/openapi.json', { cache: 'no-store' });
      var spec = await api.response.json();

      rowsModel = buildRowsFromSpec(spec);
      setSummary(spec);
      renderRows();
      await checkGetEndpoints();
    } catch (e) {
      endpointRows.innerHTML = '<tr><td colspan="5" class="placeholder">Не вдалося завантажити OpenAPI.</td></tr>';
      setText('sum-paths', 'н/д', 'state-bad');
      setText('sum-methods', 'н/д', 'state-bad');
      setText('sum-checked', '0', null);
      setText('sum-updated', new Date().toLocaleString('uk-UA'), null);
    }
  }

  rerunBtn.addEventListener('click', function () {
    checkGetEndpoints();
  });

  loadAll();
})();
