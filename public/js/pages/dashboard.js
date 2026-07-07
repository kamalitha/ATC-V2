// pages/dashboard.js
import api from '../api.js';
import { formatCurrency } from '../components/table.js';
import { currentUser } from '../app.js';

const CHART_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

export async function renderDashboard() {
  const content  = document.getElementById('page-content');
  const isAdmin  = currentUser?.role_name === 'admin';
  const modules  = currentUser?.modules ?? [];
  const isPublic = modules.includes('public');
  const canIDL   = !isPublic && (modules.includes('idl') || isAdmin);
  const canCPD   = !isPublic && (modules.includes('cpd') || isAdmin);

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Overview of all services</p>
      </div>
    </div>
    <div class="stat-grid" id="idl-stats"></div>
    <div class="stat-grid" id="cpd-stats"></div>
    ${isAdmin ? `
    <div class="dashboard-charts">
      <div class="chart-card chart-card--wide">
        <div class="chart-card-header">IDL Requests — Last 12 Months</div>
        <div class="chart-card-body"><canvas id="chart-monthly"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">Status Distribution</div>
        <div class="chart-card-body"><canvas id="chart-status"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">Request Type Breakdown</div>
        <div class="chart-card-body"><canvas id="chart-type"></canvas></div>
      </div>
      <div class="chart-card chart-card--wide">
        <div class="chart-card-header">IDL vs CPD — Monthly Volume</div>
        <div class="chart-card-body"><canvas id="chart-compare"></canvas></div>
      </div>
    </div>` : ''}`;

  const [idlResult, cpdResult, chartResult] = await Promise.allSettled([
    canIDL ? api.idl.stats() : Promise.reject('no access'),
    canCPD ? api.cpd.stats() : Promise.reject('no access'),
    isAdmin ? api.idl.chartData() : Promise.reject('not admin'),
  ]);

  const idlEl = document.getElementById('idl-stats');
  const cpdEl = document.getElementById('cpd-stats');

  if (idlResult.status === 'fulfilled') {
    const s = idlResult.value;
    idlEl.innerHTML = `
      ${statCard('IDL — Total',    s.total      ?? 0, 'fa-id-card',         'accent')}
      ${statCard('Pending',        s.pending    ?? 0, 'fa-clock',           'warning')}
      ${statCard('Issued',         s.issued     ?? 0, 'fa-circle-check',    'success')}
      ${statCard('Rejected',       s.rejected   ?? 0, 'fa-ban',             'danger')}
      ${statCard('This Month',     s.this_month ?? 0, 'fa-calendar-day',    'info')}
      ${statCard('Revenue (AED)',  formatCurrency(s.revenue ?? 0), 'fa-money-bill-wave', 'success', true)}`;
  } else {
    idlEl.remove();
  }

  if (cpdResult.status === 'fulfilled') {
    const s = cpdResult.value;
    cpdEl.innerHTML = `
      ${statCard('CPD — Total',  s.total   ?? 0, 'fa-car',             'accent')}
      ${statCard('Pending',      s.pending ?? 0, 'fa-clock',           'warning')}
      ${statCard('Issued',       s.issued  ?? 0, 'fa-circle-check',    'success')}
      ${statCard('Revenue',      formatCurrency(s.revenue ?? 0), 'fa-money-bill-wave', 'info', true)}`;
  } else {
    cpdEl.remove();
  }

  if (!isAdmin || chartResult.status !== 'fulfilled') return;

  await loadScript(CHART_CDN);
  const { Chart } = window;
  if (!Chart) return;

  const cd = chartResult.value;

  const BLUE   = 'rgba(59,130,246,0.85)';
  const GREEN  = 'rgba(34,197,94,0.85)';
  const AMBER  = 'rgba(245,158,11,0.85)';
  const PALETTE = [BLUE, GREEN, AMBER,
    'rgba(239,68,68,0.85)', 'rgba(168,85,247,0.85)',
    'rgba(6,182,212,0.85)', 'rgba(249,115,22,0.85)', 'rgba(20,184,166,0.85)'];

  const axisStyle = { ticks: { color: '#6b7280' }, grid: { color: '#e5e7eb' } };
  const noGrid    = { ticks: { color: '#6b7280' }, grid: { display: false } };
  const legendStyle = { labels: { color: '#6b7280', font: { size: 12 } } };

  // 1. Monthly bar + revenue line
  const months  = cd.monthly.map(r => r.month);
  new Chart(document.getElementById('chart-monthly'), {
    data: {
      labels: months,
      datasets: [
        { type: 'bar',  label: 'Requests',      data: cd.monthly.map(r => +r.count),   backgroundColor: BLUE,  yAxisID: 'y',  borderRadius: 4 },
        { type: 'line', label: 'Revenue (AED)',  data: cd.monthly.map(r => +r.revenue), borderColor: GREEN, backgroundColor: 'transparent', tension: 0.4, pointRadius: 4, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: legendStyle },
      scales: {
        y:  { ...axisStyle, position: 'left',  beginAtZero: true },
        y1: { position: 'right', beginAtZero: true, ticks: { color: '#6b7280', callback: v => 'AED ' + v.toLocaleString() }, grid: { display: false } },
        x:  axisStyle,
      },
    },
  });

  // 2. Status doughnut
  new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: {
      labels: cd.statusDist.map(r => r.label ?? 'Unknown'),
      datasets: [{ data: cd.statusDist.map(r => +r.count), backgroundColor: PALETTE, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { color: '#6b7280', padding: 12, font: { size: 12 } } } },
    },
  });

  // 3. Request type horizontal bar
  new Chart(document.getElementById('chart-type'), {
    type: 'bar',
    data: {
      labels: cd.typeDist.map(r => r.label ?? 'Unknown'),
      datasets: [{ label: 'Count', data: cd.typeDist.map(r => +r.count), backgroundColor: PALETTE, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ...axisStyle, beginAtZero: true }, y: noGrid },
    },
  });

  // 4. IDL vs CPD comparison
  const allMonths = [...new Set([...cd.monthly.map(r => r.month), ...cd.cpdMonthly.map(r => r.month)])].sort();
  const idlByM   = Object.fromEntries(cd.monthly.map(r => [r.month, +r.count]));
  const cpdByM   = Object.fromEntries(cd.cpdMonthly.map(r => [r.month, +r.count]));

  new Chart(document.getElementById('chart-compare'), {
    type: 'line',
    data: {
      labels: allMonths,
      datasets: [
        { label: 'IDL', data: allMonths.map(m => idlByM[m] ?? 0), borderColor: BLUE,  backgroundColor: 'rgba(59,130,246,0.1)',  fill: true, tension: 0.4, pointRadius: 4 },
        { label: 'CPD', data: allMonths.map(m => cpdByM[m] ?? 0), borderColor: AMBER, backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: legendStyle },
      scales: { y: { ...axisStyle, beginAtZero: true }, x: axisStyle },
    },
  });
}

function statCard(label, value, faIcon, cls, raw = false) {
  const display = raw ? value : Number(value ?? 0).toLocaleString();
  return `<div class="stat-card ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${display}</div>
    <span class="stat-icon"><i class="fa-solid ${faIcon}"></i></span>
  </div>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
