// pages/reports.js
import api from '../api.js';
import { DataTable, formatDate, formatDateTime, formatCurrency, statusBadge } from '../components/table.js';

export async function renderReports() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Analytics and data exports for IDL and CPD</p>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:0">
      <button class="report-tab active" data-tab="idl">
        <i class="fa-solid fa-id-card"></i> IDL Report
      </button>
      <button class="report-tab" data-tab="cpd">
        <i class="fa-solid fa-car"></i> CPD Report
      </button>
      <button class="report-tab" data-tab="activity">
        <i class="fa-solid fa-clipboard-list"></i> Activity Log
      </button>
    </div>
    <div id="report-panel"></div>`;

  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadTab(btn.dataset.tab);
    });
  });

  loadTab('idl');
}

function loadTab(tab) {
  const panel = document.getElementById('report-panel');
  if (tab === 'idl')      renderIDLReport(panel);
  else if (tab === 'cpd') renderCPDReport(panel);
  else                    renderActivityLog(panel);
}

// ── IDL Report ────────────────────────────────────────────────────────────────
async function renderIDLReport(panel) {
  panel.innerHTML = buildFilterBar('idl-filters', [
    { id:'date_from', label:'From', type:'date', default: monthStart() },
    { id:'date_to',   label:'To',   type:'date', default: today() },
    { id:'type', label:'Type', type:'select', options:[
      {value:'',label:'All Types'},{value:'WALKIN',label:'Walk-in'},
      {value:'ONLINE',label:'Online'},{value:'DISTRIBUTOR',label:'Distributor'},
    ]},
    { id:'status', label:'Status', type:'select', options:[
      {value:'',label:'All Statuses'},{value:'2',label:'Processing'},
      {value:'4',label:'Approved'},{value:'3',label:'Rejected'},{value:'5',label:'Dispatched'},
    ]},
  ]);
  panel.innerHTML += `
    <div id="idl-summary" class="stat-grid" style="margin-bottom:20px"></div>
    <div id="idl-report-table"></div>`;

  document.getElementById('idl-filters').addEventListener('submit', e => {
    e.preventDefault();
    fetchIDLReport(panel, getFilterValues('idl-filters'));
  });
  await fetchIDLReport(panel, { date_from: monthStart(), date_to: today() });
}

async function fetchIDLReport(panel, params) {
  try {
    const data = await api.get('/reports/idl', params);
    const s    = data.summary;

    document.getElementById('idl-summary').innerHTML = `
      ${sCard('Total Applications',  s.total,               'fa-id-card',         'accent')}
      ${sCard('Issued',              s.issued,              'fa-circle-check',    'success')}
      ${sCard('Revenue (AED)',       formatCurrency(s.revenue), 'fa-money-bill-wave','info', true)}
      ${sCard('Rejected',            s.total - s.issued - (s.by_status.find(x=>x.label==='Under Processing ')?.count??0), 'fa-circle-xmark', 'danger')}`;

    const tbl = document.getElementById('idl-report-table');
    new DataTable(tbl, [
      { key:'request_id',         label:'Request ID' },
      { key:'name',               label:'Applicant', render:(_,r)=>`${r.first_name??''} ${r.last_name??''}`.trim() },
      { key:'nationality',        label:'Nationality' },
      { key:'request_type',       label:'Type', render: v=>`<span class="badge badge-default">${v}</span>` },
      { key:'idl_no',             label:'IDL No' },
      { key:'payment_method',     label:'Payment' },
      { key:'total_amount',       label:'Amount', render: v=>formatCurrency(v) },
      { key:'status_label',       label:'Status', render: v=>statusBadge(v) },
      { key:'requested_datetime', label:'Date',   render: v=>formatDateTime(v) },
    ],
    p => api.get('/reports/idl', {...params, ...p}),
    { searchPlaceholder:'Search results…' },
    ).render();

    addExportBtn(tbl, '/api/reports/idl', params);
  } catch (err) {
    panel.querySelector('#idl-report-table').innerHTML =
      `<p style="color:var(--danger);padding:20px"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</p>`;
  }
}

// ── CPD Report ────────────────────────────────────────────────────────────────
async function renderCPDReport(panel) {
  panel.innerHTML = buildFilterBar('cpd-filters', [
    { id:'date_from', label:'From', type:'date', default: monthStart() },
    { id:'date_to',   label:'To',   type:'date', default: today() },
    { id:'status', label:'Status', type:'select', options:[
      {value:'',label:'All'},{value:'NEW',label:'New'},{value:'Processing',label:'Processing'},
      {value:'Confirmed',label:'Confirmed'},{value:'Issued',label:'Issued'},
      {value:'Returned',label:'Returned'},{value:'Cancelled',label:'Cancelled'},
    ]},
    { id:'category', label:'Category', type:'select', options:[
      {value:'',label:'All'},{value:'NORMAL',label:'Normal'},{value:'SPECIAL',label:'Special'},
      {value:'MOI',label:'MOI'},{value:'ADP',label:'ADP'},
    ]},
  ]);
  panel.innerHTML += `
    <div id="cpd-summary" class="stat-grid" style="margin-bottom:20px"></div>
    <div id="cpd-report-table"></div>`;

  document.getElementById('cpd-filters').addEventListener('submit', e => {
    e.preventDefault();
    fetchCPDReport(panel, getFilterValues('cpd-filters'));
  });
  await fetchCPDReport(panel, { date_from: monthStart(), date_to: today() });
}

async function fetchCPDReport(panel, params) {
  try {
    const data = await api.get('/reports/cpd', params);
    const s    = data.summary;

    document.getElementById('cpd-summary').innerHTML = `
      ${sCard('Total',    s.total,                       'fa-car',             'accent')}
      ${sCard('Revenue',  formatCurrency(s.total_revenue),'fa-money-bill-wave', 'info', true)}
      ${sCard('Issued',   s.by_status.find(x=>x.label==='Issued')?.count??0,     'fa-circle-check', 'success')}
      ${sCard('Pending',  s.by_status.find(x=>x.label==='Processing')?.count??0, 'fa-clock',        'warning')}`;

    const tbl = document.getElementById('cpd-report-table');
    new DataTable(tbl, [
      { key:'request_id',        label:'Request ID' },
      { key:'applicant',         label:'Applicant', render:(_,r)=>`${r.first_name??''} ${r.last_name??''}`.trim() },
      { key:'vehicle_make',      label:'Vehicle',   render:(_,r)=>`${r.vehicle_make} ${r.vehicle_model}` },
      { key:'vehicle_no',        label:'Plate' },
      { key:'request_category',  label:'Category',  render: v=>`<span class="badge badge-accent">${v}</span>` },
      { key:'total_amount',      label:'Total',     render: v=>formatCurrency(v) },
      { key:'method_of_payment', label:'Payment' },
      { key:'carnet_no',         label:'Carnet' },
      { key:'request_status',    label:'Status',    render: v=>statusBadge(v) },
      { key:'requested_datetime',label:'Submitted', render: v=>formatDateTime(v) },
    ],
    p => api.get('/reports/cpd', {...params, ...p}),
    { searchPlaceholder:'Search results…' },
    ).render();

    addExportBtn(tbl, '/api/reports/cpd', params);
  } catch (err) {
    panel.querySelector('#cpd-report-table').innerHTML =
      `<p style="color:var(--danger);padding:20px"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</p>`;
  }
}

// ── Activity Log ──────────────────────────────────────────────────────────────
function renderActivityLog(panel) {
  panel.innerHTML = '<div id="activity-table"></div>';
  const moduleColors = { LOGIN:'info', LOGOUT:'default', IDL:'accent', CPD:'success', ESMA:'warning' };

  new DataTable(
    document.getElementById('activity-table'),
    [
      { key:'log_id',           label:'#',       width:'60px' },
      { key:'log_module',       label:'Module',  render: v=>`<span class="badge badge-${moduleColors[v]??'default'}">${v}</span>` },
      { key:'log_action',       label:'Action' },
      { key:'action_initiator', label:'User' },
      { key:'extra_params',     label:'Reference' },
      { key:'log_datetime',     label:'When',   render: v=>formatDateTime(v) },
    ],
    p => api.get('/reports/activity', p),
    { searchPlaceholder:'Search log…' },
  ).render();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sCard(label, value, faIcon, cls, raw = false) {
  const display = raw ? value : Number(value ?? 0).toLocaleString();
  return `<div class="stat-card ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="font-size:1.5rem">${display}</div>
    <span class="stat-icon"><i class="fa-solid ${faIcon}"></i></span>
  </div>`;
}

function addExportBtn(tbl, path, params) {
  const toolbar = tbl.querySelector('.table-toolbar-right');
  if (toolbar && !toolbar.querySelector('.export-btn')) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm export-btn';
    btn.innerHTML = '<i class="fa-solid fa-download"></i> Export CSV';
    btn.onclick   = () => window.open(buildExportUrl(path, {...params, format:'csv'}));
    toolbar.appendChild(btn);
  }
}

function buildFilterBar(id, fields) {
  const inputs = fields.map(f => {
    if (f.type === 'select') {
      return `<div class="field" style="min-width:140px">
        <label>${f.label}</label>
        <select id="${f.id}" name="${f.id}" class="filter-select" style="width:100%">
          ${f.options.map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}
        </select></div>`;
    }
    return `<div class="field" style="min-width:140px">
      <label>${f.label}</label>
      <input id="${f.id}" name="${f.id}" type="${f.type}" value="${f.default??''}" style="width:100%"/>
    </div>`;
  }).join('');

  return `<form id="${id}" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;
    padding:18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-lg)">
    ${inputs}
    <div class="field" style="align-self:flex-end">
      <button type="submit" class="btn btn-primary">
        <i class="fa-solid fa-filter"></i> Apply Filters
      </button>
    </div>
  </form>`;
}

function getFilterValues(formId) {
  return Object.fromEntries(new FormData(document.getElementById(formId)).entries());
}

function buildExportUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([k,v]) => v && url.searchParams.set(k, v));
  return url.toString();
}

const today      = () => new Date().toISOString().slice(0,10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
