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
  const defaultStatus   = isIDLOfficer ? 'pending' : '';

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
      filters: isCashier ? [] : [
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
  const deliveryOpt = document.getElementById('delivery_option')?.value;
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

      <!-- ── Personal Information ─────────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">Personal Information</div>
        <div class="section-card-body">
          <div class="form-grid">
            <div class="field"><label>Emirates ID *</label>
              <input name="emirates_id" id="emirates_id_input" required
                placeholder="Enter the Emirates ID and press Enter to search" />
              <div class="eid-search-msg" id="eid-search-msg"></div>
              <div class="field-error" id="err-emirates_id"></div></div>

            <div class="field"><label>First Name *</label>
              <input name="first_name" required placeholder="First name" />
              <div class="field-error" id="err-first_name"></div></div>

            <div class="field"><label>Last Name *</label>
              <input name="last_name" required placeholder="Last name" />
              <div class="field-error" id="err-last_name"></div></div>

            <div class="field">
              <label>Nationality *</label>
              <select name="nationality" required>
                <option value="">Select nationality</option>
                ${nationalities.map(n => `<option value="${n.nationality_id}">${n.nationality}</option>`).join('')}
              </select>
              <div class="field-error" id="err-nationality"></div>
            </div>

            <div class="field">
              <label>Sex *</label>
              <select name="sex" required>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              <div class="field-error" id="err-sex"></div>
            </div>

            <div class="field"><label>Date of Birth</label>
              <input name="dob" type="date" /></div>

            <div class="field field-full">
              <label>Address in UAE *</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px">
                <div class="field" style="margin:0">
                  <label style="font-size:.8rem">Apartment / Villa Number</label>
                  <input id="idl-addr-apt" name="idl_addr_apt" placeholder="e.g. Apt 12" />
                </div>
                <div class="field" style="margin:0">
                  <label style="font-size:.8rem">Building / Street Name</label>
                  <input id="idl-addr-building" name="idl_addr_building" placeholder="e.g. Al Nahda Street" />
                </div>
                <div class="field" style="margin:0">
                  <label style="font-size:.8rem">Area</label>
                  <input id="idl-addr-area" name="idl_addr_area" placeholder="e.g. Deira" />
                </div>
                <div class="field" style="margin:0">
                  <label style="font-size:.8rem">City *</label>
                  <select id="idl-addr-city" name="idl_addr_city" required>
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
              </div>
              <div class="field-error" id="err-address_in_uae"></div>
            </div>

            <div class="field"><label>PO Box *</label>
              <input name="po_box" required placeholder="PO Box" />
              <div class="field-error" id="err-po_box"></div></div>

            <div class="field"><label>Mobile No *</label>
              <input name="mobile_no" required placeholder="+971 50 xxx xxxx" />
              <div class="field-error" id="err-mobile_no"></div></div>

            <div class="field"><label>Email *</label>
              <input name="email" type="email" required placeholder="applicant@email.com" />
              <div class="field-error" id="err-email"></div></div>

            <div class="field"><label>City *</label>
              <input name="city" required placeholder="City" />
              <div class="field-error" id="err-city"></div></div>

            <div class="field field-full"><label>Home Country Address *</label>
              <input name="home_country_address" required placeholder="Home country address" />
              <div class="field-error" id="err-home_country_address"></div></div>
          </div>
        </div>
      </div>

      <!-- ── License Information ──────────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">License Information</div>
        <div class="section-card-body">
          <div class="form-grid">
            <div class="field"><label>License No *</label>
              <input name="license_no" required placeholder="Driving licence number" />
              <div class="field-error" id="err-license_no"></div></div>

            <div class="field"><label>Place of Birth *</label>
              <input name="place_of_birth" required placeholder="City / Country of birth" />
              <div class="field-error" id="err-place_of_birth"></div></div>

            <div class="field">
              <label>DL Place of Issue *</label>
              <select name="place_of_issue" required>
                <option value="">Select emirate</option>
                ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
              </select>
              <div class="field-error" id="err-place_of_issue"></div>
            </div>

            <div class="field"><label>Issued Date</label>
              <input name="issued_date" type="date" /></div>

            <div class="field"><label>Expiry Date</label>
              <input name="expiry_date" type="date" /></div>

            <div class="field">
              <label>Type of Driving License *</label>
              <div class="multi-select" id="dl-type-select">
                <div class="multi-select-trigger" id="dl-type-trigger">
                  <span id="dl-type-display">Select DL types</span>
                  <i class="fa-solid fa-chevron-down"></i>
                </div>
                <div class="multi-select-dropdown" id="dl-type-dropdown" style="display:none">
                  ${dlTypes.map(t => `
                  <label class="multi-select-option">
                    <input type="checkbox" class="dl-type-cb" value="${t.type_id}" />
                    ${t.dl_type}
                  </label>`).join('')}
                </div>
              </div>
              <input type="hidden" name="type_of_dl" id="type_of_dl_hidden" />
              <div class="field-error" id="err-type_of_dl"></div>
            </div>

            <div class="field">
              <label>Emirate of Residence *</label>
              <select name="emirate" required>
                <option value="">Select emirate</option>
                ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
              </select>
              <div class="field-error" id="err-emirate"></div>
            </div>

            <div class="field">
              <label>Issued IDL in Past?</label>
              <div style="display:flex;gap:24px;align-items:center;padding-top:8px">
                <label style="display:flex;gap:8px;align-items:center;font-weight:400;cursor:pointer">
                  <input type="radio" name="first_idl" value="0" /> Yes
                </label>
                <label style="display:flex;gap:8px;align-items:center;font-weight:400;cursor:pointer">
                  <input type="radio" name="first_idl" value="1" checked /> No
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Documents Required ───────────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">Documents Required</div>
        <div class="section-card-body">
          <div class="doc-upload-grid">
            ${docUpload('dl_front',      'Drivers License Front Image')}
            ${docUpload('dl_back',       'Drivers License Back Image')}
            ${docUpload('eid_front',     'Emirates ID Front Image')}
            ${docUpload('eid_back',      'Emirates ID Back Image')}
            ${docUpload('passport_photo','Passport Size Photo')}
          </div>
          <div id="doc-upload-error" class="form-error hidden" style="margin-top:8px"></div>
        </div>
      </div>

      <!-- ── Delivery &amp; Payment ───────────────────────────────────────── -->
      <div class="section-card">
        <div class="section-card-header">Delivery &amp; Payment</div>
        <div class="section-card-body">
          <div class="form-grid">
            <div class="field">
              <label>Delivery Option *</label>
              <select name="delivery_option" id="delivery_option" required>
                <option value="pick_from_office">Pick from Office</option>
                <option value="send_to_address">Send to Address</option>
              </select>
            </div>
            <div class="field">
              <label>Payment Method *</label>
              <select name="payment_method" required>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="ONLINE">Online</option>
              </select>
            </div>
            <div class="field">
              <label>Request Type</label>
              <select name="request_type">
                <option value="WALKIN">Walk-in</option>
                <option value="ONLINE">Online</option>
                <option value="DISTRIBUTOR">Distributor</option>
              </select>
            </div>
            <div class="field">
              <label>Total Fees (AED)</label>
              <input type="text" id="total-fees-display"
                readonly style="background:var(--bg-elevated);cursor:default;font-weight:600;color:var(--accent)" />
            </div>
            <div class="field field-full" id="delivery-address-field" style="display:none">
              <label>Delivery Address *</label>
              <textarea name="delivery_address" id="delivery_address" rows="3"
                style="width:100%;resize:vertical"
                placeholder="Full delivery address — building, street, area, emirate, postal code"></textarea>
              <div class="field-error" id="err-delivery_address"></div>
            </div>
          </div>
        </div>
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

  // Show/hide delivery address field based on selected delivery option
  const deliverySelect = document.getElementById('delivery_option');
  const deliveryField  = document.getElementById('delivery-address-field');
  const deliveryInput  = document.getElementById('delivery_address');

  const BASE_AMOUNT   = Number(idlCfg.idl_amount  ?? 160.00);
  const ADMIN_FEE     = Number(idlCfg.admin_fee    ?? 10.00);
  const DELIVERY_FEE  = Number(idlCfg.delivery_fee ?? 15.75);
  const totalDisplay  = document.getElementById('total-fees-display');

  function updateTotal() {
    const isSend      = deliverySelect.value === 'send_to_address';
    const deliveryFee = isSend ? DELIVERY_FEE : 0;
    const vat         = Math.round((BASE_AMOUNT + deliveryFee) * 0.05 * 100) / 100;
    const total       = BASE_AMOUNT + ADMIN_FEE + deliveryFee + vat;
    if (totalDisplay) {
      totalDisplay.value = `AED ${total.toFixed(2)} (IDL ${BASE_AMOUNT.toFixed(2)} + Admin ${ADMIN_FEE.toFixed(2)}${isSend ? ` + Delivery ${DELIVERY_FEE.toFixed(2)}` : ''} + VAT ${vat.toFixed(2)})`;
    }
  }

  deliverySelect.addEventListener('change', () => {
    const isSend = deliverySelect.value === 'send_to_address';
    deliveryField.style.display = isSend ? '' : 'none';
    if (!isSend) { deliveryInput.value = ''; clearFieldError('delivery_address'); }
    updateTotal();
  });

  updateTotal();

  // Activate upload zones
  initDocUploads();

  // ── Emirates ID search on Enter ────────────────────────────────────────────
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

  // ── Multi-select: Type of Driving License ──────────────────────────────────
  const dlTrigger  = document.getElementById('dl-type-trigger');
  const dlDropdown = document.getElementById('dl-type-dropdown');
  const dlDisplay  = document.getElementById('dl-type-display');
  const dlHidden   = document.getElementById('type_of_dl_hidden');

  dlTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const open = dlDropdown.style.display !== 'none';
    dlDropdown.style.display = open ? 'none' : 'block';
    dlTrigger.classList.toggle('open', !open);
  });

  // Close when clicking outside
  document.addEventListener('click', () => {
    dlDropdown.style.display = 'none';
    dlTrigger.classList.remove('open');
  });
  dlDropdown.addEventListener('click', e => e.stopPropagation());

  function updateDlHidden() {
    const checked = [...document.querySelectorAll('.dl-type-cb:checked')].map(cb => cb.value);
    dlHidden.value = checked.join(',');
    dlDisplay.textContent = checked.length
      ? `${checked.length} type${checked.length > 1 ? 's' : ''} selected`
      : 'Select DL types';
    // Clear validation error when at least one is selected
    if (checked.length) {
      document.getElementById('err-type_of_dl').textContent = '';
      document.getElementById('dl-type-select').classList.remove('field-invalid');
    }
  }

  document.querySelectorAll('.dl-type-cb').forEach(cb => {
    cb.addEventListener('change', updateDlHidden);
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
      const slots    = ['dl_front', 'dl_back', 'eid_front', 'eid_back', 'passport_photo'];
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
  const canEdit  = status === 1 || status === 2; // Not Paid / Processing

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

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${r.request_id}</h1>
        <p class="page-subtitle">
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
      <div class="rv-section-header">
        <span class="rv-section-title">Personal Information</span>
      </div>
      <div class="rv-identity-rows">
        ${identityRow('fa-solid fa-tag',           'Request Type',         r.request_type)}
        ${identityRow('fa-regular fa-user',        'Full Name',           [r.first_name, r.last_name].filter(Boolean).join(' '))}
        ${identityRow('fa-regular fa-id-card',     'Emirates ID',         r.emirates_id)}
        ${identityRow('fa-solid fa-flag',          'Nationality',         r.nationality)}
        ${identityRow('fa-solid fa-venus-mars',    'Gender',              r.sex)}
        ${identityRow('fa-solid fa-mobile-screen', 'Mobile Number',       r.mobile_no)}
        ${identityRow('fa-regular fa-envelope',    'Email Address',       r.email)}
        ${identityRow('fa-solid fa-location-dot',  'Address in UAE',      r.address_in_uae)}
        ${identityRow('fa-solid fa-inbox',         'PO Box',              r.po_box)}
        ${identityRow('fa-solid fa-city',          'City',                r.city)}
        ${identityRow('fa-solid fa-globe',         'Home Country Address',r.home_country_address)}
      </div>
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
        ${docUpload('dl_front',    'Drivers License Front Image')}
        ${docUpload('dl_back',     'Drivers License Back Image')}
        ${docUpload('eid_front',   'Emirates ID Front Image')}
        ${docUpload('eid_back',    'Emirates ID Back Image')}
        ${docUpload('passport_photo', 'Passport Size Photo')}
      </div>
      <div id="doc-upload-error" class="form-error hidden" style="margin-top:8px"></div>
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
        ${['idl_officer','idl_cpd_cashier'].includes(currentUser?.role_name)
          ? `<div class="rv-extra-row"><span class="rv-extra-label">Total Amount (AED)</span><span class="rv-extra-value">${r.total_amount != null ? Number(r.total_amount).toFixed(2) : '—'}</span></div>`
          : `<div class="rv-extra-row"><span class="rv-extra-label">Air Waybill No</span><span class="rv-extra-value">${r.air_bill_no || '—'}</span></div>`}
        ${['idl_officer','idl_cpd_cashier'].includes(currentUser?.role_name) ? `
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
            <label>IDL No</label>
            <input id="proc-idl-no" value="${esc(r.idl_no ?? '')}"
              placeholder="IDL number" ${canEdit ? '' : 'readonly'} />
          </div>
          <div class="field">
            <label>IDL Booklet Number</label>
            <input id="proc-booklet" value="${esc(r.idl_booklet_no ?? '')}"
              placeholder="Booklet reference" ${canEdit ? '' : 'readonly'} />
          </div>
          <div class="field">
            <label>Air Waybill No</label>
            <input id="proc-awb" value="${esc(r.air_bill_no ?? '')}"
              placeholder="Airway bill number" ${canEdit ? '' : 'readonly'} />
          </div>
          ${currentUser?.role_name !== 'idl_cpd_cashier' ? `
          <div class="field field-full">
            <label>Comments</label>
            <textarea id="proc-comments" rows="3"
              style="width:100%;resize:vertical" placeholder="Officer notes…">${esc(r.officer_comments ?? '')}</textarea>
          </div>` : ''}
        </div>` : ''}
        <div id="proc-error" class="form-error hidden" style="margin-top:8px"></div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          ${status === 1 ? `
          <button class="btn btn-success btn-sm" data-action="approve">
            <i class="fa-solid fa-circle-dollar-to-slot"></i> Accept Payment</button>
          ${currentUser?.role_name === 'idl_cpd_cashier' ? `
          <button class="btn btn-info btn-sm" data-action="print-receipt">
            <i class="fa-solid fa-print"></i> Print Receipt</button>` : ''}
          <button class="btn btn-danger btn-sm" data-action="reject">
            <i class="fa-solid fa-ban"></i> ${currentUser?.role_name === 'idl_cpd_cashier' ? 'Cancel' : 'Reject'}</button>` : ''}
          ${status === 2 ? `
          <button class="btn btn-success btn-sm" data-action="approve">
            <i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn btn-danger btn-sm" data-action="reject">
            <i class="fa-solid fa-ban"></i> Reject</button>` : ''}
          ${status === 4 && !r.idl_no ? `
          <button class="btn btn-primary btn-sm" data-action="issue">
            <i class="fa-solid fa-id-card"></i> Issue IDL</button>` : ''}
          ${status === 4 || status === 5 ? `
          <button class="btn btn-info btn-sm" data-action="dispatch">
            <i class="fa-solid fa-truck"></i> Mark Dispatched</button>` : ''}
          ${status === 4 && currentUser?.role_name === 'idl_officer' ? `
          <button class="btn btn-ghost btn-sm" data-action="print">
            <i class="fa-solid fa-print"></i> Print</button>` : ''}
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
  loadExistingDocs(id);

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
    if (action === 'print')         window.open(api.idl.printUrl(id), '_blank');
    if (action === 'void')          handleVoid(id, param);
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
    const idlNo    = document.getElementById('proc-idl-no')?.value.trim()    ?? '';
    const booklet  = document.getElementById('proc-booklet')?.value.trim()   ?? '';
    const awb      = document.getElementById('proc-awb')?.value.trim()       ?? '';
    const comments = document.getElementById('proc-comments')?.value.trim()  ?? '';

    await api.put(`/idl/requests/${id}`, {
      idl_no: idlNo, idl_booklet_no: booklet,
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
    // Create (or fetch existing) receipt record in DB
    const rec = await api.idl.createReceipt(id);

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
  <h1>RECEIPT</h1>
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

function handleIssue(id, param) {
  // Pre-fill from the Process Application inputs if already entered
  const prefillNo  = document.getElementById('proc-idl-no')?.value.trim()  ?? '';
  const prefillBkl = document.getElementById('proc-booklet')?.value.trim() ?? '';

  openModal({
    title: 'Issue IDL',
    body: `
      <div class="form-grid">
        <div class="field"><label>IDL Number *</label>
          <input id="issue-idl-no" placeholder="IDL-XXXXXXX" value="${esc(prefillNo)}" /></div>
        <div class="field"><label>Booklet Number *</label>
          <input id="issue-booklet" placeholder="Booklet reference" value="${esc(prefillBkl)}" /></div>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-success" id="confirm-issue">
               <i class="fa-solid fa-circle-check"></i> Issue IDL
             </button>`,
  });
  document.getElementById('confirm-issue').onclick = async () => {
    const idl_no         = document.getElementById('issue-idl-no').value.trim();
    const idl_booklet_no = document.getElementById('issue-booklet').value.trim();
    if (!idl_no || !idl_booklet_no) return toast('All fields required', 'error');
    await api.idl.issue(id, { idl_no, idl_booklet_no });
    closeModal();
    toast('IDL issued successfully', 'success');
    renderIDLDetail(param);
  };
}

function detail(label, value) {
  return `<div class="detail-item"><label>${label}</label><div class="detail-val">${value ?? '—'}</div></div>`;
}

function identityRow(icon, label, value) {
  return `<div class="rv-identity-row"><span class="rv-id-icon"><i class="${icon}"></i></span><span class="rv-id-label">${label}</span><span class="rv-id-value">${value || '—'}</span></div>`;
}

function docUpload(key, label) {
  return `
    <div class="doc-upload-item">
      <div class="doc-upload-label">${label} *</div>
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
    const input   = document.querySelector(`input[data-doc="${slot}"]`);
    if (!input) return;

    const zone    = input.closest('.doc-upload-zone');
    const holder  = zone?.querySelector('.doc-upload-placeholder');
    const preview = zone?.querySelector('.doc-upload-preview');
    const img     = zone?.querySelector('.doc-preview-img');
    const name    = zone?.querySelector('.doc-preview-name');

    if (!zone || !preview || !img) return;

    // Serve the image through the API (auth cookie included automatically)
    img.src = `${window.location.origin}${API_BASE}/idl/requests/${id}/documents/${url.split('/').pop()}`;
    name.textContent = url.split('/').pop();
    if (holder)  holder.style.display  = 'none';
    preview.style.display = 'flex';
  });
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
