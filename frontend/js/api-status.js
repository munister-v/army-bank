(function () {
  const METHOD_KEYS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  const state = {
    schema: null,
    endpoints: [],
    running: false,
  };

  const els = {
    rows: document.getElementById('endpointRows'),
    preview: document.getElementById('responsePreview'),
    progress: document.getElementById('runProgress'),
    progressBar: document.getElementById('runProgressBar'),
    mode: document.getElementById('modeSelect'),
    search: document.getElementById('searchInput'),
    status: document.getElementById('statusFilter'),
    runAll: document.getElementById('runAllBtn'),
    reload: document.getElementById('reloadSpecBtn'),
    sumTotal: document.getElementById('sumTotal'),
    sumOk: document.getElementById('sumOk'),
    sumWarn: document.getElementById('sumWarn'),
    sumFail: document.getElementById('sumFail'),
    sumIdle: document.getElementById('sumIdle'),
    specName: document.getElementById('specName'),
    specVersion: document.getElementById('specVersion'),
    specServer: document.getElementById('specServer'),
    specUpdatedAt: document.getElementById('specUpdatedAt'),
  };

  function getBase() {
    return window.ARMY_BANK_BASE || '';
  }

  function withBase(path) {
    return `${getBase()}${path}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtPreview(rawText) {
    if (!rawText) return '(empty response body)';
    try {
      const obj = JSON.parse(rawText);
      return JSON.stringify(obj, null, 2);
    } catch {
      return rawText;
    }
  }

  function setSpecMeta(meta) {
    if (els.specName) els.specName.textContent = meta.name || '—';
    if (els.specVersion) els.specVersion.textContent = meta.version || '—';
    if (els.specServer) els.specServer.textContent = meta.server || '—';
    if (els.specUpdatedAt) els.specUpdatedAt.textContent = meta.updatedAt || '—';
  }

  function setRunProgress(done, total, label) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeDone = Math.max(0, Math.min(Number(done) || 0, safeTotal || 1));
    const percent = safeTotal > 0 ? Math.round((safeDone / safeTotal) * 100) : 0;

    if (els.progressBar) {
      els.progressBar.style.width = `${percent}%`;
    }
    if (els.progress) {
      if (label) {
        els.progress.textContent = label;
      } else if (safeTotal > 0) {
        els.progress.textContent = `${safeDone}/${safeTotal} (${percent}%)`;
      } else {
        els.progress.textContent = 'Готово до перевірки';
      }
    }
  }

  function samplePathValue(name) {
    const key = String(name || '').toLowerCase();
    if (!key) return 'sample';
    if (key.includes('account') && key.includes('number')) return 'AB-100001';
    if (key.includes('tx_type')) return 'transfer';
    if (key.includes('report')) return 'standard';
    if (key.includes('email')) return 'qa@example.com';
    if (key.includes('phone')) return '380000000000';
    if (key.includes('id')) return '1';
    return 'sample';
  }

  function resolvePathTemplate(path) {
    let resolved = String(path || '');
    resolved = resolved.replace(/<([^>]+)>/g, (_, token) => {
      const name = String(token || '').includes(':')
        ? String(token).split(':').slice(-1)[0]
        : String(token || '');
      return samplePathValue(name);
    });
    resolved = resolved.replace(/\{([^}]+)\}/g, (_, name) => samplePathValue(name));
    return resolved;
  }

  function buildEndpoints(schema) {
    const globalSec = Array.isArray(schema.security) ? schema.security : [];
    const result = [];
    const paths = schema.paths || {};

    Object.entries(paths).forEach(([path, methods]) => {
      Object.entries(methods || {}).forEach(([methodKey, operation]) => {
        if (!METHOD_KEYS.has(String(methodKey).toLowerCase())) return;
        const method = String(methodKey).toUpperCase();
        const tag = Array.isArray(operation.tags) && operation.tags[0] ? operation.tags[0] : 'General';

        let requiresAuth = true;
        if (Array.isArray(operation.security) && operation.security.length === 0) {
          requiresAuth = false;
        } else if (operation.security === undefined && globalSec.length === 0) {
          requiresAuth = false;
        }

        result.push({
          id: `${method}:${path}`,
          method,
          path,
          tag,
          summary: operation.summary || '',
          requiresAuth,
          status: 'idle',
          httpCode: '—',
          latencyMs: '—',
          strategy: '—',
          detail: '',
          preview: '',
        });
      });
    });

    result.sort((a, b) => (a.tag + a.path + a.method).localeCompare(b.tag + b.path + b.method));
    return result;
  }

  function getStrategy(ep, mode) {
    if (mode === 'safe' && WRITE_METHODS.has(ep.method)) {
      return {
        requestMethod: 'OPTIONS',
        requestBody: null,
        label: `OPTIONS probe for ${ep.method}`,
      };
    }

    let payload = null;
    if (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH') {
      payload = buildPayload(ep);
    }

    return {
      requestMethod: ep.method,
      requestBody: payload,
      label: ep.method,
    };
  }

  function buildPayload(ep) {
    if (ep.path === '/api/auth/login') {
      return { identity: 'api-probe', password: 'api-probe' };
    }
    if (ep.path === '/api/auth/register') {
      return {
        full_name: 'API Probe User',
        phone: '+380000000000',
        password: 'api-probe',
      };
    }
    if (ep.path === '/api/admin/payouts') {
      return {
        user_id: 999999999,
        amount: 1,
        title: 'API status probe',
        payout_type: 'combat',
      };
    }
    return {};
  }

  function rowStatusBadge(status) {
    const map = {
      idle: 'Not checked',
      ok: 'OK',
      warn: 'Reachable',
      fail: 'Fail',
    };
    const text = map[status] || status;
    return `<span class="api-pill ${status}">${text}</span>`;
  }

  function matchesFilter(ep) {
    const search = (els.search.value || '').trim().toLowerCase();
    const statusFilter = els.status.value || 'all';

    if (statusFilter !== 'all' && ep.status !== statusFilter) return false;

    if (!search) return true;
    const hay = `${ep.method} ${ep.path} ${ep.tag} ${ep.summary}`.toLowerCase();
    return hay.includes(search);
  }

  function updateSummary() {
    const totals = { total: 0, ok: 0, warn: 0, fail: 0, idle: 0 };
    state.endpoints.forEach((ep) => {
      totals.total += 1;
      totals[ep.status] = (totals[ep.status] || 0) + 1;
    });

    els.sumTotal.textContent = String(totals.total);
    els.sumOk.textContent = String(totals.ok || 0);
    els.sumWarn.textContent = String(totals.warn || 0);
    els.sumFail.textContent = String(totals.fail || 0);
    els.sumIdle.textContent = String(totals.idle || 0);
  }

  function renderRows() {
    const rows = state.endpoints.filter(matchesFilter).map((ep) => {
      const methodCls = `method-${ep.method.toLowerCase()}`;
      const rowCls = ep.status ? `api-row-${ep.status}` : '';
      return `
        <tr data-id="${escapeHtml(ep.id)}" class="${rowCls}">
          <td data-label="Method"><span class="api-pill api-method ${methodCls}">${escapeHtml(ep.method)}</span></td>
          <td data-label="Path">
            <div class="api-path">${escapeHtml(ep.path)}</div>
            <div class="muted" style="margin-top:3px">${escapeHtml(ep.summary || '—')}</div>
          </td>
          <td data-label="Tag">${escapeHtml(ep.tag)}</td>
          <td data-label="Auth">${ep.requiresAuth ? 'Bearer' : 'Public'}</td>
          <td data-label="Strategy">${escapeHtml(ep.strategy || '—')}</td>
          <td data-label="Status">${rowStatusBadge(ep.status)}</td>
          <td data-label="HTTP">${escapeHtml(ep.httpCode)}</td>
          <td data-label="ms">${escapeHtml(ep.latencyMs)}</td>
          <td data-label="Action"><button class="api-run-btn" data-run-one="${escapeHtml(ep.id)}" ${state.running ? 'disabled' : ''}>Run</button></td>
        </tr>
      `;
    });

    els.rows.innerHTML = rows.join('') || '<tr><td colspan="9" class="muted">Немає endpoint-ів для поточного фільтру.</td></tr>';
    updateSummary();
  }

  async function runProbe(ep) {
    const mode = els.mode.value || 'safe';
    const strategy = getStrategy(ep, mode);
    const runtimePath = resolvePathTemplate(ep.path);
    const url = withBase(runtimePath);

    const headers = {
      Accept: 'application/json, text/plain, */*',
      'X-Api-Status-Probe': '1',
    };

    const token = localStorage.getItem('army_bank_token') || '';
    if (token && ep.requiresAuth) {
      headers.Authorization = `Bearer ${token}`;
    }

    const options = {
      method: strategy.requestMethod,
      headers,
      cache: 'no-store',
    };

    if (strategy.requestBody !== null) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(strategy.requestBody);
    }

    const startedAt = performance.now();
    try {
      const response = await fetch(url, options);
      const elapsed = Math.round(performance.now() - startedAt);
      const rawText = await response.text();
      const preview = fmtPreview(rawText).slice(0, 3000);

      let status = 'ok';
      if (response.status >= 500 || response.status === 0) {
        status = 'fail';
      } else if (response.status >= 400) {
        status = 'warn';
      }

      ep.status = status;
      ep.httpCode = String(response.status);
      ep.latencyMs = String(elapsed);
      ep.strategy = strategy.label;
      ep.detail = `${strategy.requestMethod} ${url} -> ${response.status} ${response.statusText}`;
      ep.preview = preview;

      els.preview.textContent = `${ep.detail}\n\n${preview}`;
    } catch (err) {
      const elapsed = Math.round(performance.now() - startedAt);
      ep.status = 'fail';
      ep.httpCode = 'ERR';
      ep.latencyMs = String(elapsed);
      ep.strategy = strategy.label;
      ep.detail = `${strategy.requestMethod} ${url} -> network error`;
      ep.preview = String(err && err.message ? err.message : err);
      els.preview.textContent = `${ep.detail}\n\n${ep.preview}`;
    }
  }

  async function runOne(id) {
    const ep = state.endpoints.find((item) => item.id === id);
    if (!ep || state.running) return;

    state.running = true;
    toggleBusy(true);
    setRunProgress(0, 1, `Перевірка: ${ep.method} ${ep.path}`);

    await runProbe(ep);

    state.running = false;
    toggleBusy(false);
    setRunProgress(1, 1, `Завершено: ${ep.method} ${ep.path}`);
    renderRows();
  }

  async function runAll() {
    if (state.running) return;
    if ((els.mode.value || 'safe') === 'strict') {
      const ok = window.confirm('Strict mode може викликати write endpoint-и реальними HTTP-методами. Продовжити?');
      if (!ok) return;
    }

    const queue = state.endpoints.filter(matchesFilter);
    if (!queue.length) return;

    state.running = true;
    toggleBusy(true);
    setRunProgress(0, queue.length, `Run 0/${queue.length}`);

    for (let i = 0; i < queue.length; i += 1) {
      const ep = queue[i];
      setRunProgress(i, queue.length, `Run ${i + 1}/${queue.length}: ${ep.method} ${ep.path}`);
      await runProbe(ep);
      renderRows();
    }

    state.running = false;
    toggleBusy(false);
    setRunProgress(queue.length, queue.length, `Завершено: ${queue.length} endpoint(ів)`);
  }

  function toggleBusy(isBusy) {
    els.runAll.disabled = isBusy;
    els.reload.disabled = isBusy;
    document.querySelectorAll('[data-run-one]').forEach((btn) => {
      btn.disabled = isBusy;
    });
  }

  async function loadSpec() {
    if (state.running) return;
    toggleBusy(true);
    setRunProgress(0, 0, 'Завантаження OpenAPI...');
    setSpecMeta({
      name: 'Завантаження...',
      version: '—',
      server: withBase('/api'),
      updatedAt: '—',
    });

    try {
      const response = await fetch(withBase('/api/openapi.json'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      state.schema = await response.json();
      state.endpoints = buildEndpoints(state.schema);
      const info = state.schema && state.schema.info ? state.schema.info : {};
      const servers = state.schema && Array.isArray(state.schema.servers) ? state.schema.servers : [];
      const primaryServer = servers[0] && servers[0].url ? servers[0].url : withBase('/api');
      setSpecMeta({
        name: info.title || 'Army Bank API',
        version: info.version || '—',
        server: primaryServer,
        updatedAt: new Date().toLocaleString('uk-UA'),
      });
      els.preview.textContent = 'OpenAPI завантажено. Можна запускати перевірку endpoint-ів.';
      setRunProgress(0, state.endpoints.length, `Завантажено ${state.endpoints.length} endpoint(ів)`);
      renderRows();
    } catch (err) {
      state.endpoints = [];
      renderRows();
      const message = String(err && err.message ? err.message : err);
      els.preview.textContent = `Не вдалося завантажити OpenAPI: ${message}`;
      setSpecMeta({
        name: 'OpenAPI недоступний',
        version: '—',
        server: withBase('/api'),
        updatedAt: new Date().toLocaleString('uk-UA'),
      });
      setRunProgress(0, 0, 'Помилка завантаження OpenAPI');
    } finally {
      toggleBusy(false);
    }
  }

  document.addEventListener('click', (event) => {
    const runBtn = event.target.closest('[data-run-one]');
    if (runBtn) {
      runOne(runBtn.getAttribute('data-run-one'));
    }
  });

  els.reload.addEventListener('click', () => {
    loadSpec();
  });

  els.runAll.addEventListener('click', () => {
    runAll();
  });

  els.search.addEventListener('input', renderRows);
  els.status.addEventListener('change', renderRows);
  els.mode.addEventListener('change', renderRows);

  loadSpec();
})();
