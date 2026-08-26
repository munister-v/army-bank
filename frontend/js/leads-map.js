'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API = BASE + '/api';
const TOKEN_KEY = 'msng_token';
const BANK_TOKEN_KEY = 'army_bank_token';
const COOKIE_SESSION_TOKEN = '__http_only_cookie__';
const US_BOUNDS = [[24.2, -125.2], [49.8, -66.1]];

const elements = {
  refresh: document.getElementById('refresh-map'), retry: document.getElementById('retry-map'), fit: document.getElementById('fit-map'),
  loading: document.getElementById('map-loading'), error: document.getElementById('map-error'), errorText: document.getElementById('map-error-text'),
  state: document.getElementById('state-filter'), cityList: document.getElementById('city-list'), citiesCount: document.getElementById('cities-count'),
  drawer: document.getElementById('lead-drawer'), drawerTitle: document.getElementById('lead-drawer-title'), drawerState: document.getElementById('lead-drawer-state'),
  drawerSummary: document.getElementById('lead-drawer-summary'), leadList: document.getElementById('lead-list'), closeDrawer: document.getElementById('close-drawer'),
  unmapped: document.getElementById('unmapped-panel'), unmappedList: document.getElementById('unmapped-list'),
  total: document.getElementById('stat-total'), cities: document.getElementById('stat-cities'), hot: document.getElementById('stat-hot'), due: document.getElementById('stat-due'),
};

let map = null;
let markers = [];
let markerById = new Map();
let mapData = null;
let activeFilter = 'all';
let activeState = '';
let selectedId = '';

function storedToken() {
  return localStorage.getItem(TOKEN_KEY)
    || localStorage.getItem(BANK_TOKEN_KEY)
    || sessionStorage.getItem(TOKEN_KEY)
    || null;
}

async function api(path) {
  const token = storedToken();
  const headers = { Accept: 'application/json' };
  if (token && token !== COOKIE_SESSION_TOKEN) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, { credentials: 'include', headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign(`${BASE}/messenger?next=${encodeURIComponent('/leads-map')}`);
    throw new Error('Потрібен вхід у CRM.');
  }
  if (!response.ok || body.ok === false) throw new Error(body.error || 'Не вдалося завантажити дані карти.');
  return body.data || body;
}

function formatNumber(value) {
  return new Intl.NumberFormat('uk-UA').format(Number(value || 0));
}

function cityVisible(point) {
  if (activeState && point.state !== activeState) return false;
  if (activeFilter === 'due') return point.due > 0;
  if (activeFilter === 'hot') return point.hot > 0;
  return true;
}

function markerClass(point) {
  if (point.due > 0) return 'is-due';
  if (point.hot > 0) return 'is-hot';
  return '';
}

function markerIcon(point) {
  const selected = point.id === selectedId ? ' is-selected' : '';
  return window.L.divIcon({
    className: 'map-marker-shell',
    html: `<span class="map-marker ${markerClass(point)}${selected}" aria-hidden="true"><span class="map-marker-dot">${formatNumber(point.total)}</span></span>`,
    iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -18],
  });
}

function setupMap() {
  if (map || !window.L) return;
  map = window.L.map('us-leads-map', { zoomControl: true, scrollWheelZoom: false, minZoom: 3, maxBounds: US_BOUNDS, maxBoundsViscosity: 0.8 });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true,
  }).addTo(map);
  map.fitBounds(US_BOUNDS, { padding: [18, 18] });
  map.on('click', () => { if (window.innerWidth < 720) closeDrawer(); });
}

function clearMarkers() {
  markers.forEach(marker => marker.remove());
  markers = [];
  markerById.clear();
}

function renderMarkers() {
  if (!map || !mapData) return;
  clearMarkers();
  const visible = mapData.points.filter(cityVisible);
  visible.forEach(point => {
    const marker = window.L.marker([point.latitude, point.longitude], { icon: markerIcon(point), keyboard: true, title: `${point.city}: ${point.total}` })
      .bindPopup(`<div class="map-popup-city"><strong>${escapeHtml(point.city)}, ${escapeHtml(point.state)}</strong><span>${formatNumber(point.total)} лідів · ${point.due ? `${point.due} потребують дії` : 'робоча черга'}</span></div>`)
      .on('click', () => selectPoint(point.id, { pan: false }))
      .addTo(map);
    markers.push(marker);
    markerById.set(point.id, marker);
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderStats(summary) {
  elements.total.textContent = formatNumber(summary.total);
  elements.cities.textContent = formatNumber(summary.cities);
  elements.hot.textContent = formatNumber(summary.hot);
  elements.due.textContent = formatNumber(summary.due);
}

function renderStateFilter(states) {
  const current = activeState;
  elements.state.replaceChildren(new Option('Усі штати', ''));
  states.forEach(state => {
    const option = new Option(`${state.state} · ${formatNumber(state.total)}`, state.state);
    elements.state.add(option);
  });
  elements.state.value = current;
}

function renderCityList() {
  const points = (mapData?.points || []).filter(cityVisible);
  elements.citiesCount.textContent = `${formatNumber(points.length)} міст`;
  elements.cityList.replaceChildren();
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'city-list-empty';
    empty.textContent = 'За цим фільтром міст поки немає.';
    elements.cityList.append(empty);
    return;
  }
  points.forEach(point => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `city-item ${point.id === selectedId ? 'is-selected' : ''} ${point.due ? 'is-due' : ''}`;
    button.setAttribute('aria-pressed', String(point.id === selectedId));
    button.innerHTML = `<span><strong>${escapeHtml(point.city)}, ${escapeHtml(point.state)}</strong><small>${point.due ? `${point.due} потребують дії` : point.hot ? `${point.hot} високий пріоритет` : 'робоча черга'}</small></span><span class="city-item-count">${formatNumber(point.total)}</span>`;
    button.addEventListener('click', () => selectPoint(point.id));
    elements.cityList.append(button);
  });
}

function renderUnmapped(items) {
  elements.unmapped.hidden = !items.length;
  elements.unmappedList.replaceChildren();
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.city} · ${formatNumber(item.total)}`;
    elements.unmappedList.append(li);
  });
}

function priorityLabel(value) {
  return ({ Hot: 'Гарячий', High: 'Високий', Medium: 'Середній', Low: 'Низький', Watch: 'Спостереження' })[value] || value || 'Без пріоритету';
}

function selectPoint(id, options = {}) {
  const point = mapData?.points.find(item => item.id === id);
  if (!point) return;
  selectedId = id;
  renderMarkers();
  renderCityList();
  elements.drawer.hidden = false;
  elements.drawerTitle.textContent = `${point.city}, ${point.state}`;
  elements.drawerState.textContent = `США / ${point.state}`;
  elements.drawerSummary.textContent = `${formatNumber(point.total)} лідів у місті${point.due ? ` · ${formatNumber(point.due)} потребують дії` : ''}${point.hot ? ` · ${formatNumber(point.hot)} високий пріоритет` : ''}`;
  elements.leadList.replaceChildren();
  point.leads.forEach(lead => {
    const card = document.createElement('article');
    card.className = `lead-card ${lead.due ? 'is-due' : ''}`;
    const meta = [lead.category, priorityLabel(lead.priority), lead.stage].filter(Boolean).join(' · ');
    card.innerHTML = `<div class="lead-card-head"><h3>${escapeHtml(lead.name)}</h3><span class="lead-score">${formatNumber(lead.score)}</span></div><p class="lead-meta">${escapeHtml(meta || 'Деталі в CRM')}${lead.next_followup_date ? ` · ${escapeHtml(lead.next_followup_date)}` : ''}</p><a href="${BASE}/messenger?lead=${encodeURIComponent(lead.id)}">Відкрити картку в CRM</a>`;
    elements.leadList.append(card);
  });
  const marker = markerById.get(id);
  if (marker) {
    if (options.pan !== false) map.panTo(marker.getLatLng(), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    marker.openPopup();
  }
  if (options.focusDrawer) elements.drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDrawer() {
  selectedId = '';
  elements.drawer.hidden = true;
  renderMarkers();
  renderCityList();
}

function fitVisibleCities() {
  const points = (mapData?.points || []).filter(cityVisible);
  if (!map) return;
  if (!points.length) { map.fitBounds(US_BOUNDS, { padding: [18, 18] }); return; }
  map.fitBounds(points.map(point => [point.latitude, point.longitude]), { padding: [52, 52], maxZoom: points.length === 1 ? 8 : 6 });
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading;
  elements.refresh.disabled = isLoading;
  elements.refresh.setAttribute('aria-busy', String(isLoading));
}

function renderAll(data) {
  mapData = data;
  renderStats(data.summary || {});
  renderStateFilter(data.states || []);
  renderMarkers();
  renderCityList();
  renderUnmapped(data.unmapped || []);
  fitVisibleCities();
}

async function loadMap() {
  elements.error.hidden = true;
  setLoading(true);
  try {
    if (!window.L) throw new Error('Картографічний модуль не завантажився.');
    setupMap();
    renderAll(await api('/leads/map/us'));
  } catch (error) {
    elements.errorText.textContent = error.message || 'Спробуйте оновити сторінку.';
    elements.error.hidden = false;
  } finally {
    setLoading(false);
  }
}

document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter || 'all';
    selectedId = '';
    document.querySelectorAll('[data-filter]').forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    elements.drawer.hidden = true;
    renderMarkers(); renderCityList(); fitVisibleCities();
  });
});
elements.state.addEventListener('change', () => { activeState = elements.state.value; selectedId = ''; elements.drawer.hidden = true; renderMarkers(); renderCityList(); fitVisibleCities(); });
elements.fit.addEventListener('click', fitVisibleCities);
elements.refresh.addEventListener('click', loadMap);
elements.retry.addEventListener('click', loadMap);
elements.closeDrawer.addEventListener('click', closeDrawer);

loadMap();
