// components/table.js — Reusable data table with search, filter, sort, paginate

export class DataTable {
  #container; #columns; #fetchFn; #opts;
  #page = 1; #search = ''; #filters = {}; #sort = null; #sortDir = 'asc';

  constructor(container, columns, fetchFn, opts = {}) {
    this.#container = container;
    this.#columns   = columns;
    this.#fetchFn   = fetchFn;
    this.#opts      = opts;
    // Pre-load any default filters supplied by the caller
    if (opts.defaultFilters) {
      this.#filters = { ...opts.defaultFilters };
    }
  }

  render() {
    // Use data-* attributes instead of id="" to avoid conflicts when
    // multiple tables exist or the same table is re-rendered.
    this.#container.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <div class="table-toolbar-left">
            ${this.#opts.title ? `<span class="table-title">${this.#opts.title}</span>` : ''}
          </div>
          <div class="table-toolbar-right">
            ${this.#renderFilters()}
            <div class="search-input-wrap">
              <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
              <input class="search-input" data-dt="search"
                placeholder="${this.#opts.searchPlaceholder ?? 'Search…'}"
                value="${this.#search}" />
              ${this.#opts.searchOnButton ? `<button class="search-btn" data-dt="search-btn" type="button" title="Search"><i class="fa-solid fa-magnifying-glass"></i></button>` : ''}
            </div>
            ${this.#opts.actions ?? ''}
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr data-dt="head">${this.#renderHeaders()}</tr></thead>
            <tbody data-dt="body">
              <tr><td colspan="${this.#columns.length}" class="table-empty">
                <div class="spinner" style="margin:auto"></div>
              </td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" data-dt="pagination"></div>
      </div>`;

    this.#bindEvents();
    this.#load();
  }

  // ── Private: query helpers scoped to this container ──────────────────────

  #q(selector)  { return this.#container.querySelector(selector); }
  #qa(selector) { return this.#container.querySelectorAll(selector); }

  // ── Private: render ───────────────────────────────────────────────────────

  #renderHeaders() {
    return this.#columns.map(col => {
      let cls = '';
      if (this.#sort === col.key) cls = this.#sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc';
      return `<th data-key="${col.key}" class="${cls}" ${col.width ? `style="width:${col.width}"` : ''}>
        ${col.label}
      </th>`;
    }).join('');
  }

  #renderFilters() {
    if (!this.#opts.filters?.length) return '';
    return this.#opts.filters.map(f => `
      <select class="filter-select" data-dt="filter" data-filter-key="${f.key}">
        <option value="">${f.label}</option>
        ${f.options.map(o =>
          `<option value="${o.value}" ${this.#filters[f.key] === o.value ? 'selected' : ''}>${o.label}</option>`
        ).join('')}
      </select>`).join('');
  }

  // ── Private: event binding ────────────────────────────────────────────────

  #bindEvents() {
    // Search
    const searchEl = this.#q('[data-dt="search"]');
    if (searchEl) {
      if (this.#opts.searchOnButton) {
        // Only search when button is clicked or Enter is pressed
        // Clear all active filters so the search covers the full table
        const doSearch = () => {
          this.#search = searchEl.value.trim();
          this.#page   = 1;
          this.#filters = {};
          this.#qa('[data-dt="filter"]').forEach(sel => {
            // Use 'all' if that option exists, otherwise blank
            const hasAll = [...sel.options].some(o => o.value === 'all');
            sel.value = hasAll ? 'all' : '';
            this.#filters[sel.dataset.filterKey] = sel.value || '';
          });
          if (this.#search === '' && this.#opts.defaultFilters) {
            // Restore default filters only when search is cleared
            this.#filters = { ...this.#opts.defaultFilters };
            this.#qa('[data-dt="filter"]').forEach(sel => {
              const def = this.#opts.defaultFilters[sel.dataset.filterKey];
              if (def != null) sel.value = def;
            });
          }
          this.#load();
        };
        const searchBtnEl = this.#q('[data-dt="search-btn"]');
        if (searchBtnEl) searchBtnEl.addEventListener('click', doSearch);
        searchEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
      } else {
        // Default: debounced input search
        let debounce;
        searchEl.addEventListener('input', () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            this.#search = searchEl.value;
            this.#page   = 1;
            this.#load();
          }, 300);
        });
      }
    }

    // Filters — change immediately
    this.#qa('[data-dt="filter"]').forEach(sel => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.filterKey;
        const val = sel.value;
        // Empty string means "no filter" — remove from map so it isn't sent
        if (val === '') {
          delete this.#filters[key];
        } else {
          this.#filters[key] = val;
        }
        this.#page = 1;
        this.#load();
      });
    });

    // Column sort headers
    this.#bindSortHeaders();
  }

  #bindSortHeaders() {
    this.#qa('thead th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (this.#sort === key) {
          this.#sortDir = this.#sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.#sort    = key;
          this.#sortDir = 'asc';
        }
        this.#load();
      });
    });
  }

  // ── Private: load & render data ───────────────────────────────────────────

  async #load() {
    const body = this.#q('[data-dt="body"]');
    if (!body) return;

    body.innerHTML = `<tr><td colspan="${this.#columns.length}" class="table-empty">
      <div class="spinner" style="margin:auto;width:24px;height:24px"></div>
    </td></tr>`;

    // Build params — only include non-empty, non-null values
    const params = { page: this.#page };
    if (this.#search) params.search = this.#search;
    Object.entries(this.#filters).forEach(([k, v]) => { if (v !== '' && v != null) params[k] = v; });
    if (this.#sort) { params.sort = this.#sort; params.dir = this.#sortDir; }

    try {
      const result = await this.#fetchFn(params);
      this.#renderRows(result.data ?? result);
      this.#renderPagination(result);
    } catch (err) {
      body.innerHTML = `<tr><td colspan="${this.#columns.length}" class="table-empty">
        <div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <p>${err.message}</p>
      </td></tr>`;
    }
  }

  #renderRows(rows) {
    const body = this.#q('[data-dt="body"]');
    if (!body) return;

    if (!rows?.length) {
      body.innerHTML = `<tr><td colspan="${this.#columns.length}" class="table-empty">
        <div class="empty-icon"><i class="fa-solid fa-inbox"></i></div>
        <p>No records found</p>
      </td></tr>`;
    } else {
      body.innerHTML = rows.map(row => `
        <tr data-id="${row[this.#opts.idKey ?? 'id'] ?? ''}"
            style="${(this.#opts.rowStyle ? this.#opts.rowStyle(row) + ';' : '')}${this.#opts.onRowClick ? 'cursor:pointer' : ''}">
          ${this.#columns.map(col =>
            `<td>${col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}</td>`
          ).join('')}
        </tr>`).join('');

      if (this.#opts.onRowClick) {
        body.querySelectorAll('tr[data-id]').forEach(tr => {
          tr.addEventListener('click', e => {
            if (!e.target.closest('button, a')) {
              const id  = tr.dataset.id;
              const row = rows.find(r => String(r[this.#opts.idKey ?? 'id']) === id);
              this.#opts.onRowClick(id, row);
            }
          });
        });
      }
    }

    // Update sort indicators in the header without re-creating the elements
    // (avoids duplicate listener issues — just update class names)
    this.#qa('thead th[data-key]').forEach(th => {
      const key = th.dataset.key;
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (key === this.#sort) th.classList.add(this.#sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    });
  }

  #renderPagination({ total = 0, page = 1, per_page = 20, pages = 1 } = {}) {
    const pg = this.#q('[data-dt="pagination"]');
    if (!pg) return;

    const from = total === 0 ? 0 : (page - 1) * per_page + 1;
    const to   = Math.min(page * per_page, total);

    const pageNums = [];
    for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) pageNums.push(i);

    pg.innerHTML = `
      <span class="pagination-info">Showing ${from}–${to} of ${total}</span>
      <div class="pagination-btns">
        <button class="pg-btn" data-p="1" ${page <= 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-angles-left"></i></button>
        <button class="pg-btn" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-angle-left"></i></button>
        ${pageNums.map(n =>
          `<button class="pg-btn ${n === page ? 'active' : ''}" data-p="${n}">${n}</button>`
        ).join('')}
        <button class="pg-btn" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>
          <i class="fa-solid fa-angle-right"></i></button>
        <button class="pg-btn" data-p="${pages}" ${page >= pages ? 'disabled' : ''}>
          <i class="fa-solid fa-angles-right"></i></button>
      </div>`;

    pg.querySelectorAll('.pg-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#page = parseInt(btn.dataset.p, 10);
        this.#load();
      });
    });
  }

  // ── Public ────────────────────────────────────────────────────────────────

  reload() { this.#load(); }
}

// ── Status badge ──────────────────────────────────────────────────────────────
export function statusBadge(status) {
  const map = {
    // IDL request_status values (from mn_idl_status)
    1: ['warning', 'Pending'],
    2: ['warning', 'Processing'],
    3: ['danger',  'Rejected'],
    4: ['success', 'Approved'],
    5: ['info',    'Dispatched'],
    6: ['danger',  'Lost/Stolen'],
    7: ['default', 'Cancelled'],
    // IDL status label strings (kept for compatibility)
    'Under Processing':  ['warning', 'Processing'],
    'Under Processing ': ['warning', 'Processing'],
    'Approved':          ['success', 'Approved'],
    'Rejected':          ['danger',  'Rejected'],
    'Dispatched':        ['info',    'Dispatched'],
    'Cancelled':         ['default', 'Cancelled'],
    'Not Paid':          ['warning', 'Pending'],
    'Pending':           ['warning', 'Pending'],
    // Payment status
    'Paid':              ['success', 'Paid'],
    // CPD
    'NEW':        ['accent',  'New'],
    'Processing': ['warning', 'Processing'],
    'Confirmed':  ['info',    'Confirmed'],
    'Issued':     ['success', 'Issued'],
    'Returned':   ['default', 'Returned'],
    'Damaged':    ['danger',  'Damaged'],
    // Generic boolean
    '1': ['success', 'Active'],
    '0': ['danger',  'Inactive'],
  };
  const [cls, label] = map[status] ?? ['default', status ?? '—'];
  return `<span class="badge badge-${cls}">${label}</span>`;
}

export function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  return isNaN(d) ? str
    : d.toLocaleString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatCurrency(val) {
  if (val == null) return '—';
  return 'AED ' + Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
