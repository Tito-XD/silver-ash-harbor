// ============================================================
// Silver Ash Harbor — Dashboard Application
// ============================================================

const API_BASE = '/api';

// Brand config with domain for favicon lookup
const BRAND_CONFIG = {
  Fanatec:  { color: '#1a1a1a', logo: 'https://assets.fanatec.com/image/upload/v1771889128/pages/brand/fanatec-signet-black.svg' },
  Simagic:  { color: '#0052cc', domain: 'simagic.com', fallbackDomain: 'simagic.com' },
  Logitech: { color: '#00b8fc', domain: 'www.logitechg.com' },
  Simucube: { color: '#ff6a00', domain: 'simucube.com' },
  Asetek:   { color: '#0066cc', domain: 'www.asetek.com', fallbackDomain: 'asetek.com' },
};

function brandLogoUrl(name) {
  const cfg = BRAND_CONFIG[name];
  if (!cfg) return '';
  // Direct logo URL takes priority
  if (cfg.logo) return cfg.logo;
  if (cfg.domain) return `/api/favicon?domain=${cfg.domain}`;
  return '';
}

function brandLogoFallback(name) {
  const cfg = BRAND_CONFIG[name];
  const fb = cfg?.fallbackDomain;
  if (!fb) return '';
  // Fallback: Google favicon proxy
  return `https://www.google.com/s2/favicons?domain=${fb}&sz=32`;
}

function brandBadge(name) {
  const cfg = BRAND_CONFIG[name] || { color: '#6b7280' };
  const src = brandLogoUrl(name);
  const fallback = brandLogoFallback(name);
  const onerror = fallback ? `onerror="this.src='${fallback}';this.onerror=null"` : '';
  if (src) {
    return `<img class="brand-logo" src="${src}" alt="${name}" width="24" height="24" ${onerror}><span style="font-weight:600;color:${cfg.color}">${name}</span>`;
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
  btn.disabled = true;

  const overlay = document.createElement('div');
  overlay.className = 'crawl-progress';
  overlay.innerHTML = `
    <div class="crawl-progress-card">
      <div class="crawl-progress-title">正在爬取...</div>
      <div class="crawl-progress-brand-row" id="crawl-progress-brand-row"></div>
      <div class="crawl-progress-bar-track">
        <div class="crawl-progress-bar-fill" id="crawl-progress-fill" style="width:0%"></div>
      </div>
      <div class="crawl-progress-text" id="crawl-progress-text">0 / 5</div>
      <div class="crawl-progress-products" id="crawl-progress-products"></div>
    </div>`;
  document.body.appendChild(overlay);

  const brands = state.brands;
  let totalFound = 0, totalChanges = 0, completed = 0;

  const brandRow = document.getElementById('crawl-progress-brand-row');
  const productsEl = document.getElementById('crawl-progress-products');

  function updateProgress(brandName, done, total, productNames = []) {
    document.getElementById('crawl-progress-fill').style.width = `${(done / total) * 100}%`;
    document.getElementById('crawl-progress-text').textContent = `${done} / ${total}`;

    // Update brand row: show logo + name for active brand, checks for done
    brandRow.innerHTML = brands.map((b, i) => {
      const src = brandLogoUrl(b.name);
      const fb = brandLogoFallback(b.name);
      const onerr = fb ? `onerror="this.src='${fb}';this.onerror=null"` : '';
      if (i < done) {
        // Done: greyed out with check
        return `<span class="cb-item cb-done"><img src="${src}" alt="${b.name}" width="18" height="18" ${onerr}><span>${b.name}</span><i>&#10003;</i></span>`;
      }
      if (i === done) {
        // Active: highlighted
        return `<span class="cb-item cb-active"><img src="${src}" alt="${b.name}" width="18" height="18" ${onerr}><span>${b.name}</span></span>`;
      }
      // Pending: dimmed
      return `<span class="cb-item cb-pending"><img src="${src}" alt="${b.name}" width="18" height="18" ${onerr}><span>${b.name}</span></span>`;
    }).join('');

    // Show product names scrolling
    if (productNames.length > 0) {
      const names = productNames.slice(0, 12).map(n => `<span>${escapeHtml(n)}</span>`).join('  ·  ');
      productsEl.innerHTML = `<div class="cp-products-scroll">${names}</div>`;
    }
  }

  try {
    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      updateProgress(brand.name, i, brands.length);

      let productNames = [];
      try {
        const res = await api(`/crawl/${brand.id}`, { method: 'POST' });
        if (res.success && res.data) {
          totalFound += res.data.products_found || 0;
          totalChanges += res.data.price_changes || 0;
        }
        // Fetch the brand's products for display
        const prodRes = await api(`/brands/${brand.id}/products`);
        if (prodRes.success && prodRes.data) {
          productNames = prodRes.data.map(p => p.name).filter(Boolean);
        }
      } catch { /* skip */ }

      completed++;
      updateProgress(brand.name, completed, brands.length, productNames);
      await new Promise(r => setTimeout(r, 800)); // brief pause to show products
    }

    document.getElementById('crawl-progress-text').textContent = '完成!';
    productsEl.innerHTML = '';
    await new Promise(r => setTimeout(r, 500));

    showToast(
      `已爬取 ${brands.length} 个品牌，${totalFound} 个产品，${totalChanges} 处价格变动`,
      'success'
    );
    await loadDashboard();
    await loadCrawlLogs();
  } catch (err) {
    showToast('爬取失败: ' + err.message, 'error');
  } finally {
    overlay.remove();
    btn.disabled = false;
  }
}

// ── Dashboard Cards ────────────────────────────────────────

function updateDashboardCards(data) {
  document.getElementById('stat-brands').textContent = data.total_brands;

  // Render brand logos in the brands card
  const logosContainer = document.getElementById('brand-logos-card');
  if (logosContainer) {
    logosContainer.innerHTML = data.brands.map(b => {
      const src = brandLogoUrl(b.name);
      const fallback = brandLogoFallback(b.name);
      const onerror = fallback ? `onerror="this.src='${fallback}';this.onerror=null"` : '';
      return src ? `<img src="${src}" alt="${b.name}" title="${b.name}" width="28" height="28" ${onerror}>` : '';
    }).join('');
  }
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
    const src = brandLogoUrl(brand.name);
    const fallback = brandLogoFallback(brand.name);
    const onerror = fallback ? `onerror="this.src='${fallback}';this.onerror=null"` : '';
    const logoHtml = src ? `<img class="brand-tab-logo" src="${src}" alt="${brand.name}" width="20" height="20" ${onerror}>` : '';
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
