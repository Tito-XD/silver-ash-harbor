// ============================================================
// Silver Ash Harbor — Dashboard Application
// ============================================================

const API_BASE = '/api';

// Brand config with logo paths
const BRAND_CONFIG = {
  Fanatec:  { color: '#1a1a1a', logo: 'logos/fanatec.svg' },
  Simagic:  { color: '#0052cc', logo: 'logos/simagic.svg' },
  Logitech: { color: '#00b8fc', logo: 'logos/logitech.svg' },
  Simucube: { color: '#ff6a00', logo: 'logos/simucube.svg' },
  Asetek:   { color: '#0066cc', logo: 'logos/asetek.svg' },
};

function brandBadge(name) {
  const cfg = BRAND_CONFIG[name] || { color: '#6b7280' };
  const logoSrc = cfg.logo || '';
  if (logoSrc) {
    return `<img class="brand-logo" src="${logoSrc}" alt="${name}" width="24" height="24"><span style="font-weight:600;color:${cfg.color}">${name}</span>`;
  }
  return `<span style="font-weight:600;color:${cfg.color}">${name}</span>`;
}

// Application state
const state = {
  brands: [],
  allProducts: [],
  currentBrand: 'all',
  searchQuery: '',
  dashboard: null,
};

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadDashboard();
  loadCrawlLogs();
});

function setupEventListeners() {
  document.getElementById('btn-crawl').addEventListener('click', triggerCrawl);
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    renderTable();
  });

  // Delegate tab clicks
  document.getElementById('brand-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const brand = tab.dataset.brand;
    if (brand === state.currentBrand) return;
    state.currentBrand = brand;
    state.searchQuery = '';
    document.getElementById('search-input').value = '';
    updateActiveTab();
    renderTable();
  });
}

// ── API Calls ──────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

async function loadDashboard() {
  try {
    const res = await api('/dashboard');
    if (res.success) {
      state.dashboard = res.data;
      state.brands = res.data.brands;
      updateDashboardCards(res.data);
      updateBrandTabs(res.data.brands);
      loadAllProducts();
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

async function loadAllProducts() {
  try {
    const res = await api('/products');
    if (res.success) {
      state.allProducts = res.data;
      renderTable();
    }
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

async function loadCrawlLogs() {
  try {
    const res = await api('/logs');
    if (res.success) {
      renderCrawlLogs(res.data);
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

async function triggerCrawl() {
  const btn = document.getElementById('btn-crawl');
  const origText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> 爬取中...';
  btn.disabled = true;

  try {
    const res = await api('/crawl', { method: 'POST' });
    if (res.success) {
      showToast(
        `已爬取 ${res.data.brands_crawled} 个品牌，${res.data.products_found} 个产品，${res.data.price_changes} 处价格变动`,
        'success'
      );
      await loadDashboard();
      await loadCrawlLogs();
    } else {
      showToast(res.error || '爬取失败', 'error');
    }
  } catch (err) {
    showToast('爬取失败: ' + err.message, 'error');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
  }
}

// ── Dashboard Cards ────────────────────────────────────────

function updateDashboardCards(data) {
  document.getElementById('stat-brands').textContent = data.total_brands;
  document.getElementById('stat-products').textContent = data.total_products;
  document.getElementById('stat-changes').textContent = data.total_price_changes;

  const lastCrawl = data.last_crawl_time
    ? formatTime(data.last_crawl_time)
    : '从未';
  document.getElementById('stat-last-crawl').textContent = lastCrawl;
  document.getElementById('last-update').textContent = data.last_crawl_time
    ? '更新于 ' + formatTime(data.last_crawl_time)
    : '暂无数据';

  if (data.total_price_changes > 0) {
    const el = document.getElementById('stat-changes');
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }
}

// ── Brand Tabs ─────────────────────────────────────────────

function updateBrandTabs(brands) {
  const container = document.getElementById('brand-tabs');
  container.querySelectorAll('.tab[data-brand]:not([data-brand="all"]):not([data-brand="changes"])').forEach(t => t.remove());

  for (const brand of brands) {
    const cfg = BRAND_CONFIG[brand.name] || { color: '#6b7280' };
    const logoSrc = cfg.logo || '';
    const logoHtml = logoSrc ? `<img class="brand-tab-logo" src="${logoSrc}" alt="${brand.name}" width="20" height="20">` : '';
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.brand = brand.id;
    btn.innerHTML = `${logoHtml}${brand.name} <span class="tab-badge" style="${brand.price_changes > 0 ? '' : 'display:none'}">${brand.price_changes}</span>`;
    container.appendChild(btn);
  }

  updateActiveTab();
}

function updateActiveTab() {
  document.querySelectorAll('#brand-tabs .tab').forEach(tab => {
    const isActive = String(tab.dataset.brand) === String(state.currentBrand);
    tab.classList.toggle('active', isActive);
  });

  const changedCount = state.allProducts.filter(p =>
    p.change_direction === 'up' || p.change_direction === 'down'
  ).length;
  const badge = document.getElementById('changes-badge');
  badge.textContent = changedCount;
  badge.style.display = changedCount > 0 ? '' : 'none';
}

// ── Table Rendering ────────────────────────────────────────

function renderTable() {
  let products = state.allProducts;

  if (state.currentBrand === 'changes') {
    products = products.filter(p =>
      p.change_direction === 'up' || p.change_direction === 'down'
    );
  }

  if (state.currentBrand !== 'all' && state.currentBrand !== 'changes') {
    products = products.filter(p => p.brand_id === parseInt(state.currentBrand));
  }

  if (state.searchQuery) {
    products = products.filter(p =>
      p.name.toLowerCase().includes(state.searchQuery) ||
      (p.sku && p.sku.toLowerCase().includes(state.searchQuery))
    );
  }

  document.getElementById('result-count').textContent =
    `${products.length} 个产品`;

  const tbody = document.getElementById('table-body');

  if (products.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-icon">&#128269;</div>
            <p>${state.searchQuery ? '没有匹配的产品' : '暂无数据，添加品牌并执行爬取即可开始追踪'}</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const brandName = getBrandName(p.brand_id);
    const changeHtml = getChangeHtml(p);
    const priceHtml = getPriceHtml(p);
    const prevHtml = p.previous_price !== null
      ? `<span class="previous-price">${formatPrice(p.previous_price, p.currency)}</span>`
      : '<span class="time-cell">—</span>';
    const timeHtml = p.last_crawled_at
      ? `<span class="time-cell">${formatTime(p.last_crawled_at)}</span>`
      : '<span class="time-cell">—</span>';

    return `
      <tr>
        <td>
          <span class="product-name">
            ${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)}
          </span>
        </td>
        <td>${brandBadge(brandName)}</td>
        <td>${priceHtml}</td>
        <td>${prevHtml}</td>
        <td>${changeHtml}</td>
        <td>${timeHtml}</td>
      </tr>`;
  }).join('');
}

function getPriceHtml(p) {
  if (p.current_price === null) return '<span class="time-cell">—</span>';
  const cls = p.change_direction === 'up' ? 'price-up'
    : p.change_direction === 'down' ? 'price-down'
    : 'price';
  return `<span class="price ${cls}">${formatPrice(p.current_price, p.currency)}</span>`;
}

function getChangeHtml(p) {
  if (p.change_direction === 'new') {
    return '<span class="change-badge new">新品</span>';
  }
  if (p.change_direction === 'unchanged' || p.price_change === null) {
    return '<span class="change-badge unchanged">—</span>';
  }
  const dir = p.change_direction === 'up' ? 'up' : 'down';
  const arrow = dir === 'up' ? '&#9650;' : '&#9660;';
  const sign = dir === 'up' ? '+' : '';
  const absChange = sign + formatPrice(Math.abs(p.price_change), p.currency);
  const pct = p.price_change_pct !== null ? ` (${sign}${Math.abs(p.price_change_pct)}%)` : '';
  return `<span class="change-badge ${dir}">${arrow} ${absChange}${pct}</span>`;
}

function getBrandName(brandId) {
  const brand = state.brands.find(b => b.id === brandId);
  return brand ? brand.name : `Brand #${brandId}`;
}

// ── Crawl Log ──────────────────────────────────────────────

function renderCrawlLogs(logs) {
  const container = document.getElementById('log-list');
  const badge = document.getElementById('log-badge');

  badge.textContent = logs.length;

  if (logs.length === 0) {
    container.innerHTML = '<p class="log-empty">暂无爬取记录</p>';
    return;
  }

  const statusMap = { success: '成功', failed: '失败', running: '进行中', pending: '等待中' };

  container.innerHTML = logs.slice(0, 30).map(log => `
    <div class="log-item">
      <div>
        <span class="log-status ${log.status}">${statusMap[log.status] || log.status.toUpperCase()}</span>
        <span style="margin-left:8px;color:var(--text-secondary)">${getBrandName(log.brand_id)}</span>
      </div>
      <div style="color:var(--text-secondary)">
        发现 ${log.products_found} / 变动 ${log.price_changes}
      </div>
      <div style="color:var(--text-secondary)">
        ${log.finished_at ? formatTime(log.finished_at) : '进行中...'}
        ${log.error_msg ? ` &mdash; <span style="color:var(--danger)">${escapeHtml(log.error_msg)}</span>` : ''}
      </div>
    </div>
  `).join('\n');
}

// ── Helpers ────────────────────────────────────────────────

function formatPrice(price, currency = 'USD') {
  const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  const sym = symbols[currency] || currency + ' ';
  if (currency === 'JPY') {
    return sym + Math.round(price).toLocaleString();
  }
  return sym + price.toFixed(2);
}

function formatTime(isoString) {
  const d = new Date(isoString + (isoString.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  if (hours < 24) return `${hours}小时前`;

  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}
