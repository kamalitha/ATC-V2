// app.js — Main SPA entry point (PHP 8+ / vanilla JS rewrite)
import api, { setToken, clearToken } from './api.js';
import { renderDashboard }   from './pages/dashboard.js';
import { renderIDLRequests, renderIDLNew, renderIDLDetail, renderIDLSalesReport, renderIDLAramexReport, renderIDLMoeReport, renderIDLEmpostReport } from './pages/idl.js';
import { renderCPDRequests, renderCPDNew, renderCPDRenew, renderCPDDetail, renderCPDCarnets, renderCPDStockRequest, renderCPDStockRequestView, renderCPDCancellations, renderCPDReturnRequests, renderCPDClaims, renderCPDHolds } from './pages/cpd.js';
import { renderUsers }       from './pages/users.js';
import { renderReports }     from './pages/reports.js';
import { renderProfile }     from './pages/profile.js';
import { renderPublicApplyIDL, renderPublicApplyCPD, renderPublicHistory, renderPaymentResult } from './pages/public.js';
import { renderSupportTickets, renderPublicSupportTickets } from './pages/support.js';

// ── Global JS error logging ───────────────────────────────────────────────────
window.addEventListener('error', e => {
  console.error('[UNCAUGHT ERROR]', e.message, '\n  File:', e.filename, '\n  Line:', e.lineno, '\n  Col:', e.colno, '\n  Stack:', e.error?.stack ?? '—');
});

window.addEventListener('unhandledrejection', e => {
  const err = e.reason;
  console.error('[UNHANDLED PROMISE]', err?.message ?? err, '\n  Stack:', err?.stack ?? '—');
});

const _origError = console.error.bind(console);
console.error = (...args) => {
  _origError('[EMSO]', ...args);
};

// ── Global state ──────────────────────────────────────────────────────────────
export let currentUser = null;

// ── Toast ─────────────────────────────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3500) {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error:   '<i class="fa-solid fa-circle-xmark"></i>',
    info:    '<i class="fa-solid fa-circle-info"></i>',
  };
  el.innerHTML = `<span class="toast-icon">${icons[type] ?? icons.info}</span><span>${message}</span>`;
  c.appendChild(el);
  const remove = () => { el.classList.add('fade-out'); el.addEventListener('animationend', () => el.remove()); };
  const t = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(t); remove(); });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function openModal({ title, body, footer = '', size = '' }) {
  document.getElementById('modal-title').textContent   = title;
  document.getElementById('modal-body').innerHTML      = body;
  document.getElementById('modal-footer').innerHTML    = footer;
  document.getElementById('modal').className           = `modal${size ? ' modal-' + size : ''}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.querySelector('#modal-body input, #modal-body select, #modal-body textarea')?.focus(), 50);
}
export function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
window.closeModalGlobal = closeModal;

// ── Confirm helper ────────────────────────────────────────────────────────────
export function confirm(message, onConfirm, danger = true) {
  openModal({
    title: 'Confirm Action',
    body:  `<p style="color:var(--text-secondary)">${message}</p>`,
    footer:`<button class="btn btn-ghost" onclick="closeModalGlobal()">Cancel</button>
            <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirm-ok">Confirm</button>`,
  });
  document.getElementById('confirm-ok').onclick = () => { closeModal(); onConfirm(); };
}

// ── Breadcrumb map ────────────────────────────────────────────────────────────
const CRUMBS = {
  dashboard:     [{ label: 'Dashboard' }],
  'idl-requests':[{ label: 'International Driving Licenses' }, { label: 'All Requests' }],
  'idl-new':     [{ label: 'International Driving Licenses' }, { label: 'All Requests', route: 'idl-requests' }, { label: 'New' }],
  'idl-detail':  [{ label: 'International Driving Licenses' }, { label: 'All Requests', route: 'idl-requests' }, { label: 'Detail' }],
  'idl-sales-report':  [{ label: 'International Driving Licenses' }, { label: 'IDL Sales Report' }],
  'idl-aramex-report': [{ label: 'International Driving Licenses' }, { label: 'Sales Report for Aramex' }],
  'idl-moe-report':    [{ label: 'International Driving Licenses' }, { label: 'MOE Report' }],
  'idl-empost-report': [{ label: 'International Driving Licenses' }, { label: 'Sales Report for Empost' }],
  'support-tickets':   [{ label: 'Support Tickets' }],
  'public-support':    [{ label: 'My Support Tickets' }],
  'cpd-new':     [{ label: 'CPD' }, { label: 'Requests', route: 'cpd-requests' }, { label: 'New' }],
  'cpd-renew':   [{ label: 'CPD' }, { label: 'Requests', route: 'cpd-requests' }, { label: 'Copy/Renew' }],
  'cpd-detail':  [{ label: 'CPD' }, { label: 'Requests', route: 'cpd-requests' }, { label: 'Detail' }],
  'cpd-carnets':        [{ label: 'CPD' }, { label: 'Carnet Stock' }],
  'cpd-claims':         [{ label: 'CPD' }, { label: 'Claims' }],
  'cpd-holds':          [{ label: 'CPD' }, { label: 'Customer Holds' }],
  'cpd-stock-request':      [{ label: 'CPD' }, { label: 'Branch Request' }],
  'cpd-stock-request-view': [{ label: 'CPD' }, { label: 'Branch Request', route: 'cpd-stock-request' }, { label: 'View Request' }],
  users:         [{ label: 'Admin' }, { label: 'Users' }],
  reports:       [{ label: 'Reports' }],
  profile:       [{ label: 'Profile' }],
  'public-apply-idl': [{ label: 'Apply for IDL' }],
  'public-apply-cpd': [{ label: 'Apply for CPD' }],
  'public-history':        [{ label: 'My History' }],
  'payment-success':       [{ label: 'Payment Successful' }],
  'payment-declined':      [{ label: 'Payment Declined' }],
  'payment-cancelled':     [{ label: 'Payment Cancelled' }],
};

const TYPE_LABELS = {
  WEBSITE: 'Website', ONLINE: 'Online', WALKIN: 'Walk-In',
  RTA: 'RTA', MOI: 'MOI', DISTRIBUTOR: 'Distributor', ADCONNECT: 'ADConnect',
};

function setBreadcrumb(route, typeFilter = null) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;

  const crumbs = CRUMBS[route] ?? [{ label: route }];

  const allCrumbs = typeFilter
    ? [...crumbs, { label: TYPE_LABELS[typeFilter] ?? typeFilter }]
    : crumbs;

  bc.innerHTML = allCrumbs.map((c, i) => {
    const last = i === allCrumbs.length - 1;
    const sep  = i > 0 ? '<span class="sep"><i class="fa-solid fa-chevron-right"></i></span>' : '';
    return c.route && !last
      ? `${sep}<a class="crumb" data-route="${c.route}">${c.label}</a>`
      : `${sep}<span class="crumb${last ? ' active' : ''}">${c.label}</span>`;
  }).join('');

  bc.querySelectorAll('[data-route]').forEach(el =>
    el.addEventListener('click', () => navigate(el.dataset.route))
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
const ROUTES = {
  dashboard:     ()    => renderDashboard(),
  'idl-requests':param => renderIDLRequests(param),
  'idl-new':     ()    => renderIDLNew(),
  'idl-detail':  param => renderIDLDetail(param),
  'idl-sales-report': () => renderIDLSalesReport(),
  'idl-aramex-report': () => renderIDLAramexReport(),
  'idl-moe-report':    () => renderIDLMoeReport(),
  'idl-empost-report': () => renderIDLEmpostReport(),
  'support-tickets':   () => renderSupportTickets(),
  'public-support':    () => renderPublicSupportTickets(),
  'cpd-requests':param => renderCPDRequests(param),
  'cpd-new':     ()    => renderCPDNew(),
  'cpd-renew':   ()    => renderCPDRenew(),
  'cpd-detail':  param => renderCPDDetail(param),
  'cpd-carnets':       ()    => renderCPDCarnets(),
  'cpd-stock-request':       ()    => renderCPDStockRequest(),
  'cpd-stock-request-view':  (id)  => renderCPDStockRequestView(id),
  'cpd-cancellations':       ()    => renderCPDCancellations(),
  'cpd-return-requests':     ()    => renderCPDReturnRequests(),
  'cpd-claims':              ()    => renderCPDClaims(),
  'cpd-holds':               ()    => renderCPDHolds(),
  users:         ()    => renderUsers(),
  reports:       ()    => renderReports(),
  profile:       ()    => renderProfile(),
  'public-apply-idl': () => renderPublicApplyIDL(),
  'public-apply-cpd': () => renderPublicApplyCPD(),
  'public-history':   () => renderPublicHistory(),
  'payment-success':  () => renderPaymentResult('success'),
  'payment-declined': () => renderPaymentResult('declined'),
  'payment-cancelled':() => renderPaymentResult('cancelled'),
};

export function navigate(route, param = null) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  // Update sidebar active state — mark both the parent and matching subitem
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const typeFilter = (typeof param === 'object' && param?.type) ? param.type : null;

  // Map child routes to their parent nav item for highlighting
  const NAV_PARENT_MAP = {
    'cpd-stock-request-view': 'cpd-stock-request',
    'cpd-detail':             'cpd-requests',
    'cpd-new':                'cpd-requests',
    'cpd-renew':              'cpd-requests',
    'idl-detail':             'idl-requests',
    'idl-new':                'idl-requests',
  };
  const navRoute = NAV_PARENT_MAP[route] ?? route;

  if (typeFilter) {
    const subitem = document.querySelector(`[data-route="${navRoute}"][data-filter-type="${typeFilter}"]`);
    subitem?.classList.add('active');
  } else {
    const active = document.querySelector(`[data-route="${navRoute}"]:not([data-filter-type])`);
    active?.classList.add('active');
  }

  setBreadcrumb(route, typeFilter);
  closeModal();

  const feeRow = document.getElementById('nav-fee-row');
  if (feeRow) feeRow.style.display = route === 'public-apply-idl' ? '' : 'none';

  const fn = ROUTES[route];
  if (!fn) {
    content.innerHTML = '<div class="page-loading"><p style="color:var(--text-muted)">Page not found.</p></div>';
    return;
  }

  // Pass param directly — string = detail ID, object = filter context
  Promise.resolve(fn(param))
    .catch(err => {
      console.error(`[navigate:${route}]`, err);
      content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}</p></div>`;
    });
}

// ── Role-based nav ────────────────────────────────────────────────────────────
function applyNavVisibility(modules) {
  const show = id => document.getElementById(id)?.removeAttribute('style');
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

  ['nav-idl','nav-cpd','nav-admin','nav-reports','nav-public',
   'nav-idl-online','nav-cpd-online','nav-idl-walkin','nav-cpd-walkin',
   'nav-cpd-cheque','nav-cpd-cashier','nav-idl-cashier','nav-cpd-branch','nav-cpd-finance',
   'nav-cpd-claims'].forEach(hide);

  const role = currentUser?.role_name;

  // idl_cpd_online: restricted IDL + CPD sections (Online/Website only)
  if (role === 'idl_cpd_online') {
    show('nav-idl-online');
    show('nav-cpd-online');
  // idl_cpd_walkin: restricted IDL + CPD sections (Walk-In only)
  } else if (role === 'idl_cpd_walkin') {
    show('nav-idl-walkin');
    show('nav-cpd-walkin');
  // cpd_cheque: CPD Requests only — no New Request, no Carnet Stock, no Dashboard
  } else if (role === 'cpd_cheque') {
    show('nav-cpd-cheque');
  // idl_cpd_cashier: CPD Requests (queue filtered) + IDL Requests (queue filtered)
  } else if (role === 'idl_cpd_cashier') {
    show('nav-cpd-cashier');
    show('nav-idl-cashier');
  // cpd_branch: Branch Manager — Branch Stock, Carnet Requests
  } else if (role === 'cpd_branch') {
    show('nav-cpd-branch');
  // cpd_finance: Requests + Cancellation Requests
  } else if (role === 'cpd_finance') {
    show('nav-cpd-finance');
  // cpd_super_user: full IDL Officer menu (collapsed) + full CPD Officer menu + Claims
  } else if (role === 'cpd_super_user') {
    show('nav-idl');
    document.getElementById('nav-idl')?.classList.add('nav-collapsed');
    show('nav-cpd');
    show('nav-cpd-claims');
  } else {
    if (modules.includes('idl'))     show('nav-idl');
    if (modules.includes('cpd'))     show('nav-cpd');
  }

  if (modules.includes('users'))   show('nav-admin');
  if (modules.includes('reports')) show('nav-reports');
  if (modules.includes('public'))  {
    show('nav-public');
    hide('nav-dashboard');
  }

  if (role === 'admin') {
    ['nav-idl','nav-cpd','nav-admin','nav-reports'].forEach(show);
  }

  // Hide Dashboard for IDL officer roles, CPD officer, and public users
  const idlOfficerRoles = ['idl_officer','idl_cpd_cashier','idl_cpd_walkin','idl_cpd_online','idl_cpd_branch','cpd_officer','cpd_cheque','cpd_branch','cpd_super_user'];
  if (idlOfficerRoles.includes(role) || modules.includes('public')) {
    hide('nav-dashboard');
  } else {
    show('nav-dashboard');
  }

  // Support Tickets: only idl_officer
  if (role === 'idl_officer') {
    show('nav-support-tickets');
  } else {
    hide('nav-support-tickets');
  }

}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle').addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));

  document.getElementById('nav-idl-toggle')?.addEventListener('click', () => {
    document.getElementById('nav-idl')?.classList.toggle('nav-collapsed');
  });
  document.getElementById('nav-cpd-toggle')?.addEventListener('click', () => {
    document.getElementById('nav-cpd')?.classList.toggle('nav-collapsed');
  });

  document.getElementById('sidebar-nav').addEventListener('click', e => {
    const item = e.target.closest('[data-route]');
    if (!item) return;

    sidebar.classList.remove('mobile-open');

    const route      = item.dataset.route;
    const filterType = item.dataset.filterType ?? null;
    navigate(route, filterType ? { type: filterType } : null);
  });

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('user-pill').addEventListener('click', () => navigate('profile'));
  document.addEventListener('click', e => {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-open')
        && !sidebar.contains(e.target) && (!mobileBtn || !mobileBtn.contains(e.target))) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('topbar-clock');
  if (!el) return;
  const tick = () => el.textContent = new Date().toLocaleString('en-AE', {
    weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
  tick();
  setInterval(tick, 30_000);
}

// ── Sidebar badges ────────────────────────────────────────────────────────────
export async function refreshBadges() {
  try {
    const modules = currentUser?.modules ?? [];
    const isAdmin = currentUser?.role_name === 'admin';
    const canIDL  = modules.includes('idl') || isAdmin;
    const canCPD  = modules.includes('cpd') || isAdmin;

    const [idl, cpd] = await Promise.allSettled([
      canIDL ? api.idl.stats() : Promise.reject('no access'),
      canCPD ? api.cpd.stats() : Promise.reject('no access'),
    ]);

    const idlEl = document.getElementById('badge-idl-pending');
    const cpdEl = document.getElementById('badge-cpd-pending');

    if (idl.status === 'fulfilled') {
      const s = idl.value;
      // Total pending badge on "All Requests"
      if (s.pending > 0) { idlEl.textContent = s.pending; idlEl.style.display = ''; }
      else if (idlEl)    idlEl.style.display = 'none';

      // Per-type badges — ONLINE badge shows combined ONLINE+WEBSITE count
      const types = ['WALKIN','RTA','MOI','DISTRIBUTOR','ADCONNECT'];
      types.forEach(type => {
        const el    = document.getElementById(`badge-idl-${type}`);
        const count = s.by_type?.[type] ?? 0;
        if (!el) return;
        if (count > 0) { el.textContent = count; el.style.display = ''; }
        else             el.style.display = 'none';
      });
      // Combined Online/Website badge (full nav)
      const onlineEl    = document.getElementById('badge-idl-ONLINE');
      const onlineCount = (s.by_type?.['ONLINE'] ?? 0) + (s.by_type?.['WEBSITE'] ?? 0);
      if (onlineEl) {
        if (onlineCount > 0) { onlineEl.textContent = onlineCount; onlineEl.style.display = ''; }
        else                   onlineEl.style.display = 'none';
      }
      // Restricted online nav badge (idl_cpd_online) — online+website count only
      const idlOnlineRestricted = document.getElementById('badge-idl-online-restricted');
      if (idlOnlineRestricted) {
        if (onlineCount > 0) { idlOnlineRestricted.textContent = onlineCount; idlOnlineRestricted.style.display = ''; }
        else                   idlOnlineRestricted.style.display = 'none';
      }
      // Restricted walkin nav badge (idl_cpd_walkin) — WALKIN count only
      const walkinCount         = s.by_type?.['WALKIN'] ?? 0;
      const idlWalkinRestricted = document.getElementById('badge-idl-walkin-restricted');
      if (idlWalkinRestricted) {
        if (walkinCount > 0) { idlWalkinRestricted.textContent = walkinCount; idlWalkinRestricted.style.display = ''; }
        else                   idlWalkinRestricted.style.display = 'none';
      }
    } else if (idlEl) {
      idlEl.style.display = 'none';
    }

    if (cpd.status === 'fulfilled') {
      const cs = cpd.value;
      if (cs.pending > 0) { cpdEl.textContent = cs.pending; cpdEl.style.display = ''; }
      else if (cpdEl)      cpdEl.style.display = 'none';
      // cpd_cheque badge
      const cpdChequeEl = document.getElementById('badge-cpd-cheque-pending');
      if (cpdChequeEl) {
        if (cs.pending > 0) { cpdChequeEl.textContent = cs.pending; cpdChequeEl.style.display = ''; }
        else                  cpdChequeEl.style.display = 'none';
      }
      const cpdCashierEl = document.getElementById('badge-cpd-cashier-pending');
      if (cpdCashierEl) {
        if (cs.cashier_pending > 0) { cpdCashierEl.textContent = cs.cashier_pending; cpdCashierEl.style.display = ''; }
        else                          cpdCashierEl.style.display = 'none';
      }
      const idlCashierEl = document.getElementById('badge-idl-cashier-pending');
      if (idlCashierEl) {
        if (cs.idl_cashier_pending > 0) { idlCashierEl.textContent = cs.idl_cashier_pending; idlCashierEl.style.display = ''; }
        else                              idlCashierEl.style.display = 'none';
      }
      const branchEl = document.getElementById('badge-cpd-branch-pending');
      if (branchEl) {
        if (cs.pending > 0) { branchEl.textContent = cs.pending; branchEl.style.display = ''; }
        else                  branchEl.style.display = 'none';
      }
      const financeEl = document.getElementById('badge-cpd-finance-pending');
      if (financeEl) {
        if (cs.pending > 0) { financeEl.textContent = cs.pending; financeEl.style.display = ''; }
        else                  financeEl.style.display = 'none';
      }
      const cancelBadge = document.getElementById('badge-cpd-cancellations');
      if (cancelBadge) {
        if (cs.cancellations_pending > 0) { cancelBadge.textContent = cs.cancellations_pending; cancelBadge.style.display = ''; }
        else                                cancelBadge.style.display = 'none';
      }
      const returnsBadge = document.getElementById('badge-cpd-returns');
      if (returnsBadge) {
        if (cs.returns_pending > 0) { returnsBadge.textContent = cs.returns_pending; returnsBadge.style.display = ''; }
        else                          returnsBadge.style.display = 'none';
      }
      // Restricted CPD online nav badge — online booking_channel count only
      const cpdOnlineRestricted = document.getElementById('badge-cpd-online-restricted');
      if (cpdOnlineRestricted) {
        const cpdOnlineCount = cs.online_pending ?? 0;
        if (cpdOnlineCount > 0) { cpdOnlineRestricted.textContent = cpdOnlineCount; cpdOnlineRestricted.style.display = ''; }
        else                      cpdOnlineRestricted.style.display = 'none';
      }
      // Restricted CPD walkin nav badge — walkin booking_channel count only
      const cpdWalkinRestricted = document.getElementById('badge-cpd-walkin-restricted');
      if (cpdWalkinRestricted) {
        const cpdWalkinCount = cs.walkin_pending ?? 0;
        if (cpdWalkinCount > 0) { cpdWalkinRestricted.textContent = cpdWalkinCount; cpdWalkinRestricted.style.display = ''; }
        else                      cpdWalkinRestricted.style.display = 'none';
      }
    } else if (cpdEl) cpdEl.style.display = 'none';

  } catch { /* silent */ }
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
function showLogin() { document.getElementById('login-screen').classList.remove('hidden'); document.getElementById('app-shell').classList.add('hidden'); }
function showApp()   { document.getElementById('login-screen').classList.add('hidden');    document.getElementById('app-shell').classList.remove('hidden'); }

function populateUserInfo(user) {
  currentUser = user;
  const initials = `${user.first_name?.[0]??''}${user.last_name?.[0]??''}`.toUpperCase() || '??';
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-name').textContent   = `${user.first_name} ${user.last_name??''}`.trim();
  document.getElementById('user-role').textContent   = (user.role_name??'').replace(/_/g,' ');
  applyNavVisibility(user.modules ?? []);
}

function defaultRoute(roleName) {
  const map = {
    admin:'dashboard', idl_officer:'idl-requests', cpd_officer:'cpd-requests', cpd_super_user:'cpd-requests',
    idl_cpd_cashier:'cpd-requests', idl_cpd_walkin:'idl-requests', idl_cpd_online:'idl-requests',
    cpd_finance:'cpd-requests', cpd_branch:'cpd-stock-request', finance:'reports',
    management:'dashboard', idl_distributor:'idl-requests',
    cpd_cheque:'cpd-requests',
    public: 'public-history',
  };
  return map[roleName] ?? 'dashboard';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn     = document.getElementById('login-btn');
  const errEl   = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  btn.disabled = true;
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-spinner').classList.remove('hidden');
  errEl.classList.add('hidden');

  try {
    const data = await api.auth.login({ username, password });
    setToken(data.csrf_token);
    populateUserInfo(data);
    showApp();
    navigate(defaultRoute(data.role_name));
    refreshBadges();
  } catch (err) {
    errEl.textContent = err.message ?? 'Login failed';
    errEl.classList.remove('hidden');
    document.getElementById('login-password').value = '';
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-spinner').classList.add('hidden');
  }
}

async function handleLogout() {
  try { await api.auth.logout(); } catch { /* ignore */ }
  clearToken();
  currentUser = null;
  showLogin();
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  initSidebar();
  startClock();

  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // UAE Pass — placeholder: alert until OAuth is configured
  document.getElementById('btn-uae-pass')?.addEventListener('click', () => {
    alert('UAE Pass integration requires a registered client_id from UAE Pass. Please contact your system administrator.');
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.querySelector('.toggle-pwd').addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  window.addEventListener('auth:expired', () => { showLogin(); toast('Session expired. Please sign in again.', 'error', 5000); });

  // Attempt session restore
  try {
    const user = await api.auth.me();
    setToken(user.csrf_token);
    populateUserInfo(user);
    showApp();

    const paymentRoutes = { 'payment-success': true, 'payment-declined': true, 'payment-cancelled': true };
    const pathSegment   = window.location.pathname.split('/').filter(Boolean).pop() ?? '';

    if (paymentRoutes[pathSegment] && user.role_name === 'public') {
      navigate(pathSegment);
    } else {
      navigate(defaultRoute(user.role_name));
    }
    refreshBadges();
  } catch (err) {
    // Only show login screen for auth failures (401), not other errors
    if (!err || err.status === 401 || err.message?.includes('Unauthorized') || err.message?.includes('token')) {
      showLogin();
    } else {
      console.error('[boot]', err);
      showLogin();
    }
  }
}

boot();
