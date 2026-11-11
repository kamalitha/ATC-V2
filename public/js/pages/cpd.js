// pages/cpd.js
import api from '../api.js';
import { DataTable, statusBadge, formatDate, formatDateTime, formatCurrency } from '../components/table.js';
import { navigate, openModal, closeModal, toast, confirm, currentUser } from '../app.js';

// ── CPD body type display labels ────────────────────────────────────────────────
// 'Station' and 'Saloon' remain the stored/submitted values (pricing tier
// classification and existing DB rows key off them) — only the staff-facing
// wording changes, to make clear what each category means.
const CPD_BODY_TYPE_LABELS = { Station: 'Station – SUV', Saloon: 'Saloon- Sedan' };
const cpdBodyTypeLabel = t => CPD_BODY_TYPE_LABELS[t] ?? t;

// ── CPD Request list ──────────────────────────────────────────────────────────
export function renderCPDRequests(param = null) {
  const content   = document.getElementById('page-content');
  const isCashier       = currentUser?.role_name === 'idl_cpd_cashier';
  const isCPDOfficer    = currentUser?.role_name === 'cpd_officer';
  const isBranchManager = currentUser?.role_name === 'cpd_branch';

  const typeParam = (param && typeof param === 'object') ? (param.type ?? null) : (param ?? null);

  // Map nav filter-type to request_type query param
  const REQUEST_TYPE_MAP  = { ONLINE:'ONLINE', CALL_CENTER:'CALL_CENTER', MOI:'MOI', RTA:'RTA', ADCONNECT:'ADCONNECT' };
  const REQUEST_TYPE_LABELS = {
    ONLINE:'Online Applications', CALL_CENTER:'Walkin Applications',
    MOI:'MOI Applications', RTA:'RTA Applications', ADCONNECT:'AdConnect Applications',
  };
  const requestType = typeParam && REQUEST_TYPE_MAP[typeParam] ? REQUEST_TYPE_MAP[typeParam] : '';
  const pageSubtitle = requestType ? (REQUEST_TYPE_LABELS[requestType] ?? requestType) : 'All Requests';

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">CPD Requests</h1>
        <p class="page-subtitle">${pageSubtitle}</p>
      </div>
      ${(!isCashier && !isBranchManager) ? `
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-cpd">
          <i class="fa-solid fa-plus"></i> New Request
        </button>
      </div>` : ''}
    </div>
    <div id="cpd-table"></div>`;

  if (!isCashier && !isBranchManager) {
    document.getElementById('btn-new-cpd').addEventListener('click', () => navigate('cpd-new'));
  }

  // Queue filter: cashier/branch manager see their own queue position. Cashier
  // additionally defaults to "Processing" (1) — the status a CPD sits at while
  // paid online and awaiting the cashier, or unpaid and awaiting Pay at Office
  // collection — so already-handled requests don't clutter their queue by default.
  const defaultFilters = isCashier ? { queue_position: 'IDL_CPD_Cashier', status: '1' }
    : isBranchManager ? { queue_position: 'CPD_Branch_Manager' } : {};

  new DataTable(
    document.getElementById('cpd-table'),
    [
      { key: 'request_id',    label: 'Request ID',  width: '200px' },
      { key: 'applicant',     label: 'Applicant',   render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'vehicle',       label: 'Vehicle',     render: (_, r) => `${r.vehicle_make} ${r.vehicle_model}` },
      { key: 'request_type',  label: 'Type',        render: v => {
        const map = { ONLINE:'Online', CALL_CENTER:'Walk-In', MOI:'MOI', RTA:'RTA', ADCONNECT:'AdConnect' };
        return v ? `<span class="badge badge-default">${map[v] ?? v}</span>` : '—';
      }},
      { key: 'total_amount',  label: 'Amount',      render: v => formatCurrency(v) },
      { key: 'requested_datetime', label: 'Submitted', render: v => formatDateTime(v) },
      { key: 'request_status', label: 'Status',     render: (v, r) => statusBadge(r.status_label ?? v) },
      { key: 'actions',       label: '',            width: (isCashier || isBranchManager) ? '150px' : '100px',
        render: (_, r) => `<div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm view-btn" data-id="${r.auto_id}" title="View">
          <i class="fa-solid fa-eye"></i></button>
          ${(!isCashier && !isBranchManager && String(r.request_status) === '3') ? `<button class="btn btn-danger btn-sm cancel-cpd-btn" data-id="${r.auto_id}" title="Cancel CPD">
          <i class="fa-solid fa-ban"></i></button>` : ''}</div>` },
    ],
    params => {
      const extra = {};
      if (requestType) extra.request_type = requestType;
      // CPD officer: default to their queue when no search and no status filter
      if (isCPDOfficer && !params.search && !params.status) extra.queue_position = 'CPD_Officer';
      if (isCashier) extra.queue_position = 'IDL_CPD_Cashier';
      if (isBranchManager) extra.queue_position = 'CPD_Branch_Manager';
      return api.cpd.list({ ...params, ...extra });
    },
    {
      idKey: 'auto_id',
      searchPlaceholder: 'Search by ID, plate, name…',
      defaultFilters,
      rowStyle: r => parseInt(r.has_cheque) > 0 ? 'background:#ebffeb' : '',
      filters: isCashier ? [
        { key: 'status', label: 'Processing (default)', options: [
          { value: '1',    label: 'Processing' },
          { value: '2',    label: 'Confirmed' },
          { value: '3',    label: 'Issued' },
          { value: '9',    label: 'Dispatched' },
          { value: 'all',  label: 'All (incl. processed)' },
        ]},
      ] : isBranchManager ? [] : [
        { key: 'status', label: 'All Statuses', options: [
          { value: '1',          label: 'Processing' },
          { value: '2',          label: 'Confirmed' },
          { value: '3',          label: 'Issued' },
          { value: '4',          label: 'Returned' },
          { value: '6',          label: 'Cancelled' },
          { value: '8',          label: 'Sent for Corrections' },
          { value: '9',          label: 'Dispatched' },
          { value: 'all',        label: 'All Statuses' },
        ]},
        { key: 'request_type', label: 'All Types', options: [
          { value: 'ONLINE',     label: 'Online' },
          { value: 'CALL_CENTER',label: 'Walk-In' },
          { value: 'MOI',        label: 'MOI' },
          { value: 'RTA',        label: 'RTA' },
          { value: 'ADCONNECT',  label: 'AdConnect' },
        ]},
      ],
    },
  ).render();

  document.getElementById('cpd-table').addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (btn) navigate('cpd-detail', btn.dataset.id);
    const cancelBtn = e.target.closest('.cancel-cpd-btn');
    if (cancelBtn) cpdCancelFromList(Number(cancelBtn.dataset.id));
  });
}

// ── Return Guarantee Cheque Modal ─────────────────────────────────────────────
async function openReturnChequeModal(id, defaultBeneficiary = '', onSaved = null) {
  const uaeBanks = [
    'Abu Dhabi Commercial Bank (ADCB)',
    'Abu Dhabi Islamic Bank (ADIB)',
    'Al Maryah Community Bank',
    'Arab Bank for Investment & Foreign Trade (Al Masraf)',
    'Bank of Sharjah',
    'CBD (Commercial Bank of Dubai)',
    'CITI Bank',
    'Dubai Islamic Bank (DIB)',
    'Emirates Islamic Bank',
    'Emirates NBD',
    'First Abu Dhabi Bank (FAB)',
    'HSBC Bank Middle East',
    'Invest Bank',
    'Mashreq Bank',
    'National Bank of Fujairah (NBF)',
    'National Bank of Ras Al Khaimah (RAKBANK)',
    'National Bank of Umm Al Qaiwain (NBQ)',
    'Sharjah Islamic Bank',
    'Standard Chartered Bank',
    'United Arab Bank (UAB)',
    'Wio Bank',
    'Zand Bank',
  ];

  // Fetch existing record
  let existing = null;
  try {
    const res = await api.cpd.getReturnCheque(id);
    if (res && res.guarantee_cheque_id) existing = res;
  } catch { /* no record yet */ }

  const isEdit = !!existing;
  const e = existing ?? {};

  const bankOptions = uaeBanks.map(b =>
    `<option value="${b}" ${e.bank === b ? 'selected' : ''}>${b}</option>`
  ).join('');

  openModal({
    title: isEdit ? 'Update Return Guarantee Cheque' : 'Upload Return Guarantee Cheque',
    body: `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:14px">
        <div class="field" style="grid-column:1/-1">
          <label>Beneficiary Name <span style="color:var(--accent)">*</span></label>
          <input id="rc-beneficiary" type="text" placeholder="Enter beneficiary name" value="${e.beneficiary_name ?? defaultBeneficiary}" />
        </div>
        <div class="field">
          <label>Cheque No <span style="color:var(--accent)">*</span></label>
          <input id="rc-cheque-no" type="text" placeholder="e.g. 000123456" value="${e.cheque_no ?? ''}" />
        </div>
        <div class="field">
          <label>Cheque Date <span style="color:var(--accent)">*</span></label>
          <input id="rc-cheque-date" type="date" value="${e.cheque_date ? e.cheque_date.split('T')[0] : ''}" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>Bank <span style="color:var(--accent)">*</span></label>
          <select id="rc-bank">
            <option value="">— Select Bank —</option>
            ${bankOptions}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>Remarks</label>
          <textarea id="rc-remarks" rows="3" placeholder="Optional remarks…"
            style="width:100%;resize:vertical">${e.remarks ?? ''}</textarea>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModalGlobal()">
        <i class="fa-solid fa-xmark"></i> Cancel
      </button>
      <button class="btn btn-primary" id="rc-save-btn">
        ${isEdit
          ? '<i class="fa-solid fa-pen"></i> Update'
          : '<i class="fa-solid fa-floppy-disk"></i> Save'}
      </button>`,
  });

  document.getElementById('rc-save-btn').onclick = async () => {
    const beneficiary = document.getElementById('rc-beneficiary').value.trim();
    const chequeNo    = document.getElementById('rc-cheque-no').value.trim();
    const chequeDate  = document.getElementById('rc-cheque-date').value;
    const bank        = document.getElementById('rc-bank').value;
    const remarks     = document.getElementById('rc-remarks').value.trim();

    if (!beneficiary) return toast('Enter beneficiary name', 'error');
    if (!chequeNo)    return toast('Enter cheque number', 'error');
    if (!chequeDate)  return toast('Select cheque date', 'error');
    if (!bank)        return toast('Select a bank', 'error');

    const saveBtn = document.getElementById('rc-save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    try {
      const payload = { beneficiary_name: beneficiary, cheque_no: chequeNo, cheque_date: chequeDate, bank, remarks };
      if (isEdit) {
        await api.cpd.updateReturnCheque(id, payload);
        toast('Return cheque details updated', 'success');
      } else {
        await api.cpd.returnCheque(id, payload);
        toast('Return cheque details saved', 'success');
      }
      closeModal();
      onSaved?.();
    } catch (err) {
      toast(err.message || 'Failed to save', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = isEdit
        ? '<i class="fa-solid fa-pen"></i> Update'
        : '<i class="fa-solid fa-floppy-disk"></i> Save';
    }
  };
}

function cpdCancelFromList(id) {
  openModal({
    title: 'Request Cancellation',
    body: `
      <div class="field">
        <label>Cancellation Reason <span style="color:var(--accent)">*</span></label>
        <textarea id="cancel-cpd-reason" rows="4"
          placeholder="Enter reason for cancellation…"
          style="width:100%;resize:vertical"></textarea>
      </div>
      <div class="field" style="margin-top:12px">
        <label>Supporting Document <span style="color:var(--text-muted)">(optional — JPG, PNG or PDF)</span></label>
        <input type="file" id="cancel-cpd-doc" accept=".jpg,.jpeg,.png,.pdf" />
      </div>
      <p style="font-size:.82rem;color:var(--text-muted);margin-top:8px">This submits a cancellation request for cpd_finance to review and approve.</p>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Close
             </button>
             <button class="btn btn-danger" id="cancel-cpd-confirm">
               <i class="fa-solid fa-ban"></i> Submit Request
             </button>`,
  });
  document.getElementById('cancel-cpd-confirm').onclick = async () => {
    const reason = document.getElementById('cancel-cpd-reason').value.trim();
    if (!reason) return toast('Enter a cancellation reason', 'error');
    const btn = document.getElementById('cancel-cpd-confirm');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const fd = new FormData();
      fd.append('reason', reason);
      const doc = document.getElementById('cancel-cpd-doc').files[0];
      if (doc) fd.append('document', doc);
      await api.cpd.cancel(id, fd);
      closeModal();
      toast('Cancellation request submitted for approval', 'success');
      navigate('cpd-requests');
    } catch (e) {
      toast(e.message || 'Failed to submit cancellation request', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-ban"></i> Submit Request';
    }
  };
}

// ── CPD New ───────────────────────────────────────────────────────────────────
// Shared section markup for the New, Copy and Renew CPD forms — identity, vehicle,
// licence, documents, additional information, references, trip, and request & payment.
function cpdFormSectionsHtml({ nationalities, vehicleTypes, countries, docZone, feeTableId, fromRenew }) {
  const UAE_STATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];
  const BODY_TYPES = ['Station','Saloon','Motor Cycle','Truck','Coupe','Bus','Trailer','-Coupe','-Station','-Saloon','Pickup','Caravan','Hatchback'];
  const COLORS     = ['White','Silver','Black','Grey','Blue','Red','Brown','Green','Other'];
  const yearOpts   = Array.from({length:41},(_,i)=>2030-i).map(y=>`<option value="${y}">${y}</option>`).join('');
  return `
      <!-- Your Identity Information (same card as the public CPD wizard) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>Your Identity Information</span>
${fromRenew ? '' : `          <button type="button" class="btn btn-ghost btn-sm" id="btn-cpd-walkin-uaepass" style="display:none">
            <i class="fa-solid fa-mobile-screen"></i> Customer will log in with UAE PASS</button>
`}
        </div>
        <div class="pub-identity-rows">
          <input type="hidden" name="user_id" id="cpd-user-id" />

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Emirates ID *</span>
            <input name="emirates_id" id="cpd-eid-input" class="pub-id-inline-input" placeholder="784-XXXX-XXXXXXX-X — press Enter to search" />
            <div id="cpd-eid-status" style="margin:0;font-size:.82rem;min-height:20px"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Salutation</span>
            <select name="title" class="pub-id-inline-select">
              <option value="">Select</option>
              <option value="Mr">Mr</option>
              <option value="Mrs">Mrs</option>
              <option value="Ms">Ms</option>
              <option value="Dr">Dr</option>
              <option value="Sheikh">Sheikh</option>
              <option value="His Excellency">His Excellency</option>
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Full Name *</span>
            <input name="full_name" required class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-flag"></i></span>
            <span class="pub-id-label">Nationality</span>
            <select name="nationality" class="pub-id-inline-select">
              <option value="">Select nationality</option>
              ${nationalities.map(n => `<option value="${n.nationality_id}">${n.nationality}</option>`).join('')}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-venus-mars"></i></span>
            <span class="pub-id-label">Gender</span>
            <select name="sex" class="pub-id-inline-select">
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Mobile Number *</span>
            <input name="mobile_no" id="cpd-mobile" class="pub-id-inline-input" placeholder="+971 50 xxx xxxx" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-envelope"></i></span>
            <span class="pub-id-label">Email Address</span>
            <input name="email" id="cpd-email" type="email" class="pub-id-inline-input" placeholder="email@example.com" />
          </div>

        </div>
      </div>

      <!-- Vehicle Details (same card as the public CPD vehicle step) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Vehicle Details</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-hashtag"></i></span>
            <span class="pub-id-label">Vehicle Plate Number *</span>
            <input name="registration_no" required class="pub-id-inline-input" placeholder="e.g. Dubai A 12345" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-file-lines"></i></span>
            <span class="pub-id-label">Traffic File Number</span>
            <input name="mulkiya_no" class="pub-id-inline-input" placeholder="Traffic file / Mulkiya number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-car"></i></span>
            <span class="pub-id-label">Vehicle Make *</span>
            <select name="vehicle_make" required class="pub-id-inline-select">
              <option value="">Select make</option>
              ${vehicleTypes.map(v => `<option value="${v.vehicle_type}">${v.vehicle_type}</option>`).join('')}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-car-side"></i></span>
            <span class="pub-id-label">Vehicle Model *</span>
            <input name="vehicle_model" required class="pub-id-inline-input" placeholder="e.g. Land Cruiser" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-shapes"></i></span>
            <span class="pub-id-label">Body Type</span>
            <select name="body_type" class="pub-id-inline-select">
              <option value="">Select type</option>
              ${BODY_TYPES.map(t => `<option value="${t}">${cpdBodyTypeLabel(t)}</option>`).join('')}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="pub-id-label">Vehicle Registered In</span>
            <select name="vehicle_registered_in" class="pub-id-inline-select">
              <option value="">Select emirate</option>
              ${UAE_STATES.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-palette"></i></span>
            <span class="pub-id-label">Color as per Mulkiya</span>
            <select name="color" class="pub-id-inline-select">
              <option value="">Select color</option>
              ${COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar"></i></span>
            <span class="pub-id-label">Year of Manufacture *</span>
            <select name="manuf_year" required class="pub-id-inline-select">
              <option value="">Select year</option>
              ${yearOpts}
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-barcode"></i></span>
            <span class="pub-id-label">Chassis No *</span>
            <input name="chassis_no" required class="pub-id-inline-input" placeholder="VIN / Chassis number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-weight-hanging"></i></span>
            <span class="pub-id-label">Net Weight (Empty Load)</span>
            <input name="net_weight" class="pub-id-inline-input" placeholder="kg" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-gears"></i></span>
            <span class="pub-id-label">Engine No</span>
            <input name="engine_no" class="pub-id-inline-input" placeholder="Engine number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-users"></i></span>
            <span class="pub-id-label">No of Seats</span>
            <input name="no_of_seats" type="number" class="pub-id-inline-input" placeholder="5" />
          </div>

        </div>
      </div>

      <!-- Driving Licence Details (same card as the public CPD vehicle step) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Driving Licence Details</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-id-card"></i></span>
            <span class="pub-id-label">Driving Licence Number</span>
            <input name="license_no" class="pub-id-inline-input" placeholder="Enter driving licence number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span>
            <span class="pub-id-label">Driving Licence Expiry Date</span>
            <input name="license_expiry" type="date" class="pub-id-inline-input" />
          </div>

        </div>
      </div>

      <!-- Documents (same card as the public CPD vehicle step) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Documents</span></div>
        <div class="doc-upload-grid" style="padding:16px">
          ${docZone('eid_front',      'Emirates ID (Front)')}
          ${docZone('eid_back',       'Emirates ID (Back)')}
          ${docZone('dl_front',       'Driving License (Front)')}
          ${docZone('dl_back',        'Driving License (Back)')}
          ${docZone('traffic_front',  'Traffic File (Front)')}
          ${docZone('traffic_back',   'Traffic File (Back)')}
          ${docZone('passport_photo', 'Passport Copy')}
          <div id="cpd-new-corporate-docs" style="display:none;grid-column:1/-1">
            <div class="doc-upload-grid">
              ${docZone('visa_page',      'Visa Page of Owner')}
              ${docZone('trade_license',  'Trade License')}
              ${docZone('noc',            'NOC from Company Owner')}
            </div>
          </div>
        </div>
      </div>

      <!-- Additional Information (same card as the public CPD vehicle step, then the officer-only rows) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Additional Information</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-briefcase"></i></span>
            <span class="pub-id-label">Usage Type</span>
            <select name="usage_type" id="cpd-new-usage-type" class="pub-id-inline-select" required>
              <option value="PERSONAL" selected>Personal Use</option>
              <option value="COMPANY">Company Use</option>
            </select>
          </div>

          <div class="pub-identity-row" id="cpd-new-company-name-row" style="display:none">
            <span class="pub-id-icon"><i class="fa-solid fa-building"></i></span>
            <span class="pub-id-label">Company Name *</span>
            <input name="company_name" class="pub-id-inline-input" placeholder="Registered company name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-passport"></i></span>
            <span class="pub-id-label">Passport Number</span>
            <input name="passport_no" class="pub-id-inline-input" placeholder="Passport number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-sack-dollar"></i></span>
            <span class="pub-id-label">Vehicle Value (AED)</span>
            <input name="vehicle_value" type="number" class="pub-id-inline-input" placeholder="80000" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-gauge-high"></i></span>
            <span class="pub-id-label">Horse Power</span>
            <input name="horse_power" class="pub-id-inline-input" placeholder="e.g. 200" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-layer-group"></i></span>
            <span class="pub-id-label">No of Cylinders</span>
            <input name="no_of_cylinders" class="pub-id-inline-input" placeholder="e.g. 4" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-chair"></i></span>
            <span class="pub-id-label">Upholstery</span>
            <input name="upholstery" class="pub-id-inline-input" placeholder="e.g. Leather" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-radio"></i></span>
            <span class="pub-id-label">Radio</span>
            <select name="radio" class="pub-id-inline-select">
              <option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-ring"></i></span>
            <span class="pub-id-label">Spare Tyre</span>
            <select name="spare_tyre" class="pub-id-inline-select">
              <option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-list"></i></span>
            <span class="pub-id-label">Other Particulars (1)</span>
            <input name="others1" class="pub-id-inline-input" placeholder="e.g. Roof rack…" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-list"></i></span>
            <span class="pub-id-label">Other Particulars (2)</span>
            <input name="others2" class="pub-id-inline-input" placeholder="e.g. Winch, spare parts…" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-envelope-open-text"></i></span>
            <span class="pub-id-label">PO Box</span>
            <input name="po_box" class="pub-id-inline-input" placeholder="PO Box" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="pub-id-label">Address</span>
            <input name="address" class="pub-id-inline-input" placeholder="Street, area, emirate" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-city"></i></span>
            <span class="pub-id-label">City</span>
            <input name="city" class="pub-id-inline-input" placeholder="City" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Extra Driver 1 Full Name</span>
            <input name="extra_owner1_name" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Extra Driver 1 Emirates ID</span>
            <input name="extra_owner1_eid" class="pub-id-inline-input" placeholder="784-XXXX-XXXXXXX-X" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-passport"></i></span>
            <span class="pub-id-label">Extra Driver 1 Passport Number</span>
            <input name="extra_owner1_passport" class="pub-id-inline-input" placeholder="Passport number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Extra Driver 2 Full Name</span>
            <input name="extra_owner2_name" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Extra Driver 2 Emirates ID</span>
            <input name="extra_owner2_eid" class="pub-id-inline-input" placeholder="784-XXXX-XXXXXXX-X" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-passport"></i></span>
            <span class="pub-id-label">Extra Driver 2 Passport Number</span>
            <input name="extra_owner2_passport" class="pub-id-inline-input" placeholder="Passport number" />
          </div>

        </div>
      </div>

      <!-- References (same card as the public CPD vehicle step) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>References</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-address-book"></i></span>
            <span class="pub-id-label">Reference 1 in UAE Full Name</span>
            <input name="uae_refree1" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Reference 1 in UAE Mobile Number</span>
            <input name="uae_refree1_mobile" class="pub-id-inline-input" placeholder="+971 50 xxx xxxx" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-address-book"></i></span>
            <span class="pub-id-label">Reference 2 in UAE Full Name</span>
            <input name="uae_refree2" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Reference 2 in UAE Mobile Number</span>
            <input name="uae_refree2_mobile" class="pub-id-inline-input" placeholder="+971 50 xxx xxxx" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-address-book"></i></span>
            <span class="pub-id-label">Reference 1 in Destination Full Name</span>
            <input name="destination_refree1" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Reference 1 in Destination Mobile Number</span>
            <input name="destination_refree1_mobile" class="pub-id-inline-input" placeholder="Mobile number" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-address-book"></i></span>
            <span class="pub-id-label">Reference 2 in Destination Full Name</span>
            <input name="destination_refree2" class="pub-id-inline-input" placeholder="Full name" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Reference 2 in Destination Mobile Number</span>
            <input name="destination_refree2_mobile" class="pub-id-inline-input" placeholder="Mobile number" />
          </div>

        </div>
      </div>

      <!-- Trip Details (same as the public trip step: destination chips, then remarks) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Trip Details</span></div>
        <div style="padding:16px">
          <label style="display:block;margin-bottom:2px;font-weight:600">Destination Countries *</label>
          <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Select all countries you plan to visit.</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${countries.map(c => `
              <label class="cpd-country-check">
                <input type="checkbox" name="countries" value="${c.nationality_id}" style="accent-color:var(--accent)" />
                ${c.nationality}
              </label>`).join('')}
          </div>
          <div style="margin-top:16px">
            <label style="display:block;margin-bottom:6px;font-weight:600">Additional Remarks</label>
            <textarea name="additional_remarks" rows="3" style="width:100%;resize:vertical" placeholder="Any special requirements or notes…"></textarea>
          </div>
        </div>
      </div>

      <!-- Request & Payment (officer-only fields; fee figures are calculated, not editable) -->
      <div class="pub-identity-card" style="margin-bottom:20px">
        <div class="pub-identity-card-header"><span>Request &amp; Payment</span></div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-tags"></i></span>
            <span class="pub-id-label">Request Category *</span>
            <select name="request_category" required class="pub-id-inline-select">
              <option value="NORMAL">Normal</option>
              <option value="SPECIAL">Special</option>
              <option value="MOI">MOI</option>
              <option value="ADP">ADP</option>
            </select>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-credit-card"></i></span>
            <span class="pub-id-label">Payment Method *</span>
            <select name="method_of_payment" required class="pub-id-inline-select">
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="BANK_GUARANTEE">Bank Guarantee</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="CASH_CHEQUE">Cash + Cheque</option>
              <option value="CASH_BANKGUARANTEE">Cash + Bank Guarantee</option>
            </select>
          </div>

        </div>

        <!-- Fee breakdown is computed automatically (same figures the customer sees on the online
             application) — not manually editable. -->
        <input type="hidden" name="guarantee_amount" id="cpd-guarantee-amount" value="0" />
        <input type="hidden" name="booking_fee"      id="cpd-booking-fee"      value="0" />
        <input type="hidden" name="processing_fee"   id="cpd-processing-fee"   value="0" />
        <input type="hidden" name="extra_fees"       id="cpd-extra-fees"       value="0" />
        <input type="hidden" name="vat_amount"       id="cpd-vat-amount"       value="0" />
        <input type="hidden" name="total_amount"     id="cpd-total-amount"     value="0" />
      </div>

      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border);background:var(--bg-surface)">
        <div class="section-card-header" style="font-size:.82rem">
          <i class="fa-solid fa-calculator" style="color:var(--accent);margin-right:6px"></i>
          Fee Breakdown
        </div>
        <div class="section-card-body" style="padding:0">
          <table style="width:100%;border-collapse:collapse" id="${feeTableId}">
            ${cpdFeeRow('Guarantee Fee', 0)}
            ${cpdFeeRow('Processing Fee (2.5% of Guarantee Fee)', 0)}
            ${cpdFeeRow('Booking Fee', 0)}
            ${cpdFeeRow('Extra Driver Fee', 0)}
            ${cpdFeeRow('VAT (5%)', 0)}
            ${cpdFeeRow('Total Payable', 0, true, true)}
          </table>
        </div>
      </div>


`;
}

export async function renderCPDNew() {
  const content = document.getElementById('page-content');
  const [vehicleTypes, countries, nationalities, guaranteeRules] = await Promise.all([
    api.cpd.vehicleTypes(), api.cpd.countries(), api.idl.nationalities(), api.cpd.guaranteeRules(),
  ]);

  const UAE_STATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];
  // "Luxury" is intentionally not selectable — luxury vehicles are auto-detected
  // from the make (see LUXURY_MAKES_CPD below) and priced accordingly.
  const BODY_TYPES = ['Station','Saloon','Motor Cycle','Truck','Coupe','Bus','Trailer','-Coupe','-Station','-Saloon','Pickup','Caravan','Hatchback'];
  const COLORS     = ['White','Silver','Black','Grey','Blue','Red','Brown','Green','Other'];
  const yearOpts   = Array.from({length:41},(_,i)=>2030-i).map(y=>`<option value="${y}">${y}</option>`).join('');

  // Hand-the-device UAE PASS flow (personal-use walk-ins only) — mirrors the IDL
  // walk-in pattern: officer sends the customer to log in on this device, then logs
  // back in themselves; their verified profile is waiting here to prefill the form.
  const cpdWalkinPrefillRaw = sessionStorage.getItem('cpd_walkin_prefill');
  const cpdWalkinPrefill    = cpdWalkinPrefillRaw ? JSON.parse(cpdWalkinPrefillRaw) : null;
  if (cpdWalkinPrefillRaw) sessionStorage.removeItem('cpd_walkin_prefill');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">New CPD Request</h1>
        <p class="page-subtitle">Create a Carnet de Passage en Douane application</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="history.back()">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    </div>

    <form id="cpd-form" novalidate>

      ${cpdFormSectionsHtml({ nationalities, vehicleTypes, countries, docZone: officerCpdDocZone, feeTableId: 'cpd-new-fee-table', fromRenew: false })}

      <div id="form-error" class="form-error hidden"></div>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn btn-ghost" onclick="history.back()">
          <i class="fa-solid fa-xmark"></i> Cancel
        </button>
        <button type="submit" class="btn btn-primary" id="submit-btn">
          <i class="fa-solid fa-floppy-disk"></i> Create CPD Request
        </button>
      </div>
    </form>`;

  // ── Guarantee Calculator (DB-driven, same logic as public CPD wizard) ────────
  const _groups     = {};
  const _rates      = {};
  const _countryMap = {};
  const _bookingFees = [];

  (guaranteeRules.groups ?? []).forEach(g => { _groups[g.group_code] = g; });
  (guaranteeRules.rates  ?? []).forEach(r => {
    if (!_rates[r.group_code]) _rates[r.group_code] = [];
    _rates[r.group_code][r.year_band] = { saloon: +r.saloon, station: +r.station, luxury: +r.luxury };
  });
  (guaranteeRules.country_map ?? []).forEach(c => {
    const entry = { group_code: c.group_code, special_note: c.special_note };
    if (c.nationality_id != null) _countryMap[`id:${c.nationality_id}`] = entry;
    _countryMap[c.country_name.toLowerCase()] = entry;
  });
  (guaranteeRules.booking_fees ?? []).forEach(bf => _bookingFees.push(bf));
  const EXTRA_DRIVER_FEE = parseFloat(guaranteeRules.extra_driver_fee ?? 50);

  const STATION_TYPES_CPD = ['Station','SUV','-Station','Pickup','Truck','Bus','Trailer','Caravan','Hatchback'];
  // "Luxury" is not a selectable body type — see the matching note on BODY_TYPES above.
  const LUXURY_MAKES_CPD = [
    'Rolls Royce', 'Bentley', 'Ferrari', 'Lamborghini', 'Maserati', 'Aston Martin',
    'McLaren', 'Bugatti', 'Koenigsegg', 'Pagani', 'Maybach', 'W Motors', 'Bizzarrini', 'Gumpert',
  ];

  function cpdGetTier(bt, make) {
    if (LUXURY_MAKES_CPD.includes((make ?? '').trim())) return 'luxury';
    if (STATION_TYPES_CPD.includes(bt ?? '')) return 'station';
    return 'saloon';
  }
  function cpdGetBand(y) {
    const yr = parseInt(y, 10);
    if (yr <= 2000) return 0;
    if (yr <= 2009) return 1; // band 2 starts at 2010, matching the guarantee rate table
    return 2;
  }
  function cpdBookingFee(ids) {
    const idSet = new Set(ids.map(String));
    let best = 0;
    _bookingFees.forEach(bf => {
      if (!bf.country_list) return;
      if (bf.country_list.split(',').map(s => s.trim()).some(id => idSet.has(id))) {
        const fee = parseFloat(bf.booking_fee) || 0;
        if (fee > best) best = fee;
      }
    });
    return best;
  }

  function recalcGuarantee() {
    const checkedBoxes = [...document.querySelectorAll('input[name="countries"]:checked')];
    const driver1 = document.querySelector('[name="extra_owner1_name"]')?.value?.trim() ?? '';
    const driver2 = document.querySelector('[name="extra_owner2_name"]')?.value?.trim() ?? '';
    const extraFee = (driver1 || driver2) ? EXTRA_DRIVER_FEE : 0;
    if (!checkedBoxes.length) {
      setFeeFields(0, 0, extraFee, Math.round(extraFee * 0.05 * 100) / 100, extraFee + Math.round(extraFee * 0.05 * 100) / 100, 0);
      return;
    }
    const selectedIds   = checkedBoxes.map(cb => cb.value);
    const selectedNames = selectedIds.map(id => countries.find(c => String(c.nationality_id) === String(id))?.nationality ?? '');
    const bodyType      = document.querySelector('[name="body_type"]')?.value ?? '';
    const manufYear     = document.querySelector('[name="manuf_year"]')?.value ?? '';
    const vehicleMake   = document.querySelector('[name="vehicle_make"]')?.value ?? '';
    const tier = cpdGetTier(bodyType, vehicleMake);
    const band = cpdGetBand(manufYear);
    const isMotorcycle  = bodyType === 'Motor Cycle';
    const nationalityVal = document.querySelector('[name="nationality"]')?.value ?? '';
    const isUaeNational  = nationalities.find(n => String(n.nationality_id) === String(nationalityVal))?.nationality === 'United Arab Emirates';

    const groupAmounts = {};
    selectedNames.forEach((name, idx) => {
      const mapping = _countryMap[`id:${selectedIds[idx]}`] ?? _countryMap[name.toLowerCase()];
      const grpCode = mapping?.group_code ?? 'DEFAULT';
      const grp     = _groups[grpCode];
      let amount = 0;
      if (isMotorcycle && grp?.motorcycle_flat_amount != null) {
        amount = +grp.motorcycle_flat_amount;
      } else if (grp?.fixed_amount != null) {
        amount = (isUaeNational && grp?.fixed_amount_uae_national != null)
          ? +grp.fixed_amount_uae_national
          : +grp.fixed_amount;
      } else {
        const br = (_rates[grpCode] ?? [])[band]; amount = br ? br[tier] : 0;
      }
      if (!groupAmounts[grpCode] || amount > groupAmounts[grpCode]) groupAmounts[grpCode] = amount;
    });

    const guaranteeFee = Math.max(0, ...Object.values(groupAmounts));
    // Processing fee — 2.5% of the guarantee fee for every destination, Portugal included.
    const processingFee = Math.round(guaranteeFee * 0.025 * 100) / 100;
    const bookingFee   = cpdBookingFee(selectedIds);
    const vat          = Math.round((bookingFee + extraFee) * 0.05 * 100) / 100;
    const total        = guaranteeFee + bookingFee + extraFee + processingFee + vat;
    setFeeFields(guaranteeFee, bookingFee, extraFee, vat, total, processingFee);
  }

  function setFeeFields(guarantee, booking, extra, vat, total, processingFee = 0) {
    const set = (name, val) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) el.value = val > 0 ? val.toFixed(2) : '0.00';
    };
    set('guarantee_amount', guarantee);
    set('booking_fee',      booking);
    set('processing_fee',   processingFee);
    set('extra_fees',       extra);
    set('vat_amount',       vat);
    set('total_amount',     total);

    const table = document.getElementById('cpd-new-fee-table');
    if (table) {
      table.innerHTML =
        cpdFeeRow('Guarantee Fee', guarantee) +
        cpdFeeRow('Processing Fee (2.5% of Guarantee Fee)', processingFee) +
        cpdFeeRow('Booking Fee', booking) +
        cpdFeeRow('Extra Driver Fee', extra) +
        cpdFeeRow('VAT (5%)', vat) +
        cpdFeeRow('Total Payable', total, true, true);
    }
  }

  // When no countries selected still recalc in case extra driver changed
  function recalcAll() { recalcGuarantee(); }

  // Trigger recalc when countries, body type, year, or extra driver names change
  document.querySelectorAll('input[name="countries"]').forEach(cb =>
    cb.addEventListener('change', recalcGuarantee));
  document.querySelector('[name="body_type"]')?.addEventListener('change', recalcGuarantee);
  document.querySelector('[name="manuf_year"]')?.addEventListener('change', recalcGuarantee);
  document.querySelector('[name="nationality"]')?.addEventListener('change', recalcGuarantee);
  document.querySelector('[name="extra_owner1_name"]')?.addEventListener('input', recalcGuarantee);
  document.querySelector('[name="extra_owner2_name"]')?.addEventListener('input', recalcGuarantee);

  // Emirates ID lookup — populate fields on Enter
  function officerCpdDocZone(key, label) {
    return `<div class="doc-upload-item">
      <div class="doc-upload-label">${label}</div>
      <div class="doc-upload-zone" id="officer-cpd-zone-${key}" style="cursor:pointer">
        <input type="file" accept=".jpg,.jpeg,.png" data-officer-cpd-doc="${key}" style="display:none" />
        <div class="doc-upload-placeholder">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Click to upload</span>
          <small>JPG or PNG · max 2 MB</small>
        </div>
        <div class="doc-upload-preview" style="display:none">
          <img class="doc-preview-img" />
          <span class="doc-preview-name"></span>
          <button type="button" class="doc-remove-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
    </div>`;
  }

  // Toggle corporate-only documents, and the personal-use-only "hand the device" UAE
  // PASS option, when Usage Type changes.
  const usageTypeSelect  = document.getElementById('cpd-new-usage-type');
  const uaePassWalkinBtn = document.getElementById('btn-cpd-walkin-uaepass');
  function syncUsageTypeUI() {
    const isCompany = usageTypeSelect.value === 'COMPANY';
    const corpDocs = document.getElementById('cpd-new-corporate-docs');
    if (corpDocs) corpDocs.style.display = isCompany ? 'contents' : 'none';
    if (uaePassWalkinBtn) uaePassWalkinBtn.style.display = isCompany ? 'none' : '';
    const companyRow   = document.getElementById('cpd-new-company-name-row');
    const companyInput = companyRow?.querySelector('[name="company_name"]');
    if (companyRow) companyRow.style.display = isCompany ? '' : 'none';
    if (companyInput) {
      companyInput.required = isCompany;
      if (!isCompany) companyInput.value = '';
    }
  }
  usageTypeSelect?.addEventListener('change', syncUsageTypeUI);
  syncUsageTypeUI();

  uaePassWalkinBtn?.addEventListener('click', () => {
    sessionStorage.setItem('cpd_walkin_uaepass_pending', '1');
    window.location.href = api.auth.uaepassLoginUrl();
  });

  if (cpdWalkinPrefill) {
    const lockField = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el || value == null || value === '') return;
      el.value = value;
      if (el.tagName === 'SELECT') el.style.pointerEvents = 'none';
      else el.readOnly = true;
      el.tabIndex = -1;
      el.style.background = 'var(--bg-elevated)';
    };
    const fullName = [cpdWalkinPrefill.first_name, cpdWalkinPrefill.last_name].filter(Boolean).join(' ');
    lockField('full_name',   fullName);
    lockField('mobile_no',   cpdWalkinPrefill.mobile_no);
    lockField('email',       cpdWalkinPrefill.email);
    lockField('nationality', cpdWalkinPrefill.nationality);
    if (cpdWalkinPrefill.emirates_id) {
      const eidField = document.getElementById('cpd-eid-input');
      if (eidField) { eidField.value = cpdWalkinPrefill.emirates_id; eidField.readOnly = true; eidField.style.background = 'var(--bg-elevated)'; }
    }
    // Marks this application as identity-verified via UAE PASS, same as the public
    // wizard's DV share — read by the detail view to lock identity fields from editing.
    const viaUaePassFlag = document.createElement('input');
    viaUaePassFlag.type  = 'hidden';
    viaUaePassFlag.name  = 'identity_via_uae_pass';
    viaUaePassFlag.value = '1';
    document.getElementById('cpd-form').appendChild(viaUaePassFlag);
  }

  // Bind document upload zones
  document.querySelectorAll('.doc-upload-zone[id^="officer-cpd-zone-"]').forEach(zone => {
    const input   = zone.querySelector('input[data-officer-cpd-doc]');
    const holder  = zone.querySelector('.doc-upload-placeholder');
    const preview = zone.querySelector('.doc-upload-preview');
    const img     = zone.querySelector('.doc-preview-img');
    const name    = zone.querySelector('.doc-preview-name');
    const removeBtn = zone.querySelector('.doc-remove-btn');

    zone.addEventListener('click', e => {
      if (e.target.closest('.doc-remove-btn')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => { img.src = ev.target.result; };
      reader.readAsDataURL(file);
      name.textContent = file.name;
      holder.style.display  = 'none';
      preview.style.display = '';
      zone.style.border = '';
    });
    removeBtn?.addEventListener('click', () => {
      input.value = '';
      img.src = '';
      name.textContent = '';
      preview.style.display = 'none';
      holder.style.display  = '';
    });
  });

  document.getElementById('cpd-eid-input')?.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const eid    = e.target.value.trim();
    const status = document.getElementById('cpd-eid-status');
    if (!eid) return;

    status.innerHTML = `<span style="color:var(--text-muted)">
      <i class="fa-solid fa-spinner fa-spin" style="margin-right:5px"></i>
      Searching for Emirates ID <strong>${eid}</strong>…
    </span>`;
    e.target.disabled = true;

    try {
      const d   = await api.cpd.searchByEid(eid);

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
                      <p style="margin:0 0 6px;font-size:.875rem">New CPD requests cannot be created until the hold is lifted.</p>
                      ${reason ? `<p style="margin:0;font-size:.8rem;color:var(--text-muted)">Reason: ${reason}</p>` : ''}
                    </div>
                  </div>`,
          footer: `<button class="btn btn-primary" id="hold-goto-cpd-btn">
                     <i class="fa-solid fa-list"></i> Go to CPD Requests
                   </button>`,
        });
        document.getElementById('hold-goto-cpd-btn').addEventListener('click', () => {
          closeModal();
          navigate('cpd-requests');
        });
        document.getElementById('modal-close').addEventListener('click', () => navigate('cpd-requests'), { once: true });
        document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) navigate('cpd-requests'); }, { once: true });
        e.target.value = '';
        status.innerHTML = '';
        return;
      }

      const set = (name, val) => {
        if (val == null || val === '') return;
        const el = document.querySelector(`[name="${name}"]`);
        if (el) el.value = val;
      };

      // Personal details
      set('full_name',   [d.first_name, d.last_name].filter(Boolean).join(' '));
      set('nationality', d.nationality_id ?? d.nationality);
      set('city',        d.city);
      set('address',     d.uae_address);
      set('po_box',      d.po_box);
      set('passport_no', d.passport_no);
      const uidEl = document.getElementById('cpd-user-id');
      if (uidEl && d.user_id) uidEl.value = d.user_id;
      const mobEl = document.getElementById('cpd-mobile');
      if (mobEl && d.mobile_no) mobEl.value = d.mobile_no;
      const emlEl = document.getElementById('cpd-email');
      if (emlEl && d.email) emlEl.value = d.email;

      // Vehicle details from last CPD request
      set('vehicle_make',          d.vehicle_make);
      set('vehicle_model',         d.vehicle_model);
      set('vehicle_value',         d.vehicle_value);
      set('vehicle_registered_in', d.vehicle_registered_in);
      set('body_type',             d.body_type);
      set('manuf_year',            d.manuf_year);
      set('color',                 d.color);
      set('net_weight',            d.net_weight);
      set('chassis_no',            d.chassis_no);
      set('engine_no',             d.engine_no);
      set('horse_power',           d.horse_power);
      set('no_of_cylinders',       d.no_of_cylinders);
      set('upholstery',            d.upholstery);
      set('no_of_seats',           d.no_of_seats);
      set('radio',                 d.radio);
      set('spare_tyre',            d.spare_tyre);
      set('mulkiya_no',            d.mulkiya_no);
      set('registration_no',       d.registration_no);
      set('extra_owner1_name',     d.extra_owner1_name);
      set('extra_owner1_eid',      d.extra_owner1_eid);
      set('extra_owner1_passport', d.extra_owner1_passport);
      set('extra_owner2_name',     d.extra_owner2_name);
      set('extra_owner2_eid',      d.extra_owner2_eid);
      set('extra_owner2_passport', d.extra_owner2_passport);
      set('additional_remarks',    d.additional_remarks);
      set('others1',               d.others1);
      set('others2',               d.others2);
      set('uae_refree1',                  d.uae_refree1);
      set('uae_refree1_mobile',           d.uae_refree1_mobile);
      set('uae_refree2',                  d.uae_refree2);
      set('uae_refree2_mobile',           d.uae_refree2_mobile);
      set('destination_refree1',          d.destination_refree1);
      set('destination_refree1_mobile',   d.destination_refree1_mobile);
      set('destination_refree2',          d.destination_refree2);
      set('destination_refree2_mobile',   d.destination_refree2_mobile);

      const hasVehicle = d.vehicle_make || d.chassis_no;
      status.innerHTML = `<span style="color:var(--success)">
        <i class="fa-solid fa-circle-check" style="margin-right:5px"></i>
        Personal details populated.${hasVehicle ? ' Vehicle details loaded from last CPD request.' : ''}
      </span>`;
    } catch {
      status.innerHTML = `<span style="color:var(--text-muted)">
        <i class="fa-solid fa-circle-info" style="margin-right:5px"></i>
        Emirates ID not found — please fill in the details manually.
      </span>`;
    } finally {
      e.target.disabled = false;
      e.target.focus();
    }
  });

  document.getElementById('cpd-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = document.getElementById('submit-btn');
    const errEl = document.getElementById('form-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const fd   = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.countries = fd.getAll('countries').map(Number);

    // Explode Full Name into first_name (first two words) and last_name (remaining words)
    if (body.full_name) {
      const nameParts = body.full_name.trim().split(/\s+/).filter(Boolean);
      body.first_name = nameParts.slice(0, 2).join(' ');
      body.last_name  = nameParts.slice(2).join(' ');
    }

    // Validate all documents are selected. The 3 corporate docs are only ever shown
    // (and thus fillable) when Usage Type is Company — requiring them unconditionally
    // made every Personal-use walk-in submission impossible. Full doc set (incl. Driving
    // License, previously missing here) must match the online wizard's requiredDocSlots.
    const REQUIRED_DOCS = ['eid_front','eid_back','dl_front','dl_back','traffic_front','traffic_back','passport_photo'];
    if (body.usage_type === 'COMPANY') REQUIRED_DOCS.push('visa_page','trade_license','noc');
    const DOC_LABELS    = {
      eid_front: 'Emirates ID Front',      eid_back: 'Emirates ID Back',
      dl_front: 'Driving License Front',   dl_back: 'Driving License Back',
      traffic_front: 'Traffic File Front', traffic_back: 'Traffic File Back',
      passport_photo: 'Passport Photo',    visa_page: 'Visa Page',
      trade_license: 'Trade License',      noc: 'NOC',
    };
    const missingDocs = REQUIRED_DOCS.filter(key => {
      const input = document.querySelector(`input[data-officer-cpd-doc="${key}"]`);
      const zone  = document.getElementById(`officer-cpd-zone-${key}`);
      const empty = !input?.files?.[0];
      if (zone) zone.style.border = empty ? '2px solid #e90000' : '';
      return empty;
    });
    if (missingDocs.length) {
      errEl.textContent = `Please upload: ${missingDocs.map(k => DOC_LABELS[k]).join(', ')}`;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create CPD Request';
      return;
    }

    try {
      const eid = (body.emirates_id ?? '').trim();
      if (eid) {
        const holdData = await api.cpd.searchHold(eid).catch(() => null);
        if (holdData?.active_hold) {
          errEl.textContent = 'This customer has an active hold. Lift the hold before creating a new request.';
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create CPD Request';
          return;
        }
      }

      const res = await api.cpd.create(body);

      // Upload all documents
      const fd2 = new FormData();
      REQUIRED_DOCS.forEach(key => {
        const input = document.querySelector(`input[data-officer-cpd-doc="${key}"]`);
        if (input?.files?.[0]) fd2.append(key, input.files[0]);
      });
      await api.cpd.uploadDocs(res.auto_id, fd2);

      toast(`CPD request ${res.request_id} created`, 'success');
      navigate('cpd-detail', res.auto_id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create CPD Request';
    }
  });
}

// ── CPD Detail ────────────────────────────────────────────────────────────────
export async function renderCPDDetail(param) {
  // param can be a plain id, { id, returnId }, or { id, createReturn: true }
  const id           = (typeof param === 'object') ? param.id           : param;
  const returnId     = (typeof param === 'object') ? param.returnId     : null;
  const createReturn = (typeof param === 'object') ? !!param.createReturn : false;

  const content = document.getElementById('page-content');
  const [r, docs, existingCheque, cancelReq, cancelFiles] = await Promise.all([
    api.cpd.get(id),
    api.cpd.getDocs(id).catch(() => []),
    returnId ? api.cpd.getReturnCheque(id).catch(() => null) : Promise.resolve(null),
    api.cpd.getCancelRequest(id).catch(() => null),
    api.cpd.cancelAttachments(id).catch(() => []),
  ]);
  window.__cpdCurrentRecord = r;
  const isCpdFinance = currentUser?.role_name === 'cpd_finance';

  // Identity edit — same UAE-PASS lock concept as IDL: locked once the applicant
  // supplied name/Emirates ID/nationality/gender via UAE PASS; everything else
  // (vehicle, extra drivers, delivery) stays editable regardless.
  const isOfficerRole   = currentUser?.role_name === 'cpd_officer';
  const canEditIdentity = isOfficerRole && !r.applicant_via_uae_pass;
  const lockedByUaePass = isOfficerRole && !!r.applicant_via_uae_pass;
  const nationalities   = canEditIdentity ? await api.idl.nationalities() : [];

  const backBtn    = `<button class="btn btn-ghost btn-sm" data-action="back">
    <i class="fa-solid fa-arrow-left"></i> Back</button>`;
  const actionBtns = createReturn ? '' : buildCPDActionBtns(r, returnId);
  const actionsHtml = backBtn + actionBtns;

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${r.request_id}</h1>
        <p class="page-subtitle">${statusBadge(r.status_label ?? r.request_status)}</p>
      </div>
      <div class="page-actions">${actionsHtml}</div>
    </div>

    <div class="rv-section">
      <div class="rv-section-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="rv-section-title">Applicant Information</span>
        ${canEditIdentity ? `
        <button class="btn btn-ghost btn-sm" id="btn-edit-cpd-identity">
          <i class="fa-solid fa-pen"></i> Edit</button>` : ''}
        ${lockedByUaePass ? `
        <span class="badge badge-default" style="font-weight:500">
          <i class="fa-solid fa-shield-halved"></i> Verified via UAE PASS — not editable</span>` : ''}
      </div>
      <div class="rv-identity-rows" id="cpd-identity-view-rows">
        ${identityRow('fa-regular fa-user',        'Full Name',     `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim())}
        ${identityRow('fa-regular fa-id-card',     'Emirates ID',   r.emirates_id)}
        ${identityRow('fa-solid fa-flag',          'Nationality',   r.nationality)}
        ${identityRow('fa-solid fa-venus-mars',    'Gender',        r.sex)}
        ${identityRow('fa-solid fa-mobile-screen', 'Mobile Number', r.mobile_no)}
        ${identityRow('fa-regular fa-envelope',    'Email Address', r.email)}
      </div>
      ${canEditIdentity ? `
      <div class="form-grid" id="cpd-identity-edit-rows" style="display:none;margin-top:12px">
        <div class="field">
          <label>First Name</label>
          <input id="cpd-id-edit-first-name" value="${esc(r.first_name ?? '')}" />
        </div>
        <div class="field">
          <label>Last Name</label>
          <input id="cpd-id-edit-last-name" value="${esc(r.last_name ?? '')}" />
        </div>
        <div class="field">
          <label>Nationality</label>
          <select id="cpd-id-edit-nationality">
            ${nationalities.map(n => `<option value="${n.nationality_id}" ${String(n.nationality_id) === String(r.nationality_id) ? 'selected' : ''}>${esc(n.nationality)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Gender</label>
          <select id="cpd-id-edit-sex">
            <option value="Male" ${r.sex === 'Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${r.sex === 'Female' ? 'selected' : ''}>Female</option>
          </select>
        </div>
      </div>
      <div id="cpd-identity-edit-error" class="form-error hidden" style="margin-top:8px"></div>
      <div id="cpd-identity-edit-actions" style="display:none;gap:8px;margin-top:12px">
        <button class="btn btn-success btn-sm" id="btn-save-cpd-identity">
          <i class="fa-solid fa-floppy-disk"></i> Save</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-cpd-identity">
          <i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>` : ''}
    </div>

    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
      <div class="rv-extra-rows">
        ${extraRow('Passport Number', r.passport_no)}
        ${(r.extra_owner1_name || r.extra_owner1_eid || r.extra_owner1_passport) ? `
        ${extraRow('Extra Driver 1 Full Name',       r.extra_owner1_name)}
        ${extraRow('Extra Driver 1 Emirates ID',     r.extra_owner1_eid)}
        ${extraRow('Extra Driver 1 Passport Number', r.extra_owner1_passport)}` : ''}
        ${(r.extra_owner2_name || r.extra_owner2_eid || r.extra_owner2_passport) ? `
        ${extraRow('Extra Driver 2 Full Name',       r.extra_owner2_name)}
        ${extraRow('Extra Driver 2 Emirates ID',     r.extra_owner2_eid)}
        ${extraRow('Extra Driver 2 Passport Number', r.extra_owner2_passport)}` : ''}
      </div>
    </div>

    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:14px">Driving Licence Details</div>
      <div class="rv-identity-rows">
        ${identityRow('fa-solid fa-id-card',            'Licence Number', r.license_no)}
        ${identityRow('fa-regular fa-calendar-xmark',   'Licence Expiry', r.license_expiry ? formatDate(r.license_expiry) : '')}
      </div>
    </div>

    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:14px">Vehicle Details</div>
      <div class="rv-identity-rows">
        ${identityRow('fa-solid fa-hashtag',       'Vehicle Plate Number',  r.registration_no)}
        ${identityRow('fa-regular fa-file-lines',  'Traffic File Number',   r.mulkiya_no)}
        ${identityRow('fa-solid fa-car',           'Vehicle Make',          r.vehicle_make)}
        ${identityRow('fa-solid fa-car-side',      'Vehicle Model',         r.vehicle_model)}
        ${identityRow('fa-solid fa-sack-dollar',   'Vehicle Value (AED)',   r.vehicle_value ? formatCurrency(r.vehicle_value) : '')}
        ${identityRow('fa-solid fa-location-dot',  'Vehicle Registered In', r.vehicle_registered_in)}
        ${identityRow('fa-solid fa-shapes',        'Body Type',             cpdBodyTypeLabel(r.body_type))}
        ${identityRow('fa-regular fa-calendar',    'Year of Manufacture',   r.manuf_year)}
        ${identityRow('fa-solid fa-palette',       'Color as per Mulkiya',  r.color)}
        ${identityRow('fa-solid fa-weight-hanging','Net Weight (Empty Load)', r.net_weight ? r.net_weight + ' kg' : '')}
        ${identityRow('fa-solid fa-barcode',       'Chassis No',            r.chassis_no)}
        ${identityRow('fa-solid fa-gears',         'Engine No',             r.engine_no)}
        ${identityRow('fa-solid fa-gauge-high',    'Horse Power',           r.horse_power ? r.horse_power + ' HP' : '')}
        ${identityRow('fa-solid fa-layer-group',   'No of Cylinders',       r.no_of_cylinders)}
        ${identityRow('fa-solid fa-chair',         'Upholstery',            r.upholstery)}
        ${identityRow('fa-solid fa-users',         'No of Seats',           r.no_of_seats)}
        ${identityRow('fa-solid fa-radio',         'Radio',                 r.radio)}
        ${identityRow('fa-solid fa-ring',          'Spare Tyre',            r.spare_tyre)}
        ${identityRow('fa-regular fa-calendar-check', 'Mulkiya Expiry',     r.mulkiya_expiry ? formatDate(r.mulkiya_expiry) : '')}
        ${identityRow('fa-solid fa-building',      'Usage Type',            r.usage_type === 'COMPANY' ? 'Company Use' : 'Personal Use')}
        ${r.usage_type === 'COMPANY' ? identityRow('fa-solid fa-building-flag', 'Company Name', r.company_name) : ''}
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bg-base)">
        <div class="rv-extra-rows">
          ${extraRow('Additional Remarks', r.additional_remarks)}
          ${extraRow('Other Particulars / Extra Items (1)', r.others1)}
          ${extraRow('Other Particulars / Extra Items (2)', r.others2)}
          ${extraRow('Reference 1 in UAE Full Name',            r.uae_refree1)}
          ${extraRow('Reference 1 in UAE Mobile Number',        r.uae_refree1_mobile)}
          ${extraRow('Reference 2 in UAE Full Name',            r.uae_refree2)}
          ${extraRow('Reference 2 in UAE Mobile Number',        r.uae_refree2_mobile)}
          ${extraRow('Reference 1 in Destination Full Name',    r.destination_refree1)}
          ${extraRow('Reference 1 in Destination Mobile Number',r.destination_refree1_mobile)}
          ${extraRow('Reference 2 in Destination Full Name',    r.destination_refree2)}
          ${extraRow('Reference 2 in Destination Mobile Number',r.destination_refree2_mobile)}
        </div>
      </div>
    </div>

    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Delivery &amp; Payment</div>
      <div class="rv-extra-rows">
        ${extraRow('Delivery Option', r.delivery_option === 'home_delivery' ? 'Home Delivery'
            : r.delivery_option === 'pick_from_dubai_office' ? 'Collection — Dubai Office'
            : r.delivery_option === 'pick_from_abudhabi_office' ? 'Collection — Abu Dhabi Office'
            : r.delivery_option)}
        ${r.delivery_option === 'home_delivery' ? extraRow('Delivery Address', r.delivery_address) : ''}
      </div>
    </div>

    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Trip Details</div>
      <div class="rv-extra-rows">
        ${extraRow('Destination Countries', (r.countries ?? []).map(c => c.nationality).join(', '))}
      </div>
    </div>

    <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border);background:var(--bg-surface)">
      <div class="section-card-header" style="font-size:.82rem">Application Summary</div>
      <div class="section-card-body" style="padding:16px 20px">
        <div class="detail-grid">
          ${detail('Category',  r.request_category)}
          ${detail('Submitted', formatDateTime(r.requested_datetime))}
        </div>
      </div>
    </div>

    <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border);background:var(--bg-surface)">
      <div class="section-card-header" style="font-size:.82rem">
        <i class="fa-solid fa-calculator" style="color:var(--accent);margin-right:6px"></i>
        Fee Breakdown
      </div>
      <div class="section-card-body" style="padding:0">
        <table style="width:100%;border-collapse:collapse">
          <tbody>
            ${cpdFeeRow('Guarantee Fee', r.guarantee_amount)}
            ${cpdFeeRow('Processing Fee (2.5% of Guarantee Fee)', r.processing_fee)}
            ${cpdFeeRow('Booking Fee', r.booking_fee)}
            ${cpdFeeRow('Extra Fees', r.extra_fees)}
            ${cpdFeeRow('VAT (5%)', r.vat_amount)}
            ${cpdFeeRow('Total Amount', r.total_amount, true, true)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border);background:var(--bg-surface)">
      <div class="section-card-header" style="font-size:.82rem">
        <i class="fa-solid fa-wallet" style="color:var(--accent);margin-right:6px"></i>
        Payment
      </div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${detail('Payment Method',   r.method_of_payment ? r.method_of_payment.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '—')}
          ${r.order_ref_no ? detail('Payment Reference', `<span style="font-family:monospace">${r.order_ref_no}</span>`) : ''}
        </div>
        ${r.booking_fee_status == 1 ? `
        <div style="margin-top:12px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius)">
          <div style="font-size:.78rem;font-weight:700;color:var(--success,#22c55e);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
            <i class="fa-solid fa-circle-check"></i> Payment Received
          </div>
          <div class="detail-grid">
            ${detail('Paid Date', formatDateTime(r.booking_fee_paid_date))}
          </div>
        </div>` : ''}
      </div>
    </div>

    ${r.return_guarantee ? `
    <div class="section-card">
      <div class="section-card-header">Return Guarantee Details</div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${detail('Beneficiary Name', r.return_guarantee.beneficiary_name)}
          ${detail('Cheque No',        r.return_guarantee.cheque_no)}
          ${detail('Cheque Date',      formatDate(r.return_guarantee.cheque_date))}
          ${detail('Bank',             r.return_guarantee.bank)}
          ${detail('Added',            formatDateTime(r.return_guarantee.added_datetime))}
          ${r.return_guarantee.remarks ? detail('Remarks', r.return_guarantee.remarks) : ''}
        </div>
      </div>
    </div>` : ''}

    ${(r.payments ?? []).length ? `
    <div class="section-card">
      <div class="section-card-header">Payment Records</div>
      <div class="section-card-body">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:8px;color:var(--text-muted)">Type</th>
            <th style="text-align:left;padding:8px;color:var(--text-muted)">Reference</th>
            <th style="text-align:left;padding:8px;color:var(--text-muted)">Bank</th>
            <th style="text-align:left;padding:8px;color:var(--text-muted)">Date</th>
          </tr></thead>
          <tbody>${(r.payments ?? []).map(p => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px">${p.guarantee_type}</td>
            <td style="padding:8px">${p.cheque_no || '—'}</td>
            <td style="padding:8px">${p.bank || '—'}</td>
            <td style="padding:8px">${formatDateTime(p.added_datetime)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${docs && docs.length ? `
    <div class="rv-section" style="margin-top:16px">
      <div class="rv-section-title">Documents Attached</div>
      <div class="rv-docs-grid">
        ${docs.map(cpdDocThumb).join('')}
      </div>
    </div>` : ''}

    ${r.issued_carnet ? `
    <div class="section-card" style="margin-top:16px;border:1px solid rgba(34,197,94,.3)">
      <div class="section-card-header" style="background:rgba(34,197,94,.12)">
        <i class="fa-solid fa-clipboard-check" style="margin-right:6px;color:var(--success,#22c55e)"></i>
        Issued Carnet
      </div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${detail('Carnet No',    `<strong>${r.issued_carnet.carnet_no}</strong>`)}
          ${detail('Issued Date',  formatDateTime(r.issued_carnet.issued_datetime))}
          ${detail('Issued By',    r.issued_carnet.issued_by_name)}
        </div>
      </div>
    </div>` : ''}

    ${r.carnet_return ? (() => {
      const cr = r.carnet_return;
      const deliveryLabel  = cr.delivery_method === 'ARAMAX' ? 'Return via Aramex' : 'Return to Office';
      const paymentLabel   = { BANK_DEPOSIT: 'Online Transfer', CHEQUE_DEPOSIT: 'Cheque Deposit', COLLECT_CHEQUE: 'Cheque Collect from Office' }[cr.return_payment_method] ?? cr.return_payment_method;
      const payStatus      = cr.order_status == 1
        ? '<span class="badge badge-success">Paid</span>'
        : cr.delivery_method === 'ARAMAX'
          ? '<span class="badge badge-warning">Pending Payment</span>'
          : '<span class="badge badge-info">Processing</span>';
      const bankInfo = cr.cus_bank_information ? (() => {
        try { return JSON.parse(cr.cus_bank_information); } catch { return null; }
      })() : null;
      return `
      <div class="section-card" style="margin-top:16px;border:1px solid rgba(234,179,8,.3)">
        <div class="section-card-header" style="background:rgba(234,179,8,.08)">
          <i class="fa-solid fa-rotate-left" style="margin-right:6px;color:var(--warning,#ca8a04)"></i>
          Return Request
        </div>
        <div class="section-card-body">
          <div class="detail-grid">
            ${detail('Submitted By',    `${cr.submitted_by_first ?? ''} ${cr.submitted_by_last ?? ''}`.trim() || '—')}
            ${detail('Submitted Date',  formatDateTime(cr.added_datetime))}
            ${detail('Delivery Method', deliveryLabel)}
            ${detail('Payment Option',  paymentLabel)}
            ${detail('Payment Status',  payStatus)}
            ${cr.delivery_fee ? detail('Delivery Fee', formatCurrency(cr.delivery_fee)) : ''}
            ${cr.order_ref    ? detail('Order Ref',    cr.order_ref)                    : ''}
            ${cr.confirmed_datetime ? detail('Confirmed Date', formatDateTime(cr.confirmed_datetime)) : ''}
            ${cr.remarks      ? detail('Remarks',      cr.remarks)                      : ''}
          </div>
          ${bankInfo ? `
          <div style="margin-top:12px;padding:12px;background:var(--bg-elevated);border-radius:var(--radius);border:1px solid var(--border)">
            <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase">Bank Details</div>
            <div class="detail-grid">
              ${bankInfo.bank_name    ? detail('Bank Name',    bankInfo.bank_name)    : ''}
              ${bankInfo.account_no   ? detail('Account No',   bankInfo.account_no)   : ''}
              ${bankInfo.iban         ? detail('IBAN',         bankInfo.iban)         : ''}
              ${bankInfo.beneficiary  ? detail('Beneficiary',  bankInfo.beneficiary)  : ''}
            </div>
          </div>` : ''}
          ${cr.deposit_slip_path ? `
          <div style="margin-top:12px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--success,#22c55e);text-transform:uppercase;letter-spacing:.05em">
                <i class="fa-solid fa-circle-check"></i> Deposit Slip Uploaded
              </div>
              <div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">${formatDateTime(cr.deposit_slip_uploaded_datetime)}</div>
            </div>
            <a class="btn btn-ghost btn-sm" href="${api.cpd.depositSlipUrl(cr.return_id)}" target="_blank" rel="noopener">
              <i class="fa-solid fa-file-arrow-down"></i> View
            </a>
          </div>` : cr.confirmed_by ? `
          <div style="margin-top:12px">
            <button class="btn btn-primary btn-sm" id="upload-deposit-slip-btn" data-return-id="${cr.return_id}">
              <i class="fa-solid fa-upload"></i> Upload Deposit Slip
            </button>
          </div>` : ''}
        </div>
      </div>

      ${returnId && !cr.confirmed_by ? (() => {
        const issuedDatetime = r.issued_carnet?.issued_datetime ?? null;
        const isLate = issuedDatetime ? (new Date(issuedDatetime).getTime() + 364 * 86400000 < Date.now()) : false;
        const guaranteeAmount = Number(r.guarantee_amount ?? 0);
        const existingFine = Number(cr.penalty_amount ?? 0);
        return `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-header">Guarantee Return</div>
        <div class="section-card-body">
          <div class="detail-grid">
            ${detail('Original Guarantee Amount', formatCurrency(guaranteeAmount))}
            ${detail('Return Timing', isLate
              ? '<span class="badge badge-danger">After Expiry — late charges may apply</span>'
              : '<span class="badge badge-success">Before Expiry</span>')}
          </div>
          <div class="form-grid" style="margin-top:12px">
            <div class="field">
              <label>Fine (AED) — leave blank if none</label>
              <input type="number" step="0.01" min="0" id="cpd-return-fine" value="${existingFine || ''}" placeholder="0.00" />
            </div>
            <div class="field">
              <label>Return Amount (AED)</label>
              <input type="text" id="cpd-return-amount-display" readonly
                style="background:var(--bg-elevated);cursor:default;font-weight:600"
                value="${formatCurrency(guaranteeAmount - existingFine)}" />
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
            <button class="btn btn-ghost btn-sm" id="btn-save-return-fine" data-return-id="${cr.return_id}">
              <i class="fa-solid fa-floppy-disk"></i> Save Fine &amp; Return Amount</button>
          </div>
          ${['CHEQUE_DEPOSIT', 'COLLECT_CHEQUE'].includes(cr.return_payment_method) ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:8px">
              ${existingCheque ? 'Cheque details captured' : 'Cheque details not yet captured'} for this return.
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-cheque-details" data-id="${id}"
              data-default-beneficiary="${esc(`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim())}">
              <i class="fa-solid fa-money-check"></i> ${existingCheque ? 'Edit' : 'Enter'} Cheque Details</button>
          </div>` : ''}
        </div>
      </div>
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-body">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="cpd-docs-acknowledged" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer" />
            <span>I confirm all documents for this return have been received</span>
          </label>
        </div>
      </div>
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-header">Add Note / Attachment</div>
        <div class="section-card-body">
          <div class="field">
            <label>Comment</label>
            <textarea id="cpd-return-note-comment" rows="3" style="width:100%;resize:vertical" placeholder="Add a note about this return…"></textarea>
          </div>
          <div class="field">
            <label>Attachments <span style="color:var(--text-muted);font-weight:400">(Optional — JPG, PNG or PDF)</span></label>
            <input type="file" id="cpd-return-note-files" accept=".jpg,.jpeg,.png,.pdf" multiple />
          </div>
          <div id="cpd-return-note-error" class="form-error hidden" style="margin-top:8px"></div>
          <button class="btn btn-ghost btn-sm" id="btn-add-return-note" data-return-id="${cr.return_id}" style="margin-top:8px">
            <i class="fa-solid fa-paperclip"></i> Add Note</button>
        </div>
      </div>`;
      })() : ''}`;
    })() : ''}

    ${cancelReq && Number(cancelReq.cancelled_approved) === 0 ? (() => {
      const original = Number(cancelReq.original_amount ?? 0);
      return `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-header">Cancellation Request</div>
        <div class="section-card-body">
          <div class="detail-grid">
            ${detail('Requested By', cancelReq.cancelled_by ?? '—')}
            ${detail('Requested On', formatDateTime(cancelReq.cancelled_datetime))}
            ${detail('Reason', cancelReq.remarks ?? '—')}
            ${detail('Original Receipt Amount', formatCurrency(original))}
          </div>
          ${(cancelFiles ?? []).length ? `
          <div style="margin-top:12px">
            <div style="font-weight:600;margin-bottom:6px">Attachments</div>
            ${cancelFiles.map(f => `
              <div><a href="${api.cpd.cancelAttachmentUrl(id, f.file)}" target="_blank" rel="noopener">
                <i class="fa-solid fa-paperclip"></i> ${f.label} — ${f.file.split('/').pop()}</a></div>`).join('')}
          </div>` : ''}
          ${isCpdFinance ? `
          <div class="form-grid" style="margin-top:12px">
            <div class="field">
              <label>Refund Amount (AED)</label>
              <input type="number" step="0.01" min="0" max="${original}" id="cpd-cancel-refund" value="${original.toFixed(2)}" />
            </div>
            <div class="field">
              <label>Charge Amount (AED)</label>
              <input type="text" id="cpd-cancel-charge-display" readonly
                style="background:var(--bg-elevated);cursor:default;font-weight:600" value="${formatCurrency(0)}" />
            </div>
          </div>
          <div style="margin-top:12px">
            <label>Comment <span style="color:var(--text-muted);font-weight:400">(required to reject, optional to approve)</span></label>
            <textarea id="cpd-cancel-comment" rows="3" style="width:100%;resize:vertical" placeholder="Add a comment…"></textarea>
          </div>
          <div class="field" style="margin-top:8px">
            <label>Attachments <span style="color:var(--text-muted);font-weight:400">(Optional — JPG, PNG or PDF)</span></label>
            <input type="file" id="cpd-cancel-note-files" accept=".jpg,.jpeg,.png,.pdf" multiple />
          </div>
          <div id="cpd-cancel-error" class="form-error hidden" style="margin-top:8px"></div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-success btn-sm" id="btn-approve-cancel" data-id="${id}">
              <i class="fa-solid fa-check"></i> Approve Cancellation</button>
            <button class="btn btn-danger btn-sm" id="btn-reject-cancel" data-id="${id}">
              <i class="fa-solid fa-xmark"></i> Reject</button>
          </div>` : `
          <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">
            <i class="fa-solid fa-clock"></i> Awaiting cpd_finance approval.
          </div>`}
        </div>
      </div>`;
    })() : ''}

    ${Number(r.security_cheque_required) === 1 ? `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-header">Security Cheque</div>
        <div class="section-card-body">
          <div class="detail-grid">
            ${detail('Collection Method', r.security_cheque_delivery_method === 'OFFICE' ? 'Drop off at EMSO office' : 'Aramex Courier')}
            ${r.security_cheque_airway_bill ? detail('Airway Bill / Reference No', r.security_cheque_airway_bill) : ''}
          </div>
          ${r.security_cheque_received_datetime ? `
          <div style="margin-top:12px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius)">
            <div style="font-size:.78rem;font-weight:700;color:var(--success,#22c55e);text-transform:uppercase;letter-spacing:.05em">
              <i class="fa-solid fa-circle-check"></i> Cheque Received
            </div>
            <div class="detail-grid" style="margin-top:8px">
              ${detail('Cheque No', r.security_cheque_no)}
              ${detail('Received On', formatDateTime(r.security_cheque_received_datetime))}
            </div>
            ${r.security_cheque_scan_path ? `<a class="btn btn-ghost btn-sm" href="${api.cpd.securityChequeScanUrl(id)}" target="_blank" rel="noopener" style="margin-top:8px"><i class="fa-solid fa-file-arrow-down"></i> View Scan</a>` : ''}
          </div>` : `
          <div style="margin-top:12px" class="form-grid">
            <div class="field"><label>Cheque Number</label><input type="text" id="security-cheque-no" placeholder="Cheque number" /></div>
            <div class="field"><label>Scan Copy <span style="color:var(--text-muted);font-weight:400">(JPG, PNG or PDF)</span></label>
              <input type="file" id="security-cheque-scan" accept=".jpg,.jpeg,.png,.pdf" /></div>
          </div>
          <div id="security-cheque-error" class="form-error hidden" style="margin-top:8px"></div>
          <button class="btn btn-primary btn-sm" id="btn-save-security-cheque" data-id="${id}" style="margin-top:8px">
            <i class="fa-solid fa-floppy-disk"></i> Record Cheque Receipt</button>`}
          ${returnId ? `
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:8px">
              Security cheque return delivery ${r.security_cheque_return_airway_bill ? `— Airway Bill: <strong>${r.security_cheque_return_airway_bill}</strong>` : 'not yet dispatched'}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="security-cheque-return-awb" placeholder="Airway bill number" value="${r.security_cheque_return_airway_bill ?? ''}" style="max-width:220px" />
              <button class="btn btn-ghost btn-sm" id="btn-save-security-cheque-return" data-id="${id}">
                <i class="fa-solid fa-truck"></i> Save</button>
            </div>
          </div>` : ''}
        </div>
      </div>` : ''}

    ${currentUser?.role_name === 'idl_cpd_cashier' ? `
    <div class="section-card" style="margin-top:16px" id="cpd-payment-section">
      <div class="section-card-header">Payment</div>
      <div class="section-card-body">
        <div class="detail-grid" style="margin-bottom:16px">
          ${detail('Booking Fee',  formatCurrency(r.booking_fee))}
          ${detail('Extra Fees',   formatCurrency(r.extra_fees))}
          ${detail('VAT',          formatCurrency(r.vat_amount))}
          ${detail('Total Amount', `<strong style="color:var(--accent)">${formatCurrency(r.total_amount)}</strong>`)}
          ${detail('Payment Status', r.booking_fee_status == 1
            ? '<span class="badge badge-success">Paid</span>'
            : '<span class="badge badge-warning">Unpaid</span>')}
        </div>
        ${r.booking_fee_status != 1 ? `
        <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div class="field" style="min-width:200px;margin:0">
            <label>Payment Method <span style="color:var(--accent)">*</span></label>
            <select id="cpd-payment-method">
              <option value="">— Select —</option>
              <option value="CASH">Cash</option>
              <option value="CREDIT_CARD">Credit Card</option>
            </select>
          </div>
          <button class="btn btn-success" id="cpd-pay-btn">
            <i class="fa-solid fa-circle-check"></i> Save Payment
          </button>
        </div>` : `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="color:var(--success,#22c55e);font-weight:600;font-size:.9rem">
            <i class="fa-solid fa-circle-check"></i>
            Payment recorded — ${r.method_of_payment ?? ''}
          </div>
          <button class="btn btn-info btn-sm" id="cpd-print-receipt-btn" data-id="${id}">
            <i class="fa-solid fa-print"></i> Print Receipt</button>
        </div>`}
      </div>
    </div>` : ''}

    ${cancelReq && Number(cancelReq.cancelled_approved) !== 0 && (cancelFiles ?? []).length ? `
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-header">Cancellation Attachments</div>
      <div class="section-card-body">
        ${cancelFiles.map(f => `
          <div><a href="${api.cpd.cancelAttachmentUrl(id, f.file)}" target="_blank" rel="noopener">
            <i class="fa-solid fa-paperclip"></i> ${f.label} — ${f.file.split('/').pop()}</a></div>`).join('')}
      </div>
    </div>` : ''}

    ${createReturn ? `
    <div class="section-card" style="margin-top:16px" id="cpd-return-note-section">
      <div class="section-card-header">Return Note</div>
      <div class="section-card-body">
        <div class="field" style="margin:0 0 1rem">
          <textarea id="cpd-return-note" rows="4" style="width:100%;resize:vertical"
            placeholder="Enter return remarks / notes…"></textarea>
        </div>
        <div class="field" style="margin:0 0 1rem">
          <label>Attachments <span style="color:var(--text-muted);font-weight:400">(Optional — JPG, PNG or PDF, multiple allowed)</span></label>
          <input type="file" id="cpd-return-note-create-files" accept=".jpg,.jpeg,.png,.pdf" multiple />
        </div>
        <div id="cpd-return-note-error" class="form-error hidden"></div>
        <button class="btn btn-warning" id="cpd-return-note-save">
          <i class="fa-solid fa-floppy-disk"></i> Save
        </button>
      </div>
    </div>` : ''}

    <div class="detail-footer" style="margin-top:16px">${actionsHtml}</div>

    <!-- Lightbox -->
    <div id="cpd-lightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);
      z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px">
      <button id="cpd-lightbox-close" style="position:absolute;top:16px;right:20px;background:none;
        border:none;color:#fff;font-size:1.8rem;cursor:pointer;line-height:1">&times;</button>
      <img id="cpd-lightbox-img" src="" alt=""
        style="max-width:92vw;max-height:86vh;object-fit:contain;border-radius:6px;box-shadow:0 4px 40px rgba(0,0,0,.5)" />
      <span id="cpd-lightbox-label"
        style="color:rgba(255,255,255,.7);font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em"></span>
    </div>`;

  // Bind to freshly-rendered containers to avoid listener accumulation
  content.querySelector('.detail-footer').addEventListener('click', handleCPDAction);
  content.querySelector('.page-actions').addEventListener('click',  handleCPDAction);

  if (canEditIdentity) {
    const viewRows    = document.getElementById('cpd-identity-view-rows');
    const editRows    = document.getElementById('cpd-identity-edit-rows');
    const editActions = document.getElementById('cpd-identity-edit-actions');
    const editBtn     = document.getElementById('btn-edit-cpd-identity');

    editBtn.addEventListener('click', () => {
      viewRows.style.display    = 'none';
      editRows.style.display    = '';
      editActions.style.display = 'flex';
      editBtn.style.display     = 'none';
    });

    document.getElementById('btn-cancel-cpd-identity').addEventListener('click', () => renderCPDDetail(param));

    document.getElementById('btn-save-cpd-identity').addEventListener('click', async () => {
      const errEl   = document.getElementById('cpd-identity-edit-error');
      const saveBtn = document.getElementById('btn-save-cpd-identity');
      errEl.classList.add('hidden');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      try {
        await api.put(`/cpd/requests/${id}`, {
          first_name:  document.getElementById('cpd-id-edit-first-name').value.trim(),
          last_name:   document.getElementById('cpd-id-edit-last-name').value.trim(),
          nationality: document.getElementById('cpd-id-edit-nationality').value,
          sex:         document.getElementById('cpd-id-edit-sex').value,
        });
        toast('Applicant information updated', 'success');
        renderCPDDetail(param);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
      }
    });
  }

  // Return Note save (createReturn context)
  const returnNoteSave = document.getElementById('cpd-return-note-save');
  if (returnNoteSave) {
    returnNoteSave.addEventListener('click', async () => {
      const remarks = document.getElementById('cpd-return-note').value.trim();
      const errEl   = document.getElementById('cpd-return-note-error');
      if (!remarks) {
        errEl.textContent = 'Please enter a return note.';
        errEl.classList.remove('hidden');
        return;
      }
      errEl.classList.add('hidden');
      returnNoteSave.disabled = true;
      returnNoteSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      try {
        const res = await api.cpd.officerReturn(id, {
          remarks,
          delivery_option: 'DELIVER_BY_HAND',
          payment_option:  'COLLECT_CHEQUE',
        });
        // Attachments reuse the same addReturnNote() endpoint the post-creation
        // "Add Note / Attachment" section uses — officerReturn() itself only stores
        // a single plain remarks string, with no file support.
        const files = document.getElementById('cpd-return-note-create-files')?.files;
        if (files?.length) {
          const fd = new FormData();
          fd.append('comment', '');
          [...files].forEach(f => fd.append('documents[]', f));
          try {
            const noteRes = await api.cpd.addReturnNote(res.return_id, fd);
            if (noteRes.errors?.length) toast(noteRes.errors.join('; '), 'error');
          } catch (noteErr) {
            toast('Return created, but attachments failed: ' + noteErr.message, 'error');
          }
        }
        toast('Return request created successfully', 'success');
        navigate('cpd-return-requests');
      } catch (e) {
        errEl.textContent = e.message || 'Failed to save return.';
        errEl.classList.remove('hidden');
        returnNoteSave.disabled = false;
        returnNoteSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
      }
    });
  }

  // Return request approve button — rendered twice (top + bottom action bars share
  // the same actionsHtml), so bind every match, not just the first (getElementById
  // would only ever wire up the top copy, leaving the bottom one inert).
  document.querySelectorAll('#return-approve-btn').forEach(returnApproveBtn => {
    returnApproveBtn.addEventListener('click', async () => {
      document.querySelectorAll('#return-approve-btn').forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      });
      try {
        await api.cpd.approveReturnRequest(returnApproveBtn.dataset.returnId);
        toast('Return request approved', 'success');
        navigate('cpd-return-requests');
      } catch (e) {
        toast(e.message || 'Approval failed', 'error');
        document.querySelectorAll('#return-approve-btn').forEach(btn => {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Approve';
        });
      }
    });
  });

  // Guarantee Return — acknowledgment checkbox gates Approve; fine recalculates the
  // displayed return amount live and can be saved independently of approving.
  const ackCheckbox = document.getElementById('cpd-docs-acknowledged');
  if (ackCheckbox) {
    ackCheckbox.addEventListener('change', () => {
      document.querySelectorAll('#return-approve-btn').forEach(btn => { btn.disabled = !ackCheckbox.checked; });
    });
  }
  const fineInput = document.getElementById('cpd-return-fine');
  if (fineInput) {
    fineInput.addEventListener('input', () => {
      const guaranteeAmount = Number(r.guarantee_amount ?? 0);
      const fine = Number(fineInput.value) || 0;
      document.getElementById('cpd-return-amount-display').value = formatCurrency(guaranteeAmount - fine);
    });
  }
  document.getElementById('btn-cheque-details')?.addEventListener('click', e => {
    openReturnChequeModal(e.currentTarget.dataset.id, e.currentTarget.dataset.defaultBeneficiary, () => renderCPDDetail(param));
  });

  document.getElementById('btn-add-return-note')?.addEventListener('click', async e => {
    const btn     = e.currentTarget;
    const errEl   = document.getElementById('cpd-return-note-error');
    const comment = document.getElementById('cpd-return-note-comment').value.trim();
    const files   = document.getElementById('cpd-return-note-files').files;
    errEl.classList.add('hidden');
    if (!comment && !files.length) {
      errEl.textContent = 'Add a comment or attach at least one file';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      const fd = new FormData();
      fd.append('comment', comment);
      [...files].forEach(f => fd.append('documents[]', f));
      const res = await api.cpd.addReturnNote(btn.dataset.returnId, fd);
      if (res.errors?.length) toast(res.errors.join('; '), 'error');
      toast('Note added', 'success');
      document.getElementById('cpd-return-note-comment').value = '';
      document.getElementById('cpd-return-note-files').value = '';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paperclip"></i> Add Note';
    }
  });

  document.getElementById('btn-save-return-fine')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const fine = Number(document.getElementById('cpd-return-fine').value) || 0;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      await api.cpd.saveReturnFine(btn.dataset.returnId, { penalty_amount: fine });
      toast('Fine and return amount saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Fine &amp; Return Amount';
    }
  });

  // Cancellation Request — refund input recalculates the displayed charge amount live.
  const cancelRefundInput = document.getElementById('cpd-cancel-refund');
  if (cancelRefundInput) {
    const recalcCharge = () => {
      const original = Number(cancelReq?.original_amount ?? 0);
      const refund = Number(cancelRefundInput.value) || 0;
      document.getElementById('cpd-cancel-charge-display').value = formatCurrency(Math.max(original - refund, 0));
    };
    cancelRefundInput.addEventListener('input', recalcCharge);
    recalcCharge();
  }

  document.getElementById('btn-approve-cancel')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const errEl = document.getElementById('cpd-cancel-error');
    errEl.classList.add('hidden');
    const refund = Number(document.getElementById('cpd-cancel-refund').value);
    if (isNaN(refund) || refund < 0) {
      errEl.textContent = 'Enter a valid refund amount';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Approving…';
    try {
      await maybeAddCancelNote(id);
      await api.cpd.approveCancelRequest(id, { refund_amount: refund });
      toast('Cancellation approved', 'success');
      renderCPDDetail(param);
    } catch (err) {
      errEl.textContent = err.message || 'Approval failed';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Approve Cancellation';
    }
  });

  document.getElementById('btn-reject-cancel')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const errEl = document.getElementById('cpd-cancel-error');
    errEl.classList.add('hidden');
    const comment = document.getElementById('cpd-cancel-comment').value.trim();
    if (!comment) {
      errEl.textContent = 'A comment is required to reject a cancellation request';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rejecting…';
    try {
      await maybeAddCancelNote(id);
      await api.cpd.rejectCancelRequest(id, { comment });
      toast('Cancellation request rejected', 'info');
      renderCPDDetail(param);
    } catch (err) {
      errEl.textContent = err.message || 'Rejection failed';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject';
    }
  });

  async function maybeAddCancelNote(requestId) {
    const commentEl = document.getElementById('cpd-cancel-comment');
    const filesEl = document.getElementById('cpd-cancel-note-files');
    const comment = commentEl?.value.trim();
    const files = filesEl?.files;
    if (!comment && !files?.length) return;
    const fd = new FormData();
    fd.append('comment', comment ?? '');
    [...(files ?? [])].forEach(f => fd.append('documents[]', f));
    await api.cpd.addCancelNote(requestId, fd);
  }

  // Security Cheque — record receipt (cheque no + scan) and, during a return, the
  // Aramex airway bill for delivering it back to the customer.
  document.getElementById('btn-save-security-cheque')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const errEl = document.getElementById('security-cheque-error');
    errEl.classList.add('hidden');
    const chequeNo = document.getElementById('security-cheque-no').value.trim();
    if (!chequeNo) {
      errEl.textContent = 'Enter the cheque number';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      const fd = new FormData();
      fd.append('cheque_no', chequeNo);
      const scanFile = document.getElementById('security-cheque-scan').files[0];
      if (scanFile) fd.append('scan', scanFile);
      await api.cpd.updateSecurityCheque(btn.dataset.id, fd);
      toast('Security cheque receipt recorded', 'success');
      renderCPDDetail(param);
    } catch (err) {
      errEl.textContent = err.message || 'Failed to save';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Record Cheque Receipt';
    }
  });

  document.getElementById('btn-save-security-cheque-return')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const awb = document.getElementById('security-cheque-return-awb').value.trim();
    if (!awb) return toast('Enter the airway bill number', 'error');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await api.cpd.updateSecurityChequeReturn(btn.dataset.id, { airway_bill: awb });
      toast('Airway bill saved', 'success');
      renderCPDDetail(param);
    } catch (err) {
      toast(err.message || 'Failed to save', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-truck"></i> Save';
    }
  });

  // Upload Deposit Slip — closes off an approved return
  document.getElementById('upload-deposit-slip-btn')?.addEventListener('click', () => {
    const returnId = document.getElementById('upload-deposit-slip-btn').dataset.returnId;
    openModal({
      title: 'Upload Deposit Slip',
      body: `
        <div class="field">
          <label>Deposit Slip File *</label>
          <input type="file" id="deposit-slip-file" accept=".jpg,.jpeg,.png,.pdf" />
          <p style="font-size:.78rem;color:var(--text-muted);margin-top:6px">JPG, PNG or PDF · max 2 MB</p>
        </div>
        <div class="field">
          <label>Transfer / Reference Number <span style="color:var(--text-muted);font-weight:400">(Optional)</span></label>
          <input type="text" id="deposit-slip-ref" placeholder="e.g. bank transfer reference" />
        </div>
        <div id="deposit-slip-error" class="form-error hidden"></div>`,
      footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
                 <i class="fa-solid fa-xmark"></i> Cancel
               </button>
               <button class="btn btn-primary" id="confirm-deposit-slip">
                 <i class="fa-solid fa-upload"></i> Upload
               </button>`,
    });
    document.getElementById('confirm-deposit-slip').onclick = async () => {
      const fileInput = document.getElementById('deposit-slip-file');
      const errEl     = document.getElementById('deposit-slip-error');
      const file      = fileInput.files[0];
      if (!file) {
        errEl.textContent = 'Please select a file';
        errEl.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('confirm-deposit-slip');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
      try {
        const fd = new FormData();
        fd.append('deposit_slip', file);
        const refNo = document.getElementById('deposit-slip-ref').value.trim();
        if (refNo) fd.append('reference_number', refNo);
        await api.cpd.uploadDepositSlip(returnId, fd);
        closeModal();
        toast('Deposit slip uploaded', 'success');
        renderCPDDetail(param);
      } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload';
        errEl.textContent = e.message || 'Upload failed';
        errEl.classList.remove('hidden');
      }
    };
  });

  // Lightbox — open on doc thumbnail click
  const lightbox      = document.getElementById('cpd-lightbox');
  const lightboxImg   = document.getElementById('cpd-lightbox-img');
  const lightboxLabel = document.getElementById('cpd-lightbox-label');
  const lightboxClose = document.getElementById('cpd-lightbox-close');

  content.querySelectorAll('[data-lightbox]').forEach(el => {
    el.addEventListener('click', () => {
      lightboxImg.src          = el.dataset.lightbox;
      lightboxLabel.textContent = el.dataset.label ?? '';
      lightbox.style.display   = 'flex';
    });
  });

  if (lightboxClose) lightboxClose.addEventListener('click', () => { lightbox.style.display = 'none'; });
  if (lightbox)      lightbox.addEventListener('click', e => { if (e.target === lightbox) lightbox.style.display = 'none'; });

  // Cashier payment button
  const payBtn = document.getElementById('cpd-pay-btn');
  if (payBtn) {
    payBtn.addEventListener('click', async () => {
      const method = document.getElementById('cpd-payment-method').value;
      if (!method) return toast('Select a payment method', 'error');
      payBtn.disabled = true;
      payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      try {
        await api.cpd.pay(id, { method_of_payment: method });
        toast('Payment recorded successfully', 'success');
        renderCPDDetail(id);
      } catch (e) {
        toast(e.message || 'Failed to save payment', 'error');
        payBtn.disabled = false;
        payBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Save Payment';
      }
    });
  }

  document.getElementById('cpd-print-receipt-btn')?.addEventListener('click', () => handleCPDPrintReceipt(id, r));

  function handleCPDAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'back')          (returnId || createReturn) ? navigate('cpd-return-requests') : navigate('cpd-requests');
    if (action === 'approve')       cpdApprove(id);
    if (action === 'reject')        cpdReject(id);
    if (action === 'issue-carnet')  cpdIssueCarnet(id);
    if (action === 'cancel')        cpdCancel(id);
    if (action === 'print-carnet')  window.open(api.cpd.printCarnetUrl(id), '_blank');
    if (action === 'print-awb')     cpdPrintAWB(id);
    if (action === 'dispatch')      cpdMarkDispatched(id, param);
    if (action === 'create-return') cpdOfficerCreateReturn(id);
    if (action === 'branch-approve') cpdBranchApprove(id);
    if (action === 'branch-reject')  cpdBranchReject(id);
  }
}

// Cashier "Print Receipt" — same receipt format/print mechanism as IDLController's
// (idl.js's handlePrintReceipt), adapted for CPD's request/amount fields.
async function handleCPDPrintReceipt(id, r) {
  try {
    // If a receipt already exists for this request, this is a reprint — fetch it
    // instead of creating a new one, and mark the printout as a copy.
    let rec, isReprint;
    try {
      rec = await api.cpd.getReceipt(id);
      isReprint = true;
    } catch {
      rec = await api.cpd.createReceipt(id);
      isReprint = false;
    }

    // Compute amounts: total = fees + 5% VAT; base fee = total / 1.05
    const total    = parseFloat(r.total_amount ?? 0);
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
    Amount in words : &nbsp;&nbsp; ${cpdAmountToWords(total).toUpperCase()}
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

// Same word-conversion idea as idl.js's amountToWords, extended with thousand/
// million groups — CPD guarantee amounts routinely run into the tens of
// thousands, unlike IDL's small flat fees (that version only covers up to 999.99).
function cpdAmountToWords(amount) {
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
  function wholeNumber(n) {
    if (n === 0) return 'ZERO';
    const millions  = Math.floor(n / 1000000);
    const thousands = Math.floor((n % 1000000) / 1000);
    const rest      = n % 1000;
    let out = '';
    if (millions)  out += threeDigits(millions) + ' MILLION ';
    if (thousands) out += threeDigits(thousands) + ' THOUSAND ';
    if (rest || !out) out += threeDigits(rest);
    return out.trim();
  }

  const intPart  = Math.floor(amount);
  const fracPart = Math.round((amount - intPart) * 100);
  let   words    = wholeNumber(intPart);
  if (fracPart > 0) words += ' POINT ' + twoDigits(fracPart);
  return words || 'ZERO';
}

async function cpdReject(id) {
  openModal({
    title: 'Send for Corrections',
    body: `
      <div class="field">
        <label>Comment / Correction Required <span style="color:var(--accent)">*</span></label>
        <textarea id="reject-comment" rows="5"
          placeholder="Describe what needs to be corrected by the customer…"
          style="width:100%;resize:vertical"></textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-arrow-left"></i> Back
             </button>
             <button class="btn btn-warning" id="confirm-reject">
               <i class="fa-solid fa-rotate-left"></i> Send for Corrections
             </button>`,
  });
  document.getElementById('confirm-reject').onclick = async () => {
    const comment = document.getElementById('reject-comment').value.trim();
    if (!comment) return toast('Please enter a comment', 'error');
    try {
      await api.cpd.reject(id, { comment });
      closeModal();
      toast('Request sent for corrections', 'warning');
      renderCPDDetail(id);
    } catch (e) {
      toast('Failed to update request', 'error');
    }
  };
}

async function cpdApprove(id) {
  confirm('Approve this CPD request?', async () => {
    const res = await api.cpd.approve(id);
    toast(res.message || 'Request approved', 'success');
    renderCPDDetail(id);
  }, false);
}

async function cpdBranchApprove(id) {
  confirm('Approve this Special CPD request and forward it to the Cashier?', async () => {
    await api.cpd.branchApprove(id);
    toast('Request approved and forwarded to the Cashier', 'success');
    renderCPDDetail(id);
  }, false);
}

async function cpdBranchReject(id) {
  openModal({
    title: 'Send Back to CS',
    body: `
      <div class="field">
        <label>Comment <span style="color:var(--accent)">*</span></label>
        <textarea id="branch-reject-comment" rows="5"
          placeholder="Describe what needs to be corrected before resubmitting for branch approval…"
          style="width:100%;resize:vertical"></textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-arrow-left"></i> Back
             </button>
             <button class="btn btn-warning" id="confirm-branch-reject">
               <i class="fa-solid fa-rotate-left"></i> Send Back to CS
             </button>`,
  });
  document.getElementById('confirm-branch-reject').onclick = async () => {
    const comment = document.getElementById('branch-reject-comment').value.trim();
    if (!comment) return toast('Please enter a comment', 'error');
    try {
      await api.cpd.branchReject(id, { comment });
      closeModal();
      toast('Request sent back to CS', 'warning');
      renderCPDDetail(id);
    } catch (e) {
      toast(e.message || 'Failed to update request', 'error');
    }
  };
}

async function cpdIssueCarnet(id) {
  let sortCol = 'carnet_no';
  let sortDir = 'ASC';
  let searchTerm = '';

  const renderTable = async () => {
    const tbody = document.getElementById('carnet-grid-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">
      <i class="fa-solid fa-spinner fa-spin"></i> Loading…</td></tr>`;
    try {
      const results = await api.cpd.carnets({
        status: 'available', carnet_no: searchTerm, sort: sortCol, dir: sortDir,
      });
      if (!results.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No available carnets found</td></tr>';
        return;
      }
      tbody.innerHTML = results.map(c => `
        <tr>
          <td>${c.carnet_no}</td>
          <td>${c.carnet_type ?? '—'}</td>
          <td>${c.location ?? '—'}</td>
          <td>
            <button class="btn btn-primary btn-sm select-carnet-btn" data-carnet="${c.carnet_no}">
              <i class="fa-solid fa-circle-check"></i> Select
            </button>
          </td>
        </tr>`).join('');
      bindSelectBtns();
      updateSortIndicators();
    } catch {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty" style="color:var(--danger)">Error loading carnets</td></tr>';
    }
  };

  const updateSortIndicators = () => {
    document.querySelectorAll('#carnet-modal-table th[data-col]').forEach(th => {
      const icon = th.querySelector('.sort-icon');
      if (!icon) return;
      if (th.dataset.col === sortCol) {
        icon.className = `sort-icon fa-solid ${sortDir === 'ASC' ? 'fa-sort-up' : 'fa-sort-down'}`;
        icon.style.color = 'var(--accent)';
      } else {
        icon.className = 'sort-icon fa-solid fa-sort';
        icon.style.color = 'var(--text-muted)';
      }
    });
  };

  const bindSelectBtns = () => {
    document.querySelectorAll('.select-carnet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const carnetNo = btn.dataset.carnet;
        const tr       = btn.closest('tr');

        // Remove any existing inline confirmation
        document.querySelectorAll('.carnet-confirm-row').forEach(r => r.remove());
        document.querySelectorAll('.select-carnet-btn').forEach(b => { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-circle-check"></i> Select'; });

        // Insert confirmation row directly after this row
        const confirmTr = document.createElement('tr');
        confirmTr.className = 'carnet-confirm-row';
        confirmTr.style.cssText = 'background:var(--bg-elevated)';
        confirmTr.innerHTML = `
          <td colspan="4" style="padding:10px 12px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span style="font-size:.88rem;color:var(--text-primary)">
                <i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i>
                Confirm issue carnet <strong>${carnetNo}</strong> to this request?
              </span>
              <button class="btn btn-success btn-sm" id="confirm-issue-yes">
                <i class="fa-solid fa-check"></i> Yes, Issue
              </button>
              <button class="btn btn-ghost btn-sm" id="confirm-issue-no">
                <i class="fa-solid fa-xmark"></i> Cancel
              </button>
            </div>
          </td>`;
        tr.after(confirmTr);

        // Highlight selected row
        tr.style.background = 'var(--bg-elevated)';

        document.getElementById('confirm-issue-no').addEventListener('click', () => {
          confirmTr.remove();
          tr.style.background = '';
        });

        document.getElementById('confirm-issue-yes').addEventListener('click', async () => {
          const yesBtn = document.getElementById('confirm-issue-yes');
          yesBtn.disabled = true;
          yesBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
          try {
            await api.cpd.issueCarnet(id, { carnet_no: carnetNo });
            closeModal();
            toast(`Carnet ${carnetNo} issued successfully`, 'success');
            renderCPDDetail(id);
          } catch (e) {
            toast(e.message || 'Failed to issue carnet', 'error');
            confirmTr.remove();
            tr.style.background = '';
          }
        });
      });
    });
  };

  openModal({
    title: 'Issue Carnet — Select Available Carnet',
    size: 'lg',
    body: `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="carnet-search-input" type="text" placeholder="Search carnet number…" style="flex:1" />
        <button class="btn btn-primary btn-sm" id="carnet-search-btn">
          <i class="fa-solid fa-magnifying-glass"></i> Search
        </button>
        <button class="btn btn-ghost btn-sm" id="carnet-clear-btn">
          <i class="fa-solid fa-xmark"></i> Clear
        </button>
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius)">
        <table id="carnet-modal-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">
              <th data-col="carnet_no" style="padding:10px 12px;text-align:left;cursor:pointer;user-select:none;white-space:nowrap">
                Carnet No <i class="sort-icon fa-solid fa-sort-up" style="margin-left:4px;color:var(--accent)"></i>
              </th>
              <th data-col="carnet_type" style="padding:10px 12px;text-align:left;cursor:pointer;user-select:none;white-space:nowrap">
                Type <i class="sort-icon fa-solid fa-sort" style="margin-left:4px;color:var(--text-muted)"></i>
              </th>
              <th data-col="location" style="padding:10px 12px;text-align:left;cursor:pointer;user-select:none;white-space:nowrap">
                Location <i class="sort-icon fa-solid fa-sort" style="margin-left:4px;color:var(--text-muted)"></i>
              </th>
              <th style="padding:10px 12px;width:100px"></th>
            </tr>
          </thead>
          <tbody id="carnet-grid-body">
            <tr><td colspan="4" class="table-empty">
              <i class="fa-solid fa-spinner fa-spin"></i> Loading…</td></tr>
          </tbody>
        </table>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Close
             </button>`,
  });

  // Bind sort headers
  document.querySelectorAll('#carnet-modal-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        sortCol = col;
        sortDir = 'ASC';
      }
      renderTable();
    });
  });

  // Bind search
  const searchBtn   = document.getElementById('carnet-search-btn');
  const clearBtn    = document.getElementById('carnet-clear-btn');
  const searchInput = document.getElementById('carnet-search-input');

  searchBtn.addEventListener('click', () => { searchTerm = searchInput.value.trim(); renderTable(); });
  clearBtn.addEventListener('click',  () => { searchInput.value = ''; searchTerm = ''; renderTable(); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { searchTerm = searchInput.value.trim(); renderTable(); } });

  // Initial load
  renderTable();
}

function cpdCancel(id) {
  openModal({
    title: 'Request Cancellation',
    body: `<div class="field"><label>Reason *</label>
      <textarea id="cancel-reason" rows="3" style="width:100%;resize:vertical"></textarea></div>
      <div class="field" style="margin-top:12px">
        <label>Supporting Document <span style="color:var(--text-muted)">(optional — JPG, PNG or PDF)</span></label>
        <input type="file" id="cancel-doc" accept=".jpg,.jpeg,.png,.pdf" />
      </div>
      <p style="font-size:.82rem;color:var(--text-muted);margin-top:8px">This submits a cancellation request for cpd_finance to review and approve.</p>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-arrow-left"></i> Back
             </button>
             <button class="btn btn-danger" id="confirm-cancel">
               <i class="fa-solid fa-ban"></i> Submit Request
             </button>`,
  });
  document.getElementById('confirm-cancel').onclick = async () => {
    const reason = document.getElementById('cancel-reason').value.trim();
    if (!reason) return toast('Enter a reason', 'error');
    try {
      const fd = new FormData();
      fd.append('reason', reason);
      const doc = document.getElementById('cancel-doc').files[0];
      if (doc) fd.append('document', doc);
      await api.cpd.cancel(id, fd);
      closeModal();
      toast('Cancellation request submitted for approval', 'info');
      renderCPDDetail(id);
    } catch (e) {
      toast(e.message || 'Failed to submit cancellation request', 'error');
    }
  };
}

// ── CPD Return Requests ───────────────────────────────────────────────────────
export function renderCPDReturnRequests() {
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Return Requests</h1>
        <p class="page-subtitle">Pending carnet return requests</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="create-return-btn">
          <i class="fa-solid fa-plus"></i> Create New
        </button>
      </div>
    </div>

    <!-- ── Create New Return Panel ── -->
    <div id="create-return-panel" style="display:none;margin-bottom:1.5rem">
      <div class="card" style="padding:1.25rem">
        <h3 style="margin:0 0 1rem;font-size:1rem;font-weight:600">Find Request</h3>
        <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:.75rem">
          <div class="field" style="margin:0;flex:1;min-width:220px">
            <label for="cr-search-ref">Carnet No / Request ID</label>
            <input id="cr-search-ref" type="text" placeholder="e.g. DDD164172 or CPD-ATC-…" autocomplete="off" />
          </div>
          <button class="btn btn-primary" id="cr-search-btn" style="height:38px">
            <i class="fa-solid fa-magnifying-glass"></i> Search
          </button>
          <button type="button" class="btn btn-ghost" id="cr-cancel-btn" style="height:38px">Cancel</button>
        </div>
        <div id="cr-search-status" style="font-size:.88rem;min-height:20px"></div>
      </div>
    </div>

    <div id="returns-table"></div>`;

  // ── Create New panel toggle ───────────────────────────────────────────────
  document.getElementById('create-return-btn').addEventListener('click', () => {
    const panel = document.getElementById('create-return-panel');
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : '';
    if (!isOpen) document.getElementById('cr-search-ref').focus();
  });

  document.getElementById('cr-cancel-btn').addEventListener('click', () => {
    document.getElementById('create-return-panel').style.display = 'none';
  });

  // ── Search → navigate to CPD detail ──────────────────────────────────────
  const crSearch = async () => {
    const ref    = document.getElementById('cr-search-ref').value.trim();
    const status = document.getElementById('cr-search-status');
    const btn    = document.getElementById('cr-search-btn');
    if (!ref) {
      status.innerHTML = '<span style="color:var(--danger)">Please enter a Carnet No or Request ID.</span>';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    status.innerHTML = '';
    try {
      const row = await api.cpd.getByRef(ref);
      navigate('cpd-detail', { id: row.auto_id, createReturn: true });
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">${e.message || 'No issued request found for the given reference.'}</span>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Search';
    }
  };

  document.getElementById('cr-search-btn').addEventListener('click', crSearch);
  document.getElementById('cr-search-ref').addEventListener('keydown', e => { if (e.key === 'Enter') crSearch(); });

  // ── Returns table ─────────────────────────────────────────────────────────
  const returnsTable = new DataTable(
    document.getElementById('returns-table'),
    [
      { key: 'cpd_request_id', label: 'Request No',    width: '200px' },
      { key: 'applicant',      label: 'Applicant',     render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'carnet_no',      label: 'Carnet No' },
      { key: 'issued_datetime',label: 'Issue Date',    render: v => v ? formatDate(v) : '—' },
      { key: 'expiry_date',    label: 'Expiry Date',   render: v => v ? formatDate(v) : '—' },
      { key: 'computed_penalty',label: 'Penalty',      render: v => parseFloat(v) > 0
          ? `<span style="color:var(--danger);font-weight:600">${formatCurrency(v)}</span>`
          : '<span style="color:var(--text-muted)">—</span>' },
      { key: 'added_datetime', label: 'Submitted',     render: v => formatDateTime(v) },
      { key: 'actions',        label: '',              width: '80px',
        render: (_, r) => `<div style="display:flex">
          <button class="btn btn-ghost btn-sm view-return-btn" data-id="${r.request_id}" data-return-id="${r.return_id}" title="View Request">
            <i class="fa-solid fa-eye"></i>
          </button></div>` },
    ],
    params => api.cpd.returnRequests(params),
    {
      idKey: 'return_id',
      searchPlaceholder: 'Search by request no or applicant…',
      filters: [
        { key: 'status', label: 'Pending Confirmation (default)', options: [
          { value: 'approved', label: 'Approved' },
          { value: 'all',      label: 'All' },
        ]},
      ],
    },
  ).render();

  document.getElementById('returns-table').addEventListener('click', e => {
    const btn = e.target.closest('.view-return-btn');
    if (btn) navigate('cpd-detail', { id: btn.dataset.id, returnId: btn.dataset.returnId });
  });
}

// ── CPD Cancellation Requests (cpd_finance) ───────────────────────────────────
export async function renderCPDCancellations() {
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Cancellation Requests</h1>
        <p class="page-subtitle">Pending CPD cancellation requests</p>
      </div>
    </div>
    <div id="cancel-table"></div>`;

  new DataTable(
    document.getElementById('cancel-table'),
    [
      { key: 'request_id',          label: 'Request No',  width: '200px' },
      { key: 'applicant',           label: 'Applicant',   render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'remarks',             label: 'Reason',      render: v => v
          ? `<span title="${v}" style="display:block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>`
          : '—' },
      { key: 'cancelled_datetime',  label: 'Submitted',   render: v => formatDateTime(v) },
      { key: 'cancelled_approved',  label: 'Status',      render: () => '<span class="badge badge-warning">Pending</span>' },
      { key: 'actions',             label: '',            width: '80px',
        render: (_, r) => `<div style="display:flex"><button class="btn btn-ghost btn-sm view-cancellation-btn" data-id="${r.request_auto_id}" title="View">
          <i class="fa-solid fa-eye"></i></button></div>` },
    ],
    params => api.cpd.cancellations(params),
    {
      idKey: 'request_auto_id',
      searchPlaceholder: 'Search by request no or applicant…',
    },
  ).render();

  document.getElementById('cancel-table').addEventListener('click', e => {
    const btn = e.target.closest('.view-cancellation-btn');
    if (btn) navigate('cpd-detail', btn.dataset.id);
  });
}

// ── CPD Stock Request ─────────────────────────────────────────────────────────
export async function renderCPDStockRequest() {
  if (currentUser?.role_name === 'cpd_branch') {
    return renderBranchStockList();
  }
  return renderBranchStockForm();
}

function renderBranchStockList() {
  const content = document.getElementById('page-content');

  const stockStatusBadge = r => {
    if (r.stock_received  == 1) return '<span class="badge badge-success">Received</span>';
    if (r.approval_level2 == 1) return '<span class="badge badge-info">Approved L2</span>';
    if (r.approval_level1 == 1) return '<span class="badge badge-warning">Approved L1</span>';
    return '<span class="badge badge-default">Pending Approval</span>';
  };

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Branch Stock Requests</h1>
        <p class="page-subtitle">Stock requests for your location</p>
      </div>
    </div>
    <div id="branch-stock-table-wrap"></div>`;

  const wrap = document.getElementById('branch-stock-table-wrap');

  const table = new DataTable(wrap, [
    { key: 'request_id',              label: 'Req No',           render: v => `<span style="font-weight:600">${v ?? '—'}</span>` },
    { key: 'expected_delivery_date',  label: 'Expected Delivery',render: v => formatDate(v) },
    { key: 'location',                label: 'Location',         render: v => v ?? '—' },
    { key: 'total_carnets',           label: 'Total Carnets',    render: v => v ?? 0 },
    { key: 'created_datetime',        label: 'Requested Date',   render: v => formatDateTime(v) },
    { key: 'status_display',          label: 'Status',           render: (_, r) => stockStatusBadge(r) },
    { key: 'auto_id',                 label: '',                 render: v => `<button class="btn btn-ghost btn-sm view-stock-btn" data-id="${v}" title="View"><i class="fa-solid fa-eye"></i></button>` },
  ], p => api.cpd.stockRequests(p), {
    title: '',
    idKey: 'auto_id',
    searchPlaceholder: 'Search requests…',
  });

  table.render();

  wrap.addEventListener('click', e => {
    const btn = e.target.closest('.view-stock-btn');
    if (btn) navigate('cpd-stock-request-view', btn.dataset.id);
  });
}

export async function renderCPDStockRequestView(id) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let r;
  try { r = await api.cpd.getStockRequest(id); }
  catch (e) { content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${e.message}</p></div>`; return; }

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${r.request_id}</h1>
        <p class="page-subtitle">Branch Stock Request — ${r.location_name ?? '—'}</p>
      </div>
    </div>

    <!-- Request Details -->
    <div class="section-card">
      <div class="section-card-header">Request Details</div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${detail('Request No',        r.request_id)}
          ${detail('Expected Delivery', formatDate(r.expected_delivery_date))}
          ${detail('Location',          r.location_name)}
          ${detail('Requested By',      `${r.first_name ?? ''} ${r.last_name ?? ''}`)}
          ${detail('Requested Date',    formatDateTime(r.created_datetime))}
          ${r.description ? detail('Description', r.description) : ''}
          ${r.reference   ? detail('Reference',   r.reference)   : ''}
        </div>
      </div>
    </div>

    <!-- Items -->
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-header">Carnet Items</div>
      <div class="section-card-body">
        <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">#</th>
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">Carnet Type</th>
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">Quantity</th>
              </tr>
            </thead>
            <tbody>
              ${(r.items ?? []).map((item, i) => `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:10px 14px;color:var(--text-muted)">${i + 1}</td>
                <td style="padding:10px 14px">${item.carnet_type ?? '—'}</td>
                <td style="padding:10px 14px">${item.quantity}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Comments & Actions -->
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-header">Comments</div>
      <div class="section-card-body">
        <textarea id="sr-view-comment" rows="4" placeholder="Add a comment (required for rejection)…"
          style="width:100%;resize:vertical"></textarea>

        <div id="sr-reject-block" style="display:none;margin-top:12px">
          <div class="field">
            <label>Rejection Reason <span style="color:var(--accent)">*</span></label>
            <textarea id="sr-reject-reason" rows="3" placeholder="Enter reason for rejection…"
              style="width:100%;resize:vertical"></textarea>
          </div>
        </div>

        <div id="sr-action-error" class="form-error hidden" style="margin-top:10px"></div>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-success" id="sr-approve-btn">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button class="btn btn-danger" id="sr-reject-btn">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
          <button class="btn btn-ghost" id="sr-reject-confirm-btn" style="display:none">
            <i class="fa-solid fa-triangle-exclamation"></i> Confirm Rejection
          </button>
          <button class="btn btn-ghost" id="sr-back-btn">
            <i class="fa-solid fa-arrow-left"></i> Go Back
          </button>
        </div>
      </div>
    </div>`;

  const errEl         = document.getElementById('sr-action-error');
  const approveBtn    = document.getElementById('sr-approve-btn');
  const rejectBtn     = document.getElementById('sr-reject-btn');
  const rejectConfBtn = document.getElementById('sr-reject-confirm-btn');
  const rejectBlock   = document.getElementById('sr-reject-block');

  document.getElementById('sr-back-btn').addEventListener('click', () => navigate('cpd-stock-request'));

  // Approve
  approveBtn.addEventListener('click', async () => {
    approveBtn.disabled = true;
    approveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await api.cpd.approveStockRequest(id);
      toast('Stock request approved', 'success');
      navigate('cpd-stock-request');
    } catch (e) {
      errEl.textContent = e.message || 'Approval failed';
      errEl.classList.remove('hidden');
      approveBtn.disabled = false;
      approveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Approve';
    }
  });

  // Reject — first click shows reason field
  rejectBtn.addEventListener('click', () => {
    rejectBlock.style.display = '';
    rejectConfBtn.style.display = '';
    rejectBtn.style.display = 'none';
    document.getElementById('sr-reject-reason').focus();
  });

  // Confirm rejection
  rejectConfBtn.addEventListener('click', async () => {
    const reason = document.getElementById('sr-reject-reason').value.trim();
    if (!reason) {
      errEl.textContent = 'Rejection reason is required.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    rejectConfBtn.disabled = true;
    rejectConfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await api.cpd.rejectStockRequest(id, { reason });
      toast('Stock request rejected', 'warning');
      navigate('cpd-stock-request');
    } catch (e) {
      errEl.textContent = e.message || 'Rejection failed';
      errEl.classList.remove('hidden');
      rejectConfBtn.disabled = false;
      rejectConfBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Confirm Rejection';
    }
  });
}

async function renderBranchStockForm() {

  let locations = [], carnetTypes = [];
  try {
    [locations, carnetTypes] = await Promise.all([
      api.cpd.locations(),
      api.cpd.carnetTypes(),
    ]);
  } catch (e) {
    content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${e.message}</p></div>`;
    return;
  }

  const locationOptions   = locations.map(l  => `<option value="${l.location_id}">${l.location}</option>`).join('');
  const carnetTypeOptions = carnetTypes.map(t => `<option value="${t.carnet_type_id}">${t.carnet_type}</option>`).join('');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">New Branch Request — CPD</h1>
        <p class="page-subtitle">Carnet Stock Request</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="history.back()">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    </div>

    <!-- Request Details -->
    <div class="section-card">
      <div class="section-card-header">Request Details</div>
      <div class="section-card-body">
        <div class="form-grid">
          <div class="field">
            <label>Expected Delivery Date <span style="color:var(--accent)">*</span></label>
            <input type="date" id="sr-delivery-date" />
          </div>
          <div class="field">
            <label>Location <span style="color:var(--accent)">*</span></label>
            <select id="sr-location">
              <option value="">— Select Location —</option>
              ${locationOptions}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Description</label>
            <textarea id="sr-description" rows="3" placeholder="Enter description…" style="width:100%;resize:vertical"></textarea>
          </div>
          <div class="field">
            <label>Reference</label>
            <input type="text" id="sr-reference" placeholder="Enter reference…" />
          </div>
        </div>
      </div>
    </div>

    <!-- Carnet Items -->
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-header">Carnet Items</div>
      <div class="section-card-body">
        <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px">
          <div class="field" style="min-width:200px;margin:0">
            <label>Carnet Type <span style="color:var(--accent)">*</span></label>
            <select id="sr-carnet-type">
              <option value="">— Select Type —</option>
              ${carnetTypeOptions}
            </select>
          </div>
          <div class="field" style="min-width:120px;margin:0">
            <label>Quantity <span style="color:var(--accent)">*</span></label>
            <input type="number" id="sr-quantity" min="1" value="1" placeholder="1" style="width:100%" />
          </div>
          <button class="btn btn-primary" id="sr-add-btn" style="margin-bottom:1px">
            <i class="fa-solid fa-plus"></i> Add to List
          </button>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
          <table id="sr-items-table" style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">#</th>
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">Carnet Type</th>
                <th style="padding:10px 14px;text-align:left;font-size:.82rem;color:var(--text-muted)">Quantity</th>
                <th style="padding:10px 14px;width:60px"></th>
              </tr>
            </thead>
            <tbody id="sr-items-body">
              <tr><td colspan="4" class="table-empty">No items added yet. Select a carnet type and click Add to List.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="sr-form-error" class="form-error hidden" style="margin-top:12px"></div>
    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px">
      <button type="button" class="btn btn-ghost" onclick="history.back()">
        <i class="fa-solid fa-xmark"></i> Cancel
      </button>
      <button type="button" class="btn btn-primary" id="sr-submit-btn">
        <i class="fa-solid fa-floppy-disk"></i> Submit Request
      </button>
    </div>`;

  let items = [];

  const renderItems = () => {
    const tbody = document.getElementById('sr-items-body');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No items added yet. Select a carnet type and click Add to List.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item, i) => `
      <tr>
        <td style="padding:10px 14px;color:var(--text-muted)">${i + 1}</td>
        <td style="padding:10px 14px">${item.carnet_type_label}</td>
        <td style="padding:10px 14px">${item.quantity}</td>
        <td style="padding:10px 14px;text-align:center">
          <button class="btn btn-ghost btn-sm sr-remove-btn" data-idx="${i}" title="Remove">
            <i class="fa-solid fa-xmark" style="color:var(--danger)"></i>
          </button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('.sr-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { items.splice(Number(btn.dataset.idx), 1); renderItems(); });
    });
  };

  document.getElementById('sr-add-btn').addEventListener('click', () => {
    const typeSelect = document.getElementById('sr-carnet-type');
    const qtyInput   = document.getElementById('sr-quantity');
    const typeId     = typeSelect.value;
    const typeLabel  = typeSelect.options[typeSelect.selectedIndex]?.text ?? '';
    const qty        = parseInt(qtyInput.value);

    if (!typeId)          return toast('Select a carnet type', 'error');
    if (!qty || qty < 1)  return toast('Enter a valid quantity', 'error');

    const existing = items.find(i => i.carnet_type_id === typeId);
    if (existing) { existing.quantity += qty; }
    else          { items.push({ carnet_type_id: typeId, carnet_type_label: typeLabel, quantity: qty }); }

    renderItems();
    typeSelect.value = '';
    qtyInput.value   = '1';
    typeSelect.focus();
  });

  document.getElementById('sr-submit-btn').addEventListener('click', async () => {
    const errEl    = document.getElementById('sr-form-error');
    const date     = document.getElementById('sr-delivery-date').value;
    const location = document.getElementById('sr-location').value;
    const desc     = document.getElementById('sr-description').value.trim();
    const ref      = document.getElementById('sr-reference').value.trim();

    if (!date)         { errEl.textContent = 'Expected delivery date is required.'; errEl.classList.remove('hidden'); return; }
    if (!location)     { errEl.textContent = 'Location is required.'; errEl.classList.remove('hidden'); return; }
    if (!items.length) { errEl.textContent = 'Add at least one carnet item.'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');

    const submitBtn = document.getElementById('sr-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

    try {
      const res = await api.cpd.stockRequest({
        expected_delivery_date: date,
        location,
        description: desc,
        reference:   ref,
        items: items.map(i => ({ carnet_type_id: i.carnet_type_id, quantity: i.quantity })),
      });
      toast(`Stock request ${res.request_id} submitted successfully`, 'success');
      navigate('cpd-carnets');
    } catch (e) {
      errEl.textContent = e.message || 'Failed to submit stock request.';
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Submit Request';
    }
  });
}

// ── CPD Carnet stock ──────────────────────────────────────────────────────────
export function renderCPDCarnets() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Carnet Stock</h1>
        <p class="page-subtitle">Physical carnet inventory</p>
      </div>
    </div>
    <div id="carnet-table"></div>`;

  new DataTable(
    document.getElementById('carnet-table'),
    [
      { key: 'carnet_no',   label: 'Carnet No' },
      { key: 'carnet_type', label: 'Type' },
      { key: 'location_id', label: 'Location' },
      { key: 'is_used', label: 'Status', render: (v, r) =>
          r.is_damaged == 1 ? `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Damaged</span>`
        : v == 1            ? `<span class="badge badge-default">Used</span>`
        :                     `<span class="badge badge-success">Unused</span>` },
    ],
    params => api.cpd.carnets(params),
    {
      searchPlaceholder: 'Search carnet…',
      filters: [
        { key: 'status', label: 'All', options: [
          { value: 'unused',   label: 'Unused' },
          { value: 'used',     label: 'Used' },
          { value: 'damaged',  label: 'Damaged' },
        ]},
      ],
    },
  ).render();
}

function buildCPDActionBtns(r, returnId = null) {
  const btns            = [];
  const s               = String(r.request_status);
  const isCashier       = currentUser?.role_name === 'idl_cpd_cashier';
  const isFinance       = currentUser?.role_name === 'cpd_finance';
  const isBranchManager = currentUser?.role_name === 'cpd_branch';
  const isPending       = ['1','2','NEW','Processing'].includes(s);

  // Return request view: only Approve button — disabled until the officer ticks the
  // "documents received" acknowledgment checkbox rendered alongside the return details.
  if (returnId) {
    btns.push(`<button class="btn btn-success btn-sm" id="return-approve-btn" data-return-id="${returnId}" disabled title="Acknowledge documents received first">
      <i class="fa-solid fa-check"></i> Approve</button>`);
    return btns.join('');
  }
  if (isFinance) {
    btns.push(`<button class="btn btn-success btn-sm" data-action="approve">
      <i class="fa-solid fa-check"></i> Accept</button>`);
    btns.push(`<button class="btn btn-danger btn-sm" data-action="cancel">
      <i class="fa-solid fa-ban"></i> Reject</button>`);
    return btns.join('');
  }

  // Special-category walk-in awaiting Branch Manager approval (CS → Branch Manager →
  // Cashier → CS) — a distinct queue/action set from the normal CS approve/reject flow.
  if (isBranchManager) {
    if (r.current_queue_position === 'CPD_Branch_Manager') {
      btns.push(`<button class="btn btn-success btn-sm" data-action="branch-approve">
        <i class="fa-solid fa-check"></i> Approve</button>`);
      btns.push(`<button class="btn btn-warning btn-sm" data-action="branch-reject">
        <i class="fa-solid fa-rotate-left"></i> Send Back to CS</button>`);
    }
    return btns.join('');
  }

  const isApproveOrIssue = s === '2' && String(r.booking_fee_status) === '1';
  const alreadyIssued    = s === '3' || parseInt(r.has_issued_carnet) > 0;

  if (isPending && !isCashier) {
    btns.push(isApproveOrIssue
      ? `<button class="btn btn-primary btn-sm" data-action="issue-carnet">
          <i class="fa-solid fa-clipboard-check"></i> Issue Carnet</button>`
      : `<button class="btn btn-success btn-sm" data-action="approve">
          <i class="fa-solid fa-check"></i> Approve</button>`
    );
    btns.push(`<button class="btn btn-warning btn-sm" data-action="reject">
      <i class="fa-solid fa-rotate-left"></i> Send for Corrections</button>`);
    if (String(r.paid_status) !== '1') {
      btns.push(`<button class="btn btn-danger btn-sm" data-action="cancel">
        <i class="fa-solid fa-ban"></i> Cancel</button>`);
    }
  }
  if (['Confirmed','3'].includes(s) && !alreadyIssued) {
    btns.push(`<button class="btn btn-primary btn-sm" data-action="issue-carnet">
      <i class="fa-solid fa-clipboard-check"></i> Issue Carnet</button>`);
  }
  if (s === '3' && !isCashier && !isFinance && !returnId) {
    btns.push(`<button class="btn btn-ghost btn-sm" data-action="print-carnet">
      <i class="fa-solid fa-print"></i> Print Carnet</button>`);
    if (r.delivery_option === 'home_delivery') {
      btns.push(`<button class="btn btn-ghost btn-sm" data-action="print-awb">
        <i class="fa-solid fa-print"></i> Print AWB</button>`);
      btns.push(`<button class="btn btn-info btn-sm" data-action="dispatch">
        <i class="fa-solid fa-truck"></i> Mark Dispatched</button>`);
    }
    if (!r.carnet_return) {
      btns.push(`<button class="btn btn-warning btn-sm" data-action="create-return">
        <i class="fa-solid fa-rotate-left"></i> Create Return</button>`);
    }
  }
  return btns.join('');
}

async function cpdPrintAWB(id) {
  const btn = document.querySelector('[data-action="print-awb"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating AWB…'; }

  try {
    const res = await api.cpd.printAwb(id);

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-print"></i> Print AWB'; }

    if (res.label_url) {
      window.open(res.label_url, '_blank');
      toast(`AWB created — ${res.air_bill_no}`, 'success');
    } else if (res.air_bill_no) {
      toast(`AWB created — ${res.air_bill_no}. No label URL returned.`, 'success');
    } else {
      toast('AWB created but no tracking number returned', 'warning');
    }

    // Refresh detail to show updated air_bill_no
    renderCPDDetail(id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-print"></i> Print AWB'; }
    toast(e.message || 'Failed to create AWB', 'error');
  }
}

function cpdMarkDispatched(id, param) {
  const awb = window.__cpdCurrentRecord?.airway_bill_no ?? '';
  confirm('Mark this CPD request as dispatched?', async () => {
    try {
      await api.cpd.markDispatched(id, { air_bill_no: awb });
      toast('Marked as dispatched', 'success');
      renderCPDDetail(param);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, false);
}

function detail(label, value) {
  return `<div class="detail-item"><label>${label}</label><div class="detail-val">${value ?? '—'}</div></div>`;
}

// ── Shared with the public wizard's "Review & Pay" step — same icon-row / card
// look for the officer-side CPD detail view's read-only info sections. ──
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function identityRow(icon, label, value) {
  return `<div class="rv-identity-row"><span class="rv-id-icon"><i class="${icon}"></i></span><span class="rv-id-label">${label}</span><span class="rv-id-value">${value || '—'}</span></div>`;
}
function extraRow(label, value) {
  return `<div class="rv-extra-row"><span class="rv-extra-label">${label}</span><span class="rv-extra-value">${value || '—'}</span></div>`;
}
function cpdFeeRow(label, value, bold = false, accent = false) {
  const fmt = n => 'AED ' + Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 });
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 16px;font-size:.875rem${bold ? ';font-weight:700' : ''}">${label}</td>
      <td style="padding:10px 16px;text-align:right;font-weight:${bold ? '700' : '500'};font-size:${bold ? '1rem' : '.875rem'};${accent ? 'color:var(--accent)' : ''}">${fmt(value)}</td>
    </tr>`;
}
function cpdDocThumb(doc) {
  return `
    <div class="rv-doc-item">
      <div class="rv-doc-thumb rv-doc-thumb-clickable" data-lightbox="${doc.base64}" data-label="${doc.label}">
        <img src="${doc.base64}" alt="${doc.label}" />
      </div>
      <div class="rv-doc-label">${doc.label}</div>
    </div>`;
}

async function cpdOfficerCreateReturn(id) {
  openModal({
    title: 'Create Return Request',
    body: `
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
        <div style="flex:1;min-width:180px">
          <div class="field" style="margin:0">
            <label>Delivery Option <span style="color:var(--accent)">*</span></label>
            <div style="display:flex;gap:.75rem;margin-top:.4rem;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                <input type="radio" name="cr-delivery" value="DELIVER_BY_HAND" checked /> Deliver by Hand
              </label>
              <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                <input type="radio" name="cr-delivery" value="ARAMAX" /> Aramex
              </label>
            </div>
          </div>
        </div>
        <div style="flex:1;min-width:180px">
          <div class="field" style="margin:0">
            <label>Return Payment Option <span style="color:var(--accent)">*</span></label>
            <div style="display:flex;gap:.75rem;margin-top:.4rem;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                <input type="radio" name="cr-payment" value="COLLECT_CHEQUE" checked /> Collect Cheque
              </label>
              <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                <input type="radio" name="cr-payment" value="BANK_DEPOSIT" /> Bank Deposit
              </label>
            </div>
          </div>
        </div>
      </div>

      <div id="cr-modal-bank" style="display:none;background:var(--bg-secondary);border-radius:8px;padding:.9rem;margin-bottom:1rem">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
          <div class="field" style="margin:0"><label>Bank Name <span style="color:var(--accent)">*</span></label>
            <input type="text" id="cr-bank-name" placeholder="Bank name" /></div>
          <div class="field" style="margin:0"><label>Account No <span style="color:var(--accent)">*</span></label>
            <input type="text" id="cr-account-no" placeholder="Account number" /></div>
          <div class="field" style="margin:0"><label>IBAN</label>
            <input type="text" id="cr-iban" placeholder="AE00 0000 …" /></div>
          <div class="field" style="margin:0"><label>Beneficiary Name <span style="color:var(--accent)">*</span></label>
            <input type="text" id="cr-beneficiary" placeholder="Account holder name" /></div>
        </div>
      </div>

      <div class="field" style="margin:0">
        <label>Remarks <span style="color:var(--accent)">*</span></label>
        <textarea id="cr-remarks" rows="3" style="width:100%;resize:vertical"
          placeholder="Condition of carnet and reason for return…"></textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-warning" id="cr-modal-submit">
               <i class="fa-solid fa-rotate-left"></i> Submit Return
             </button>`,
  });

  document.querySelectorAll('input[name="cr-payment"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('cr-modal-bank').style.display =
        r.value === 'BANK_DEPOSIT' && r.checked ? '' : 'none';
    });
  });

  document.getElementById('cr-modal-submit').onclick = async () => {
    const delivery = document.querySelector('input[name="cr-delivery"]:checked')?.value;
    const payment  = document.querySelector('input[name="cr-payment"]:checked')?.value;
    const remarks  = document.getElementById('cr-remarks').value.trim();

    if (!remarks)  return toast('Please enter remarks', 'error');

    const body = { remarks, delivery_option: delivery, payment_option: payment };

    if (payment === 'BANK_DEPOSIT') {
      body.bank_name   = document.getElementById('cr-bank-name').value.trim();
      body.account_no  = document.getElementById('cr-account-no').value.trim();
      body.iban        = document.getElementById('cr-iban').value.trim();
      body.beneficiary = document.getElementById('cr-beneficiary').value.trim();
      if (!body.bank_name)   return toast('Bank name is required', 'error');
      if (!body.account_no)  return toast('Account number is required', 'error');
      if (!body.beneficiary) return toast('Beneficiary name is required', 'error');
    }

    const submitBtn = document.getElementById('cr-modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

    try {
      await api.cpd.officerReturn(id, body);
      closeModal();
      toast('Return request created successfully', 'success');
      renderCPDDetail(id);
    } catch (e) {
      toast(e.message || 'Failed to create return request', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Submit Return';
    }
  };
}

// ── CPD Copy/Renew ────────────────────────────────────────────────────────────
export async function renderCPDRenew() {
  const content = document.getElementById('page-content');

  const [vehicleTypes, countries, nationalities, guaranteeRules] = await Promise.all([
    api.cpd.vehicleTypes(), api.cpd.countries(), api.idl.nationalities(), api.cpd.guaranteeRules(),
  ]);

  const UAE_STATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];
  // "Luxury" is intentionally not selectable — luxury vehicles are auto-detected
  // from the make (see LUXURY_MAKES_CPD below) and priced accordingly.
  const BODY_TYPES = ['Station','Saloon','Motor Cycle','Truck','Coupe','Bus','Trailer','-Coupe','-Station','-Saloon','Pickup','Caravan','Hatchback'];
  const COLORS     = ['White','Silver','Black','Grey','Blue','Red','Brown','Green','Other'];
  const yearOpts   = Array.from({length:41},(_,i)=>2030-i).map(y=>`<option value="${y}">${y}</option>`).join('');

  function docZone(key, label) {
    return `<div class="doc-upload-item">
      <div class="doc-upload-label">${label}</div>
      <div class="doc-upload-zone" id="renew-cpd-zone-${key}" style="cursor:pointer">
        <input type="file" accept=".jpg,.jpeg,.png" data-renew-cpd-doc="${key}" style="display:none" />
        <div class="doc-upload-placeholder">
          <i class="fa-solid fa-cloud-arrow-up"></i><span>Click to upload</span><small>JPG or PNG · max 2 MB</small>
        </div>
        <div class="doc-upload-preview" style="display:none">
          <img class="doc-preview-img" /><span class="doc-preview-name"></span>
          <button type="button" class="doc-remove-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
    </div>`;
  }

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Copy / Renew Request</h1>
        <p class="page-subtitle">Enter the previous request number or Carnet No to copy and renew</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="history.back()">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">Copy / Renew Details</div>
      <div class="section-card-body">
        <div class="form-grid">
          <div class="field">
            <label for="cpd-renew-ref">Previous Request No / Carnet No <span class="required">*</span></label>
            <input id="cpd-renew-ref" type="text" placeholder="Enter previous request no or carnet no" autocomplete="off" />
          </div>
        </div>
        <div class="form-actions" style="margin-top:1.5rem;display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap">
          <button class="btn btn-primary" id="cpd-renew-btn">
            <i class="fa-solid fa-magnifying-glass"></i> Search
          </button>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500">
            <input type="radio" name="cpd-renew-action" value="copy" checked /> Copy
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500">
            <input type="radio" name="cpd-renew-action" value="renew" /> Renew
          </label>
        </div>
        <div id="cpd-renew-status" style="margin-top:1rem;font-size:.88rem;min-height:24px"></div>
      </div>
    </div>

    <div id="cpd-renew-form-wrap" style="display:none">
      <form id="cpd-renew-form" novalidate>
        <input type="hidden" name="parent_request_id" />
      ${cpdFormSectionsHtml({ nationalities, vehicleTypes, countries, docZone, feeTableId: 'cpd-renew-fee-table', fromRenew: true })}

        <div id="renew-form-error" class="form-error hidden"></div>
        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px">
          <button type="button" class="btn btn-ghost" onclick="history.back()">
            <i class="fa-solid fa-xmark"></i> Cancel
          </button>
          <button type="submit" class="btn btn-primary" id="renew-submit-btn">
            <i class="fa-solid fa-floppy-disk"></i> Create CPD Request
          </button>
        </div>
      </form>
    </div>
  `;

  // ── Search ─────────────────────────────────────────────────────────────────
  let lastFoundRow = null;

  const applyFoundRow = (row) => {
    const selectedAction = document.querySelector('input[name="cpd-renew-action"]:checked')?.value ?? 'copy';
    const statusEl = document.getElementById('cpd-renew-status');
    const wrap     = document.getElementById('cpd-renew-form-wrap');
    if (selectedAction === 'renew' && (row.childs ?? 0) > 0) {
      statusEl.innerHTML = '<span style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i> This Carnet is already Renewed</span>';
      wrap.style.display = 'none';
    } else {
      wrap.style.display = '';
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      statusEl.innerHTML = '<span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Request found — review and submit below.</span>';
    }
  };

  document.querySelectorAll('input[name="cpd-renew-action"]').forEach(radio => {
    radio.addEventListener('change', () => { if (lastFoundRow) applyFoundRow(lastFoundRow); });
  });

  document.getElementById('cpd-renew-btn').addEventListener('click', async () => {
    const ref    = document.getElementById('cpd-renew-ref').value.trim();
    const status = document.getElementById('cpd-renew-status');
    const btn    = document.getElementById('cpd-renew-btn');

    if (!ref) {
      status.innerHTML = '<span style="color:var(--danger)">Please enter a Previous Request No / Carnet No.</span>';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching…';
    status.innerHTML = '';

    try {
      const row = await api.cpd.getByRef(ref);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Search';

      const set = (name, val) => {
        if (val == null || val === '') return;
        const el = document.querySelector(`#cpd-renew-form [name="${name}"]`);
        if (el) el.value = val;
      };
      set('parent_request_id',  row.auto_id);
      set('user_id',            row.belonging_user_id);
      set('title',              row.title);
      set('full_name',          [row.first_name, row.last_name].filter(Boolean).join(' '));
      set('emirates_id',        row.emirates_id);
      set('sex',                row.sex);
      set('usage_type',         row.usage_type);
      set('company_name',       row.company_name);
      set('license_no',         row.license_no);
      set('license_expiry',     row.license_expiry);
      set('mobile_no',          row.mobile_no);
      set('email',              row.email);
      set('nationality',        row.nationality_id ?? row.nationality);
      set('passport_no',        row.passport_no);
      set('po_box',             row.po_box);
      set('address',            row.uae_address);
      set('city',               row.city);
      set('extra_owner1_name',  row.extra_owner1_name);
      set('extra_owner1_eid',      row.extra_owner1_eid);
      set('extra_owner1_passport', row.extra_owner1_passport);
      set('extra_owner2_name',  row.extra_owner2_name);
      set('extra_owner2_eid',      row.extra_owner2_eid);
      set('extra_owner2_passport', row.extra_owner2_passport);
      set('mulkiya_no',         row.mulkiya_no);
      set('registration_no',    row.registration_no);
      set('vehicle_make',       row.vehicle_make);
      set('vehicle_model',      row.vehicle_model);
      set('vehicle_value',      row.vehicle_value);
      set('vehicle_registered_in', row.vehicle_registered_in);
      set('body_type',          row.body_type);
      set('manuf_year',         row.manuf_year);
      set('color',              row.color);
      set('net_weight',         row.net_weight);
      set('chassis_no',         row.chassis_no);
      set('engine_no',          row.engine_no);
      set('horse_power',        row.horse_power);
      set('no_of_cylinders',    row.no_of_cylinders);
      set('upholstery',         row.upholstery);
      set('no_of_seats',        row.no_of_seats);
      set('radio',              row.radio);
      set('spare_tyre',         row.spare_tyre);
      set('additional_remarks', row.additional_remarks);
      set('others1',            row.others1);
      set('others2',            row.others2);
      set('uae_refree1',        row.uae_refree1);
      set('uae_refree2',        row.uae_refree2);
      set('destination_refree1', row.destination_refree1);
      set('destination_refree2', row.destination_refree2);
      set('request_category',   row.request_category);
      set('method_of_payment',  row.method_of_payment);
      // Display the source request's own saved fee breakdown (not a fresh recalculation —
      // rules may have changed since it was created, or an officer may have manually
      // adjusted it) via the same read-only table used for a live recalc.
      setRenewFees(
        +row.guarantee_amount || 0, +row.booking_fee || 0, +row.extra_fees || 0,
        +row.vat_amount || 0, +row.total_amount || 0, +row.processing_fee || 0,
      );

      const countryIds = new Set((row.countries ?? []).map(c => String(c.country_id)));
      document.querySelectorAll('#cpd-renew-form [name="countries"]').forEach(cb => {
        cb.checked = countryIds.has(cb.value);
      });

      // Load documents from the source request
      const STEM_TO_KEY = {
        'cpd_mulkiya_front':     'traffic_front',
        'cpd_mulkiya_back':      'traffic_back',
        'cpd_emirates_id_front': 'eid_front',
        'cpd_emirates_id_back':  'eid_back',
        'cpd_dl_front':          'dl_front',
        'cpd_dl_back':           'dl_back',
        'cpd_passport':          'passport_photo',
        'cpd_owner_visa':        'visa_page',
        'cpd_trade_license':     'trade_license',
        'cpd_noc':               'noc',
      };
      const docs = await api.cpd.getDocs(row.auto_id).catch(() => []);
      for (const doc of docs) {
        const key    = STEM_TO_KEY[doc.stem];
        if (!key) continue;
        const zone   = document.getElementById(`renew-cpd-zone-${key}`);
        const input  = zone?.querySelector('input[data-renew-cpd-doc]');
        const holder = zone?.querySelector('.doc-upload-placeholder');
        const prev   = zone?.querySelector('.doc-upload-preview');
        const img    = zone?.querySelector('.doc-preview-img');
        const nm     = zone?.querySelector('.doc-preview-name');
        if (!zone || !input) continue;
        try {
          const blob = await fetch(doc.base64).then(r => r.blob());
          const ext  = blob.type.includes('png') ? 'png' : 'jpg';
          const dt   = new DataTransfer();
          dt.items.add(new File([blob], `${doc.stem}.${ext}`, { type: blob.type }));
          input.files = dt.files;
        } catch (_) {}
        if (img)    img.src            = doc.base64;
        if (nm)     nm.textContent     = doc.stem;
        if (holder) holder.style.display = 'none';
        if (prev)   prev.style.display   = '';
        if (zone)   zone.style.border    = '';
      }

      lastFoundRow = row;
      syncRenewUsage();
      applyFoundRow(row);
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Search';
      status.innerHTML = `<span style="color:var(--danger)">${e.message || 'No request found for the given reference.'}</span>`;
    }
  });

  document.getElementById('cpd-renew-ref').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('cpd-renew-btn').click();
  });

  // ── Guarantee calculator ───────────────────────────────────────────────────
  const _groups = {}, _rates = {}, _countryMap = {}, _bookingFees = [];
  const EXTRA_DRIVER_FEE = parseFloat(guaranteeRules.extra_driver_fee ?? 50);
  (guaranteeRules.groups     ?? []).forEach(g => { _groups[g.group_code] = g; });
  (guaranteeRules.rates      ?? []).forEach(r => {
    if (!_rates[r.group_code]) _rates[r.group_code] = [];
    _rates[r.group_code][r.year_band] = { saloon: +r.saloon, station: +r.station, luxury: +r.luxury };
  });
  (guaranteeRules.country_map ?? []).forEach(c => {
    const entry = { group_code: c.group_code, special_note: c.special_note };
    if (c.nationality_id != null) _countryMap[`id:${c.nationality_id}`] = entry;
    _countryMap[c.country_name.toLowerCase()] = entry;
  });
  (guaranteeRules.booking_fees ?? []).forEach(bf => _bookingFees.push(bf));

  const STATION_TYPES = ['Station','SUV','-Station','Pickup','Truck','Bus','Trailer','Caravan','Hatchback'];
  const LUXURY_MAKES  = [
    'Rolls Royce', 'Bentley', 'Ferrari', 'Lamborghini', 'Maserati', 'Aston Martin',
    'McLaren', 'Bugatti', 'Koenigsegg', 'Pagani', 'Maybach', 'W Motors', 'Bizzarrini', 'Gumpert',
  ];
  const getTier = (bt, make) => LUXURY_MAKES.includes((make ?? '').trim()) ? 'luxury' : STATION_TYPES.includes(bt ?? '') ? 'station' : 'saloon';
  const getBand = y  => { const yr = parseInt(y,10); return yr <= 2000 ? 0 : yr <= 2009 ? 1 : 2; };
  const calcBookingFee = ids => {
    const s = new Set(ids.map(String)); let best = 0;
    _bookingFees.forEach(bf => {
      if (!bf.country_list) return;
      if (bf.country_list.split(',').map(x=>x.trim()).some(id=>s.has(id))) {
        const f = parseFloat(bf.booking_fee)||0; if (f>best) best=f;
      }
    });
    return best;
  };

  function recalcRenew() {
    const form = document.getElementById('cpd-renew-form');
    if (!form) return;
    const checked = [...form.querySelectorAll('input[name="countries"]:checked')];
    const d1 = form.querySelector('[name="extra_owner1_name"]')?.value?.trim() ?? '';
    const d2 = form.querySelector('[name="extra_owner2_name"]')?.value?.trim() ?? '';
    const extra = (d1||d2) ? EXTRA_DRIVER_FEE : 0;
    if (!checked.length) {
      setRenewFees(0,0,extra,Math.round(extra*.05*100)/100,extra+Math.round(extra*.05*100)/100,0);
      return;
    }
    const ids   = checked.map(cb=>cb.value);
    const names = ids.map(id=>countries.find(c=>String(c.nationality_id)===id)?.nationality??'');
    const bodyType = form.querySelector('[name="body_type"]')?.value;
    const vehicleMake = form.querySelector('[name="vehicle_make"]')?.value ?? '';
    const tier  = getTier(bodyType, vehicleMake);
    const band  = getBand(form.querySelector('[name="manuf_year"]')?.value);
    const isMotorcycle  = bodyType === 'Motor Cycle';
    const nationalityVal = form.querySelector('[name="nationality"]')?.value ?? '';
    const isUaeNational  = nationalities.find(n => String(n.nationality_id) === String(nationalityVal))?.nationality === 'United Arab Emirates';
    const ga = {};
    names.forEach((name,i)=>{
      const m = _countryMap[`id:${ids[i]}`] ?? _countryMap[name.toLowerCase()];
      const gc = m?.group_code ?? 'DEFAULT';
      const g  = _groups[gc];
      let amt  = 0;
      if (isMotorcycle && g?.motorcycle_flat_amount != null) {
        amt = +g.motorcycle_flat_amount;
      } else if (g?.fixed_amount != null) {
        amt = (isUaeNational && g?.fixed_amount_uae_national != null) ? +g.fixed_amount_uae_national : +g.fixed_amount;
      } else {
        const br=(_rates[gc]??[])[band]; amt=br?br[tier]:0;
      }
      if (!ga[gc]||amt>ga[gc]) ga[gc]=amt;
    });
    const gFee = Math.max(0,...Object.values(ga));
    // Processing fee — 2.5% of the guarantee fee for every destination, Portugal included.
    const processingFee = Math.round(gFee * 0.025 * 100) / 100;
    const bFee = calcBookingFee(ids);
    const vat  = Math.round((bFee+extra)*.05*100)/100;
    setRenewFees(gFee, bFee, extra, vat, gFee+bFee+extra+processingFee+vat, processingFee);
  }

  function setRenewFees(guarantee,booking,extra,vat,total,processingFee = 0) {
    const form = document.getElementById('cpd-renew-form');
    if (!form) return;
    const set = (n,v) => { const el=form.querySelector(`[name="${n}"]`); if(el) el.value=v>0?v.toFixed(2):'0.00'; };
    set('guarantee_amount',guarantee); set('booking_fee',booking);
    set('processing_fee',processingFee);
    set('extra_fees',extra);           set('vat_amount',vat);
    set('total_amount',total);

    const table = document.getElementById('cpd-renew-fee-table');
    if (table) {
      table.innerHTML =
        cpdFeeRow('Guarantee Fee', guarantee) +
        cpdFeeRow('Processing Fee (2.5% of Guarantee Fee)', processingFee) +
        cpdFeeRow('Booking Fee', booking) +
        cpdFeeRow('Extra Driver Fee', extra) +
        cpdFeeRow('VAT (5%)', vat) +
        cpdFeeRow('Total Payable', total, true, true);
    }
  }

  document.querySelectorAll('#cpd-renew-form input[name="countries"]').forEach(cb=>cb.addEventListener('change',recalcRenew));
  document.querySelector('#cpd-renew-form [name="body_type"]')?.addEventListener('change',recalcRenew);
  document.querySelector('#cpd-renew-form [name="manuf_year"]')?.addEventListener('change',recalcRenew);
  document.querySelector('#cpd-renew-form [name="nationality"]')?.addEventListener('change',recalcRenew);
  document.querySelector('#cpd-renew-form [name="extra_owner1_name"]')?.addEventListener('input',recalcRenew);
  document.querySelector('#cpd-renew-form [name="extra_owner2_name"]')?.addEventListener('input',recalcRenew);

  const syncRenewUsage = () => {
    const isCompany    = document.getElementById('cpd-new-usage-type')?.value === 'COMPANY';
    const companyRow   = document.getElementById('cpd-new-company-name-row');
    const companyInput = companyRow?.querySelector('[name="company_name"]');
    const corpDocs     = document.getElementById('cpd-new-corporate-docs');
    if (companyRow)   companyRow.style.display = isCompany ? '' : 'none';
    if (corpDocs)     corpDocs.style.display   = isCompany ? 'contents' : 'none';
    if (companyInput) companyInput.required    = isCompany;
  };
  document.getElementById('cpd-new-usage-type')?.addEventListener('change', syncRenewUsage);
  syncRenewUsage();

  // ── Doc upload zones ───────────────────────────────────────────────────────
  document.querySelectorAll('.doc-upload-zone[id^="renew-cpd-zone-"]').forEach(zone => {
    const input  = zone.querySelector('input[data-renew-cpd-doc]');
    const holder = zone.querySelector('.doc-upload-placeholder');
    const prev   = zone.querySelector('.doc-upload-preview');
    const img    = zone.querySelector('.doc-preview-img');
    const nm     = zone.querySelector('.doc-preview-name');
    const rmBtn  = zone.querySelector('.doc-remove-btn');
    zone.addEventListener('click', e => { if (!e.target.closest('.doc-remove-btn')) input.click(); });
    input.addEventListener('change', () => {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => { img.src = ev.target.result; };
      reader.readAsDataURL(file);
      nm.textContent = file.name;
      holder.style.display = 'none'; prev.style.display = ''; zone.style.border = '';
    });
    rmBtn?.addEventListener('click', () => {
      input.value=''; img.src=''; nm.textContent='';
      prev.style.display='none'; holder.style.display='';
    });
  });

  // ── Submit ─────────────────────────────────────────────────────────────────
  document.getElementById('cpd-renew-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = document.getElementById('renew-submit-btn');
    const errEl = document.getElementById('renew-form-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const fd   = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.countries = fd.getAll('countries').map(Number);
    if (body.full_name) {
      const nameParts = body.full_name.trim().split(/\s+/).filter(Boolean);
      body.first_name = nameParts.slice(0, 2).join(' ');
      body.last_name  = nameParts.slice(2).join(' ');
    }

    const DOC_KEYS = ['eid_front','eid_back','dl_front','dl_back','traffic_front','traffic_back',
                      'passport_photo','visa_page','trade_license','noc'];

    // Include the selected Copy/Renew action so the backend can branch logic
    body.renew_action = document.querySelector('input[name="cpd-renew-action"]:checked')?.value ?? 'copy';

    try {
      const res = await api.cpd.renew(body);
      // Upload any files that were pre-loaded or manually replaced in the zones
      const fd2 = new FormData();
      DOC_KEYS.forEach(key => {
        const input = document.querySelector(`input[data-renew-cpd-doc="${key}"]`);
        if (input?.files?.[0]) fd2.append(key, input.files[0]);
      });
      if ([...fd2.keys()].length) await api.cpd.uploadDocs(res.auto_id, fd2);
      toast(`CPD request ${res.request_id} created`, 'success');
      navigate('cpd-detail', res.auto_id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Create CPD Request';
    }
  });
}

// ── CPD Claims ────────────────────────────────────────────────────────────────
export function renderCPDClaims() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Claims</h1>
        <p class="page-subtitle">Search by Carnet No to view claim details</p>
      </div>
    </div>
    <div class="section-card" style="max-width:560px">
      <div class="section-card-header">Search Carnet</div>
      <div class="section-card-body">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div class="field" style="flex:1;margin:0">
            <label>Carnet No</label>
            <input id="claims-carnet-input" type="text"
              placeholder="Enter Carnet No…" autocomplete="off" />
          </div>
          <button id="claims-search-btn" class="btn btn-primary" style="flex-shrink:0">
            <i class="fa-solid fa-magnifying-glass"></i> Search
          </button>
        </div>
        <p id="claims-error" class="form-error" style="display:none;margin-top:8px"></p>
      </div>
    </div>
    <div id="claims-result"></div>

    <div class="section-card" style="margin-top:20px">
      <div class="section-card-header">All Claims</div>
      <div id="claims-list-table"></div>
    </div>`;

  const input  = document.getElementById('claims-carnet-input');
  const btn    = document.getElementById('claims-search-btn');
  const errEl  = document.getElementById('claims-error');
  const result = document.getElementById('claims-result');

  const doSearch = async (carnetNoOverride) => {
    const carnetNo = carnetNoOverride ?? input.value.trim();
    if (!carnetNo) {
      errEl.textContent = 'Please enter a Carnet No.';
      errEl.style.display = '';
      return;
    }
    input.value = carnetNo;
    errEl.style.display = 'none';
    btn.disabled = true;
    result.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const row = await api.cpd.searchClaims(carnetNo);
      result.innerHTML = buildClaimsResult(row);
      initClaimsTabs(result, row);
    } catch (e) {
      result.innerHTML = '';
      errEl.textContent = e.message ?? 'No record found.';
      errEl.style.display = '';
    } finally {
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', () => doSearch());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // ── Browsable list — previously the only way to find a claim was to already
  // know its carnet number and search for it individually. ──
  const claimsTable = new DataTable(
    document.getElementById('claims-list-table'),
    [
      { key: 'carnet_no',       label: 'Carnet No' },
      { key: 'cpd_request_id',  label: 'Request No' },
      { key: 'applicant',       label: 'Applicant', render: (_, r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—' },
      { key: 'claim_details',   label: 'Claim Details', render: v => v ? (v.length > 80 ? v.slice(0, 80) + '…' : v) : '—' },
      { key: 'added_by_name',   label: 'Added By',   render: v => v?.trim() || '—' },
      { key: 'added_datetime',  label: 'Added',       render: v => formatDateTime(v) },
      { key: 'actions', label: '', width: '70px',
        render: (_, r) => `<button class="btn btn-ghost btn-sm view-claim-btn" data-carnet="${r.carnet_no}" title="View">
          <i class="fa-solid fa-eye"></i></button>` },
    ],
    params => api.cpd.listClaims(params),
    { idKey: 'claim_id', searchPlaceholder: 'Search by carnet no, request no or applicant…' },
  ).render();

  document.getElementById('claims-list-table').addEventListener('click', e => {
    const viewBtn = e.target.closest('.view-claim-btn');
    if (viewBtn) doSearch(viewBtn.dataset.carnet);
  });
}

function buildClaimsResult(r) {
  const ownerName = [r.title, r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
  const vehicle   = [r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || '—';
  const returned  = r.request_status == 4;
  return `
    <div class="section-card" style="margin-top:16px">
      <div class="tab-bar" style="padding:0 20px">
        <button class="tab-btn active" data-claims-tab="carnet">Carnet Details</button>
        <button class="tab-btn"        data-claims-tab="claim">Claim Details</button>
      </div>
      <div data-claims-pane="carnet">
        <div class="section-card-body" style="border-top:1px solid var(--border)">
          <p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:10px">Carnet</p>
          <div class="detail-grid">
            ${detail('Carnet No',       r.carnet_no        ?? '—')}
            ${detail('Request ID',      r.request_id       ?? '—')}
            ${detail('Status',          statusBadge(r.status_label ?? r.request_status))}
            ${detail('Issued Date',     formatDateTime(r.issued_datetime))}
            ${returned ? detail('Returned Date', formatDateTime(r.returned_datetime)) : ''}
          </div>
          <p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:16px 0 10px">Vehicle</p>
          <div class="detail-grid">
            ${detail('Vehicle',         vehicle)}
            ${detail('Registration No', r.registration_no  ?? '—')}
            ${detail('Mulkiya No',      r.mulkiya_no       ?? '—')}
            ${detail('Chassis No',      r.chassis_no       ?? '—')}
            ${detail('Engine No',       r.engine_no        ?? '—')}
            ${detail('Color / Year',    [r.color, r.manuf_year].filter(Boolean).join(' / ') || '—')}
          </div>
          <p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:16px 0 10px">Owner</p>
          <div class="detail-grid">
            ${detail('Name',            ownerName)}
            ${detail('Passport No',     r.passport_no      ?? '—')}
            ${detail('Emirates ID',     r.emirates_id      ?? '—')}
            ${detail('Mobile',          r.mobile_no        ?? '—')}
            ${detail('Email',           r.email            ?? '—')}
            ${r.company_name         ? detail('Company',      r.company_name)         : ''}
            ${r.uae_address          ? detail('UAE Address',  r.uae_address)          : ''}
            ${r.home_country_address ? detail('Home Address', r.home_country_address) : ''}
          </div>
        </div>
      </div>
      <div data-claims-pane="claim" style="display:none">
        <div class="section-card-body" style="border-top:1px solid var(--border)">
          <div id="claims-list-wrap"><div class="spinner" style="margin:auto;width:24px;height:24px"></div></div>
          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button id="claims-add-btn" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-plus"></i> Add Claim
            </button>
            <button id="claims-hold-btn" class="btn btn-warning btn-sm">
              <i class="fa-solid fa-user-lock"></i> Put Customer on Hold
            </button>
          </div>
          <div id="claims-form-wrap" style="display:none;margin-top:16px"></div>
        </div>
      </div>
    </div>`;
}

function initClaimsTabs(container, r) {
  // Tab switching
  container.querySelectorAll('[data-claims-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.claimsTab;
      container.querySelectorAll('[data-claims-tab]').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('[data-claims-pane]').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      container.querySelector(`[data-claims-pane="${target}"]`).style.display = '';
      if (target === 'claim') loadClaimsList(container, r);
    });
  });

  // Add Claim button
  container.querySelector('#claims-add-btn')?.addEventListener('click', () => {
    const wrap = container.querySelector('#claims-form-wrap');
    wrap.style.display = '';
    wrap.innerHTML = buildClaimForm();
    initClaimForm(wrap, container, r);
    container.querySelector('#claims-add-btn').style.display = 'none';
  });

  // Put Customer on Hold button
  container.querySelector('#claims-hold-btn')?.addEventListener('click', () => {
    const eid = r.emirates_id ?? '';
    if (!eid) { toast('No Emirates ID found for this customer.', 'error'); return; }
    openModal({
      title: 'Put Customer on Hold',
      size:  'sm',
      body:  `<p style="font-size:.875rem;margin:0 0 12px">
                Emirates ID: <strong>${eid}</strong><br>
                <span style="color:var(--text-muted)">Customer: ${((r.first_name ?? '') + ' ' + (r.last_name ?? '')).trim() || '—'}</span>
              </p>
              <div class="field">
                <label>Reason <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>
                <textarea id="claims-hold-reason" rows="3"
                  placeholder="Enter reason for hold…"
                  style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);
                         background:var(--bg-surface);color:var(--text-primary);resize:vertical;font-family:inherit"></textarea>
              </div>
              <div id="claims-hold-error" class="alert alert-danger" style="display:none;margin-top:8px"></div>`,
      footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
               <button class="btn btn-warning" id="claims-hold-confirm-btn">
                 <i class="fa-solid fa-user-lock"></i> Confirm Hold
               </button>`,
    });

    document.getElementById('claims-hold-confirm-btn').addEventListener('click', async () => {
      const reason  = document.getElementById('claims-hold-reason').value.trim();
      const errEl   = document.getElementById('claims-hold-error');
      const btn     = document.getElementById('claims-hold-confirm-btn');
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      try {
        await api.cpd.placeHold({ emirates_id: eid, reason });
        closeModal();
        toast('Customer placed on hold', 'success');
      } catch (e) {
        errEl.textContent = e.message ?? 'Failed to place hold.';
        errEl.style.display = '';
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-lock"></i> Confirm Hold';
      }
    });
  });
}

async function loadClaimsList(container, r) {
  const wrap = container.querySelector('#claims-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="spinner" style="margin:auto;width:24px;height:24px"></div>';
  try {
    const claims = await api.cpd.getClaims(r.auto_id);
    if (!claims.length) {
      wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">No claims yet.</p>';
      return;
    }
    wrap.innerHTML = claims.map(c => `
      <div style="border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-weight:600;font-size:.875rem">Claim #${c.claim_id}</span>
            <span style="font-size:.75rem;color:var(--text-muted)">${formatDateTime(c.added_datetime)} &nbsp;·&nbsp; ${c.added_by_name ?? '—'}</span>
          </div>
          ${c.claim_details ? `<p style="font-size:.875rem;color:var(--text-primary);white-space:pre-wrap;margin:0 0 8px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${c.claim_details}</p>` : ''}
          ${c.documents?.length ? `<span style="font-size:.78rem;color:var(--text-muted)"><i class="fa-solid fa-paperclip"></i> ${c.documents.length} document${c.documents.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm view-claim-btn" data-claim-idx="${claims.indexOf(c)}" style="flex-shrink:0">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </div>`).join('');

    wrap.querySelectorAll('.view-claim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = claims[parseInt(btn.dataset.claimIdx)];
        openClaimModal(c);
      });
    });
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--danger);font-size:.875rem">${e.message}</p>`;
  }
}

function openClaimModal(c) {
  const claimDocs = c.documents?.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${c.documents.map(f => docChip(api.cpd.claimDocumentUrl(c.claim_id, f), f)).join('')}</div>`
    : '';

  openModal({
    title: `Claim #${c.claim_id}`,
    size: 'lg',
    body: `
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
        ${formatDateTime(c.added_datetime)} &nbsp;·&nbsp; ${c.added_by_name ?? '—'}
      </div>
      ${c.claim_details ? `<p style="font-size:.875rem;white-space:pre-wrap;line-height:1.6;margin-bottom:4px">${c.claim_details}</p>` : ''}
      ${claimDocs}
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0">Notes</p>
          <button id="claim-add-note-btn" class="btn btn-primary btn-sm">
            <i class="fa-solid fa-plus"></i> Add Note
          </button>
        </div>
        <div id="claim-note-form-wrap" style="display:none;margin-bottom:16px"></div>
        <div id="claim-notes-timeline"><div class="spinner" style="margin:auto;width:22px;height:22px"></div></div>
      </div>`,
  });

  // Load notes async after modal is in the DOM
  loadClaimNotes(c);

  document.getElementById('claim-add-note-btn')?.addEventListener('click', () => {
    const formWrap = document.getElementById('claim-note-form-wrap');
    if (formWrap.style.display !== 'none') return;
    formWrap.style.display = '';
    formWrap.innerHTML = buildNoteForm();
    initNoteForm(formWrap, c);
    document.getElementById('claim-add-note-btn').style.display = 'none';
  });
}

async function loadClaimNotes(c) {
  const timeline = document.getElementById('claim-notes-timeline');
  if (!timeline) return;
  try {
    const notes = await api.cpd.getClaimNotes(c.claim_id);
    renderNotesTimeline(timeline, notes, c.claim_id);
  } catch (e) {
    timeline.innerHTML = `<p style="color:var(--danger);font-size:.875rem">${e.message}</p>`;
  }
}

function renderNotesTimeline(timeline, notes, claimId) {
  if (!notes.length) {
    timeline.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">No notes yet.</p>';
    return;
  }
  timeline.innerHTML = `
    <div style="position:relative;padding-left:24px">
      <div style="position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--border)"></div>
      ${notes.map(n => `
        <div style="position:relative;margin-bottom:20px">
          <div style="position:absolute;left:-21px;top:3px;width:10px;height:10px;border-radius:50%;
                      background:var(--accent);border:2px solid var(--bg-surface)"></div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">
            ${formatDateTime(n.added_datetime)} &nbsp;·&nbsp; ${n.added_by_name ?? '—'}
          </div>
          ${n.note_text ? `<p style="font-size:.875rem;white-space:pre-wrap;line-height:1.6;margin:0 0 6px">${n.note_text}</p>` : ''}
          ${n.documents?.length ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${n.documents.map(f => docChip(api.cpd.claimNoteDocumentUrl(claimId, n.note_id, f), f)).join('')}
            </div>` : ''}
        </div>`).join('')}
    </div>`;
}

function docChip(url, filename) {
  return `<a href="${url}" target="_blank" rel="noopener"
    style="display:inline-flex;align-items:center;gap:5px;font-size:.78rem;padding:4px 10px;
           background:var(--bg-elevated);border:1px solid var(--border);border-radius:20px;
           color:var(--text-primary);text-decoration:none"
    onmouseover="this.style.borderColor='var(--accent)'"
    onmouseout="this.style.borderColor='var(--border)'">
    <i class="fa-solid fa-file-pdf" style="color:#e53e3e"></i>
    <span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${filename}</span>
    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:.6rem;color:var(--text-muted)"></i>
  </a>`;
}

function buildNoteForm() {
  return `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
      <div class="field" style="margin-bottom:12px">
        <label>Note</label>
        <textarea id="note-text-input" rows="4" placeholder="Enter note…" style="resize:vertical"></textarea>
      </div>
      <div>
        <label style="font-size:.82rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px">Documents (PDF only)</label>
        <input id="note-files-input" type="file" accept=".pdf,application/pdf" multiple style="display:none" />
        <button id="note-add-doc-btn" type="button" class="btn btn-ghost btn-sm">
          <i class="fa-solid fa-paperclip"></i> Add Document
        </button>
        <div id="note-files-list" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
      </div>
      <p id="note-form-error" style="display:none;color:var(--danger);font-size:.82rem;margin-top:8px"></p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="note-save-btn" class="btn btn-primary btn-sm"><i class="fa-solid fa-floppy-disk"></i> Save Note</button>
        <button id="note-cancel-btn" class="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>`;
}

function initNoteForm(wrap, c) {
  const fileInput   = wrap.querySelector('#note-files-input');
  const addDocBtn   = wrap.querySelector('#note-add-doc-btn');
  const filesList   = wrap.querySelector('#note-files-list');
  const saveBtn     = wrap.querySelector('#note-save-btn');
  const cancelBtn   = wrap.querySelector('#note-cancel-btn');
  const errEl       = wrap.querySelector('#note-form-error');
  let selectedFiles = [];

  addDocBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const MAX = 2 * 1024 * 1024;
    Array.from(fileInput.files).forEach(f => {
      if (f.size > MAX) { toast(`"${f.name}" exceeds the 2 MB limit and was not added.`, 'error'); return; }
      if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) selectedFiles.push(f);
    });
    fileInput.value = '';
    renderNoteFilesList();
  });

  function renderNoteFilesList() {
    filesList.innerHTML = selectedFiles.map((f, i) => `
      <div style="display:flex;align-items:center;gap:8px;font-size:.82rem">
        <i class="fa-solid fa-file-pdf" style="color:#e53e3e;flex-shrink:0"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
        <span style="color:var(--text-muted)">${(f.size/1024).toFixed(0)} KB</span>
        <button type="button" class="btn btn-ghost btn-sm" data-remove="${i}"
          style="padding:2px 6px;color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
    filesList.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', () => { selectedFiles.splice(parseInt(btn.dataset.remove), 1); renderNoteFilesList(); })
    );
  }

  cancelBtn.addEventListener('click', () => {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    document.getElementById('claim-add-note-btn').style.display = '';
  });

  saveBtn.addEventListener('click', async () => {
    errEl.style.display = 'none';
    const noteText = wrap.querySelector('#note-text-input').value.trim();
    if (!noteText && !selectedFiles.length) {
      errEl.textContent = 'Please enter a note or attach at least one document.';
      errEl.style.display = ''; return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      const fd = new FormData();
      fd.append('note_text', noteText);
      selectedFiles.forEach(f => fd.append('documents[]', f));
      await api.cpd.addClaimNote(c.claim_id, fd);
      toast('Note saved', 'success');
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      document.getElementById('claim-add-note-btn').style.display = '';
      await loadClaimNotes(c);
    } catch (e) {
      errEl.textContent = e.message ?? 'Failed to save note.';
      errEl.style.display = '';
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Note';
    }
  });
}

function buildClaimForm() {
  return `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <p style="font-weight:600;font-size:.9rem;margin-bottom:12px">New Claim</p>
      <div class="field">
        <label>Claim Details</label>
        <textarea id="claim-details-input" rows="5" placeholder="Describe the claim…"
          style="resize:vertical"></textarea>
      </div>
      <div style="margin-top:14px">
        <label style="font-size:.82rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:8px">Documents (PDF only)</label>
        <input id="claim-files-input" type="file" accept=".pdf,application/pdf" multiple style="display:none" />
        <button id="claim-add-doc-btn" type="button" class="btn btn-ghost btn-sm">
          <i class="fa-solid fa-paperclip"></i> Add Document
        </button>
        <div id="claim-files-list" style="margin-top:8px;display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <p id="claim-form-error" style="display:none;color:var(--danger);font-size:.82rem;margin-top:10px"></p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="claim-save-btn" class="btn btn-primary btn-sm">
          <i class="fa-solid fa-floppy-disk"></i> Save Claim
        </button>
        <button id="claim-cancel-btn" class="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>`;
}

function initClaimForm(wrap, container, r) {
  const fileInput  = wrap.querySelector('#claim-files-input');
  const addDocBtn  = wrap.querySelector('#claim-add-doc-btn');
  const filesList  = wrap.querySelector('#claim-files-list');
  const saveBtn    = wrap.querySelector('#claim-save-btn');
  const cancelBtn  = wrap.querySelector('#claim-cancel-btn');
  const errEl      = wrap.querySelector('#claim-form-error');
  let selectedFiles = [];

  addDocBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const MAX = 2 * 1024 * 1024;
    Array.from(fileInput.files).forEach(f => {
      if (f.size > MAX) { toast(`"${f.name}" exceeds the 2 MB limit and was not added.`, 'error'); return; }
      if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) {
        selectedFiles.push(f);
      }
    });
    fileInput.value = '';
    renderFilesList();
  });

  function renderFilesList() {
    filesList.innerHTML = selectedFiles.map((f, i) => `
      <div style="display:flex;align-items:center;gap:8px;font-size:.82rem;padding:4px 0">
        <i class="fa-solid fa-file-pdf" style="color:#e53e3e;flex-shrink:0"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
        <span style="color:var(--text-muted)">${(f.size/1024).toFixed(0)} KB</span>
        <button type="button" class="btn btn-ghost btn-sm" data-remove="${i}"
          style="padding:2px 6px;color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
    filesList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.remove), 1);
        renderFilesList();
      });
    });
  }

  cancelBtn.addEventListener('click', () => {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    container.querySelector('#claims-add-btn').style.display = '';
  });

  saveBtn.addEventListener('click', async () => {
    errEl.style.display = 'none';
    const claimDetails = wrap.querySelector('#claim-details-input').value.trim();
    if (!claimDetails && !selectedFiles.length) {
      errEl.textContent = 'Please enter claim details or attach at least one document.';
      errEl.style.display = '';
      return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    try {
      const fd = new FormData();
      fd.append('request_id',    r.auto_id);
      fd.append('carnet_no',     r.carnet_no);
      fd.append('claim_details', claimDetails);
      selectedFiles.forEach(f => fd.append('documents[]', f));

      await api.cpd.addClaim(fd);
      toast('Claim saved successfully', 'success');
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      container.querySelector('#claims-add-btn').style.display = '';
      await loadClaimsList(container, r);
    } catch (e) {
      errEl.textContent = e.message ?? 'Failed to save claim.';
      errEl.style.display = '';
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Claim';
    }
  });
}

// ── Customer Holds ────────────────────────────────────────────────────────────

export function renderCPDHolds() {
  const page = document.getElementById('page-content');
  page.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Customer Holds</h2>
      </div>
      <div class="card-body" style="padding:0">
        <div id="holds-table-wrap"></div>
      </div>
    </div>`;

  const dt = new DataTable(
    document.getElementById('holds-table-wrap'),
    [
      { key: 'emirates_id',    label: 'Emirates ID' },
      { key: 'customer_name',  label: 'Customer' },
      { key: 'hold_reason',    label: 'Reason',
        render: v => v || '<span style="color:var(--text-muted)">—</span>' },
      { key: 'placed_by_name', label: 'Placed By' },
      { key: 'placed_at',      label: 'Placed On',
        render: v => v ? new Date(v).toLocaleDateString('en-AE') : '—' },
      { key: 'is_active',      label: 'Status',
        render: v => v
          ? '<span style="padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:600;background:var(--danger,#e53e3e);color:#fff">Active</span>'
          : '<span style="padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:600;background:var(--bg-hover);color:var(--text-muted)">Lifted</span>' },
      { key: 'actions', label: '', width: '60px',
        render: (_, r) => `<button class="btn btn-ghost btn-sm view-hold-btn" data-eid="${r.emirates_id}" title="View"><i class="fa-solid fa-eye"></i></button>` },
    ],
    p => api.cpd.listHolds(p),
    { defaultSort: 'placed_at', defaultDir: 'DESC' },
  );
  dt.render();

  document.getElementById('holds-table-wrap').addEventListener('click', async e => {
    const btn = e.target.closest('.view-hold-btn');
    if (!btn) return;
    openHoldViewModal(btn.dataset.eid, dt);
  });
}

async function openHoldViewModal(eid, dt) {
  openModal({
    title: 'Customer Hold',
    size:  'lg',
    body:  '<div style="text-align:center;padding:32px"><i class="fa-solid fa-spinner fa-spin fa-lg"></i></div>',
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>',
  });
  const modalBody = document.getElementById('modal-body');
  try {
    const data = await api.cpd.searchHold(eid);
    renderHoldResult(modalBody, data, dt);
  } catch (e) {
    modalBody.innerHTML = `<p class="alert alert-danger">${e.message ?? 'Failed to load.'}</p>`;
  }
}

function renderHoldResult(container, data, dt) {
  const p          = data.profile;
  const activeHold = data.active_hold;
  const history    = data.history ?? [];
  const eid        = data.emirates_id;

  const profileHtml = p
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:.875rem">
         <div><span style="color:var(--text-muted)">Name</span><br><strong>${p.first_name ?? ''} ${p.last_name ?? ''}</strong></div>
         <div><span style="color:var(--text-muted)">Mobile</span><br><strong>${p.mobile_no ?? '—'}</strong></div>
         <div><span style="color:var(--text-muted)">Email</span><br><strong>${p.email ?? '—'}</strong></div>
         <div><span style="color:var(--text-muted)">Emirates ID</span><br><strong>${eid}</strong></div>
       </div>`
    : `<p style="font-size:.875rem;color:var(--text-muted)">No profile found for this Emirates ID. A hold can still be placed.</p>
       <p style="font-size:.875rem"><strong>Emirates ID:</strong> ${eid}</p>`;

  const holdStatusHtml = activeHold
    ? `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
         <div>
           <span style="display:inline-flex;align-items:center;gap:6px;background:var(--danger,#e53e3e);color:#fff;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600">
             <i class="fa-solid fa-lock"></i> ON HOLD
           </span>
           <p style="margin:8px 0 2px;font-size:.875rem"><strong>Reason:</strong> ${activeHold.hold_reason || '(no reason given)'}</p>
           <p style="margin:0;font-size:.8rem;color:var(--text-muted)">Placed by ${activeHold.placed_by_name ?? '—'} on ${new Date(activeHold.placed_at).toLocaleDateString('en-AE')}</p>
         </div>
         <button class="btn btn-success btn-sm" id="holds-lift-btn" data-hold-id="${activeHold.hold_id}">
           <i class="fa-solid fa-lock-open"></i> Lift Hold
         </button>
       </div>`
    : `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
         <span style="display:inline-flex;align-items:center;gap:6px;background:var(--success,#38a169);color:#fff;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600">
           <i class="fa-solid fa-circle-check"></i> No Active Hold
         </span>
         <button class="btn btn-danger btn-sm" id="holds-place-btn" data-eid="${eid}">
           <i class="fa-solid fa-lock"></i> Place Hold
         </button>
       </div>`;

  const historyHtml = history.length
    ? history.map(h => `
        <tr>
          <td style="font-size:.82rem">${new Date(h.placed_at).toLocaleDateString('en-AE')}</td>
          <td style="font-size:.82rem">${h.hold_reason || '—'}</td>
          <td style="font-size:.82rem">${h.placed_by_name ?? '—'}</td>
          <td style="font-size:.82rem">${h.lifted_at ? new Date(h.lifted_at).toLocaleDateString('en-AE') + '<br><small style="color:var(--text-muted)">' + (h.lifted_by_name ?? '') + '</small>' : '—'}</td>
          <td><span style="padding:2px 8px;border-radius:999px;font-size:.75rem;font-weight:600;background:${h.is_active ? 'var(--danger,#e53e3e)' : 'var(--bg-hover)'};color:${h.is_active ? '#fff' : 'var(--text-muted)'}">
            ${h.is_active ? 'Active' : 'Lifted'}
          </span></td>
        </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);font-size:.875rem">No hold history</td></tr>';

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;max-width:720px">
      <div class="card">
        <div class="card-header"><h3 class="card-title" style="font-size:1rem">Customer Profile</h3></div>
        <div class="card-body">${profileHtml}</div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title" style="font-size:1rem">Hold Status</h3></div>
        <div class="card-body">${holdStatusHtml}</div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title" style="font-size:1rem">Hold History</h3></div>
        <div class="card-body" style="padding:0">
          <table class="table" style="margin:0">
            <thead><tr><th>Date Placed</th><th>Reason</th><th>Placed By</th><th>Lifted</th><th>Status</th></tr></thead>
            <tbody>${historyHtml}</tbody>
          </table>
        </div>
      </div>
    </div>`;

  document.getElementById('holds-place-btn')?.addEventListener('click', () => openPlaceHoldModal(eid, container, data, dt));
  document.getElementById('holds-lift-btn')?.addEventListener('click', () => liftHold(activeHold.hold_id, eid, container, dt));
}

function openPlaceHoldModal(eid, container, prevData, dt) {
  openModal({
    title: 'Place Customer Hold',
    size:  'sm',
    body:  `<p style="font-size:.875rem;margin:0 0 12px">Emirates ID: <strong>${eid}</strong></p>
            <div class="field">
              <label>Reason <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>
              <textarea id="hold-reason-input" rows="3" placeholder="Enter reason for hold…"
                style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);
                       background:var(--bg-surface);color:var(--text-primary);resize:vertical;font-family:inherit"></textarea>
            </div>
            <div id="hold-modal-error" class="alert alert-danger" style="display:none;margin-top:8px"></div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
             <button class="btn btn-danger" id="hold-confirm-btn">
               <i class="fa-solid fa-lock"></i> Confirm Hold
             </button>`,
  });

  document.getElementById('hold-confirm-btn').addEventListener('click', async () => {
    const reason  = document.getElementById('hold-reason-input').value.trim();
    const errEl   = document.getElementById('hold-modal-error');
    const btn     = document.getElementById('hold-confirm-btn');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      await api.cpd.placeHold({ emirates_id: eid, reason });
      closeModal();
      toast('Hold placed successfully', 'success');
      dt?.render();
    } catch (e) {
      errEl.textContent = e.message ?? 'Failed to place hold.';
      errEl.style.display = '';
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> Confirm Hold';
    }
  });
}

function liftHold(holdId, eid, container, dt) {
  confirm('Lift this hold? The customer will be able to apply again.', async () => {
    try {
      await api.cpd.liftHold(holdId);
      toast('Hold lifted', 'success');
      dt?.render();
      const fresh = await api.cpd.searchHold(eid);
      renderHoldResult(container, fresh, dt);
    } catch (e) {
      toast(e.message ?? 'Failed to lift hold.', 'error');
    }
  }, false);
}
