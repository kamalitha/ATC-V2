// pages/idl.js
import api, { API_BASE } from '../api.js';
import { DataTable, statusBadge, formatDate, formatDateTime, formatCurrency } from '../components/table.js';
import { navigate, openModal, closeModal, toast, confirm, currentUser } from '../app.js';

// ── IDL Request list ──────────────────────────────────────────────────────────
export function renderIDLRequests(param = null) {
  const typeFilter  = (param && typeof param === 'object') ? (param.type ?? null) : null;
  const isCashier   = currentUser?.role_name === 'idl_cpd_cashier';

  const TYPE_LABELS = {
    WEBSITE:'Website', ONLINE:'Online', ONLINE_WEBSITE:'Online / Website', WALKIN:'Walk-In',
    RTA:'RTA', MOI:'MOI', DISTRIBUTOR:'Distributor', ADCONNECT:'ADConnect',
  };
  const subtitle = typeFilter
    ? `${TYPE_LABELS[typeFilter] ?? typeFilter} Applications`
    : isCashier ? 'Pending in queue' : 'All Requests';

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${isCashier ? 'International Driving Licenses' : 'IDL Requests'}</h1>
        <p class="page-subtitle">${subtitle}</p>
      </div>
      ${!isCashier ? `
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-idl">
          <i class="fa-solid fa-plus"></i> New Request
        </button>
      </div>` : ''}
    </div>
    <div id="idl-table"></div>`;

  if (!isCashier) {
    document.getElementById('btn-new-idl').addEventListener('click', () => navigate('idl-new'));
  }

  const idlOfficerRoles = ['idl_officer','idl_cpd_cashier','idl_cpd_walkin','idl_cpd_online','idl_cpd_branch'];
  const isIDLOfficer    = idlOfficerRoles.includes(currentUser?.role_name);
  // Cashier defaults specifically to "Processing" (paid, awaiting the cashier) —
  // narrower than the other officer roles' "pending" bucket (Not Paid + Processing).
  const defaultStatus   = isCashier ? '2' : isIDLOfficer ? 'pending' : '';

  const defaultFilters = {};
  if (defaultStatus) defaultFilters.status = defaultStatus;
  if (typeFilter)    defaultFilters.type   = typeFilter;

  new DataTable(
    document.getElementById('idl-table'),
    [
      { key: 'request_id',         label: 'Request ID',  width: '180px' },
      { key: 'name',               label: 'Applicant',   render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'request_type',       label: 'Type',        render: v => `<span class="badge badge-default">${v}</span>` },
      { key: 'requested_datetime', label: 'Submitted',   render: v => formatDateTime(v) },
      { key: 'paid_status',        label: 'Payment',     render: v => statusBadge(v == 1 ? 'Paid' : 'Not Paid') },
      { key: 'status_label',        label: 'Status',      render: v => statusBadge(v ?? '—') },
      { key: 'actions',            label: '',            width: '80px',
        render: (_, r) => `<button class="btn btn-ghost btn-sm view-btn" data-id="${r.auto_id}">
          <i class="fa-solid fa-eye"></i> View</button>` },
    ],
    params => api.idl.list(params),
    {
      idKey:             'auto_id',
      searchPlaceholder: 'Search by ID, name, IDL no…',
      searchOnButton:    true,
      defaultFilters,
      filters: isCashier ? [
        { key: 'status', label: 'Processing (default)', options: [
          { value: '2',       label: 'Processing' },
          { value: 'pending', label: 'Not Paid + Processing' },
          { value: '4',       label: 'Approved' },
          { value: '5',       label: 'Dispatched' },
          { value: 'all',     label: 'All (incl. processed)' },
        ]},
        { key: 'location', label: 'Location', options: [
          { value: 'DXB', label: 'Dubai' },
          { value: 'AUH', label: 'Abu Dhabi' },
          { value: 'all', label: 'All Locations' },
        ]},
      ] : [
        { key: 'status', label: isIDLOfficer ? 'Pending (default)' : 'All Statuses', options: [
          { value: 'pending', label: 'Pending (Not Paid + Processing)' },
          { value: '1',       label: 'Not Paid' },
          { value: '2',       label: 'Processing' },
          { value: '3',       label: 'Rejected' },
          { value: '4',       label: 'Approved' },
          { value: '5',       label: 'Dispatched' },
          { value: 'all',     label: 'All Statuses' },
        ]},
        { key: 'type', label: typeFilter ? (TYPE_LABELS[typeFilter] ?? typeFilter) : 'All Types', options: [
          { value: 'ONLINE_WEBSITE', label: 'Online / Website' },
          { value: 'ONLINE',         label: 'Online' },
          { value: 'WEBSITE',        label: 'Website' },
          { value: 'WALKIN',         label: 'Walk-In' },
          { value: 'RTA',            label: 'RTA' },
          { value: 'MOI',            label: 'MOI' },
          { value: 'DISTRIBUTOR',    label: 'Distributor' },
          { value: 'ADCONNECT',      label: 'AD Connect' },
          { value: 'all',            label: 'All Types' },
        ]},
        { key: 'location', label: 'Location', options: [
          { value: 'DXB', label: 'Dubai' },
          { value: 'AUH', label: 'Abu Dhabi' },
          { value: 'all', label: 'All Locations' },
        ]},
      ],
    },
  ).render();

  document.getElementById('idl-table').addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (btn) navigate('idl-detail', { id: btn.dataset.id, type: typeFilter });
  });
}

// ── IDL New Request — validation helpers ─────────────────────────────────────

function setFieldError(name, msg) {
  const addrFields = { idl_addr_apt: true, idl_addr_building: true, idl_addr_area: true, idl_addr_city: true };
  const errKey = addrFields[name] ? 'address_in_uae' : name;
  const errEl  = document.getElementById(`err-${errKey}`);
  const input  = document.querySelector(`[name="${name}"]`);
  if (errEl) errEl.textContent = msg;
  input?.closest('.field')?.classList.add('field-invalid');
}

function clearFieldError(name) {
  const errEl = document.getElementById(`err-${name}`);
  const input = document.querySelector(`[name="${name}"]`);
  if (errEl) errEl.textContent = '';
  input?.closest('.field')?.classList.remove('field-invalid');
}

function validateIDLForm() {
  // Clear all previous errors first
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  document.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));

  const errors = [];

  const required = [
    { name: 'emirates_id',          label: 'Emirates ID' },
    { name: 'first_name',           label: 'First Name' },
    { name: 'last_name',            label: 'Last Name' },
    { name: 'nationality',          label: 'Nationality' },
    { name: 'sex',                  label: 'Sex' },
    { name: 'idl_addr_city',        label: 'City (Address in UAE)' },
    { name: 'po_box',               label: 'PO Box' },
    { name: 'mobile_no',            label: 'Mobile No' },
    { name: 'email',                label: 'Email' },
    { name: 'city',                 label: 'City' },
    { name: 'home_country_address', label: 'Home Country Address' },
    { name: 'license_no',           label: 'License No' },
    { name: 'place_of_birth',       label: 'Place of Birth' },
    { name: 'place_of_issue',       label: 'DL Place of Issue' },
    { name: 'type_of_dl',           label: 'Type of Driving License' },
    { name: 'emirate',              label: 'Emirate of Residence' },
  ];

  required.forEach(({ name, label }) => {
    // type_of_dl is handled separately below (multi-select hidden input)
    if (name === 'type_of_dl') return;
    const el = document.querySelector(`[name="${name}"]`);
    if (!el) return;
    const val = el.value?.trim();
    if (!val) {
      setFieldError(name, `${label} is required`);
      errors.push(name);
    }
  });

  // type_of_dl — multi-select: check hidden input has at least one value
  const dlHiddenVal = document.getElementById('type_of_dl_hidden')?.value?.trim();
  if (!dlHiddenVal) {
    const errEl = document.getElementById('err-type_of_dl');
    const container = document.getElementById('dl-type-select');
    if (errEl) errEl.textContent = 'Type of Driving License is required';
    container?.classList.add('field-invalid');
    errors.push('type_of_dl');
  }

  // Email format
  const emailEl = document.querySelector('[name="email"]');
  if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
    setFieldError('email', 'Enter a valid email address');
    errors.push('email');
  }

  // Delivery address required when "send to address" is selected
  const deliveryOpt = document.querySelector('input[name="delivery_option"]:checked')?.value;
  if (deliveryOpt === 'send_to_address') {
    const addrEl = document.getElementById('delivery_address');
    if (!addrEl?.value?.trim()) {
      setFieldError('delivery_address', 'Delivery address is required when sending to address');
      errors.push('delivery_address');
    }
  }

  // Documents — all 5 slots required
  const docSlots = [
    { key: 'dl_front',      label: 'Drivers License Front Image' },
    { key: 'dl_back',       label: 'Drivers License Back Image' },
    { key: 'eid_front',     label: 'Emirates ID Front Image' },
    { key: 'eid_back',      label: 'Emirates ID Back Image' },
    { key: 'passport_photo',label: 'Passport Size Photo' },
  ];
  docSlots.forEach(({ key, label }) => {
    const input   = document.querySelector(`input[data-doc="${key}"]`);
    const errEl   = document.getElementById(`err-doc-${key}`);
    const zone    = document.getElementById(`doc-zone-${key}`);
    // A file is "present" if the input has a new file OR an existing preview is showing
    const hasFile = (input?.files?.[0]) ||
                    (zone?.querySelector('.doc-upload-preview')?.style.display !== 'none');
    if (!hasFile) {
      if (errEl) errEl.textContent = `${label} is required`;
      zone?.classList.add('doc-zone-invalid');
      errors.push(`doc-${key}`);
    }
  });

  // Disclaimer checkboxes — both required
  const disclaimers = [
    { id: 'disclaimer_1', label: 'You must agree to the driving licence validity disclaimer' },
    { id: 'disclaimer_2', label: 'You must accept the communications disclaimer' },
  ];
  disclaimers.forEach(({ id, label }) => {
    const cb    = document.getElementById(id);
    const errEl = document.getElementById(`err-${id}`);
    if (!cb?.checked) {
      if (errEl) errEl.textContent = label;
      document.getElementById(`disclaimer-check-${id.slice(-1)}`)?.classList.add('disclaimer-invalid');
      errors.push(id);
    }
  });

  return errors;
}

// ── IDL New Request ───────────────────────────────────────────────────────────
export async function renderIDLNew() {
  const content = document.getElementById('page-content');

  // Fetch all lookups in parallel
  const [nationalities, dlTypes, emirates, idlCfg] = await Promise.all([
    api.idl.nationalities(),
    api.idl.dlTypes(),
    api.idl.emirates(),
    api.idl.config(),
  ]);

  // Hand-the-device UAE PASS flow: the officer sent the customer to log in on this
  // same device (see app.js handleUaePassCallback), then logged back in themselves —
  // the customer's verified profile is waiting here to prefill this fresh form.
  const walkinPrefillRaw = sessionStorage.getItem('idl_walkin_prefill');
  const walkinPrefill    = walkinPrefillRaw ? JSON.parse(walkinPrefillRaw) : null;
  if (walkinPrefillRaw) sessionStorage.removeItem('idl_walkin_prefill');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">New IDL Request</h1>
        <p class="page-subtitle">Create a walk-in or officer-submitted IDL application</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="btn-new-back">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    </div>

    <form id="idl-form" novalidate>

      <!-- ── Personal Information (matches public Verify Your Identity card) ── -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>Your Identity Information</span>
          ${walkinPrefill ? `
          <span class="pub-verified-badge"><i class="fa-solid fa-shield-halved"></i> Verified by UAE PASS</span>`
          : `<button type="button" class="btn btn-ghost btn-sm" id="btn-walkin-uaepass">
               <i class="fa-solid fa-mobile-screen"></i> Customer will log in with UAE PASS</button>`}
        </div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Full Name</span>
            <input id="idl-full-name" class="pub-id-inline-input" placeholder="Full name" autocomplete="off" />
            <input type="hidden" name="first_name" />
            <input type="hidden" name="last_name" />
            <div class="field-error" id="err-first_name" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Emirates ID</span>
            <input name="emirates_id" id="emirates_id_input" class="pub-id-inline-input"
              placeholder="784-XXXX-XXXXXXX-X — press Enter to search" />
            <div class="eid-search-msg" id="eid-search-msg"></div>
            <div class="field-error" id="err-emirates_id" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-flag"></i></span>
            <span class="pub-id-label">Nationality</span>
            <select name="nationality" class="pub-id-inline-select">
              <option value="">Select nationality</option>
              ${nationalities.map(n => `<option value="${n.nationality_id}">${n.nationality}</option>`).join('')}
            </select>
            <div class="field-error" id="err-nationality" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-venus-mars"></i></span>
            <span class="pub-id-label">Gender</span>
            <select name="sex" class="pub-id-inline-select">
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <div class="field-error" id="err-sex" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Mobile Number</span>
            <input name="mobile_no" class="pub-id-inline-input" placeholder="+971 50 xxx xxxx" />
            <div class="field-error" id="err-mobile_no" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-envelope"></i></span>
            <span class="pub-id-label">Email Address</span>
            <input name="email" type="email" class="pub-id-inline-input" placeholder="applicant@email.com" />
            <div class="field-error" id="err-email" style="margin:0"></div>
          </div>

        </div>
      </div>

      <!-- ── Driving Licence Details (same card style as Your Identity Information) ── -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Driving Licence Details</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-id-card"></i></span>
            <span class="pub-id-label">Driving Licence Number *</span>
            <input name="license_no" class="pub-id-inline-input" placeholder="Enter driving licence number" />
            <div class="field-error" id="err-license_no" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar-check"></i></span>
            <span class="pub-id-label">Date of Issue</span>
            <input name="issued_date" type="date" class="pub-id-inline-input" />
            <div class="field-error" id="err-issued_date" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="pub-id-label">Licence Issuing Emirate *</span>
            <select name="place_of_issue" class="pub-id-inline-select" required>
              <option value="">Select emirate</option>
              ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
            </select>
            <div class="field-error" id="err-place_of_issue" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span>
            <span class="pub-id-label">Date of Expiry</span>
            <input name="expiry_date" type="date" class="pub-id-inline-input" />
            <div class="field-error" id="err-expiry_date" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-circle-question"></i></span>
            <span class="pub-id-label">Issued IDL in Past?</span>
            <span style="display:flex;gap:24px;align-items:center">
              <label style="display:flex;gap:8px;align-items:center;font-weight:400;cursor:pointer">
                <input type="radio" name="first_idl" value="0" /> Yes
              </label>
              <label style="display:flex;gap:8px;align-items:center;font-weight:400;cursor:pointer">
                <input type="radio" name="first_idl" value="1" checked /> No
              </label>
            </span>
          </div>

        </div>
      </div>

      <!-- ── Vehicle Categories (same tiles as the public licence step) ── -->
      <div class="pub-additional-card" style="margin-bottom:20px">
        <div class="pub-additional-title">Vehicle Categories *</div>
        <p style="font-size:.85rem;color:var(--text-muted);margin:10px 0 14px">
          Select all the categories that are mentioned on the driving licence.
        </p>
        <div class="vc-grid">
          ${dlTypes.map(t => `
            <label class="vc-tile" id="vc-tile-${t.type_id}">
              <input type="checkbox" class="vc-cb dl-type-cb" value="${t.type_id}" style="display:none" />
              <i class="fa-solid fa-id-card vc-tile-icon"></i>
              <span class="vc-tile-code">${t.dl_type}</span>
            </label>`).join('')}
        </div>
        <input type="hidden" name="type_of_dl" id="type_of_dl_hidden" />
        <div class="field-error" id="err-type_of_dl" style="margin-top:8px"></div>
      </div>

      <!-- ── Documents Upload (same card as the public licence step) ── -->
      <div class="pub-additional-card" style="margin-bottom:20px">
        <div class="pub-additional-title">Documents Upload</div>
        <p style="font-size:.78rem;color:var(--text-muted);margin:4px 0 16px">
          Accepted formats: JPG, PNG or PDF
        </p>
        <div class="doc-upload-grid">
          ${docUpload('eid_front',     'Emirates ID Front Image')}
          ${docUpload('eid_back',      'Emirates ID Back Image')}
          ${docUpload('dl_front',      'Driving Licence Front Image')}
          ${docUpload('dl_back',       'Driving Licence Back Image')}
          ${docUpload('passport_photo','Passport Size Photo')}
          ${docUpload('signature',     'Signature', false, false)}
        </div>
        <div id="doc-upload-error" class="form-error hidden" style="margin-top:8px"></div>
      </div>

      <!-- ── Additional Information (same card style as Your Identity Information) ── -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Additional Information</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar"></i></span>
            <span class="pub-id-label">Date of Birth *</span>
            <input name="dob" type="date" required class="pub-id-inline-input" />
            <div class="field-error" id="err-dob" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="pub-id-label">Place of Birth *</span>
            <input name="place_of_birth" required class="pub-id-inline-input" placeholder="Enter city or country of birth" />
            <div class="field-error" id="err-place_of_birth" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-map-location-dot"></i></span>
            <span class="pub-id-label">UAE Permanent Place of Residence *</span>
            <select name="emirate" required class="pub-id-inline-select">
              <option value="">Select emirate</option>
              ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
            </select>
            <div class="field-error" id="err-emirate" style="margin:0"></div>
          </div>

        </div>
      </div>

      <!-- ── Residential Address (officer-only fields, not in the public wizard) ── -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Residential Address</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row" style="align-items:start">
            <span class="pub-id-icon"><i class="fa-solid fa-house-chimney"></i></span>
            <span class="pub-id-label">Address in UAE *</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input id="idl-addr-apt" name="idl_addr_apt" class="pub-id-inline-input" placeholder="Apartment / Villa Number" />
              <input id="idl-addr-building" name="idl_addr_building" class="pub-id-inline-input" placeholder="Building / Street Name" />
              <input id="idl-addr-area" name="idl_addr_area" class="pub-id-inline-input" placeholder="Area" />
              <select id="idl-addr-city" name="idl_addr_city" class="pub-id-inline-select" required>
                <option value="">— Select City —</option>
                <option value="Abu Dhabi">Abu Dhabi</option>
                <option value="Dubai">Dubai</option>
                <option value="Sharjah">Sharjah</option>
                <option value="Ajman">Ajman</option>
                <option value="Ras Al-Khaimah">Ras Al-Khaimah</option>
                <option value="Fujairah">Fujairah</option>
                <option value="Umm Al Quwain">Umm Al Quwain</option>
              </select>
            </div>
            <div class="field-error" id="err-address_in_uae" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-envelope-open-text"></i></span>
            <span class="pub-id-label">PO Box *</span>
            <input name="po_box" required class="pub-id-inline-input" placeholder="PO Box" />
            <div class="field-error" id="err-po_box" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-city"></i></span>
            <span class="pub-id-label">City *</span>
            <input name="city" required class="pub-id-inline-input" placeholder="City" />
            <div class="field-error" id="err-city" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-house"></i></span>
            <span class="pub-id-label">Home Country Address *</span>
            <input name="home_country_address" required class="pub-id-inline-input" placeholder="Home country address" />
            <div class="field-error" id="err-home_country_address" style="margin:0"></div>
          </div>

        </div>
      </div>

      <!-- ── Delivery ──────────────────────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">Choose Delivery Method</div>
        <div class="section-card-body">
          <div class="del-method-grid">
            <label class="del-method-card del-method-card-active" id="wi-del-card-office">
              <input type="radio" name="delivery_option" value="pick_from_office" checked style="display:none" />
              <div class="del-method-radio" id="wi-del-radio-office"><i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i></div>
              <div class="del-method-icon-wrap"><i class="fa-solid fa-building"></i></div>
              <div>
                <div class="del-method-title">Collect from Office</div>
                <div class="del-method-desc">Free — customer picks up in person</div>
              </div>
            </label>
            <label class="del-method-card" id="wi-del-card-send">
              <input type="radio" name="delivery_option" value="send_to_address" style="display:none" />
              <div class="del-method-radio" id="wi-del-radio-send"><i class="fa-regular fa-circle"></i></div>
              <div class="del-method-icon-wrap"><i class="fa-solid fa-house"></i></div>
              <div>
                <div class="del-method-title">Send to Address</div>
                <div class="del-method-fee">Delivery Fee - AED ${Number(idlCfg.delivery_fee ?? 15.00).toFixed(2)}</div>
              </div>
            </label>
          </div>
          <div class="field field-full" id="delivery-address-field" style="display:none;margin-top:16px">
            <label>Delivery Address *</label>
            <textarea name="delivery_address" id="delivery_address" rows="3"
              style="width:100%;resize:vertical"
              placeholder="Full delivery address — building, street, area, emirate, postal code"></textarea>
            <div class="field-error" id="err-delivery_address"></div>
          </div>
        </div>
      </div>

      <!-- ── Fee Breakdown ─────────────────────────────────────────────────── -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Fee Breakdown</div>
        <div class="rv-extra-rows" id="wi-fee-breakdown"></div>
      </div>

      <!-- ── Disclaimer ────────────────────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">Disclaimer</div>
        <div class="section-card-body">
          <div style="display:flex;flex-direction:column;gap:16px">
            <label class="disclaimer-check" id="disclaimer-check-1">
              <input type="checkbox" name="disclaimer_1" id="disclaimer_1" />
              <span>By clicking agree you understand that your UAE drivers licence is valid up to the date of use when driving overseas.</span>
            </label>
            <div class="field-error" id="err-disclaimer_1"></div>
            <label class="disclaimer-check" id="disclaimer-check-2">
              <input type="checkbox" name="disclaimer_2" id="disclaimer_2" />
              <span>By clicking purchase I accept that the ATCUAE may send you news and information about your IDL via email.</span>
            </label>
            <div class="field-error" id="err-disclaimer_2"></div>
          </div>
        </div>
      </div>

      <div id="form-error" class="form-error hidden"></div>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="btn-new-cancel">
          <i class="fa-solid fa-xmark"></i> Cancel
        </button>
        <button type="submit" class="btn btn-primary" id="submit-btn">
          <i class="fa-solid fa-floppy-disk"></i> Create IDL Request
        </button>
      </div>
    </form>`;

  document.getElementById('btn-new-back').addEventListener('click',   () => navigate('idl-requests'));
  document.getElementById('btn-new-cancel').addEventListener('click', () => navigate('idl-requests'));

  document.getElementById('btn-walkin-uaepass')?.addEventListener('click', () => {
    sessionStorage.setItem('idl_walkin_uaepass_pending', '1');
    window.location.href = api.auth.uaepassLoginUrl();
  });

  if (walkinPrefill) {
    // Populate and lock exactly the fields UAE PASS verified — same fields the online
    // wizard's viaUaePass branch treats as read-only.
    const lockField = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el || value == null || value === '') return;
      el.value = value;
      // A disabled <select> is excluded from FormData on submit — lock it visually
      // (block interaction) instead, so the verified value still gets submitted.
      if (el.tagName === 'SELECT') el.style.pointerEvents = 'none';
      else el.readOnly = true;
      el.tabIndex = -1;
      el.style.background = 'var(--bg-elevated)';
    };
    const fullNameEl = document.getElementById('idl-full-name');
    fullNameEl.value = [walkinPrefill.first_name, walkinPrefill.last_name].filter(Boolean).join(' ');
    fullNameEl.readOnly = true;
    fullNameEl.style.background = 'var(--bg-elevated)';
    lockField('first_name',  walkinPrefill.first_name);
    lockField('last_name',   walkinPrefill.last_name);
    lockField('nationality', walkinPrefill.nationality);
    lockField('sex',         walkinPrefill.sex);
    lockField('mobile_no',   walkinPrefill.mobile_no);
    lockField('email',       walkinPrefill.email);
    if (walkinPrefill.emirates_id) {
      const eidField = document.getElementById('emirates_id_input');
      if (eidField) { eidField.value = walkinPrefill.emirates_id; eidField.readOnly = true; eidField.style.background = 'var(--bg-elevated)'; }
    }
    // Marks this application as identity-verified via UAE PASS, same as the public
    // wizard's DV share — read by the detail view to lock identity fields from editing.
    const viaUaePassFlag = document.createElement('input');
    viaUaePassFlag.type  = 'hidden';
    viaUaePassFlag.name  = 'identity_via_uae_pass';
    viaUaePassFlag.value = '1';
    document.getElementById('idl-form').appendChild(viaUaePassFlag);
  }

  // Delivery method cards (Collect from Office / Send to Address) + fee breakdown
  const deliveryRadios = [...document.querySelectorAll('input[name="delivery_option"]')];
  const deliveryField  = document.getElementById('delivery-address-field');
  const deliveryInput  = document.getElementById('delivery_address');
  const feeBreakdownEl = document.getElementById('wi-fee-breakdown');

  const BASE_AMOUNT  = Number(idlCfg.idl_amount   ?? 160.00);
  const SERVICE_FEE  = Number(idlCfg.service_fee  ?? 10.00);
  const DELIVERY_FEE = Number(idlCfg.delivery_fee ?? 15.00);
  const aed          = n => 'AED ' + Number(n).toFixed(2);

  function selectedDeliveryOption() {
    return deliveryRadios.find(r => r.checked)?.value ?? 'pick_from_office';
  }

  function updateDeliveryCardStyles() {
    const isSend = selectedDeliveryOption() === 'send_to_address';
    document.getElementById('wi-del-card-office').classList.toggle('del-method-card-active', !isSend);
    document.getElementById('wi-del-card-send').classList.toggle('del-method-card-active', isSend);
    document.getElementById('wi-del-radio-office').innerHTML = !isSend
      ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>';
    document.getElementById('wi-del-radio-send').innerHTML = isSend
      ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>';
  }

  function updateTotal() {
    const isSend      = selectedDeliveryOption() === 'send_to_address';
    const deliveryFee = isSend ? DELIVERY_FEE : 0;
    const vat         = Math.round((BASE_AMOUNT + deliveryFee) * 0.05 * 100) / 100;
    const total       = BASE_AMOUNT + deliveryFee + vat + SERVICE_FEE;
    if (feeBreakdownEl) {
      feeBreakdownEl.innerHTML = `
        <div class="rv-extra-row"><span class="rv-extra-label">Base Fee</span><span class="rv-extra-value">${aed(BASE_AMOUNT)}</span></div>
        ${isSend ? `<div class="rv-extra-row"><span class="rv-extra-label">Delivery Fee</span><span class="rv-extra-value">${aed(deliveryFee)}</span></div>` : ''}
        <div class="rv-extra-row"><span class="rv-extra-label">VAT 5%</span><span class="rv-extra-value">${aed(vat)}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Service Fee</span><span class="rv-extra-value">${aed(SERVICE_FEE)}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label" style="font-weight:700;color:var(--text-primary)">Total Payable</span><span class="rv-extra-value" style="font-weight:700;color:var(--accent);font-size:1rem">${aed(total)}</span></div>`;
    }
  }

  deliveryRadios.forEach(radio => radio.addEventListener('change', () => {
    const isSend = selectedDeliveryOption() === 'send_to_address';
    deliveryField.style.display = isSend ? '' : 'none';
    if (!isSend) { deliveryInput.value = ''; clearFieldError('delivery_address'); }
    updateDeliveryCardStyles();
    updateTotal();
  }));

  updateDeliveryCardStyles();
  updateTotal();

  // Activate upload zones
  initDocUploads();

  // ── Emirates ID search on Enter ────────────────────────────────────────────
  const fullNameInput = document.getElementById('idl-full-name');
  const syncNameParts = () => {
    const parts = fullNameInput.value.trim().split(/\s+/).filter(Boolean);
    document.querySelector('[name="first_name"]').value = parts.slice(0, 2).join(' ');
    document.querySelector('[name="last_name"]').value  = parts.slice(2).join(' ');
  };
  fullNameInput.addEventListener('input', syncNameParts);
  syncNameParts();
  const eidInput  = document.getElementById('emirates_id_input');
  const eidMsg    = document.getElementById('eid-search-msg');

  // Helper: set a select value and trigger visual update
  function setField(name, value) {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el || value == null) return;
    el.value = value;
  }

  eidInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const eid = eidInput.value.trim();
    if (!eid) return;

    eidMsg.textContent    = '';
    eidMsg.className      = 'eid-search-msg';
    eidInput.disabled     = true;
    eidMsg.textContent    = 'Searching…';
    eidMsg.classList.add('eid-searching');

    try {
      const data = await api.idl.searchByEid(eid);

      // ── Hold check ────────────────────────────────────────────────────────
      const holdData = await api.cpd.searchHold(eid).catch(() => null);
      if (holdData?.active_hold) {
        const reason = holdData.active_hold.hold_reason;
        openModal({
          title: 'Customer on Hold',
          size:  'sm',
          body:  `<div style="display:flex;gap:12px;align-items:flex-start">
                    <i class="fa-solid fa-triangle-exclamation fa-xl" style="color:var(--warning,#d97706);margin-top:2px;flex-shrink:0"></i>
                    <div>
                      <p style="margin:0 0 8px;font-weight:600">This customer has an active hold.</p>
                      <p style="margin:0 0 6px;font-size:.875rem">New IDL requests cannot be created until the hold is lifted.</p>
                      ${reason ? `<p style="margin:0;font-size:.8rem;color:var(--text-muted)">Reason: ${reason}</p>` : ''}
                    </div>
                  </div>`,
          footer: `<button class="btn btn-primary" id="hold-goto-idl-btn">
                     <i class="fa-solid fa-list"></i> Go to IDL Requests
                   </button>`,
        });
        document.getElementById('hold-goto-idl-btn').addEventListener('click', () => {
          closeModal();
          navigate('idl-requests');
        });
        document.getElementById('modal-close').addEventListener('click', () => navigate('idl-requests'), { once: true });
        document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) navigate('idl-requests'); }, { once: true });
        eidInput.value    = '';
        eidMsg.textContent = '';
        eidMsg.className   = 'eid-search-msg';
        return;
      }

      // ── Personal Information ──────────────────────────────────────────────
      setField('first_name',           data.first_name);
      setField('last_name',            data.last_name);
      document.getElementById('idl-full-name').value = [data.first_name, data.last_name].filter(Boolean).join(' ');
      setField('nationality',          data.nationality);
      setField('sex',                  data.sex);
      setField('dob',                  data.dob?.split('T')[0] ?? data.dob ?? '');
      setField('address_in_uae',       data.address_in_uae);
      // Pre-fill city if address contains a known emirate
      const knownCities = ['Abu Dhabi','Dubai','Sharjah','Ajman','Ras Al-Khaimah','Fujairah','Umm Al Quwain'];
      const cityMatch   = knownCities.find(c => (data.address_in_uae ?? '').includes(c));
      if (cityMatch) setField('idl_addr_city', cityMatch);
      setField('po_box',               data.po_box);
      setField('mobile_no',            data.mobile_no);
      setField('email',                data.email);
      setField('city',                 data.city);
      setField('home_country_address', data.home_country_address);

      // ── License Information ───────────────────────────────────────────────
      setField('license_no',    data.license_no);
      setField('place_of_birth',data.place_of_birth);
      setField('place_of_issue',data.place_of_issue);
      setField('issued_date',   data.issued_date?.split('T')[0]  ?? data.issued_date  ?? '');
      setField('expiry_date',   data.expiry_date?.split('T')[0]  ?? data.expiry_date  ?? '');
      setField('emirate',       data.emirate);
      setField('first_idl',     data.first_idl ?? 1);

      // ── DL Type multi-select ──────────────────────────────────────────────
      if (data.type_of_dl) {
        const ids = String(data.type_of_dl).split(',').map(s => s.trim());
        document.querySelectorAll('.dl-type-cb').forEach(cb => {
          cb.checked = ids.includes(cb.value);
        });
        updateDlHidden();
      }

      eidMsg.textContent = '✓ Applicant details populated from last IDL';
      eidMsg.className   = 'eid-search-msg eid-found';

      // Load documents from the previous request if available
      if (data.last_request_auto_id) {
        try {
          const docs = await api.idl.getDocuments(data.last_request_auto_id);
          Object.entries(docs).forEach(([slot, url]) => {
            const input   = document.querySelector(`input[data-doc="${slot}"]`);
            if (!input) return;
            const zone    = input.closest('.doc-upload-zone');
            const holder  = zone?.querySelector('.doc-upload-placeholder');
            const preview = zone?.querySelector('.doc-upload-preview');
            const img     = zone?.querySelector('.doc-preview-img');
            const name    = zone?.querySelector('.doc-preview-name');
            if (!zone || !preview || !img) return;
            img.src = `${window.location.origin}${API_BASE}${url}`;
            if (name) name.textContent = url.split('/').pop();
            if (holder)  holder.style.display  = 'none';
            preview.style.display = 'flex';
            // Clear any doc validation error since we now have a file
            const errEl = document.getElementById(`err-doc-${slot}`);
            if (errEl) errEl.textContent = '';
            zone.classList.remove('doc-zone-invalid');
          });
        } catch {
          // Silently ignore — documents may simply not exist for that request
        }
      }

    } catch (err) {
      const notFound = err.status === 404 || err.message?.toLowerCase().includes('not found');
      eidMsg.textContent = notFound ? 'Emirates ID not found — please fill in the details manually' : `Search error: ${err.message}`;
      eidMsg.className   = 'eid-search-msg eid-not-found';
    } finally {
      eidInput.disabled = false;
      eidInput.focus();
    }
  });

  // ── Vehicle categories: tile selection (same behaviour as the public licence step) ──
  function updateDlHidden() {
    document.querySelectorAll('.vc-tile').forEach(tile => {
      tile.classList.toggle('vc-tile-active', tile.querySelector('.dl-type-cb').checked);
    });
    const checked = [...document.querySelectorAll('.dl-type-cb:checked')].map(cb => cb.value);
    document.getElementById('type_of_dl_hidden').value = checked.join(',');
    if (checked.length) document.getElementById('err-type_of_dl').textContent = '';
  }

  document.querySelectorAll('.vc-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const cb = tile.querySelector('.dl-type-cb');
      cb.checked = !cb.checked;
      updateDlHidden();
    });
  });

  document.getElementById('idl-form').addEventListener('submit', async e => {
    e.preventDefault();

    // ── Client-side validation ─────────────────────────────────────────────
    const errors = validateIDLForm();
    if (errors.length) {
      // Scroll to first error
      const first = document.querySelector('.field-error:not(:empty)');
      first?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn   = document.getElementById('submit-btn');
    const errEl = document.getElementById('form-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const body = Object.fromEntries(new FormData(e.target).entries());

    // Concatenate address sub-fields into address_in_uae
    const addrParts = [
      (body.idl_addr_apt      ?? '').trim(),
      (body.idl_addr_building ?? '').trim(),
      (body.idl_addr_area     ?? '').trim(),
      (body.idl_addr_city     ?? '').trim(),
    ].filter(Boolean);
    body.address_in_uae = addrParts.join(' ');
    delete body.idl_addr_apt; delete body.idl_addr_building;
    delete body.idl_addr_area; delete body.idl_addr_city;

    try {
      const eid = (body.emirates_id ?? '').trim();
      if (eid) {
        const holdData = await api.cpd.searchHold(eid).catch(() => null);
        if (holdData?.active_hold) {
          errEl.textContent = 'This customer has an active hold. Lift the hold before creating a new request.';
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create IDL Request';
          return;
        }
      }

      const res = await api.idl.create(body);

      // Upload any selected documents
      const slots    = ['dl_front', 'dl_back', 'eid_front', 'eid_back', 'passport_photo', 'signature'];
      const formData = new FormData();
      let   hasFiles = false;
      slots.forEach(slot => {
        const input = document.querySelector(`input[data-doc="${slot}"]`);
        if (input?.files?.[0]) { formData.append(slot, input.files[0]); hasFiles = true; }
      });
      if (hasFiles) {
        try {
          const up = await api.upload(`/idl/requests/${res.auto_id}/documents`, formData);
          if (up.errors && Object.keys(up.errors).length) {
            toast(`Request created — some files not saved: ${Object.values(up.errors).join('; ')}`, 'error', 7000);
          }
        } catch {
          toast('Request created but document upload failed', 'error');
        }
      }

      toast(`IDL request ${res.request_id} created`, 'success');
      navigate('idl-detail', res.auto_id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create IDL Request';
    }
  });

  // Clear field errors on interaction
  document.getElementById('idl-form').addEventListener('input',  e => clearFieldError(e.target.name));
  document.getElementById('idl-form').addEventListener('change', e => {
    clearFieldError(e.target.name);
    // Clear disclaimer invalid state on check
    if (e.target.id === 'disclaimer_1' || e.target.id === 'disclaimer_2') {
      const num = e.target.id.slice(-1);
      document.getElementById(`err-${e.target.id}`).textContent = '';
      document.getElementById(`disclaimer-check-${num}`)?.classList.remove('disclaimer-invalid');
    }
  });
}

// ── IDL Detail ────────────────────────────────────────────────────────────────
export async function renderIDLDetail(param) {
  const id         = (typeof param === 'object') ? param.id   : param;
  const typeFilter = (typeof param === 'object') ? (param.type ?? null) : null;
  const content = document.getElementById('page-content');
  const r = await api.idl.get(id);

  const status   = parseInt(r.request_status);
  // Cashier accepts payment at status 1, or officer/cashier views an approved/
  // dispatched request — fetch fee config to render the same styled fee-breakdown
  // the online wizard uses, instead of a bare total.
  const isOfficerOrCashier   = ['idl_officer', 'idl_cpd_cashier'].includes(currentUser?.role_name);
  const isCashierPaymentStep = currentUser?.role_name === 'idl_cpd_cashier' && status === 1;
  const showsIssuedBreakdown = isOfficerOrCashier && (status === 4 || status === 5);
  const idlCfg   = (isCashierPaymentStep || showsIssuedBreakdown) ? await api.idl.config() : null;
  const canEdit  = status === 1 || status === 2; // Not Paid / Processing
  // Air Waybill No must be enterable at status 4 (Approved, awaiting dispatch) —
  // otherwise the Dispatch button can never succeed since the field starts empty.
  const canEditAwb = canEdit || status === 4;
  // Personal-info edit is allowed for officers up until the IDL is printed (print_hash
  // is only ever set the first time printIdl() runs) — matches the feedback that once
  // printed, the customer-officer view must be locked from further edits. Also locked
  // when the applicant supplied this info via UAE PASS — first/last name, nationality
  // and gender (the only fields this edit form exposes) are exactly what UAE PASS
  // verifies, so officers must not be able to override a verified identity.
  const isOfficerRole   = ['idl_officer', 'idl_cpd_walkin'].includes(currentUser?.role_name);
  const canEditIdentity = !r.print_hash && isOfficerRole && !r.applicant_via_uae_pass;
  const lockedByUaePass = !r.print_hash && isOfficerRole && !!r.applicant_via_uae_pass;
  const nationalities = canEditIdentity ? await api.idl.nationalities() : [];

  const CAT_LABELS   = { A:'Motorcycle', B:'Car', C:'Heavy Vehicle', D:'Bus', E:'Car with Heavy Trailer' };
  const CAT_ICONS    = { A:'fa-motorcycle', B:'fa-car', C:'fa-truck', D:'fa-bus', E:'fa-trailer' };
  // Older requests store legacy numeric dl_type ids (mn_idl_dl_types) instead of the new A–E letter codes
  const LEGACY_CAT_MAP = { 1:'A', 2:'B', 3:'C', 4:'D', 5:'E', 6:'E' };
  const selectedCats = (r.type_of_dl || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(code => LEGACY_CAT_MAP[code] ?? code);

  const backBtn    = `<button class="btn btn-ghost btn-sm" data-action="back">
    <i class="fa-solid fa-arrow-left"></i> Back</button>`;
  const actionBtns = buildIDLActionBtns(r);
  const actionsHtml = backBtn + actionBtns;

  const cancelBannerHtml = await idlCancelBannerHtml(id);
  content.innerHTML = `
      ${cancelBannerHtml}
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${r.request_id}</h1>
        <p class="page-subtitle">
          <span class="subtitle-item">Type: <span class="badge badge-default">${esc(r.request_type ?? '—')}</span></span>
          <span class="subtitle-item">Payment: ${r.paid_status == 1
            ? '<span class="badge badge-success">Paid</span>'
            : '<span class="badge badge-warning">Unpaid</span>'}</span>
          <span class="subtitle-item">Status: ${statusBadge(r.status_label ?? r.request_status)}</span>
        </p>
      </div>
      <div class="page-actions">${actionsHtml}</div>
    </div>

    <!-- ── 1. Personal Information ──────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="rv-section-title">Personal Information</span>
        ${canEditIdentity ? `
        <button class="btn btn-ghost btn-sm" id="btn-edit-identity">
          <i class="fa-solid fa-pen"></i> Edit</button>` : ''}
        ${lockedByUaePass ? `
        <span class="badge badge-default" style="font-weight:500">
          <i class="fa-solid fa-shield-halved"></i> Verified via UAE PASS — not editable</span>` : ''}
      </div>
      <div class="rv-identity-rows" id="identity-view-rows">
        ${identityRow('fa-regular fa-user',        'Full Name',           [r.first_name, r.last_name].filter(Boolean).join(' '))}
        ${identityRow('fa-regular fa-id-card',     'Emirates ID',         r.emirates_id)}
        ${identityRow('fa-solid fa-flag',          'Nationality',         r.nationality)}
        ${identityRow('fa-solid fa-venus-mars',    'Gender',              r.sex)}
        ${identityRow('fa-solid fa-mobile-screen', 'Mobile Number',       r.mobile_no)}
        ${identityRow('fa-regular fa-envelope',    'Email Address',       r.email)}
      </div>
      ${canEditIdentity ? `
      <div class="form-grid" id="identity-edit-rows" style="display:none;margin-top:12px">
        <div class="field">
          <label>First Name</label>
          <input id="id-edit-first-name" value="${esc(r.first_name ?? '')}" />
        </div>
        <div class="field">
          <label>Last Name</label>
          <input id="id-edit-last-name" value="${esc(r.last_name ?? '')}" />
        </div>
        <div class="field">
          <label>Nationality</label>
          <select id="id-edit-nationality">
            ${nationalities.map(n => `<option value="${n.nationality_id}" ${String(n.nationality_id) === String(r.nationality_id) ? 'selected' : ''}>${esc(n.nationality)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Gender</label>
          <select id="id-edit-sex">
            <option value="Male" ${r.sex === 'Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${r.sex === 'Female' ? 'selected' : ''}>Female</option>
          </select>
        </div>
      </div>
      <div id="identity-edit-error" class="form-error hidden" style="margin-top:8px"></div>
      <div id="identity-edit-actions" style="display:none;gap:8px;margin-top:12px">
        <button class="btn btn-success btn-sm" id="btn-save-identity">
          <i class="fa-solid fa-floppy-disk"></i> Save</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-identity">
          <i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>` : ''}
    </div>

    <!-- ── Additional Information ───────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
      <div class="rv-extra-rows">
        <div class="rv-extra-row"><span class="rv-extra-label">Date of Birth</span><span class="rv-extra-value">${formatDate(r.dob)}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Place of Birth</span><span class="rv-extra-value">${r.place_of_birth || '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">UAE Permanent Place of Residence</span><span class="rv-extra-value">${r.emirate_name ?? r.emirate ?? '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Additional Phone Number</span><span class="rv-extra-value">${r.additional_mobile_no || '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Additional Email</span><span class="rv-extra-value">${r.additional_email || '—'}</span></div>
      </div>
    </div>

    <!-- ── Driving Licence Details ──────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:14px">Driving Licence Details</div>
      <div class="rv-identity-rows">
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-id-card"></i></span><span class="rv-id-label">Licence Number</span><span class="rv-id-value">${r.license_no || '—'}</span></div>
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-check"></i></span><span class="rv-id-label">Date of Issue</span><span class="rv-id-value">${r.issued_date ? new Date(r.issued_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}</span></div>
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-location-dot"></i></span><span class="rv-id-label">Issuing Emirate</span><span class="rv-id-value">${r.place_of_issue_name ?? r.place_of_issue ?? '—'}</span></div>
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span><span class="rv-id-label">Date of Expiry</span><span class="rv-id-value">${r.expiry_date ? new Date(r.expiry_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}</span></div>
      </div>
      ${selectedCats.length ? `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bg-base)">
        <div style="font-size:.82rem;color:var(--text-muted);font-weight:500;margin-bottom:8px">Vehicle Categories</div>
        <div class="rv-cats-row">
          ${selectedCats.map(code => `
            <div class="rv-cat-badge">
              <i class="fa-solid ${CAT_ICONS[code] || 'fa-car'}"></i>
              <span>${code} — ${CAT_LABELS[code] || code}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- ── Documents Attached ───────────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Documents Attached</div>
      <div class="doc-upload-grid">
        ${docUpload('dl_front',    'Drivers License Front Image', !canEdit)}
        ${docUpload('dl_back',     'Drivers License Back Image', !canEdit)}
        ${docUpload('eid_front',   'Emirates ID Front Image', !canEdit)}
        ${docUpload('eid_back',    'Emirates ID Back Image', !canEdit)}
        ${docUpload('passport_photo', 'Passport Size Photo', !canEdit)}
        ${docUpload('signature',   'Signature', !canEdit, false)}
      </div>
      <div id="doc-upload-error" class="form-error hidden" style="margin-top:8px"></div>
    </div>

    <!-- Document viewer lightbox -->
    <div id="idl-lightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);
      z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px">
      <button id="idl-lightbox-close" style="position:absolute;top:16px;right:20px;background:none;
        border:none;color:#fff;font-size:1.8rem;cursor:pointer;line-height:1">&times;</button>
      <img id="idl-lightbox-img" src="" alt=""
        style="max-width:92vw;max-height:86vh;object-fit:contain;border-radius:6px;box-shadow:0 4px 40px rgba(0,0,0,.5)" />
      <span id="idl-lightbox-label"
        style="color:rgba(255,255,255,.7);font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em"></span>
    </div>

    <!-- ── 4. Delivery Options ──────────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Delivery &amp; Payment</div>
      <div class="rv-extra-rows">
        <div class="rv-extra-row"><span class="rv-extra-label">Delivery Option</span><span class="rv-extra-value">${(() => {
            const map = {
              pick_from_office:          'Pick up at ATCUAE Office (Dubai Only)',
              pick_from_dubai_office:    'Pick up at Dubai Office',
              pick_from_abudhabi_office: 'Pick up at Abu Dhabi Office',
              send_to_address:          'Send to Address',
              home_delivery:            'Home Delivery',
            };
            return map[r.delivery_option] ?? 'Send to Address';
          })()}</span></div>
        ${['send_to_address', 'home_delivery'].includes(r.delivery_option) ? `
        <div class="rv-extra-row"><span class="rv-extra-label">Delivery Address</span><span class="rv-extra-value">${r.delivery_address || '—'}</span></div>` : ''}
        <div class="rv-extra-row"><span class="rv-extra-label">Payment Method</span><span class="rv-extra-value">${(() => {
            const m = (r.payment_method ?? '').toUpperCase();
            const map = { CREDIT_CARD: 'Credit Card', CASH: 'Cash', CARD: 'Card', ONLINE: 'Online', CHEQUE: 'Cheque' };
            return map[m] || r.payment_method || '—';
          })()}</span></div>
        ${isOfficerOrCashier
          ? (showsIssuedBreakdown ? (() => {
              const isSend      = ['send_to_address', 'home_delivery'].includes(r.delivery_option);
              const baseAmount  = Number(idlCfg.idl_amount  ?? 160.00);
              const serviceFee  = Number(idlCfg.service_fee ?? 10.00);
              const deliveryFee = isSend ? Number(idlCfg.delivery_fee ?? 15.00) : 0;
              const vat         = Math.round((baseAmount + deliveryFee) * 0.05 * 100) / 100;
              const total       = baseAmount + deliveryFee + vat + serviceFee;
              const aedFmt      = n => 'AED ' + Number(n).toFixed(2);
              return `
        <div class="rv-extra-row"><span class="rv-extra-label">Base Fee</span><span class="rv-extra-value">${aedFmt(baseAmount)}</span></div>
        ${isSend ? `<div class="rv-extra-row"><span class="rv-extra-label">Delivery Fee</span><span class="rv-extra-value">${aedFmt(deliveryFee)}</span></div>` : ''}
        <div class="rv-extra-row"><span class="rv-extra-label">VAT 5%</span><span class="rv-extra-value">${aedFmt(vat)}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Service Fee</span><span class="rv-extra-value">${aedFmt(serviceFee)}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label" style="font-weight:700;color:var(--text-primary)">Total Payable</span><span class="rv-extra-value" style="font-weight:700;color:var(--accent)">${aedFmt(r.total_amount ?? total)}</span></div>`;
            })() : `<div class="rv-extra-row"><span class="rv-extra-label">Total Amount (AED)</span><span class="rv-extra-value">${r.total_amount != null ? Number(r.total_amount).toFixed(2) : '—'}</span></div>`)
          : `<div class="rv-extra-row"><span class="rv-extra-label">Air Waybill No</span><span class="rv-extra-value">${r.air_bill_no || '—'}</span></div>`}
        ${isOfficerOrCashier ? `
        <div class="rv-extra-row"><span class="rv-extra-label">Paid Date &amp; Time</span><span class="rv-extra-value">${r.paid_date ? formatDateTime(r.paid_date) : '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Order / Ref No</span><span class="rv-extra-value">${esc(r.order_ref_no ?? '') || '—'}</span></div>` : ''}
      </div>
    </div>

    <!-- ── 4. Process Application ───────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Process Application</div>
        ${(currentUser?.role_name !== 'idl_cpd_cashier') ||
           (status === 4 || status === 5) ? `
        <div class="form-grid">
          <div class="field">
            <label>IDP No</label>
            <input id="proc-idl-no" value="${esc(r.idl_no ?? '')}"
              placeholder="Auto-generated when issued" readonly />
          </div>
          <div class="field">
            <label>IDP Booklet Number</label>
            <input id="proc-booklet" value="${esc(r.idl_booklet_no ?? '')}"
              placeholder="Assigned when issued" readonly />
          </div>
          <div class="field">
            <label>Air Waybill No</label>
            <input id="proc-awb" value="${esc(r.air_bill_no ?? '')}"
              placeholder="Airway bill number" ${canEditAwb ? '' : 'readonly'} />
          </div>
          ${currentUser?.role_name !== 'idl_cpd_cashier' ? `
          <div class="field field-full">
            <label>Comments</label>
            <textarea id="proc-comments" rows="3"
              style="width:100%;resize:vertical" placeholder="Officer notes…">${esc(r.officer_comments ?? '')}</textarea>
          </div>` : ''}
        </div>` : ''}
        ${isCashierPaymentStep ? (() => {
          const isSend      = ['send_to_address', 'home_delivery'].includes(r.delivery_option);
          const baseAmount  = Number(idlCfg.idl_amount  ?? 160.00);
          const serviceFee  = Number(idlCfg.service_fee ?? 10.00);
          const deliveryFee = isSend ? Number(idlCfg.delivery_fee ?? 15.00) : 0;
          const vat         = Math.round((baseAmount + deliveryFee) * 0.05 * 100) / 100;
          const total       = baseAmount + deliveryFee + vat + serviceFee;
          const aed         = n => 'AED ' + Number(n).toFixed(2);
          return `
        <div class="field" style="max-width:280px;margin-top:16px">
          <label>Payment Method *</label>
          <select id="proc-payment-method" required>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="ONLINE">Online</option>
          </select>
        </div>
        <div class="rv-extra-rows" style="margin-top:12px">
          <div class="rv-extra-row"><span class="rv-extra-label">Base Fee</span><span class="rv-extra-value">${aed(baseAmount)}</span></div>
          ${isSend ? `<div class="rv-extra-row"><span class="rv-extra-label">Delivery Fee</span><span class="rv-extra-value">${aed(deliveryFee)}</span></div>` : ''}
          <div class="rv-extra-row"><span class="rv-extra-label">VAT 5%</span><span class="rv-extra-value">${aed(vat)}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Service Fee</span><span class="rv-extra-value">${aed(serviceFee)}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label" style="font-weight:700;color:var(--text-primary)">Total Payable</span><span class="rv-extra-value" style="font-weight:700;color:var(--accent);font-size:1rem">${aed(total)}</span></div>
        </div>`;
        })() : ''}
        <div id="proc-error" class="form-error hidden" style="margin-top:8px"></div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          ${status === 1 ? `
          <button class="btn btn-success btn-sm" data-action="approve">
            <i class="fa-solid fa-circle-dollar-to-slot"></i> Approved</button>
          <button class="btn btn-danger btn-sm" data-action="reject">
            <i class="fa-solid fa-ban"></i> ${currentUser?.role_name === 'idl_cpd_cashier' ? 'Cancel' : 'Reject'}</button>` : ''}
          ${currentUser?.role_name === 'idl_cpd_cashier' ? `
          <button class="btn btn-info btn-sm" data-action="print-receipt">
            <i class="fa-solid fa-print"></i> ${status === 1 ? 'Print Receipt' : 'Reprint Receipt'}</button>` : ''}
          ${status === 2 ? `
          <button class="btn btn-success btn-sm" data-action="issue">
            <i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn btn-danger btn-sm" data-action="reject">
            <i class="fa-solid fa-ban"></i> Reject</button>` : ''}
          ${status === 4 && !r.idl_no ? `
          <button class="btn btn-primary btn-sm" data-action="issue">
            <i class="fa-solid fa-id-card"></i> Issue IDP</button>` : ''}
          ${status === 4 || status === 5 ? `
          <button class="btn btn-info btn-sm" data-action="dispatch">
            <i class="fa-solid fa-truck"></i> Mark Dispatched</button>` : ''}
          ${status === 4 && currentUser?.role_name === 'idl_officer' ? `
          <button class="btn btn-ghost btn-sm" data-action="print">
            <i class="fa-solid fa-print"></i> Print IDP</button>` : ''}
          ${status === 4 && r.idl_no && r.print_hash && currentUser?.role_name === 'idl_officer' && ['send_to_address', 'home_delivery'].includes(r.delivery_option) ? `
          <button class="btn btn-ghost btn-sm" data-action="print-awb">
            <i class="fa-solid fa-truck-fast"></i> Print AWB</button>` : ''}
          ${status === 4 && r.idl_no && !r.print_hash && currentUser?.role_name === 'idl_officer' && ['send_to_address', 'home_delivery'].includes(r.delivery_option) ? `
          <span class="badge badge-default" style="font-weight:500" title="Print IDP first to confirm and lock the applicant's details before generating the AWB">
            <i class="fa-solid fa-circle-info"></i> Print IDP first to enable AWB</span>` : ''}
          ${(status === 4 || status === 5) && currentUser?.role_name === 'idl_officer' ? `
          <button class="btn btn-danger btn-sm" data-action="void">
            <i class="fa-solid fa-ban"></i> Void</button>` : ''}
          ${canEdit && ['idl_officer','idl_cpd_walkin'].includes(currentUser?.role_name) ? `
          <button class="btn btn-ghost btn-sm" data-action="save-proc">
            <i class="fa-solid fa-floppy-disk"></i> Save Changes</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-action="back">
            <i class="fa-solid fa-arrow-left"></i> Go Back</button>
        </div>
    </div>`;

  // Bind listeners to the page-actions bar only (Process Application has inline buttons)
  content.querySelector('.page-actions').addEventListener('click', handleIDLAction);
  content.querySelector('.rv-section:last-child').addEventListener('click', handleIDLAction);
  initDocUploads();
  initIdlLightbox();
  loadExistingDocs(id);

  if (canEditIdentity) {
    const viewRows    = document.getElementById('identity-view-rows');
    const editRows    = document.getElementById('identity-edit-rows');
    const editActions = document.getElementById('identity-edit-actions');
    const editBtn     = document.getElementById('btn-edit-identity');

    editBtn.addEventListener('click', () => {
      viewRows.style.display    = 'none';
      editRows.style.display    = '';
      editActions.style.display = 'flex';
      editBtn.style.display     = 'none';
    });

    document.getElementById('btn-cancel-identity').addEventListener('click', () => renderIDLDetail(param));

    document.getElementById('btn-save-identity').addEventListener('click', async () => {
      const errEl  = document.getElementById('identity-edit-error');
      const saveBtn = document.getElementById('btn-save-identity');
      errEl.classList.add('hidden');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      try {
        await api.put(`/idl/requests/${id}`, {
          first_name:  document.getElementById('id-edit-first-name').value.trim(),
          last_name:   document.getElementById('id-edit-last-name').value.trim(),
          nationality: document.getElementById('id-edit-nationality').value,
          sex:         document.getElementById('id-edit-sex').value,
        });
        toast('Personal information updated', 'success');
        renderIDLDetail(param);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
      }
    });
  }

  function handleIDLAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'back')          navigate('idl-requests', typeFilter ? { type: typeFilter } : null);
    if (action === 'approve')       handleApprove(id, param);
    if (action === 'reject')        handleReject(id, param);
    if (action === 'issue')         handleIssue(id, param);
    if (action === 'dispatch')      handleDispatch(id, param);
    if (action === 'save-proc')     handleSaveProc(id).catch(() => {});
    if (action === 'print-receipt') handlePrintReceipt(id, r);
    if (action === 'print')         handlePrintMargins(id, param);
    if (action === 'print-awb')     handlePrintAwb(id, param);
    if (action === 'void')          handleVoid(id, param);
  }
}

const PRINT_MARGIN_COMPONENTS = [
  ['top_atc_string',  'Top ATC String'],
  ['issued_date',     'Issued Date'],
  ['qr_code',         'QR Code'],
  ['last_name',       'Last Name'],
  ['first_name',      'First Name'],
  ['place_of_birth',  'Place of Birth'],
  ['dob',             'Date of Birth'],
  ['city',            'Permanent Place of Residence'],
  ['sex',             'Sex'],
  ['nationality',     'Nationality'],
  ['idl_no',          'IDL No'],
  ['license_no',      'License No'],
  ['center_image',    'Photo (Center Image)'],
  ['class_A_tick',    'Class A Tick'],
  ['class_B_tick',    'Class B Tick'],
  ['class_C_tick',    'Class C Tick'],
  ['class_D_tick',    'Class D Tick'],
  ['class_E_tick_1',  'Class E Tick 1'],
  ['class_E_tick_2',  'Class E Tick 2'],
  ['signature',       'Signature'],
];

async function handlePrintMargins(id, param) {
  let margins;
  try {
    margins = await api.idl.getPrintMargins();
  } catch (e) {
    toast(e.message || 'Failed to load print margins', 'error');
    return;
  }

  const coords = margins.component_coordinates || {};

  openModal({
    title: 'Print Margins',
    size: 'lg',
    body: `
      <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:14px">
        Adjust the print overlay position for your printer, or skip straight to printing with these values.
      </p>
      <div class="form-grid" style="margin-bottom:16px">
        <div class="field"><label>Left Margin (mm)</label>
          <input id="pm-left-margin" type="number" step="0.01" value="${esc(margins.left_margin ?? '0.00')}" /></div>
        <div class="field"><label>Top Margin (mm)</label>
          <input id="pm-top-margin" type="number" step="0.01" value="${esc(margins.top_margin ?? '0.00')}" /></div>
      </div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>Component</th><th>X</th><th>Y</th></tr></thead>
        <tbody>
          ${PRINT_MARGIN_COMPONENTS.map(([key, label]) => `
            <tr>
              <td>${label}</td>
              <td><input id="pm-x-${key}" type="number" step="1" style="width:80px"
                    value="${esc(coords[key]?.x ?? '0')}" /></td>
              <td><input id="pm-y-${key}" type="number" step="1" style="width:80px"
                    value="${esc(coords[key]?.y ?? '0')}" /></td>
            </tr>`).join('')}
        </tbody>
      </table>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-ghost" id="pm-skip-print">
               <i class="fa-solid fa-forward"></i> Skip &amp; Print
             </button>
             <button class="btn btn-success" id="pm-save-print">
               <i class="fa-solid fa-floppy-disk"></i> Save &amp; Print
             </button>`,
  });

  const readForm = () => {
    const componentCoordinates = {};
    PRINT_MARGIN_COMPONENTS.forEach(([key]) => {
      componentCoordinates[key] = {
        x: document.getElementById(`pm-x-${key}`).value,
        y: document.getElementById(`pm-y-${key}`).value,
      };
    });
    return {
      left_margin: document.getElementById('pm-left-margin').value,
      top_margin:  document.getElementById('pm-top-margin').value,
      component_coordinates: componentCoordinates,
    };
  };

  // The print view opens as a plain GET navigation in a new tab — there's no promise
  // to await for when the server sets print_hash there, so the Print AWB button stays
  // disabled on this page until something refreshes it. Re-fetching once the officer
  // comes back to this tab catches that without requiring a manual reload.
  const refreshAfterReturn = () => {
    window.addEventListener('focus', () => renderIDLDetail(param), { once: true });
  };

  document.getElementById('pm-skip-print').onclick = () => {
    closeModal();
    window.open(api.idl.printUrl(id), '_blank');
    refreshAfterReturn();
  };

  document.getElementById('pm-save-print').onclick = async () => {
    const btn = document.getElementById('pm-save-print');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      await api.idl.savePrintMargins(readForm());
      closeModal();
      toast('Print margins saved', 'success');
      window.open(api.idl.printUrl(id), '_blank');
      refreshAfterReturn();
    } catch (e) {
      toast(e.message || 'Failed to save print margins', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save &amp; Print';
    }
  };
}

async function handlePrintAwb(id, param) {
  const btn = document.querySelector('[data-action="print-awb"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating AWB…'; }

  try {
    const res = await api.idl.printAwb(id);

    if (res.label_url) {
      window.open(res.label_url, '_blank');
      toast(`AWB created — ${res.air_bill_no}`, 'success');
    } else if (res.air_bill_no) {
      toast(`AWB created — ${res.air_bill_no}. No label URL returned.`, 'success');
    } else {
      toast('AWB created but no tracking number returned', 'warning');
    }

    renderIDLDetail(param);
  } catch (e) {
    toast(e.message || 'Failed to create AWB', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-truck-fast"></i> Print AWB'; }
  }
}

function handleVoid(id, param) {
  openModal({
    title: 'Void IDL',
    body: `<div class="field"><label>Comments *</label>
      <textarea id="void-comment" rows="3" style="width:100%;resize:vertical"
        placeholder="Explain why this IDL is being voided…"></textarea></div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-danger" id="confirm-void">
               <i class="fa-solid fa-ban"></i> Void
             </button>`,
  });
  document.getElementById('confirm-void').onclick = async () => {
    const comment = document.getElementById('void-comment').value.trim();
    if (!comment) return toast('Please enter a comment', 'error');
    await api.idl.voidRequest(id, { comment });
    closeModal();
    toast('IDL voided', 'info');
    renderIDLDetail(param);
  };
}

async function handleSaveProc(id) {
  const errEl   = document.getElementById('proc-error');
  const saveBtn = document.querySelector('[data-action="save-proc"]');
  if (errEl) errEl.classList.add('hidden');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }

  try {
    // ── 1. Upload any selected document files ─────────────────────────────
    const slots    = ['dl_front', 'dl_back', 'eid_front', 'eid_back', 'passport_photo'];
    const formData = new FormData();
    let   hasFiles = false;

    slots.forEach(slot => {
      const input = document.querySelector(`input[data-doc="${slot}"]`);
      if (input?.files?.[0]) {
        formData.append(slot, input.files[0]);
        hasFiles = true;
      }
    });

    if (hasFiles) {
      const uploadResult = await api.upload(`/idl/requests/${id}/documents`, formData);
      // If any individual file had an error, show it as a warning but continue saving
      if (uploadResult.errors && Object.keys(uploadResult.errors).length) {
        const msgs = Object.entries(uploadResult.errors)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        toast(`Some files not saved — ${msgs}`, 'error', 7000);
      }
    }

    // ── 2. Save text fields ───────────────────────────────────────────────
    // idl_no / idl_booklet_no are read-only here — they're only ever set via
    // the Issue IDL action (auto-generated number + stock-picked booklet).
    const awb      = document.getElementById('proc-awb')?.value.trim()       ?? '';
    const comments = document.getElementById('proc-comments')?.value.trim()  ?? '';

    await api.put(`/idl/requests/${id}`, {
      air_bill_no: awb, officer_comments: comments,
    });

    toast('Changes saved successfully', 'success');

  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    else toast(err.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes'; }
  }
}

async function handlePrintReceipt(id, r) {
  try {
    // If a receipt already exists for this request, this is a reprint — fetch it
    // instead of creating a new one, and mark the printout as a copy.
    let rec, isReprint;
    try {
      rec = await api.idl.getReceipt(id);
      isReprint = true;
    } catch {
      rec = await api.idl.createReceipt(id);
      isReprint = false;
    }

    // Compute amounts: total = fees + 5% VAT; base fee = total / 1.05
    const total    = parseFloat(r.total_amount ?? 178.50);
    const baseFee  = Math.round((total / 1.05) * 100) / 100;
    const vatAmt   = Math.round((total - baseFee) * 100) / 100;
    const dateStr  = new Date().toISOString().split('T')[0];
    const custName = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();

    const receiptHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${rec.receipt_no}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #000;
           padding: 40px; max-width: 700px; margin: auto; }
    h1 { text-align: center; font-size: 22px; font-weight: bold;
         text-decoration: underline; margin-bottom: 24px; letter-spacing: 2px; }
    .meta { margin-bottom: 16px; line-height: 1.8; }
    .vat-reg { text-align: center; font-weight: bold; margin-bottom: 18px; }
    .customer { margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    thead tr { background: #ddd; }
    th, td { padding: 8px 12px; text-align: left; }
    th:last-child, td:last-child { text-align: right; }
    td:last-child { min-width: 110px; }
    .amount-words { margin-bottom: 60px; }
    .signature { text-align: center; padding-top: 8px;
                 border-top: 1px dotted #333; width: 60%; margin: 0 auto; }
    .sig-label { margin-top: 6px; font-weight: bold; letter-spacing: 1px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>RECEIPT${isReprint ? ' <span style="font-size:14px;letter-spacing:1px">(COPY)</span>' : ''}</h1>
  <div class="meta">
    <div>Date: ${dateStr}</div>
    <div>Receipt #: ${rec.receipt_no}</div>
    <div>Request #: ${r.request_id}</div>
  </div>
  <div class="vat-reg">VAT REGISTRATION NUMBER : 100233632700003</div>
  <div class="customer">Customer Name: ${custName}</div>
  <table>
    <thead>
      <tr><th>Items</th><th>Amount (in AED)</th></tr>
    </thead>
    <tbody>
      <tr><td>Fees</td><td>${baseFee.toFixed(2)}</td></tr>
      <tr><td>VAT (5%) against Fees</td><td>${vatAmt.toFixed(2)}</td></tr>
      <tr><td><strong>Total (AED)</strong></td><td><strong>${total.toFixed(2)}</strong></td></tr>
    </tbody>
  </table>
  <div class="amount-words">
    Amount in words : &nbsp;&nbsp; ${amountToWords(total).toUpperCase()}
  </div>
  <div class="signature">
    <div>.....................................................................</div>
    <div class="sig-label">CASHIER</div>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=750,height=600');
    win.document.write(receiptHtml);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);

  } catch (err) {
    toast('Receipt error: ' + err.message, 'error');
  }
}

// Convert a decimal amount to English words (up to 999.99)
function amountToWords(amount) {
  const ones = ['','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE',
                 'TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN',
                 'SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN'];
  const tens = ['','','TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  }
  function threeDigits(n) {
    if (n >= 100) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
    return twoDigits(n);
  }

  const intPart  = Math.floor(amount);
  const fracPart = Math.round((amount - intPart) * 100);
  let   words    = threeDigits(intPart);
  if (fracPart > 0) words += ' POINT ' + twoDigits(fracPart);
  return words || 'ZERO';
}

function handleDispatch(id, param) {
  const awb = document.getElementById('proc-awb')?.value.trim() ?? '';
  if (!awb) { toast('Enter Air Waybill No before dispatching', 'error'); return; }
  api.post(`/idl/requests/${id}/dispatch`, { air_bill_no: awb })
    .then(() => { toast('Marked as dispatched', 'success'); renderIDLDetail(param); })
    .catch(err => toast(err.message, 'error'));
}

function buildIDLActionBtns(_r) {
  // Actions are now rendered inline in the Process Application section
  // This stub kept for compatibility with the header back-button only
  return '';
}

function handleApprove(id, param) {
  const isCashierOrOfficer = ['idl_officer','idl_cpd_cashier'].includes(currentUser?.role_name);
  const status = parseInt(document.querySelector('.page-subtitle .badge')?.textContent) || 0;

  // For roles 8 and 25 approving a paid (status=2) request, include proc fields
  const body = {};
  if (isCashierOrOfficer) {
    const idlNo   = document.getElementById('proc-idl-no')?.value.trim()  ?? '';
    const booklet = document.getElementById('proc-booklet')?.value.trim() ?? '';
    const awb     = document.getElementById('proc-awb')?.value.trim()     ?? '';
    if (idlNo)   body.idl_no          = idlNo;
    if (booklet) body.idl_booklet_no  = booklet;
    if (awb)     body.air_bill_no     = awb;
  }
  // Cashier accepting payment (status 1) — payment method is captured here now,
  // not by the officer/CSO at request creation.
  const paymentMethodEl = document.getElementById('proc-payment-method');
  if (paymentMethodEl) body.payment_method = paymentMethodEl.value;

  confirm('Approve this IDL request?', async () => {
    await api.idl.approve(id, body);
    toast('Request approved', 'success');
    renderIDLDetail(param);
  }, false);
}

function handleReject(id, param) {
  openModal({
    title: 'Reject Request',
    body: `<div class="field"><label>Reason *</label>
      <textarea id="reject-reason" rows="3" style="width:100%;resize:vertical"
        placeholder="Explain why this request is being rejected…"></textarea></div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-danger" id="confirm-reject">
               <i class="fa-solid fa-ban"></i> Reject
             </button>`,
  });
  document.getElementById('confirm-reject').onclick = async () => {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) return toast('Please enter a reason', 'error');
    await api.idl.reject(id, { reason });
    closeModal();
    toast('Request rejected', 'info');
    renderIDLDetail(param);
  };
}

async function handleIssue(id, param) {
  openModal({
    title: 'Issue IDP',
    body: `
      <div class="form-grid">
        <div class="field"><label>IDP Number</label>
          <input value="Auto-generated on issue" disabled /></div>
        <div class="field"><label>Booklet Number *</label>
          <input id="issue-booklet" list="issue-booklet-list" autocomplete="off" disabled
            placeholder="Loading booklets…" />
          <datalist id="issue-booklet-list"></datalist>
          <div class="field-error" id="err-issue-booklet"></div>
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-success" id="confirm-issue">
               <i class="fa-solid fa-circle-check"></i> Issue IDP
             </button>`,
  });

  const bookletInput = document.getElementById('issue-booklet');
  const bookletList  = document.getElementById('issue-booklet-list');
  const bookletErr   = document.getElementById('err-issue-booklet');
  let available = [];
  try {
    const booklets = await api.idl.booklets();
    available = booklets.filter(b => !Number(b.is_used) && Number(b.is_active));
    bookletList.innerHTML = available.map(b => `<option value="${esc(b.booklet_no)}"></option>`).join('');
    bookletInput.placeholder = available.length ? 'Type to search booklet number…' : 'No booklets available in stock';
    bookletInput.disabled = available.length === 0;
  } catch {
    bookletInput.placeholder = 'Failed to load booklet stock';
  }

  const confirmBtn = document.getElementById('confirm-issue');
  confirmBtn.onclick = async () => {
    bookletErr.textContent = '';
    const idl_booklet_no = bookletInput.value.trim();
    if (!idl_booklet_no) { bookletErr.textContent = 'Select a booklet number'; return; }
    if (!available.some(b => b.booklet_no === idl_booklet_no)) {
      bookletErr.textContent = 'Select a valid, available booklet number from the list';
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Issuing…';
    let res;
    try {
      res = await api.idl.issue(id, { idl_booklet_no });
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Issue IDP';
      bookletErr.textContent = err.message || 'Failed to issue IDP';
      return;
    }
    closeModal();
    toast(`IDP issued successfully — IDP No: ${res.idl_no}`, 'success');
    renderIDLDetail(param);
  };
}

function detail(label, value) {
  return `<div class="detail-item"><label>${label}</label><div class="detail-val">${value ?? '—'}</div></div>`;
}

function identityRow(icon, label, value) {
  return `<div class="rv-identity-row"><span class="rv-id-icon"><i class="${icon}"></i></span><span class="rv-id-label">${label}</span><span class="rv-id-value">${value || '—'}</span></div>`;
}

function docUpload(key, label, readOnly = false, required = true) {
  if (readOnly) {
    // Read-only view of an already-submitted document — no upload input, click opens a lightbox.
    return `
      <div class="doc-upload-item">
        <div class="doc-upload-label">${label}</div>
        <div class="doc-upload-zone doc-view-only" data-key="${key}" id="doc-zone-${key}" style="cursor:default">
          <div class="doc-upload-placeholder">
            <i class="fa-solid fa-file-circle-question"></i>
            <span>Not submitted</span>
          </div>
          <div class="doc-upload-preview" style="display:none">
            <img class="doc-preview-img" style="cursor:zoom-in" title="Click to view full size" />
            <span class="doc-preview-name"></span>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="doc-upload-item">
      <div class="doc-upload-label">${label}${required ? ' *' : ''}</div>
      <div class="doc-upload-zone" data-key="${key}" id="doc-zone-${key}">
        <input type="file" accept=".jpg,.jpeg,.png" data-doc="${key}"
               style="display:none" />
        <div class="doc-upload-placeholder">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Click to upload</span>
          <small>JPG or PNG · max 2 MB</small>
        </div>
        <div class="doc-upload-preview" style="display:none">
          <img class="doc-preview-img" />
          <span class="doc-preview-name"></span>
          <button type="button" class="doc-remove-btn" title="Remove">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div class="field-error" id="err-doc-${key}" style="margin-top:4px"></div>
    </div>`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Called once after renderIDLDetail sets innerHTML
// Called after renderIDLDetail to populate any previously uploaded document previews
async function loadExistingDocs(id) {
  let docs;
  try {
    docs = await api.idl.getDocuments(id);
  } catch {
    return; // Silently ignore — no docs saved yet
  }

  Object.entries(docs).forEach(([slot, url]) => {
    // Look up by zone id directly rather than via the upload <input> — read-only
    // zones (already-submitted documents) don't render one at all.
    const zone    = document.getElementById(`doc-zone-${slot}`);
    const holder  = zone?.querySelector('.doc-upload-placeholder');
    const preview = zone?.querySelector('.doc-upload-preview');
    const img     = zone?.querySelector('.doc-preview-img');
    const name    = zone?.querySelector('.doc-preview-name');

    if (!zone || !preview || !img) return;

    // Serve the image through the API (auth cookie included automatically)
    const fullUrl = `${window.location.origin}${API_BASE}/idl/requests/${id}/documents/${url.split('/').pop()}`;
    img.src = fullUrl;
    if (name) name.textContent = url.split('/').pop();
    if (holder)  holder.style.display  = 'none';
    preview.style.display = 'flex';

    if (zone.classList.contains('doc-view-only')) {
      zone.style.cursor = 'zoom-in';
      zone.addEventListener('click', () => openIdlLightbox(fullUrl, name?.textContent ?? ''));
    }
  });
}

function openIdlLightbox(src, label) {
  const lightbox = document.getElementById('idl-lightbox');
  if (!lightbox) return;
  document.getElementById('idl-lightbox-img').src = src;
  document.getElementById('idl-lightbox-label').textContent = label;
  lightbox.style.display = 'flex';
}

function initIdlLightbox() {
  const lightbox = document.getElementById('idl-lightbox');
  if (!lightbox) return;
  const close = () => { lightbox.style.display = 'none'; };
  document.getElementById('idl-lightbox-close')?.addEventListener('click', close);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) close(); });
}

function initDocUploads() {
  const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
  const ALLOWED  = ['image/jpeg', 'image/png'];
  const errEl    = document.getElementById('doc-upload-error');

  document.querySelectorAll('[data-doc]').forEach(input => {
    const zone    = input.closest('.doc-upload-zone');
    const holder  = zone.querySelector('.doc-upload-placeholder');
    const preview = zone.querySelector('.doc-upload-preview');
    const img     = zone.querySelector('.doc-preview-img');
    const name    = zone.querySelector('.doc-preview-name');
    const removeBtn = zone.querySelector('.doc-remove-btn');

    // Open picker on zone click (but not on remove button)
    zone.addEventListener('click', e => {
      if (e.target.closest('.doc-remove-btn')) return;
      input.click();
    });

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      errEl?.classList.add('hidden');

      // Clear per-slot validation error
      const slotKey = input.dataset.doc;
      const slotErrEl = document.getElementById(`err-doc-${slotKey}`);
      const slotZone  = document.getElementById(`doc-zone-${slotKey}`);
      if (slotErrEl) slotErrEl.textContent = '';
      slotZone?.classList.remove('doc-zone-invalid');

      if (!ALLOWED.includes(file.type)) {
        showDocError(`"${file.name}" is not a JPG or PNG file.`);
        input.value = '';
        return;
      }
      if (file.size > MAX_SIZE) {
        showDocError(`"${file.name}" exceeds the 2 MB size limit.`);
        input.value = '';
        return;
      }

      // Show preview
      const reader = new FileReader();
      reader.onload = ev => {
        img.src          = ev.target.result;
        name.textContent = file.name;
        holder.style.display  = 'none';
        preview.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });

    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      input.value          = '';
      img.src              = '';
      name.textContent     = '';
      holder.style.display  = '';
      preview.style.display = 'none';
      // Don't clear validation state on remove — field is now empty again
    });
  });

  function showDocError(msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 5000);
  }
}

// ── Shared report helpers ─────────────────────────────────────────────────────

function rptCard(label, value, icon, cls, raw = false) {
  const display = raw ? value : Number(value ?? 0).toLocaleString();
  return `<div class="stat-card ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${display}</div>
    <span class="stat-icon"><i class="fa-solid ${icon}"></i></span>
  </div>`;
}

/** Lazily load a script tag — skips if already loaded */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s  = document.createElement('script');
    s.src    = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

/** Fetch all pages of a report endpoint for PDF/export (no page param) */
async function fetchAllReportData(fetchFn, extraParams = {}) {
  return fetchFn({ ...extraParams });
}

/** Build a filter bar and DataTable for a report page */
function buildReportPage({
  content, title, subtitle, extraFilters = '',
  fetchFn, columns, columnsFn, summaryFn,
  exportExcelFn, exportPdfFn,
}) {
  const today = new Date().toISOString().slice(0, 10);

  // Render into a scoped wrapper so listeners are garbage-collected on navigate
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${title}</h1>
        <p class="page-subtitle">${subtitle}</p>
      </div>
    </div>
    <div id="rpt-scope">
      <div class="section-card">
        <div class="section-card-header">Filter</div>
        <div class="section-card-body">
          <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
            <div class="field" style="min-width:160px">
              <label>From Date</label>
              <input type="date" data-rpt="from" value="${today}" />
            </div>
            <div class="field" style="min-width:160px">
              <label>To Date</label>
              <input type="date" data-rpt="to" value="${today}" />
            </div>
            ${extraFilters}
            <div class="field" style="align-self:flex-end;display:flex;gap:8px">
              <button class="btn btn-primary" data-rpt="apply">
                <i class="fa-solid fa-magnifying-glass"></i> View Data
              </button>
              <button class="btn btn-ghost" data-rpt="excel">
                <i class="fa-solid fa-file-excel"></i> Export to Excel
              </button>
              <button class="btn btn-ghost" data-rpt="pdf" disabled>
                <i class="fa-solid fa-file-pdf"></i> Export to PDF
              </button>
            </div>
          </div>
        </div>
      </div>
      <div data-rpt="summary" style="display:none" class="stat-grid"></div>
      <div data-rpt="table"></div>
    </div>`;

  // Scope ALL queries and listeners to this freshly-rendered div — never #page-content
  const scope = document.getElementById('rpt-scope');

  let currentFrom  = today;
  let currentTo    = today;
  let activeParams = {};

  const getFrom   = () => scope.querySelector('[data-rpt="from"]')?.value ?? today;
  const getTo     = () => scope.querySelector('[data-rpt="to"]')?.value   ?? today;
  const getSumEl  = () => scope.querySelector('[data-rpt="summary"]');
  const getTblEl  = () => scope.querySelector('[data-rpt="table"]');
  const getPdfBtn = () => scope.querySelector('[data-rpt="pdf"]');

  let tableInstance = null;

  function applyFilters() {
    const from = getFrom();
    const to   = getTo();
    if (!from || !to) { toast('Please select both dates', 'error'); return; }
    if (from > to)    { toast('From Date cannot be after To Date', 'error'); return; }

    currentFrom  = from;
    currentTo    = to;
    activeParams = buildExtraParams();

    const sumEl  = getSumEl();
    const tblEl  = getTblEl();
    const pdfBtn = getPdfBtn();

    if (sumEl) sumEl.style.display = 'none';
    if (pdfBtn) pdfBtn.disabled = true;

    tblEl.innerHTML = '';
    // Resolve columns: use columnsFn (dynamic) if provided, else fall back to static columns
    const activeCols = columnsFn ? columnsFn() : columns;
    tableInstance = new DataTable(
      tblEl,
      activeCols,
      async (params) => {
        const result = await fetchFn({ ...params, ...activeParams, date_from: currentFrom, date_to: currentTo });
        if (params.page === 1 || !params.page) {
          if (sumEl && summaryFn) {
            sumEl.innerHTML = summaryFn(result);
            sumEl.style.display = '';
          }
          if (pdfBtn) pdfBtn.disabled = !(result.total > 0);
        }
        return result;
      },
      { searchPlaceholder: 'Search…' },
    );
    tableInstance.render();
  }

  function buildExtraParams() {
    const extra = {};
    scope.querySelectorAll('[data-rpt-param]').forEach(el => {
      const key = el.dataset.rptParam;
      if (el.value) extra[key] = el.value;
    });
    return extra;
  }

  // Bind to the scoped wrapper — destroyed with the DOM when user navigates away
  scope.addEventListener('click', e => {
    const btn = e.target.closest('[data-rpt]');
    if (!btn) return;
    const action = btn.dataset.rpt;
    if (action === 'apply') applyFilters();
    if (action === 'excel') exportExcelFn(getFrom(), getTo(), buildExtraParams());
    if (action === 'pdf')   exportPdfFn(getFrom(), getTo(), buildExtraParams(), currentFrom, currentTo);
  });

  // Do NOT auto-fire — wait for user to click "View Data"
}

// ── IDL Sales Report ─────────────────────────────────────────────────────────

function formatProcessingMinutes(minutes) {
  if (minutes == null || minutes < 0) return '—';
  const days  = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins  = minutes % 60;
  const parts = [];
  if (days)  parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return parts.join(' ');
}

export function renderIDLSalesReport() {
  const content = document.getElementById('page-content');

  const columns = [
    { key: 'request_type',  label: 'Type',       render: v => `<span class="badge badge-default">${v??'—'}</span>` },
    { key: 'idl_no',        label: 'IDL No' },
    { key: 'idl_booklet_no',label: 'Booklet No' },
    { key: 'first_name',    label: 'First Name' },
    { key: 'last_name',     label: 'Last Name' },
    { key: 'nationality',   label: 'Nationality' },
    { key: 'dob',           label: 'DOB',        render: v => formatDate(v) },
    { key: 'sex',           label: 'Sex' },
    { key: 'license_no',    label: 'DL No' },
    { key: 'issued_date',   label: 'Issued',     render: v => formatDate(v) },
    { key: 'total_amount',  label: 'Amount',     render: v => v != null ? `AED ${Number(v).toFixed(2)}` : '—' },
    { key: 'status_label',  label: 'Status',     render: v => statusBadge(v) },
    { key: 'email',         label: 'Email' },
    { key: 'mobile_no',     label: 'Mobile' },
    { key: 'issued_by',     label: 'Issued By' },
    { key: 'processing_minutes', label: 'Processing Time', render: v => formatProcessingMinutes(v) },
    { key: 'distributor_name', label: 'Distributor' },
    { key: 'branch_name',   label: 'Branch' },
  ];

  buildReportPage({
    content,
    title: 'IDL Sales Report',
    subtitle: 'Paid IDL applications by date range',
    fetchFn: p => api.idl.salesReport(p),
    columns,
    summaryFn: r => `
      ${rptCard('Total Records', r.total, 'fa-list', 'accent')}
      ${rptCard('Revenue (AED)', formatCurrency(r.revenue ?? 0), 'fa-money-bill-wave', 'success', true)}`,
    exportExcelFn: (from, to) => {
      const url = new URL(`${window.location.origin}${API_BASE}/idl/sales-report`);
      url.searchParams.set('date_from', from);
      url.searchParams.set('date_to',   to);
      url.searchParams.set('format',    'excel');
      window.open(url.toString());
    },
    exportPdfFn: async (from, to) => {
      await exportReportToPdf({
        fetchFn:   () => api.idl.salesReport({ date_from: from, date_to: to, page: 1, per_page: 99999 }),
        columns,
        title:     `IDL Sales Report  ${from}  —  ${to}`,
        filename:  `IDL_Sales_Report_${from}_to_${to}.pdf`,
        subLineFn: r => `${r.total} records   |   Revenue: AED ${Number(r.revenue??0).toFixed(2)}`,
      });
    },
  });
}

// ── Sales Report for Aramex ───────────────────────────────────────────────────

export function renderIDLAramexReport() {
  const content = document.getElementById('page-content');

  const columns = [
    { key: 'customer_name',   label: 'Customer Name' },
    { key: 'air_bill_no',     label: 'Airway Bill No' },
    { key: 'address',         label: 'Address' },
    { key: 'phone_no',        label: 'Phone No' },
    { key: 'idl_no',          label: 'IDL No' },
    { key: 'delivery_method', label: 'Delivery Method' },
  ];

  buildReportPage({
    content,
    title: 'Sales Report for Aramex',
    subtitle: 'Issued IDL deliveries (Online, Website & MOI) by date range',
    fetchFn: p => api.idl.aramexReport(p),
    columns,
    summaryFn: r => rptCard('Total Records', r.total, 'fa-truck-fast', 'accent'),
    exportExcelFn: (from, to) => {
      const url = new URL(`${window.location.origin}${API_BASE}/idl/aramex-report`);
      url.searchParams.set('date_from', from);
      url.searchParams.set('date_to',   to);
      url.searchParams.set('format',    'excel');
      window.open(url.toString());
    },
    exportPdfFn: async (from, to) => {
      await exportReportToPdf({
        fetchFn:   () => api.idl.aramexReport({ date_from: from, date_to: to, page: 1, per_page: 99999 }),
        columns,
        title:     `Sales Report for Aramex  ${from}  —  ${to}`,
        filename:  `Aramex_Sales_Report_${from}_to_${to}.pdf`,
        subLineFn: r => `${r.total} record${r.total !== 1 ? 's' : ''}`,
        colWidths: [50, 35, 80, 30, 28, 28],
      });
    },
  });
}

// ── Empost Report ─────────────────────────────────────────────────────────────

export function renderIDLEmpostReport() {
  const content = document.getElementById('page-content');

  const columns = [
    { key: 'customer_name',   label: 'Customer Name' },
    { key: 'air_bill_no',     label: 'Airway Bill No' },
    { key: 'address',         label: 'Address' },
    { key: 'mobile_no',       label: 'Phone No' },
    { key: 'idl_no',          label: 'IDL No' },
    { key: 'delivery_method', label: 'Delivery Method' },
    { key: 'issued_date',     label: 'Issued Date', render: v => formatDate(v) },
  ];

  const today = new Date().toISOString().slice(0, 10);

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Sales Report for Empost</h1>
        <p class="page-subtitle">Issued IDL deliveries by date</p>
      </div>
    </div>
    <div id="rpt-scope">
      <div class="section-card">
        <div class="section-card-header">Filter</div>
        <div class="section-card-body">
          <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
            <div class="field" style="min-width:180px">
              <label>Date</label>
              <input type="date" id="empost-date" value="${today}" />
            </div>
            <div class="field" style="align-self:flex-end;display:flex;gap:8px">
              <button class="btn btn-primary" id="empost-apply">
                <i class="fa-solid fa-magnifying-glass"></i> View Data
              </button>
              <button class="btn btn-ghost" id="empost-excel">
                <i class="fa-solid fa-file-excel"></i> Export to Excel
              </button>
              <button class="btn btn-ghost" id="empost-pdf" disabled>
                <i class="fa-solid fa-file-pdf"></i> Export to PDF
              </button>
            </div>
          </div>
        </div>
      </div>
      <div id="empost-summary" style="display:none" class="stat-grid"></div>
      <div id="empost-table"></div>
    </div>`;

  const scope    = document.getElementById('rpt-scope');
  const getDate  = () => document.getElementById('empost-date')?.value ?? today;
  let tableInst  = null;

  function applyFilters() {
    const date = getDate();
    if (!date) { toast('Please select a date', 'error'); return; }

    const sumEl  = document.getElementById('empost-summary');
    const tblEl  = document.getElementById('empost-table');
    const pdfBtn = document.getElementById('empost-pdf');

    sumEl.style.display = 'none';
    pdfBtn.disabled = true;
    tblEl.innerHTML = '';

    tableInst = new DataTable(
      tblEl,
      columns,
      async (params) => {
        const result = await api.idl.empostReport({ ...params, date });
        if (params.page === 1 || !params.page) {
          sumEl.innerHTML = rptCard('Total Records', result.total, 'fa-box', 'accent');
          sumEl.style.display = '';
          pdfBtn.disabled = !(result.total > 0);
        }
        return result;
      },
      { searchPlaceholder: 'Search…' },
    );
    tableInst.render();
  }

  document.getElementById('empost-apply').addEventListener('click', applyFilters);

  document.getElementById('empost-excel').addEventListener('click', () => {
    const date = getDate();
    const url  = new URL(`${window.location.origin}${API_BASE}/idl/empost-report`);
    url.searchParams.set('date',   date);
    url.searchParams.set('format', 'excel');
    window.open(url.toString());
  });

  document.getElementById('empost-pdf').addEventListener('click', async () => {
    const date = getDate();
    await exportReportToPdf({
      fetchFn:   () => api.idl.empostReport({ date, page: 1, per_page: 99999 }),
      columns,
      title:     `Sales Report for Empost  ${date}`,
      filename:  `Empost_Sales_Report_${date}.pdf`,
      subLineFn: r => `${r.total} record${r.total !== 1 ? 's' : ''}`,
      colWidths: [50, 35, 80, 30, 28, 28],
    });
  });
}

// ── MOE Report ────────────────────────────────────────────────────────────────

const MOE_DATA_TYPES = [
  { value: 'idl',        label: 'IDL Data' },
  { value: 'cpd_trucks', label: 'CPD Data (Truck and Buses)' },
  { value: 'cpd_other',  label: 'CPD Data (Other)' },
];

const MOE_IDL_COLS = [
  { key: 'paid_date',      label: 'TransactionDateTime' },
  { key: 'total_amount',   label: 'TranasctionAmount',  render: v => v != null ? Number(v).toFixed(2) : '0.00' },
  { key: '_vat',           label: 'VATTransaction',     render: () => '0' },
  { key: 'request_id',     label: 'URN' },
  { key: '_type',          label: 'TransactionType',    render: () => 'Purchase' },
  { key: 'payment_method', label: 'Instrument' },
  { key: '_currency',      label: 'Currency',           render: () => 'AED' },
  { key: 'emirates_id',    label: 'EmiratesID' },
  { key: 'nationality',    label: 'Nationality' },
  { key: '_name',          label: 'Name',               render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() },
  { key: 'status',         label: 'Status' },
  { key: 'reject_reason',  label: 'RejectReason' },
  { key: 'idl_no',         label: 'IDL No' },
  { key: 'idl_booklet_no', label: 'Booklet No' },
  { key: 'order_ref_no',   label: 'Telr Reference' },
];

const MOE_CPD_COLS = [
  { key: 'request_id',       label: 'Request ID' },
  { key: 'issued_date',      label: 'Issued Date' },
  { key: 'carnet_no',        label: 'Carnet No' },
  { key: 'full_name',        label: 'Full Name' },
  { key: 'emirates_id',      label: 'Emirates ID' },
  { key: 'nationality',      label: 'Nationality' },
  { key: 'booking_fee',      label: 'Booking Fee',  render: v => v != null ? Number(v).toFixed(2) : '—' },
  { key: 'extra_fees',       label: 'Extra Fees',   render: v => v != null ? Number(v).toFixed(2) : '—' },
  { key: 'vat_amount',       label: 'VAT Amount',   render: v => v != null ? Number(v).toFixed(2) : '—' },
  { key: 'method_of_payment',label: 'Payment Method' },
  { key: 'mulkiya_no',       label: 'Mulkiya No' },
  { key: 'registration_no',  label: 'Registration No' },
  { key: 'vehicle_make',     label: 'Vehicle Make' },
  { key: 'vehicle_model',    label: 'Vehicle Model' },
  { key: 'body_type',        label: 'Body Type' },
  { key: 'manuf_year',       label: 'Manuf Year' },
  { key: 'color',            label: 'Color' },
  { key: 'chassis_no',       label: 'Chassis No' },
  { key: 'engine_no',        label: 'Engine No' },
  { key: 'no_of_seats',      label: 'Seats' },
  { key: 'no_of_cylinders',  label: 'Cylinders' },
  { key: 'cpd_status',       label: 'Status' },
];

export function renderIDLMoeReport() {
  const content = document.getElementById('page-content');

  const extraFilters = `
    <div class="field" style="min-width:220px">
      <label>Data Type</label>
      <select data-rpt-param="data_type">
        ${MOE_DATA_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>
    </div>`;

  // Returns the right column set for whatever is currently selected
  const getCols = () => {
    const scope = document.getElementById('rpt-scope');
    const type  = scope?.querySelector('[data-rpt-param="data_type"]')?.value ?? 'idl';
    return type === 'idl' ? MOE_IDL_COLS : MOE_CPD_COLS;
  };

  buildReportPage({
    content,
    title: 'MOE Report',
    subtitle: 'Ministry of Education data export',
    extraFilters,
    fetchFn: p => api.idl.moeReport(p),
    columnsFn: getCols,   // dynamic — resolved at each applyFilters() call
    summaryFn: r => `
      ${rptCard('Total Records', r.total, 'fa-list', 'accent')}
      ${r.revenue > 0 ? rptCard('Revenue (AED)', formatCurrency(r.revenue), 'fa-money-bill-wave', 'success', true) : ''}`,
    exportExcelFn: (from, to, extra) => {
      const url = new URL(`${window.location.origin}${API_BASE}/idl/moe-report`);
      url.searchParams.set('date_from', from);
      url.searchParams.set('date_to',   to);
      url.searchParams.set('data_type', extra.data_type ?? 'idl');
      url.searchParams.set('format',    'excel');
      window.open(url.toString());
    },
    exportPdfFn: async (from, to, extra) => {
      const dataType  = extra.data_type ?? 'idl';
      const typeLabel = MOE_DATA_TYPES.find(t => t.value === dataType)?.label ?? dataType;
      const cols      = dataType === 'idl' ? MOE_IDL_COLS : MOE_CPD_COLS;

      const moeMetaHeader = dataType === 'idl' ? [
        ['EntityName',        'Ministry of Energy and Infrastructure'],
        ['ServiceGLCode',     '142220'],
        ['ServiceID',         '1024121882'],
        ['ServiceNameEnglish','Issue International Driving License'],
        ['ServiceNameArabic', 'إصدار رخصة قيادة دولية IDL لكل رخصة'],
      ] : null;

      await exportReportToPdf({
        fetchFn:    () => api.idl.moeReport({ date_from: from, date_to: to, data_type: dataType, page: 1, per_page: 99999 }),
        columns:    cols,
        title:      `MOE Report — ${typeLabel}  ${from}  —  ${to}`,
        filename:   `MOE_Report_${dataType}_${from}_to_${to}.pdf`,
        subLineFn:  r => `${r.total} record${r.total !== 1 ? 's' : ''}`,
        metaHeader: moeMetaHeader,
      });
    },
  });
}

// ── Generic PDF export helper (all three reports) ─────────────────────────────

async function exportReportToPdf({ fetchFn, columns, title, filename, subLineFn, colWidths, metaHeader }) {
  const pdfBtn = document.querySelector('[data-rpt="pdf"]');
  if (pdfBtn) { pdfBtn.disabled = true; pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…'; }

  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');

    const result = await fetchFn();
    const rows   = result.data ?? result.rows ?? [];

    if (!rows.length) { toast('No data to export', 'error'); return; }

    const { jsPDF } = window.jspdf;
    const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    // ── Main title ────────────────────────────────────────────────────────────
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(title, pageW / 2, 12, { align: 'center' });

    let startY = 18;

    // ── Optional metadata block (MOE format) ──────────────────────────────────
    if (metaHeader?.length) {
      doc.autoTable({
        body: metaHeader.map(([k, v]) => [k, v]),
        startY,
        theme: 'plain',
        styles:      { fontSize: 8, cellPadding: 1.5 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 45, textColor: [60, 60, 60] },
          1: { cellWidth: 110 },
        },
        margin: { left: 5, right: 5 },
        tableWidth: 'wrap',
      });
      startY = doc.lastAutoTable.finalY + 4;
    }

    // ── Sub-line ──────────────────────────────────────────────────────────────
    if (subLineFn) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(subLineFn(result), pageW / 2, startY, { align: 'center' });
      doc.setTextColor(0);
      startY += 5;
    }

    // ── Data table ────────────────────────────────────────────────────────────
    const pdfCols = columns.map(c => c.label);
    const pdfRows = rows.map(r =>
      columns.map(c => {
        const val = r[c.key];
        if (c.render) {
          const html = c.render(val, r);
          return String(html ?? '').replace(/<[^>]+>/g, '').trim();
        }
        return String(val ?? '');
      })
    );

    const usableW = pageW - 10;
    const styles  = {};
    if (colWidths?.length === columns.length) {
      colWidths.forEach((w, i) => { styles[i] = { cellWidth: w }; });
    } else {
      const w = Math.floor(usableW / columns.length);
      columns.forEach((_, i) => { styles[i] = { cellWidth: w }; });
    }

    doc.autoTable({
      head: [pdfCols],
      body: pdfRows,
      startY,
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [41, 80, 149], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: styles,
      didDrawPage: d => {
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`Page ${d.pageNumber} of ${doc.getNumberOfPages()}`,
          pageW - 10, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
        doc.setTextColor(0);
      },
      margin: { top: startY, left: 5, right: 5, bottom: 10 },
    });

    doc.save(filename);
    toast('PDF exported successfully', 'success');

  } catch (err) {
    toast('PDF generation failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Export to PDF'; }
  }
}

// Shows the cancellation status of an IDL application (open request, or processed as cancelled).
async function idlCancelBannerHtml(id) {
  try {
    const c = await api.idl.getCancelRequest(id);
    if (!c || !c.auto_id) return '';
    const reason = Number(c.is_lost_or_stolen) === 1 ? 'Reported as lost or stolen' : 'By the holder\x27s request';
    if (Number(c.is_processed) === 1) {
      return `<div class="rv-info-banner" style="border-color:rgba(239,68,68,.4)"><i class="fa-solid fa-ban rv-info-icon" style="color:var(--danger,#ef4444)"></i><div class="rv-info-lines"><div><strong>This IDP is cancelled.</strong></div><div>${reason}</div></div></div>`;
    }
    return `<div class="rv-info-banner"><i class="fa-solid fa-clock rv-info-icon"></i><div class="rv-info-lines"><div><strong>Cancellation requested</strong></div><div>${reason} — awaiting review.</div></div></div>`;
  } catch {
    return '';
  }
}

// ── IDL Cancellation Requests (staff queue) ─────────────────────────────────────
export function renderIDLCancellations() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">IDL Cancellation Requests</h1>
        <p class="page-subtitle">Confirm a request to deactivate the IDL</p>
      </div>
    </div>
    <div id="idl-cancel-table"></div>`;

  new DataTable(
    document.getElementById('idl-cancel-table'),
    [
      { key: 'request_id', label: 'Request ID', width: '200px' },
      { key: 'applicant', label: 'Applicant', render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'idl_no', label: 'IDL No', render: v => v || '—' },
      { key: 'is_lost_or_stolen', label: 'Reason', render: v => Number(v) === 1
          ? '<span class="badge badge-danger">Lost / Stolen</span>'
          : '<span class="badge badge-default">Holder request</span>' },
      { key: 'reported_datetime', label: 'Reported', render: v => formatDateTime(v) },
      { key: 'actions', label: '', width: '130px', render: (_, r) =>
          `<button class="btn btn-danger btn-sm confirm-idl-cancel-btn" data-id="${r.idl_auto_id}">
             <i class="fa-solid fa-check"></i> Confirm</button>` },
    ],
    () => api.idl.cancelRequests(),
    { idKey: 'auto_id', searchPlaceholder: 'Search by request ID or name…' },
  ).render();

  document.getElementById('idl-cancel-table').addEventListener('click', e => {
    const btn = e.target.closest('.confirm-idl-cancel-btn');
    if (!btn) return;
    confirm('Confirm this request? The IDL will be deactivated and marked Lost / Stolen.', async () => {
      try {
        await api.idl.confirmCancelRequest(Number(btn.dataset.id));
        toast('Cancellation confirmed', 'success');
        renderIDLCancellations();
      } catch (err) {
        toast(err.message || 'Could not confirm the cancellation', 'error');
      }
    });
  });
}
