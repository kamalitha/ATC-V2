// pages/public.js — Public user (role 2) pages
import api, { API_BASE, PUBLIC_BASE } from '../api.js';
import { navigate, toast, openModal, closeModal, currentUser, confirm } from '../app.js';
import { statusBadge, formatDate, formatDateTime } from '../components/table.js';

// ── Select Service (shown once, right after a public user logs in) ────────────
export async function renderPublicSelectService() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Welcome${currentUser?.first_name ? `, ${currentUser.first_name}` : ''}</h1>
        <p class="page-subtitle">Which service would you like to use today?</p>
      </div>
    </div>

    <div class="del-method-grid" style="max-width:720px">
      <label class="del-method-card" id="select-service-idl">
        <div class="del-method-icon-wrap"><i class="fa-solid fa-id-card"></i></div>
        <div>
          <div class="del-method-title">International Driving Licence (IDL)</div>
          <div class="del-method-desc">Apply for or renew your International Driving Permit.</div>
        </div>
      </label>
      <label class="del-method-card" id="select-service-cpd">
        <div class="del-method-icon-wrap"><i class="fa-solid fa-car"></i></div>
        <div>
          <div class="del-method-title">Carnet De Passage (CPD)</div>
          <div class="del-method-desc">Apply for, renew or return your vehicle Carnet.</div>
        </div>
      </label>
    </div>`;

  document.getElementById('select-service-idl').addEventListener('click', () => navigate('public-apply-idl'));
  document.getElementById('select-service-cpd').addEventListener('click', () => navigate('public-apply-cpd'));
}

// ── Wizard step definitions ────────────────────────────────────────────────────
const STEPS = [
  { id: 'identity',  label: 'Identity Verification'      },
  { id: 'licence',   label: 'Driving Licence & Documents' },
  { id: 'delivery',  label: 'Delivery'                    },
  { id: 'review',    label: 'Review & Pay'                },
];

// ── Per-step required fields for validation ────────────────────────────────────
const STEP_REQUIRED = {
  identity: [
    { name: 'full_name',            label: 'Full Name' },
    { name: 'emirates_id',          label: 'Emirates ID' },
    { name: 'nationality',          label: 'Nationality' },
    { name: 'sex',                  label: 'Gender' },
    { name: 'mobile_no',            label: 'Mobile No' },
    { name: 'email',                label: 'Email' },
    { name: 'place_of_birth',       label: 'Place of Birth' },
    { name: 'emirate',              label: 'UAE Permanent Place of Residence' },
  ],
  licence: [
    { name: 'license_no',     label: 'Driving Licence Number' },
    { name: 'issued_date',    label: 'Date of Issue' },
    { name: 'place_of_issue', label: 'Licence Issuing Emirate' },
    { name: 'expiry_date',    label: 'Date of Expiry' },
  ],
  delivery: [],
  review:   [],
};

// ── Apply for IDL (wizard) ─────────────────────────────────────────────────────
export async function renderPublicApplyIDL(param = null) {
  const content = document.getElementById('page-content');
  const isRenew = (typeof param === 'object' && param?.mode === 'renew');

  const [nationalities, dlTypes, emirates, idlCfg] = await Promise.all([
    api.idl.nationalities(),
    api.idl.dlTypes(),
    api.idl.emirates(),
    api.idl.config(),
  ]);

  const BASE_AMOUNT  = Number(idlCfg.idl_amount  ?? 160.00);
  const ADMIN_FEE    = Number(idlCfg.admin_fee    ?? 10.00);
  const DELIVERY_FEE = Number(idlCfg.delivery_fee ?? 15.75);

  // Fetch last IDL request for this user to pre-populate fields
  let lastRequest = null;
  try {
    const mine = await api.idl.myRequests(1);
    if (mine.data?.length) {
      lastRequest = await api.idl.get(mine.data[0].auto_id);
    }
  } catch { /* no previous requests — start blank */ }

  // Status timeline builder for the right panel
  function buildStatusTimeline(requestStatus) {
    const rs = parseInt(requestStatus, 10);
    const steps = [
      { label: 'Application Submitted', done: rs >= 1, active: rs === 1 },
      { label: 'Payment Confirmed',     done: rs >= 2, active: rs === 2 },
      { label: 'Under Review',          done: rs >= 3, active: rs === 3 },
      { label: 'IDL Issued',            done: rs >= 4, active: rs === 4 },
    ];
    return steps.map((s, i) => {
      const dotClass = s.done && !s.active ? 'done' : s.active ? 'active' : 'pending';
      const hasLine   = i < steps.length - 1;
      return `
        <div class="spt-item">
          <div class="spt-dot-wrap">
            <div class="spt-dot spt-dot-${dotClass}"></div>
            ${hasLine ? '<div class="spt-line"></div>' : ''}
          </div>
          <div class="spt-label ${s.active ? 'spt-label-active' : s.done ? 'spt-label-done' : ''}">${s.label}</div>
        </div>`;
    }).join('');
  }

  let currentStep = 0;

  // ── Build step content HTML ──────────────────────────────────────────────────
  function stepIdentity() {
    const u = currentUser ?? {};
    const r = lastRequest ?? {};
    const viaUaePass = !!u.via_uae_pass;
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';

    const firstName       = u.first_name ?? r.first_name ?? '';
    const lastName        = u.last_name ?? r.last_name ?? '';
    const fullNameValue   = [firstName, lastName].filter(Boolean).join(' ');
    const emiratesId      = u.emirates_id ?? r.emirates_id ?? '';
    const dobRaw          = u.dob ?? r.dob ?? '';
    const dobValue        = dobRaw ? String(dobRaw).split('T')[0].split(' ')[0] : '';
    const dobDisplay      = dobValue ? new Date(dobValue).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const nationalityId   = String(u.nationality ?? r.nationality_id ?? r.nationality ?? '');
    const nationalityName = nationalities.find(n => String(n.nationality_id) === nationalityId)?.nationality || '—';
    const sex             = u.sex ?? r.sex ?? '';
    const mobileNo        = u.mobile_no ?? r.mobile_no ?? '';
    const email           = u.email ?? r.email ?? '';

    const identityRowsHtml = viaUaePass ? `
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Full Name</span>
            <span class="pub-id-value">${fullName}</span>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Emirates ID</span>
            <span class="pub-id-value">${emiratesId || '—'}</span>
            <input type="hidden" name="emirates_id" value="${emiratesId}" />
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-flag"></i></span>
            <span class="pub-id-label">Nationality</span>
            <span class="pub-id-value">${nationalityName}</span>
            <input type="hidden" name="nationality" value="${nationalityId}" />
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-venus-mars"></i></span>
            <span class="pub-id-label">Gender</span>
            <span class="pub-id-value">${sex || '—'}</span>
            <input type="hidden" name="sex" value="${sex}" />
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Mobile Number</span>
            <span class="pub-id-value">${mobileNo || '—'}</span>
            <input type="hidden" name="mobile_no" value="${mobileNo}" />
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-envelope"></i></span>
            <span class="pub-id-label">Email Address</span>
            <span class="pub-id-value">${email || '—'}</span>
            <input type="hidden" name="email" value="${email}" />
          </div>` : `
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Full Name</span>
            <input name="full_name" class="pub-id-inline-input" placeholder="Full name" value="${fullNameValue}" />
            <div class="field-error" id="err-full_name" style="margin:0"></div>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Emirates ID</span>
            <input name="emirates_id" class="pub-id-inline-input" placeholder="784-XXXX-XXXXXXX-X" value="${emiratesId}" />
            <div class="field-error" id="err-emirates_id" style="margin:0"></div>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-flag"></i></span>
            <span class="pub-id-label">Nationality</span>
            <select name="nationality" class="pub-id-inline-select">
              <option value="">Select nationality</option>
              ${nationalities.map(n => `<option value="${n.nationality_id}" ${String(n.nationality_id) === nationalityId ? 'selected' : ''}>${n.nationality}</option>`).join('')}
            </select>
            <div class="field-error" id="err-nationality" style="margin:0"></div>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-venus-mars"></i></span>
            <span class="pub-id-label">Gender</span>
            <select name="sex" class="pub-id-inline-select">
              <option value="">Select</option>
              <option value="Male" ${sex === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${sex === 'Female' ? 'selected' : ''}>Female</option>
            </select>
            <div class="field-error" id="err-sex" style="margin:0"></div>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            <span class="pub-id-label">Mobile Number</span>
            <input name="mobile_no" class="pub-id-inline-input" placeholder="+971 50 xxx xxxx" value="${mobileNo}" />
            <div class="field-error" id="err-mobile_no" style="margin:0"></div>
          </div>
          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-envelope"></i></span>
            <span class="pub-id-label">Email Address</span>
            <input name="email" type="email" class="pub-id-inline-input" placeholder="your@email.com" value="${email}" />
            <div class="field-error" id="err-email" style="margin:0"></div>
          </div>`;

    return `
      <!-- Identity verification header -->
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-user"></i></div>
        <div>
          <div class="pub-step-title">Verify Your Identity</div>
          <div class="pub-step-sub">${viaUaePass ? 'We use UAE PASS to verify your identity and pre-fill your details.' : 'Please enter your identity details below.'}</div>
        </div>
      </div>

      ${viaUaePass ? `
      <!-- Verified banner -->
      <div class="pub-verified-banner">
        <i class="fa-solid fa-circle-check pub-verified-icon"></i>
        <div>
          <div class="pub-verified-title">UAE PASS Profile Verified</div>
          <div class="pub-verified-sub">Your identity has been successfully verified.</div>
        </div>
      </div>` : ''}

      <!-- Identity card -->
      <div class="pub-identity-card">
        <div class="pub-identity-card-header">
          <span>Your Identity Information</span>
          ${viaUaePass ? '<span class="pub-verified-badge"><i class="fa-solid fa-shield-halved"></i> Verified by UAE PASS</span>' : ''}
        </div>
        <div class="pub-identity-rows">
          ${identityRowsHtml}
        </div>
      </div>

      <!-- Additional information (editable) -->
      <div class="pub-additional-card">
        <div class="pub-additional-title">Additional Information</div>
        <div class="form-grid pub-additional-grid" style="margin-top:16px">

          <div class="field"><label>Date of Birth</label>
            <div class="pub-input-icon-wrap">
              ${viaUaePass
                ? `<input value="${dobDisplay}" readonly /><input type="hidden" name="dob" value="${dobValue}" />`
                : `<input name="dob" type="date" value="${dobValue}" />`}
              <i class="fa-regular fa-calendar pub-input-icon-right"></i>
            </div>
          </div>

          <div class="field"><label>Place of Birth *</label>
            <div class="pub-input-icon-wrap">
              <input name="place_of_birth" required placeholder="Enter city or country of birth" />
              <i class="fa-solid fa-location-dot pub-input-icon-right"></i>
            </div>
            <div class="field-error" id="err-place_of_birth"></div>
          </div>

          <div class="field">
            <label>UAE Permanent Place of Residence *</label>
            <div class="pub-input-icon-wrap">
              <select name="emirate" required>
                <option value="">Select emirate</option>
                ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
              </select>
              <i class="fa-solid fa-chevron-down pub-input-icon-right"></i>
            </div>
            <p class="pub-field-hint"><i class="fa-solid fa-circle-info"></i> As it appears on your passport or official documents.</p>
            <div class="field-error" id="err-emirate"></div>
          </div>

          <div class="field"><label>Additional Phone Number</label>
            <div class="pub-input-icon-wrap">
              <input name="additional_mobile_no" placeholder="+971 50 xxx xxxx" />
              <i class="fa-solid fa-phone pub-input-icon-right"></i>
            </div>
            <div class="field-error" id="err-additional_mobile_no"></div>
          </div>

          <div class="field"><label>Additional Email</label>
            <div class="pub-input-icon-wrap">
              <input name="additional_email" type="email" placeholder="alternate@email.com" />
              <i class="fa-regular fa-envelope pub-input-icon-right"></i>
            </div>
            <div class="field-error" id="err-additional_email"></div>
          </div>

        </div>
      </div>`;
  }

  function stepLicence() {
    const catInfo = [
      { code:'A', icon:'fa-motorcycle',  name:'Motorcycle',        desc:'For motorcycles with or without a sidecar.' },
      { code:'B', icon:'fa-car',         name:'Car',               desc:'For motor vehicles up to 3,500 kg with up to 8 passenger seats.' },
      { code:'C', icon:'fa-truck',       name:'Heavy Vehicle',     desc:'For vehicles over 3,500 kg.' },
      { code:'D', icon:'fa-bus',         name:'Bus',               desc:'For buses with more than 8 passenger seats.' },
      { code:'E', icon:'fa-trailer',     name:'Car with Heavy Trailer', desc:'For combination of vehicles in category B, C or D.' },
    ];
    return `
      <!-- ── Section header ── -->
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-id-card"></i></div>
        <div>
          <div class="pub-step-title">Driving Licence &amp; Documents</div>
          <div class="pub-step-sub">Provide your driving licence details and upload the required documents.</div>
        </div>
      </div>

      <!-- ── Driving Licence Details ── -->
      <div class="pub-additional-card" style="margin-bottom:20px">
        <div class="pub-additional-title">Driving Licence Details</div>
        <div class="form-grid" style="margin-top:16px">

          <div class="field"><label>Driving Licence Number *</label>
            <input name="license_no" required placeholder="Enter driving licence number" />
            <div class="field-error" id="err-license_no"></div>
          </div>

          <div class="field"><label>Date of Issue *</label>
            <input name="issued_date" type="date" required />
            <div class="field-error" id="err-issued_date"></div>
          </div>

          <div class="field"><label>Licence Issuing Emirate *</label>
            <select name="place_of_issue" required>
              <option value="">Select emirate</option>
              ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
            </select>
            <div class="field-error" id="err-place_of_issue"></div>
          </div>

          <div class="field"><label>Date of Expiry *</label>
            <input name="expiry_date" type="date" required />
            <div class="field-error" id="err-expiry_date"></div>
          </div>

        </div>
      </div>

      <!-- ── Vehicle Categories ── -->
      <div class="pub-additional-card" style="margin-bottom:20px">
        <div class="pub-additional-title" style="display:flex;align-items:center;justify-content:space-between">
          <span>Vehicle Categories *</span>
          <button type="button" class="vc-info-btn" id="vc-info-btn" title="About Licence Categories">
            <i class="fa-solid fa-circle-info"></i>
          </button>
        </div>

        <!-- Info tooltip panel -->
        <div class="vc-info-panel" id="vc-info-panel" style="display:none">
          <div class="vc-info-panel-title"><i class="fa-solid fa-circle-info"></i> About Licence Categories</div>
          ${catInfo.map(c => `
            <div class="vc-info-row">
              <span class="vc-info-code">${c.code}</span>
              <div><strong>${c.name}</strong><br><span>${c.desc}</span></div>
            </div>`).join('')}
        </div>

        <p style="font-size:.85rem;color:var(--text-muted);margin:10px 0 14px">
          Select all the categories that are mentioned on your driving licence.
        </p>
        <div class="vc-grid">
          ${catInfo.map(c => `
            <label class="vc-tile" id="vc-tile-${c.code}">
              <input type="checkbox" class="vc-cb" name="vc_${c.code}" value="${c.code}" style="display:none" />
              <i class="fa-solid ${c.icon} vc-tile-icon"></i>
              <span class="vc-tile-code">${c.code} &ndash; ${c.name}</span>
            </label>`).join('')}
        </div>
        <input type="hidden" name="type_of_dl" id="type_of_dl_hidden" />
        <div class="field-error" id="err-type_of_dl" style="margin-top:8px"></div>
      </div>

      <!-- ── Documents Upload ── -->
      <div class="pub-additional-card">
        <div class="pub-additional-title">Documents Upload</div>
        <p style="font-size:.78rem;color:var(--text-muted);margin:4px 0 16px">
          Accepted formats: JPG, PNG or PDF &nbsp;·&nbsp; Max 5 MB (Photo), 2 MB (Signature)
        </p>
        <div class="doc-upload-grid">
          ${docUploadHtml('eid_front',     'Emirates ID (Front)',          `${PUBLIC_BASE}/images/doc-placeholders/em_id_front.png`)}
          ${docUploadHtml('eid_back',      'Emirates ID (Back)',           `${PUBLIC_BASE}/images/doc-placeholders/em_id_back.png`)}
          ${docUploadHtml('dl_front',      'Driving Licence (Front)',      `${PUBLIC_BASE}/images/doc-placeholders/dl_front.png`)}
          ${docUploadHtml('dl_back',       'Driving Licence (Back)',       `${PUBLIC_BASE}/images/doc-placeholders/dl_back.png`)}
          ${docUploadHtml('passport_photo','Passport Size Photo',          `${PUBLIC_BASE}/images/doc-placeholders/passport.png`)}
          <div class="doc-upload-item">
            <div class="doc-upload-label">Signature *</div>
            <div class="doc-upload-zone" data-key="signature" id="doc-zone-signature">
              <input type="file" accept=".jpg,.jpeg,.png" data-doc="signature" style="display:none" />
              <div class="doc-upload-placeholder">
                <i class="fa-solid fa-signature"></i>
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
            <button type="button" id="sig-draw-btn" class="sig-draw-btn">
              <i class="fa-solid fa-pen"></i> Or draw your signature
            </button>
            <div class="field-error" id="err-doc-signature" style="margin-top:4px"></div>
          </div>
        </div>
        <div id="doc-upload-error" class="form-error hidden" style="margin-top:8px"></div>

        <!-- Signature draw modal -->
        <div class="sig-modal" id="sig-modal" style="display:none">
          <div class="sig-modal-box">
            <div class="sig-modal-header">
              <span>Draw Your Signature</span>
              <button type="button" id="sig-modal-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <canvas id="sig-canvas" class="sig-canvas" width="560" height="200"></canvas>
            <div class="sig-modal-actions">
              <button type="button" class="btn btn-ghost" id="sig-clear-btn">Clear</button>
              <button type="button" class="btn btn-primary" id="sig-save-btn">Use Signature</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  const OFFICES = [
    {
      id: 'dubai',
      deliveryValue: 'pick_from_dubai_office',
      name: 'Dubai Office',
      addr: 'Emirates Motorsports Organization<br>P.O. Box 5078, Al Wuheida St, 5078,<br>Dubai, UAE',
      hours: [
        ['Mon–Thu', '8:00 AM – 7:30 PM'],
        ['Friday', '8:00 – 11:30 AM, 1:30 – 7:30 PM'],
        ['Saturday', '9:00 AM – 4:30 PM'],
        ['Sunday', 'Closed'],
      ],
    },
    {
      id: 'abu_dhabi',
      deliveryValue: 'pick_from_abudhabi_office',
      name: 'Abu Dhabi Office',
      addr: 'Emirates Motorsports Organization<br>P.O. Box 27487, Abu Dhabi, UAE',
      hours: [
        ['Mon–Sat', '8:00 AM – 5:00 PM'],
        ['Sunday', 'Closed'],
      ],
    },
  ];

  function stepDelivery() {
    const isHome = (formData.delivery_option ?? 'home_delivery') === 'home_delivery';
    const currentOffice   = OFFICES.find(o => o.deliveryValue === formData.delivery_option) ?? OFFICES[0];
    const selectedOffice  = currentOffice.id;
    return `
      <!-- Header -->
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-truck"></i></div>
        <div>
          <div class="pub-step-title">Delivery Method &amp; Address</div>
          <div class="pub-step-sub">Choose how you would like to receive your International Driving Permit.</div>
        </div>
      </div>

      <!-- Delivery method cards -->
      <div style="margin-bottom:24px">
        <div class="del-method-label">Choose Delivery Method</div>
        <div class="del-method-grid">

          <label class="del-method-card ${isHome ? 'del-method-card-active' : ''}" id="del-card-home">
            <input type="radio" name="delivery_option" value="home_delivery" ${isHome ? 'checked' : ''} style="display:none" />
            <div class="del-method-radio" id="del-radio-home">
              ${isHome ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>'}
            </div>
            <div class="del-method-icon-wrap"><i class="fa-solid fa-house"></i></div>
            <div>
              <div class="del-method-title">Home Delivery</div>
              <div class="del-method-fee">AED ${DELIVERY_FEE.toFixed(2)}</div>
              <div class="del-method-desc">Delivered within 24–48 hours</div>
            </div>
          </label>

          <label class="del-method-card ${!isHome ? 'del-method-card-active' : ''}" id="del-card-collection">
            <input type="radio" name="delivery_option" id="del-radio-collection-input" value="${currentOffice.deliveryValue}" ${!isHome ? 'checked' : ''} style="display:none" />
            <div class="del-method-radio" id="del-radio-collection">
              ${!isHome ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>'}
            </div>
            <div class="del-method-icon-wrap"><i class="fa-solid fa-building"></i></div>
            <div>
              <div class="del-method-title">Collection</div>
              <div class="del-method-fee del-method-fee-free">Free</div>
              <div class="del-method-desc">Collect from our office</div>
            </div>
          </label>

        </div>
      </div>

      <!-- Two-column body -->
      <div class="del-body-grid">

        <!-- Left: Delivery address (shown for home delivery) -->
        <div id="del-address-col" style="display:${isHome ? '' : 'none'}">
          <div class="del-section-label">Delivery Address</div>
          <div class="del-address-grid">

            <div class="field del-addr-third">
              <label>Building / Villa / Floor #</label>
              <input name="del_building" id="del-building" placeholder="E.g. Villa 12, Floor 3" />
            </div>

            <div class="field del-addr-half">
              <label>Street / Road</label>
              <input name="del_street" id="del-street" placeholder="E.g. Sheikh Zayed Road" />
            </div>

            <div class="field del-addr-third">
              <label>Area</label>
              <div class="pub-input-icon-wrap">
                <select name="del_area" id="del-area">
                  <option value="">Select area</option>
                </select>
                <i class="fa-solid fa-chevron-down pub-input-icon-right"></i>
              </div>
              <div class="field-error" id="err-del_area"></div>
            </div>

            <div class="field del-addr-half">
              <label>Emirate *</label>
              <div class="pub-input-icon-wrap">
                <select name="del_emirate" id="del-emirate">
                  <option value="">Select emirate</option>
                  ${emirates.map(e => `<option value="${e.emirate_id}">${e.emirate}</option>`).join('')}
                </select>
                <i class="fa-solid fa-chevron-down pub-input-icon-right"></i>
              </div>
              <div class="field-error" id="err-del_emirate"></div>
            </div>

            <div class="field del-addr-half">
              <label>Additional Address Details <span style="color:var(--text-muted);font-weight:400">(Optional)</span></label>
              <input name="del_extra" id="del-extra" placeholder="E.g. Near landmark or building name" />
            </div>

          </div>

          <div class="del-info-banner">
            <i class="fa-solid fa-circle-info" style="color:var(--accent);flex-shrink:0;font-size:1rem"></i>
            <div>
              <div>Please ensure someone is available to receive the delivery.</div>
              <div>A valid contact number is required for delivery updates.</div>
            </div>
          </div>
          <div class="field-error" id="err-delivery_address"></div>
        </div>

        <!-- Right: Collection locations (shown for office pickup) -->
        <div id="del-collection-col" style="display:${!isHome ? '' : 'none'}">
          <div class="del-section-label">Collection Locations</div>
          <img src="${PUBLIC_BASE}/css/office_map.png" alt="Office Locations Map" class="del-map-img" />
          <div class="del-offices-grid">
            ${OFFICES.map(o => `
            <div class="del-office-card ${selectedOffice === o.id ? 'del-office-card-active' : ''}" data-office="${o.id}">
              <div class="del-office-header">
                <i class="fa-solid fa-building" style="color:var(--accent)"></i>
                <span class="del-office-name">${o.name}</span>
                <span class="del-office-radio">${selectedOffice === o.id
                  ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
                  : '<i class="fa-regular fa-circle"></i>'}</span>
              </div>
              <div class="del-office-addr">${o.addr}</div>
              <div class="del-office-hours">
                ${o.hours.map(([day, time]) => `<div class="del-hours-row"><span>${day}</span><span${time === 'Closed' ? ' class="pub-closed"' : ''}>${time}</span></div>`).join('')}
              </div>
            </div>`).join('')}
          </div>
        </div>

      </div><!-- /del-body-grid -->`;
  }

  function stepReview() {
    const isHome      = formData.delivery_option === 'home_delivery';
    const deliveryFee = isHome ? DELIVERY_FEE : 0;
    const vatAmount   = Math.round((BASE_AMOUNT + deliveryFee) * 0.05 * 100) / 100;
    const totalPayable = BASE_AMOUNT + ADMIN_FEE + deliveryFee + vatAmount;
    const aed         = n => 'AED ' + Number(n).toFixed(2);
    const natLabel    = nationalities.find(n => String(n.nationality_id) === String(formData.nationality))?.nationality ?? formData.nationality ?? '—';
    const emirLabel   = emirates.find(e => String(e.emirate_id) === String(formData.emirate))?.emirate ?? formData.emirate ?? '—';
    const fullName    = [formData.first_name, formData.last_name].filter(Boolean).join(' ') || '—';
    const dob         = formData.dob ? new Date(formData.dob).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '—';

    // Vehicle categories for review display
    const CAT_LABELS = { A:'Motorcycle', B:'Car', C:'Heavy Vehicle', D:'Bus', E:'Car with Heavy Trailer' };
    const CAT_ICONS  = { A:'fa-motorcycle', B:'fa-car', C:'fa-truck', D:'fa-bus', E:'fa-trailer' };
    const selectedCats = (formData.type_of_dl || '').split(',').map(s => s.trim()).filter(Boolean);
    const issuePlaceLabel = emirates.find(e => String(e.emirate_id) === String(formData.place_of_issue))?.emirate ?? formData.place_of_issue ?? '—';

    // Helper: thumbnail placeholder — images are loaded imperatively in bindStepBehaviours
    const docThumb = (slot, label) => {
      const hasFile = !!savedFiles[slot];
      return `
        <div class="rv-doc-item">
          <div class="rv-doc-thumb ${hasFile ? '' : 'rv-doc-thumb-empty'}" data-slot="${slot}">
            ${hasFile ? '<span class="rv-doc-loading"><i class="fa-solid fa-spinner fa-spin"></i></span>' : '<i class="fa-solid fa-file-image"></i>'}
          </div>
          <div class="rv-doc-label">${label}</div>
        </div>`;
    };

    return `
      <!-- Header -->
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="pub-step-title">Review Your Details</div>
          <div class="pub-step-sub">Please review all your information before proceeding to payment.</div>
        </div>
      </div>

      <!-- Info banner -->
      <div class="rv-info-banner">
        <i class="fa-solid fa-circle-info rv-info-icon"></i>
        <div class="rv-info-lines">
          <div>After agreeing to the preview, accept and continue to payment. You will no longer be able to change the information.</div>
          <div>By proceeding, you agree to and consent to all the information provided.</div>
          <div>If you proceed and there is a mistake in the information, we will not be held responsible and no refund will be provided.</div>
        </div>
      </div>

      <!-- Identity Information -->
      <div class="rv-section">
        <div class="rv-section-header">
          <span class="rv-section-title">Your Identity Information</span>
          <span class="pub-verified-badge"><i class="fa-solid fa-shield-halved"></i> Verified by UAE PASS</span>
        </div>
        <div class="rv-identity-rows">
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-user"></i></span><span class="rv-id-label">Full Name</span><span class="rv-id-value">${fullName}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-id-card"></i></span><span class="rv-id-label">Emirates ID</span><span class="rv-id-value">${formData.emirates_id || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-flag"></i></span><span class="rv-id-label">Nationality</span><span class="rv-id-value">${natLabel}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-venus-mars"></i></span><span class="rv-id-label">Gender</span><span class="rv-id-value">${formData.sex || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-mobile-screen"></i></span><span class="rv-id-label">Mobile Number</span><span class="rv-id-value">${formData.mobile_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-envelope"></i></span><span class="rv-id-label">Email Address</span><span class="rv-id-value">${formData.email || '—'}</span></div>
        </div>
      </div>

      <!-- Additional Information -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
        <div class="rv-extra-rows">
          <div class="rv-extra-row"><span class="rv-extra-label">Date of Birth</span><span class="rv-extra-value">${dob}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Place of Birth</span><span class="rv-extra-value">${formData.place_of_birth || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">UAE Permanent Place of Residence</span><span class="rv-extra-value">${emirLabel}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Additional Phone Number</span><span class="rv-extra-value">${formData.additional_mobile_no || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Additional Email</span><span class="rv-extra-value">${formData.additional_email || '—'}</span></div>
        </div>
      </div>

      <!-- Driving Licence Details -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:14px">Driving Licence Details</div>
        <div class="rv-identity-rows">
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-id-card"></i></span><span class="rv-id-label">Licence Number</span><span class="rv-id-value">${formData.license_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-check"></i></span><span class="rv-id-label">Date of Issue</span><span class="rv-id-value">${formData.issued_date ? new Date(formData.issued_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-location-dot"></i></span><span class="rv-id-label">Issuing Emirate</span><span class="rv-id-value">${issuePlaceLabel}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span><span class="rv-id-label">Date of Expiry</span><span class="rv-id-value">${formData.expiry_date ? new Date(formData.expiry_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}</span></div>
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

      <!-- Documents Attached -->
      <div class="rv-section">
        <div class="rv-section-title">Documents Attached</div>
        <div class="rv-section-sub">These are the documents you have uploaded.</div>
        <div class="rv-docs-grid">
          ${docThumb('eid_front',     'Emirates ID Front')}
          ${docThumb('eid_back',      'Emirates ID Back')}
          ${docThumb('dl_front',      'Driving License Front')}
          ${docThumb('dl_back',       'Driving License Back')}
          ${docThumb('passport_photo','Passport Photo')}
          ${docThumb('signature',     'Signature')}
        </div>
      </div>

      <!-- Delivery summary -->
      <div class="rv-delivery-grid">

        <div class="rv-delivery-card">
          <div class="rv-delivery-card-header">
            <i class="fa-solid fa-truck" style="color:var(--accent)"></i>
            <span>Delivery Method &amp; Address</span>
          </div>
          <div class="rv-delivery-method">${isHome ? 'Home Delivery' : 'Collection'}</div>
          <div class="rv-delivery-desc">${isHome ? 'Delivered within 24–48 hours' : 'You will collect from our office'}</div>
          ${isHome ? `
          <div class="rv-delivery-rows">
            <div class="rv-delivery-row"><span class="rv-delivery-label">Building / Villa / Floor #</span><span>${formData.del_building || '—'}</span></div>
            <div class="rv-delivery-row"><span class="rv-delivery-label">Street / Road</span><span>${formData.del_street || '—'}</span></div>
            ${formData.del_area ? `<div class="rv-delivery-row"><span class="rv-delivery-label">Area</span><span>${formData.del_area}</span></div>` : ''}
            <div class="rv-delivery-row"><span class="rv-delivery-label">Emirate</span><span>${emirates.find(e => String(e.emirate_id) === String(formData.del_emirate))?.emirate ?? formData.del_emirate ?? '—'}</span></div>
            ${formData.del_extra ? `<div class="rv-delivery-row"><span class="rv-delivery-label">Additional Details</span><span>${formData.del_extra}</span></div>` : ''}
          </div>` : ''}
        </div>

        <div class="rv-delivery-card">
          <div class="rv-delivery-card-header">
            <i class="fa-solid fa-building" style="color:var(--accent)"></i>
            <span>Collection Location</span>
          </div>
          ${(() => {
            const office = OFFICES.find(o => o.deliveryValue === formData.delivery_option) ?? OFFICES[0];
            return `
          <div class="rv-delivery-method">${office.name}</div>
          <div class="rv-delivery-desc">You will collect from our office</div>
          <div class="rv-delivery-rows">
            <div class="rv-delivery-row"><span class="rv-delivery-label">Address</span><span>${office.addr}</span></div>
            <div class="rv-delivery-row" style="align-items:flex-start"><span class="rv-delivery-label">Working Hours</span>
              <span>
                ${office.hours.map(([day, time]) => `${day} &nbsp; ${time}`).join('<br>\n                ')}
              </span>
            </div>
          </div>`;
          })()}
        </div>

      </div>

      <!-- Fee Breakdown -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Fee Breakdown</div>
        <div class="rv-extra-rows">
          <div class="rv-extra-row"><span class="rv-extra-label">IDL Fee</span><span class="rv-extra-value">${aed(BASE_AMOUNT)}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Administration Fee</span><span class="rv-extra-value">${aed(ADMIN_FEE)}</span></div>
          ${isHome ? `<div class="rv-extra-row"><span class="rv-extra-label">Delivery Fee</span><span class="rv-extra-value">${aed(deliveryFee)}</span></div>` : ''}
          <div class="rv-extra-row"><span class="rv-extra-label">VAT 5%</span><span class="rv-extra-value">${aed(vatAmount)}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label" style="font-weight:700;color:var(--text-primary)">Total Payable</span><span class="rv-extra-value" style="font-weight:700;color:var(--accent);font-size:1rem">${aed(totalPayable)}</span></div>
        </div>
      </div>

      <!-- Payment Method -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Payment Method</div>
        <div class="field" style="max-width:280px">
          <select name="payment_method_display">
            <option value="online" selected>Credit/Debit Card</option>
          </select>
        </div>
      </div>

      <!-- Declaration -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Declaration</div>
        <label class="disclaimer-check" id="disclaimer-check-1">
          <input type="checkbox" name="disclaimer_1" id="disclaimer_1" />
          <span>I confirm that all the information provided is correct and complete. I understand that once I proceed to payment, I will not be able to make any changes. I agree to the <a href="#" style="color:var(--accent)">terms and conditions</a> and consent to the processing of my data.<br><br>
          I understand that if I proceed and there is a mistake in the information, I will not hold EMSO responsible and no refund will be provided.</span>
        </label>
        <div class="field-error" id="err-disclaimer_1"></div>
      </div>

      <!-- Next Steps -->
      <div class="rv-section">
        <div class="rv-next-steps-header">
          <i class="fa-solid fa-circle-check rv-next-steps-icon"></i>
          <span class="rv-section-title">Next Steps</span>
        </div>
        <div class="rv-next-steps-list">
          <div class="rv-next-step-item"><span class="rv-next-step-num">1</span><span>Your IDP application will be submitted automatically after successful payment.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">2</span><span>A confirmation email and SMS will be sent to you.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">3</span><span>If Home Delivery was selected: Your IDP will be dispatched within 24–48 hours.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">4</span><span>If Collection was selected: You will receive a notification when your permit is ready for collection.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">5</span><span>You can track the status of your application anytime under History.</span></div>
        </div>
      </div>`;
  }

  const STEP_HTML = [stepIdentity, stepLicence, stepDelivery, stepReview];

  // ── Render wizard shell ────────────────────────────────────────────────────
  function renderWizard() {
    content.innerHTML = `
      <div class="pub-portal-layout">

        <!-- ── Wizard content ── -->
        <div class="pub-main">

          <!-- Breadcrumb -->
          <div class="pub-breadcrumb">
            <span class="pub-crumb">Services</span>
            <i class="fa-solid fa-chevron-right pub-crumb-sep"></i>
            <span class="pub-crumb pub-crumb-active">${isRenew ? 'Renew your IDL' : 'International Driving Permit'}</span>
          </div>

          ${isRenew ? `
          <div class="pub-renew-banner">
            <i class="fa-solid fa-rotate"></i>
            <span>Renewing your last IDL${lastRequest?.request_id ? ` &ndash; ${lastRequest.request_id}` : ''}</span>
          </div>` : ''}

          <!-- Step progress bar -->
          <div class="pub-step-bar">
            ${STEPS.map((s, i) => `
              <div class="pub-step-item ${i === currentStep ? 'pub-step-active' : i < currentStep ? 'pub-step-done' : ''}">
                <div class="pub-step-circle">
                  ${i < currentStep ? '<i class="fa-solid fa-check"></i>' : i + 1}
                </div>
                <div class="pub-step-label">${s.label}</div>
              </div>
              ${i < STEPS.length - 1
                ? `<div class="pub-step-connector${i < currentStep ? ' pub-step-connector-done' : ''}"></div>`
                : ''}
            `).join('')}
          </div>

          <!-- Step form -->
          <form id="idl-wizard-form" novalidate>
            <input type="hidden" id="wizard-data" />

            <div id="wizard-step-body">
              ${STEP_HTML[currentStep]()}
            </div>

            <div id="form-error" class="form-error hidden" style="margin-top:16px"></div>

            <div class="pub-wizard-nav">
              <button type="button" class="btn btn-ghost" id="btn-wizard-back">
                <i class="fa-solid fa-arrow-left"></i>
                ${currentStep === 0 ? 'Back' : 'Back'}
              </button>
              <button type="button" class="btn pub-btn-next" id="btn-wizard-next">
                ${currentStep === STEPS.length - 1
                  ? 'Proceed to Payment <i class="fa-solid fa-arrow-right"></i>'
                  : 'Next <i class="fa-solid fa-arrow-right"></i>'}
              </button>
            </div>
          </form>

        </div><!-- /pub-main -->

      </div><!-- /pub-portal-layout -->`;

    // Bind after render
    bindStepBehaviours();
  }

  // ── Bind step-specific JS ──────────────────────────────────────────────────
  // Persistent form data store across steps — pre-seeded from last request
  const formData  = { first_idl: '0' };
  const savedFiles    = {}; // preserves File objects across step navigation
  const savedFileUrls = {}; // preserves server-side doc URLs for the review thumbnail fallback
  if (lastRequest) {
    const r = lastRequest;

    // Helper: safely extract YYYY-MM-DD from any date string or null
    const toDate = v => v ? (v.includes('T') ? v.split('T')[0] : String(v).split(' ')[0]) : '';

    // Personal Information
    formData.emirates_id          = r.emirates_id          ?? '';
    formData.first_name           = r.first_name           ?? '';
    formData.last_name            = r.last_name            ?? '';
    formData.full_name            = [r.first_name, r.last_name].filter(Boolean).join(' ');
    formData.nationality          = String(r.nationality_id ?? r.nationality ?? '');
    formData.sex                  = r.sex                  ?? '';
    formData.dob                  = toDate(r.dob);
    formData.address_in_uae       = r.address_in_uae       ?? '';
    formData.po_box               = r.po_box               ?? '';
    formData.mobile_no            = r.mobile_no            ?? '';
    formData.email                = r.email                ?? '';
    formData.city                 = r.city                 ?? '';
    formData.home_country_address = r.home_country_address ?? '';
    formData.additional_mobile_no = r.additional_mobile_no ?? '';
    formData.additional_email     = r.additional_email     ?? '';
    // License Information
    formData.license_no           = r.license_no           ?? '';
    formData.place_of_birth       = r.place_of_birth       ?? '';
    formData.place_of_issue       = String(r.place_of_issue ?? '');
    formData.issued_date          = toDate(r.issued_date);
    formData.expiry_date          = toDate(r.expiry_date);
    formData.type_of_dl           = r.type_of_dl           ?? '';
    formData.emirate              = String(r.emirate        ?? '');
    // Delivery & Payment — pre-fill from last request
    formData.delivery_option      = r.delivery_option      ?? 'home_delivery';
    formData.payment_method       = 'CREDIT_CARD'; // always card for public users
    formData.delivery_address     = r.delivery_address     ?? '';
    // Status panel data
    formData._lastRequestId       = r.request_id           ?? null;
    formData._lastStatus          = r.request_status       ?? null;
  }

  function saveCurrentStepData() {
    const form = document.getElementById('idl-wizard-form');
    if (!form) return;
    new FormData(form).forEach((val, key) => { formData[key] = val; });
    // Explode Full Name into first_name (first two words) and last_name (remaining words)
    if (formData.full_name) {
      const nameParts = formData.full_name.trim().split(/\s+/).filter(Boolean);
      formData.first_name = nameParts.slice(0, 2).join(' ');
      formData.last_name  = nameParts.slice(2).join(' ');
    }
    // Build delivery_address string from the structured address fields
    const dBldg    = (formData.del_building ?? '').trim();
    const dSt      = (formData.del_street   ?? '').trim();
    const dArea    = (formData.del_area     ?? '').trim();
    const dEmirate = emirates.find(e => String(e.emirate_id) === String(formData.del_emirate))?.emirate ?? '';
    const dExtra   = (formData.del_extra    ?? '').trim();
    if (dBldg || dSt || dArea || dEmirate) {
      formData.delivery_address = [dBldg, dSt, dArea, dEmirate, dExtra].filter(Boolean).join(' ');
    }
    // Save DL type hidden value
    const dlHidden = document.getElementById('type_of_dl_hidden');
    if (dlHidden?.value) formData.type_of_dl = dlHidden.value;
    // Capture File objects from document upload inputs before this step's DOM is destroyed
    if (STEPS[currentStep].id === 'licence') {
      const slots = ['eid_front','eid_back','dl_front','dl_back','passport_photo','signature'];
      slots.forEach(slot => {
        const input = document.querySelector(`input[data-doc="${slot}"]`);
        if (input?.files?.[0]) savedFiles[slot] = input.files[0];
      });
      // Drawn signature (canvas) takes over only if the user hasn't uploaded a file instead
      const sigCanvas = document.getElementById('sig-canvas');
      if (!savedFiles.signature && sigCanvas?._signed && sigCanvas._blob) {
        savedFiles.signature = new File([sigCanvas._blob], 'signature.png', { type: 'image/png' });
      }
      // Save vehicle categories
      const checked = [...document.querySelectorAll('.vc-cb:checked')].map(cb => cb.value);
      if (checked.length) formData.type_of_dl = checked.join(',');
    }
  }

  function restoreStepData() {
    Object.entries(formData).forEach(([name, val]) => {
      if (!val && val !== '0') return; // skip empty values
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      if (el.type === 'radio') {
        const radio = document.querySelector(`[name="${name}"][value="${val}"]`);
        if (radio) radio.checked = true;
      } else if (el.tagName === 'SELECT') {
        // Force select to match the stored value (ID-based dropdowns)
        el.value = String(val);
        if (!el.value) el.value = val; // fallback if String coercion needed
      } else {
        el.value = val;
      }
    });
    // Restore DL type checkboxes
    if (formData.type_of_dl) {
      const ids = formData.type_of_dl.split(',');
      document.querySelectorAll('.dl-type-cb').forEach(cb => {
        cb.checked = ids.includes(cb.value);
      });
      updateDlHiddenValue();
    }
    // Restore delivery address fields
    const delEmirate  = document.getElementById('del-emirate');
    const delArea     = document.getElementById('del-area');
    const delBuilding = document.getElementById('del-building');
    const delStreet   = document.getElementById('del-street');
    const delExtra    = document.getElementById('del-extra');
    if (delEmirate  && formData.del_emirate)       delEmirate.value  = formData.del_emirate;
    if (delArea     && formData.del_area)          delArea.value     = formData.del_area;
    if (delBuilding && formData.del_building)      delBuilding.value = formData.del_building;
    if (delStreet   && formData.del_street)        delStreet.value   = formData.del_street;
    if (delExtra    && formData.del_extra)         delExtra.value    = formData.del_extra;
  }

  function updateDlHiddenValue() {
    const checked = [...document.querySelectorAll('.dl-type-cb:checked')].map(cb => cb.value);
    const hidden  = document.getElementById('type_of_dl_hidden');
    const display = document.getElementById('dl-type-display');
    if (hidden)  hidden.value = checked.join(',');
    if (display) display.textContent = checked.length
      ? `${checked.length} type${checked.length > 1 ? 's' : ''} selected`
      : 'Select DL types';
    if (checked.length) {
      document.getElementById('err-type_of_dl')?.textContent && (document.getElementById('err-type_of_dl').textContent = '');
      document.getElementById('dl-type-select')?.classList.remove('field-invalid');
    }
  }

  async function bindStepBehaviours() {
    restoreStepData();

    // Sidebar service navigation
    document.querySelectorAll('.pub-service-nav-item[data-route]').forEach(link => {
      link.addEventListener('click', () => navigate(link.dataset.route));
    });

    // Vehicle category tiles (step 2)
    document.querySelectorAll('.vc-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const cb = tile.querySelector('.vc-cb');
        cb.checked = !cb.checked;
        tile.classList.toggle('vc-tile-active', cb.checked);
        // sync hidden field
        const checked = [...document.querySelectorAll('.vc-cb:checked')].map(c => c.value);
        const hidden  = document.getElementById('type_of_dl_hidden');
        if (hidden) hidden.value = checked.join(',');
        if (checked.length) {
          const errEl = document.getElementById('err-type_of_dl');
          if (errEl) errEl.textContent = '';
        }
      });
    });
    // Restore vc tile active state from formData
    if (formData.type_of_dl) {
      formData.type_of_dl.split(',').forEach(code => {
        const tile = document.getElementById(`vc-tile-${code.trim()}`);
        const cb   = tile?.querySelector('.vc-cb');
        if (tile && cb) { cb.checked = true; tile.classList.add('vc-tile-active'); }
      });
    }

    // Vehicle category info tooltip
    const vcInfoBtn   = document.getElementById('vc-info-btn');
    const vcInfoPanel = document.getElementById('vc-info-panel');
    if (vcInfoBtn && vcInfoPanel) {
      vcInfoBtn.addEventListener('click', e => {
        e.stopPropagation();
        const open = vcInfoPanel.style.display !== 'none';
        vcInfoPanel.style.display = open ? 'none' : 'block';
      });
      document.addEventListener('click', () => { if (vcInfoPanel) vcInfoPanel.style.display = 'none'; });
      vcInfoPanel.addEventListener('click', e => e.stopPropagation());
    }

    // Signature draw modal
    const sigDrawBtn    = document.getElementById('sig-draw-btn');
    const sigModal      = document.getElementById('sig-modal');
    const sigModalClose = document.getElementById('sig-modal-close');
    const sigCanvas     = document.getElementById('sig-canvas');
    const sigClearBtn   = document.getElementById('sig-clear-btn');
    const sigSaveBtn    = document.getElementById('sig-save-btn');

    if (sigDrawBtn && sigModal && sigCanvas) {
      const ctx = sigCanvas.getContext('2d');
      let drawing = false;

      const getPos = e => {
        const r = sigCanvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
      };

      sigCanvas.addEventListener('mousedown',  e => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
      sigCanvas.addEventListener('mousemove',  e => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); });
      sigCanvas.addEventListener('mouseup',    () => { drawing = false; });
      sigCanvas.addEventListener('mouseleave', () => { drawing = false; });
      sigCanvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
      sigCanvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); }, { passive: false });
      sigCanvas.addEventListener('touchend',   () => { drawing = false; });

      sigDrawBtn.addEventListener('click', () => { sigModal.style.display = 'flex'; });
      sigModalClose.addEventListener('click', () => { sigModal.style.display = 'none'; });
      sigModal.addEventListener('click', e => { if (e.target === sigModal) sigModal.style.display = 'none'; });

      sigClearBtn.addEventListener('click', () => { ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sigCanvas._signed = false; });

      sigSaveBtn.addEventListener('click', () => {
        sigCanvas.toBlob(blob => {
          sigCanvas._signed = true;
          sigCanvas._blob   = blob;
          // Show preview in the signature zone
          const zone    = document.getElementById('doc-zone-signature');
          const holder  = zone?.querySelector('.doc-upload-placeholder');
          const preview = zone?.querySelector('.doc-upload-preview');
          const img     = zone?.querySelector('.doc-preview-img');
          const nameEl  = zone?.querySelector('.doc-preview-name');
          if (img)     img.src = sigCanvas.toDataURL();
          if (nameEl)  nameEl.textContent = 'drawn-signature.png';
          if (holder)  holder.style.display  = 'none';
          if (preview) preview.style.display = 'flex';
          const errEl = document.getElementById('err-doc-signature');
          if (errEl) errEl.textContent = '';
          zone?.classList.remove('doc-zone-invalid');
          sigModal.style.display = 'none';
        }, 'image/png');
      });
    }

    // Doc uploads (step 2)
    document.querySelectorAll('[data-doc]').forEach(input => {
      const zone      = input.closest('.doc-upload-zone');
      const holder    = zone?.querySelector('.doc-upload-placeholder');
      const preview   = zone?.querySelector('.doc-upload-preview');
      const img       = zone?.querySelector('.doc-preview-img');
      const nameEl    = zone?.querySelector('.doc-preview-name');
      const removeBtn = zone?.querySelector('.doc-remove-btn');
      if (!zone) return;

      zone.addEventListener('click', e => {
        if (e.target.closest('.doc-remove-btn')) return;
        input.click();
      });

      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        if (!['image/jpeg','image/png'].includes(file.type)) {
          toast('Only JPG and PNG files are accepted', 'error'); input.value = ''; return;
        }
        if (file.size > 2 * 1024 * 1024) {
          toast('File exceeds 2 MB limit', 'error'); input.value = ''; return;
        }
        // User chose a new file — their upload takes priority over any server URL
        delete savedFileUrls[input.dataset.doc];
        const reader = new FileReader();
        reader.onload = ev => {
          if (img)     img.src = ev.target.result;
          if (nameEl)  nameEl.textContent = file.name;
          if (holder)  holder.style.display  = 'none';
          if (preview) preview.style.display = 'flex';
          const errEl = document.getElementById(`err-doc-${input.dataset.doc}`);
          if (errEl) errEl.textContent = '';
          zone.classList.remove('doc-zone-invalid');
        };
        reader.readAsDataURL(file);
      });

      removeBtn?.addEventListener('click', e => {
        e.stopPropagation();
        input.value = '';
        delete savedFileUrls[input.dataset.doc];
        if (img)     img.src = '';
        if (nameEl)  nameEl.textContent = '';
        if (holder)  holder.style.display  = '';
        if (preview) preview.style.display = 'none';
      });
    });

    // Restore doc zone previews from savedFiles when navigating back to the licence step
    if (STEPS[currentStep].id === 'licence') {
      ['eid_front','eid_back','dl_front','dl_back','passport_photo','signature'].forEach(slot => {
        const file = savedFiles[slot];
        if (!file) return;
        const input   = document.querySelector(`input[data-doc="${slot}"]`);
        if (!input) return;
        const zone    = input.closest('.doc-upload-zone');
        const holder  = zone?.querySelector('.doc-upload-placeholder');
        const preview = zone?.querySelector('.doc-upload-preview');
        const img     = zone?.querySelector('.doc-preview-img');
        const nameEl  = zone?.querySelector('.doc-preview-name');
        if (!zone || !preview || !img) return;
        const reader = new FileReader();
        reader.onload = ev => {
          img.src = ev.target.result;
          if (nameEl)  nameEl.textContent  = file.name;
          if (holder)  holder.style.display  = 'none';
          preview.style.display = 'flex';
          const errEl = document.getElementById(`err-doc-${slot}`);
          if (errEl) errEl.textContent = '';
          zone.classList.remove('doc-zone-invalid');
        };
        reader.readAsDataURL(file);
      });
    }

    // Load existing docs from last request when on documents step
    // Skip any slot the user already has a fresh file for (savedFiles wins)
    if (STEPS[currentStep].id === 'licence' && lastRequest?.auto_id) {
      try {
        const docs = await api.idl.getDocuments(lastRequest.auto_id);
        Object.entries(docs).forEach(([slot, url]) => {
          if (savedFiles[slot]) return; // user's upload takes priority
          const input   = document.querySelector(`input[data-doc="${slot}"]`);
          if (!input) return;
          const zone    = input.closest('.doc-upload-zone');
          const holder  = zone?.querySelector('.doc-upload-placeholder');
          const preview = zone?.querySelector('.doc-upload-preview');
          const img     = zone?.querySelector('.doc-preview-img');
          const nameEl  = zone?.querySelector('.doc-preview-name');
          if (!zone || !preview || !img) return;
          const fullUrl = `${window.location.origin}${API_BASE}${url}`;
          savedFileUrls[slot] = fullUrl; // remember for review step
          img.src = fullUrl;
          if (nameEl)  nameEl.textContent  = url.split('/').pop();
          if (holder)  holder.style.display  = 'none';
          preview.style.display = 'flex';
          const errEl = document.getElementById(`err-doc-${slot}`);
          if (errEl) errEl.textContent = '';
          zone.classList.remove('doc-zone-invalid');
        });
      } catch { /* no docs saved yet */ }
    }

    // Delivery method card toggle (step 3)
    const delCards = document.querySelectorAll('.del-method-card');
    if (delCards.length) {
      const addrCol      = document.getElementById('del-address-col');
      const collCol      = document.getElementById('del-collection-col');
      const radioHome    = document.getElementById('del-radio-home');
      const radioColl    = document.getElementById('del-radio-collection');
      const cardHome     = document.getElementById('del-card-home');
      const cardColl     = document.getElementById('del-card-collection');

      const applyDelivery = val => {
        const isHome = val === 'home_delivery';
        if (addrCol)   addrCol.style.display  = isHome ? '' : 'none';
        if (collCol)   collCol.style.display  = isHome ? 'none' : '';
        if (radioHome) radioHome.innerHTML    = isHome
          ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
          : '<i class="fa-regular fa-circle"></i>';
        if (radioColl) radioColl.innerHTML    = !isHome
          ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
          : '<i class="fa-regular fa-circle"></i>';
        cardHome?.classList.toggle('del-method-card-active', isHome);
        cardColl?.classList.toggle('del-method-card-active', !isHome);
        formData.delivery_option = val;
      };

      delCards.forEach(card => {
        card.addEventListener('click', () => {
          const radio = card.querySelector('input[type="radio"]');
          if (radio) { radio.checked = true; applyDelivery(radio.value); }
        });
      });
    }

    // Collection office card selection (step 3) — writes the office-specific
    // value directly into the delivery_option radio (e.g. pick_from_dubai_office),
    // since the office choice IS the delivery option for collection.
    const officeCards = document.querySelectorAll('.del-office-card');
    if (officeCards.length) {
      const collectionRadio = document.getElementById('del-radio-collection-input');
      officeCards.forEach(card => {
        card.addEventListener('click', () => {
          officeCards.forEach(c => {
            const isSelected = c === card;
            c.classList.toggle('del-office-card-active', isSelected);
            const radioIcon = c.querySelector('.del-office-radio');
            if (radioIcon) radioIcon.innerHTML = isSelected
              ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
              : '<i class="fa-regular fa-circle"></i>';
          });
          const office = OFFICES.find(o => o.id === card.dataset.office);
          if (collectionRadio) { collectionRadio.value = office.deliveryValue; collectionRadio.checked = true; }
          formData.delivery_option = office.deliveryValue;
        });
      });
    }

    // Load review step document thumbnails — user upload first, server URL fallback
    if (STEPS[currentStep].id === 'review') {
      document.querySelectorAll('.rv-doc-thumb[data-slot]').forEach(thumbEl => {
        const slot  = thumbEl.dataset.slot;
        const label = thumbEl.closest('.rv-doc-item')?.querySelector('.rv-doc-label')?.textContent ?? slot;
        const file  = savedFiles[slot];
        const setThumb = src => {
          thumbEl.classList.remove('rv-doc-thumb-empty');
          thumbEl.innerHTML = `<img src="${src}" alt="${slot}" /><span class="rv-doc-check"><i class="fa-solid fa-circle-check"></i></span>`;
          thumbEl.classList.add('rv-doc-thumb-clickable');
          thumbEl.addEventListener('click', () => {
            openModal({
              title: label,
              body: `<img src="${src}" alt="${label}" style="display:block;max-width:100%;max-height:75vh;margin:0 auto;border-radius:var(--radius)" />`,
              size: 'lg',
            });
          });
        };
        if (file) {
          const reader = new FileReader();
          reader.onload = ev => setThumb(ev.target.result);
          reader.readAsDataURL(file);
        } else if (savedFileUrls[slot]) {
          setThumb(savedFileUrls[slot]);
        }
      });
    }

    // Clear errors on input
    document.getElementById('idl-wizard-form')?.addEventListener('input',  e => clearErr(e.target.name));
    document.getElementById('idl-wizard-form')?.addEventListener('change', e => {
      clearErr(e.target.name);
      if (e.target.id === 'disclaimer_1') {
        document.getElementById('err-disclaimer_1').textContent = '';
        document.getElementById('disclaimer-check-1')?.classList.remove('disclaimer-invalid');
      }
    });

    // Navigation buttons
    document.getElementById('btn-wizard-back')?.addEventListener('click', () => {
      if (currentStep === 0) { navigate('public-history'); return; }
      saveCurrentStepData();
      currentStep--;
      renderWizard();
    });

    document.getElementById('btn-wizard-next')?.addEventListener('click', async () => {
      if (!validateStep(currentStep)) return;
      saveCurrentStepData();

      if (currentStep < STEPS.length - 1) {
        currentStep++;
        renderWizard();
      } else {
        await submitWizard();
      }
    });
  }

  function clearErr(name) {
    if (!name) return;
    document.getElementById(`err-${name}`)?.textContent && (document.getElementById(`err-${name}`).textContent = '');
    document.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.remove('field-invalid');
  }

  // ── Per-step validation ──────────────────────────────────────────────────────
  function setErr(name, msg) {
    // Map address sub-fields to the shared error element
    const addrFields = { addr_apt: true, addr_building: true, addr_area: true, addr_city: true };
    const errKey  = addrFields[name] ? 'address_in_uae' : name;
    const errEl   = document.getElementById(`err-${errKey}`);
    const input   = document.querySelector(`[name="${name}"]`);
    if (errEl) errEl.textContent = msg;
    input?.closest('.field')?.classList.add('field-invalid');
  }

  function validateStep(step) {
    // Clear all errors
    document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    document.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));

    const key = STEPS[step].id;
    let ok = true;

    // Required text/select fields
    (STEP_REQUIRED[key] ?? []).forEach(({ name, label }) => {
      if (name === 'type_of_dl') return; // handled below
      const el = document.querySelector(`[name="${name}"]`);
      // Hidden fields are UAE PASS-verified read-only data the user can't edit —
      // don't block navigation on them being non-empty.
      if (!el || el.type === 'hidden') return;
      if (!el.value?.trim()) { setErr(name, `${label} is required`); ok = false; }
    });

    if (key === 'identity') {
      const emailEl = document.querySelector('[name="email"]');
      if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
        setErr('email', 'Enter a valid email address'); ok = false;
      }
    }

    if (key === 'licence') {
      const issuedVal = document.querySelector('[name="issued_date"]')?.value;
      const expiryVal = document.querySelector('[name="expiry_date"]')?.value;
      if (issuedVal && expiryVal && new Date(expiryVal) <= new Date(issuedVal)) {
        setErr('expiry_date', 'Expiry date must be after issue date');
        ok = false;
      }
      // Vehicle categories
      const vcChecked = [...document.querySelectorAll('.vc-cb:checked')];
      if (!vcChecked.length) {
        const errEl = document.getElementById('err-type_of_dl');
        if (errEl) errEl.textContent = 'Select at least one vehicle category';
        ok = false;
      }
      // Documents
      const slots  = ['eid_front','eid_back','dl_front','dl_back','passport_photo','signature'];
      const labels = { eid_front:'Emirates ID (Front)', eid_back:'Emirates ID (Back)', dl_front:'Driving Licence (Front)', dl_back:'Driving Licence (Back)', passport_photo:'Passport Size Photo', signature:'Signature' };
      slots.forEach(slot => {
        const input   = document.querySelector(`input[data-doc="${slot}"]`);
        const zone    = document.getElementById(`doc-zone-${slot}`);
        const errEl   = document.getElementById(`err-doc-${slot}`);
        const hasFile = input?.files?.[0]
          || zone?.querySelector('.doc-upload-preview')?.style.display !== 'none';
        if (!hasFile) {
          if (errEl) errEl.textContent = `${labels[slot]} is required`;
          zone?.classList.add('doc-zone-invalid');
          ok = false;
        }
      });
    }

    if (key === 'delivery') {
      const isHome = (formData.delivery_option ?? 'home_delivery') === 'home_delivery';
      if (isHome) {
        const emirate = document.getElementById('del-emirate')?.value;
        if (!emirate) { setErr('del_emirate', 'Emirate is required'); ok = false; }
      }
    }

    if (key === 'review') {
      const d1 = document.getElementById('disclaimer_1');
      if (!d1?.checked) {
        document.getElementById('err-disclaimer_1').textContent = 'You must read and accept the declaration to proceed';
        document.getElementById('disclaimer-check-1')?.classList.add('disclaimer-invalid');
        ok = false;
      }
    }

    if (!ok) {
      const first = document.querySelector('.field-error:not(:empty), .doc-zone-invalid');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return ok;
  }

  // ── Submit wizard ─────────────────────────────────────────────────────────
  async function submitWizard() {
    const btn   = document.getElementById('btn-wizard-next');
    const errEl = document.getElementById('form-error');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    errEl?.classList.add('hidden');

    try {
      // 1. Build body — always CREDIT_CARD for public users
      const body = { ...formData };
      body.request_type   = 'ONLINE';
      body.payment_method = 'CREDIT_CARD';

      // 2. Create IDL request
      const res = await api.idl.create(body);

      // 3. Upload documents using files captured when user left step 2. A slot may
      // have no fresh File but still have a savedFileUrls entry — that's a document
      // carried forward as a preview from the last request (e.g. re-applying without
      // re-drawing a signature already on file); fetch it so it actually gets copied
      // to the new request instead of silently being dropped.
      const slots  = ['eid_front','eid_back','dl_front','dl_back','passport_photo','signature'];
      const fd     = new FormData();
      let hasFiles = false;
      for (const slot of slots) {
        if (savedFiles[slot]) {
          fd.append(slot, savedFiles[slot]);
          hasFiles = true;
        } else if (savedFileUrls[slot]) {
          try {
            const blob = await (await fetch(savedFileUrls[slot], { credentials: 'include' })).blob();
            fd.append(slot, blob, `${slot}.${blob.type === 'image/png' ? 'png' : 'jpg'}`);
            hasFiles = true;
          } catch { /* best-effort — skip if the carried-forward file can't be fetched */ }
        }
      }
      if (hasFiles) {
        try {
          await api.upload(`/idl/requests/${res.auto_id}/documents`, fd);
        } catch {
          toast('Documents could not be uploaded — please contact support', 'error');
        }
      }

      // 4. Initiate Telr payment session
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to payment gateway…';
      const payment = await api.idl.telrInit(res.auto_id);

      // 5. Redirect to Telr hosted payment page
      window.location.href = payment.redirect_url;

    } catch (err) {
      errEl.textContent = err.message;
      errEl?.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = 'Proceed to Payment <i class="fa-solid fa-arrow-right"></i>';
    }
  }

  // Initial render
  renderWizard();
}

// ── Doc upload zone HTML helper ───────────────────────────────────────────────
function docUploadHtml(key, label, placeholderImg = '') {
  return `
    <div class="doc-upload-item">
      <div class="doc-upload-label">${label} *</div>
      <div class="doc-upload-zone" data-key="${key}" id="doc-zone-${key}">
        <input type="file" accept=".jpg,.jpeg,.png" data-doc="${key}" style="display:none" />
        <div class="doc-upload-placeholder">
          ${placeholderImg
            ? `<img src="${placeholderImg}" class="doc-placeholder-img" alt="${label}" />`
            : `<i class="fa-solid fa-cloud-arrow-up"></i>`}
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

// ── Apply for CPD (wizard) ─────────────────────────────────────────────────────
export async function renderPublicApplyCPD(param = null) {
  const content = document.getElementById('page-content');

  const isRenew = (typeof param === 'object' && param?.mode === 'renew');
  const renewSource = isRenew ? (param?.source ?? null) : null;

  const [nationalities, vehicleTypes, countries, guaranteeRules] = await Promise.all([
    api.idl.nationalities(),
    api.cpd.vehicleTypes(),
    api.cpd.countries(),
    api.cpd.guaranteeRules(),
  ]);
  countries.sort((a, b) => a.nationality.localeCompare(b.nationality));

  const CPD_STEPS = [
    { id: 'identity', label: 'Identity Information'      },
    { id: 'vehicle',  label: 'Vehicle Information'        },
    { id: 'trip',     label: 'Trip Details'               },
    { id: 'review',   label: 'Review & Pay'               },
    { id: 'payment',  label: 'Payment Details'            },
  ];

  const CPD_REQUIRED = {
    identity: [
      { name: 'full_name',   label: 'Full Name'   },
      { name: 'emirates_id', label: 'Emirates ID' },
      { name: 'nationality', label: 'Nationality' },
      { name: 'sex',         label: 'Gender'      },
      { name: 'mobile_no',   label: 'Mobile No'   },
      { name: 'email',       label: 'Email'       },
      { name: 'passport_no', label: 'Passport Number' },
    ],
    vehicle: [
      { name: 'license_no',      label: 'Driving Licence Number'      },
      { name: 'license_expiry',  label: 'Driving Licence Expiry Date' },
      { name: 'vehicle_make',    label: 'Vehicle Make'     },
      { name: 'vehicle_model',   label: 'Vehicle Model'    },
      { name: 'registration_no', label: 'Registration No'  },
      { name: 'mulkiya_no',      label: 'Traffic File Number' },
      { name: 'chassis_no',      label: 'Chassis No'       },
      { name: 'manuf_year',      label: 'Manufacture Year' },
      { name: 'radio',           label: 'Radio'            },
      { name: 'spare_tyre',      label: 'Spare Tyre'       },
    ],
    trip:    [],
    review:  [],
    payment: [],
  };

  let currentStep   = 0;
  const formData    = {};
  const savedCountries = [];

  if (renewSource) {
    const s = renewSource;
    formData.parent_request_id = s.auto_id;
    // Owner details
    formData.title          = s.title          ?? '';
    formData.first_name     = s.first_name     ?? '';
    formData.last_name      = s.last_name      ?? '';
    formData.full_name      = [s.first_name, s.last_name].filter(Boolean).join(' ');
    formData.mobile_no      = s.mobile_no       ?? '';
    formData.email          = s.email           ?? '';
    formData.nationality    = s.nationality_id  ?? '';
    formData.passport_no    = s.passport_no     ?? '';
    formData.po_box         = s.po_box          ?? '';
    formData.address        = s.uae_address     ?? '';
    formData.city           = s.city            ?? '';
    formData.extra_owner1_name = s.extra_owner1_name ?? '';
    formData.extra_owner2_name = s.extra_owner2_name ?? '';
    formData.emirates_id    = s.emirates_id     ?? '';
    formData.dob             = s.dob ? String(s.dob).split('T')[0].split(' ')[0] : '';
    formData.sex             = s.sex             ?? '';
    formData.license_no      = s.license_no      ?? '';
    formData.license_expiry  = s.license_expiry ? String(s.license_expiry).split('T')[0].split(' ')[0] : '';
    formData.usage_type      = s.usage_type      ?? 'PERSONAL';
    // Vehicle details
    formData.mulkiya_no            = s.mulkiya_no            ?? '';
    formData.registration_no       = s.registration_no       ?? '';
    formData.vehicle_make          = s.vehicle_make          ?? '';
    formData.vehicle_model         = s.vehicle_model         ?? '';
    formData.vehicle_value         = s.vehicle_value         ?? '';
    formData.vehicle_registered_in = s.vehicle_registered_in ?? '';
    formData.body_type             = s.body_type             ?? '';
    formData.manuf_year            = s.manuf_year            ?? '';
    formData.color                 = s.color                 ?? '';
    formData.net_weight            = s.net_weight            ?? '';
    formData.chassis_no            = s.chassis_no             ?? '';
    formData.engine_no             = s.engine_no             ?? '';
    formData.horse_power           = s.horse_power           ?? '';
    formData.no_of_cylinders       = s.no_of_cylinders       ?? '';
    formData.upholstery            = s.upholstery            ?? '';
    formData.no_of_seats           = s.no_of_seats           ?? '';
    formData.radio                 = s.radio                 ?? '';
    formData.spare_tyre            = s.spare_tyre            ?? '';
    // Destination countries
    (s.countries ?? []).forEach(c => savedCountries.push(String(c.country_id)));
  }
  const savedDocs = {};

  const UAE_STATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];
  const BODY_TYPES = ['Luxury','Station','Saloon','Motor Cycle','Truck','Trailer','Pickup'];
  const COLORS     = ['White','Silver','Black','Grey','Blue','Red','Brown','Green','Other'];
  const YEAR_OPTS  = Array.from({length:41},(_,i)=>2030-i).map(y=>`<option value="${y}">${y}</option>`).join('');

  // Delivery / Pick-up from ATC Office (same offices as the IDL wizard)
  const CPD_DELIVERY_FEE = parseFloat(guaranteeRules.delivery_fee ?? 30);
  const OFFICES = [
    {
      id: 'dubai',
      deliveryValue: 'pick_from_dubai_office',
      name: 'Dubai Office',
      addr: 'Emirates Motorsports Organization<br>P.O. Box 5078, Al Wuheida St, 5078,<br>Dubai, UAE',
      hours: [
        ['Mon–Thu', '8:00 AM – 7:30 PM'],
        ['Friday', '8:00 – 11:30 AM, 1:30 – 7:30 PM'],
        ['Saturday', '9:00 AM – 4:30 PM'],
        ['Sunday', 'Closed'],
      ],
    },
    {
      id: 'abu_dhabi',
      deliveryValue: 'pick_from_abudhabi_office',
      name: 'Abu Dhabi Office',
      addr: 'Emirates Motorsports Organization<br>P.O. Box 27487, Abu Dhabi, UAE',
      hours: [
        ['Mon–Sat', '8:00 AM – 5:00 PM'],
        ['Sunday', 'Closed'],
      ],
    },
  ];

  function cpdDocZone(key, label) {
    return `<div class="doc-upload-item">
      <div class="doc-upload-label">${label}</div>
      <div class="doc-upload-zone" id="cpd-doc-zone-${key}">
        <input type="file" accept=".jpg,.jpeg,.png" data-cpd-doc="${key}" style="display:none" />
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

  function stepIdentity() {
    const usageType = formData.usage_type || 'PERSONAL';
    return `
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-user"></i></div>
        <div>
          <div class="pub-step-title">Verify Your Identity</div>
          <div class="pub-step-sub">Please enter your identity details below.</div>
        </div>
      </div>

      <div class="pub-identity-card">
        <div class="pub-identity-card-header">
          <span>Your Identity Information</span>
        </div>
        <div class="pub-identity-rows">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-user"></i></span>
            <span class="pub-id-label">Full Name</span>
            <input name="full_name" class="pub-id-inline-input" placeholder="Full name" />
            <div class="field-error" id="err-full_name" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-id-card"></i></span>
            <span class="pub-id-label">Emirates ID</span>
            <input name="emirates_id" class="pub-id-inline-input" placeholder="784-XXXX-XXXXXXX-X" />
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
            <input name="email" type="email" class="pub-id-inline-input" placeholder="your@email.com" />
            <div class="field-error" id="err-email" style="margin:0"></div>
          </div>

        </div>
      </div>

      <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
      <div class="pub-identity-card">
        <div class="pub-identity-rows pub-identity-rows-2col">

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-regular fa-calendar"></i></span>
            <span class="pub-id-label">Date of Birth</span>
            <input name="dob" type="date" class="pub-id-inline-input" />
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-passport"></i></span>
            <span class="pub-id-label">Passport Number</span>
            <input name="passport_no" class="pub-id-inline-input" placeholder="Passport number" />
            <div class="field-error" id="err-passport_no" style="margin:0"></div>
          </div>

          <div class="pub-identity-row">
            <span class="pub-id-icon"><i class="fa-solid fa-inbox"></i></span>
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

        </div>

        <div class="pub-identity-rows pub-identity-rows-bycol-3">

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
      </div>`;
  }

  function stepVehicle() {
    const yearOpts = Array.from({length:41},(_,i)=>2030-i).map(y=>`<option value="${y}">${y}</option>`).join('');
    const usageType = formData.usage_type || 'PERSONAL';
    const upholsteryChoice = ['Yes','No'].includes(formData.upholstery) ? formData.upholstery : (formData.upholstery ? 'Other' : '');
    const upholsteryOther  = upholsteryChoice === 'Other' ? formData.upholstery : '';
    return `
    <div class="pub-step-header">
      <div class="pub-step-icon-wrap"><i class="fa-solid fa-car"></i></div>
      <div>
        <div class="pub-step-title">Vehicle Information</div>
        <div class="pub-step-sub">Provide your vehicle and additional details.</div>
      </div>
    </div>

    <div class="rv-section-title" style="margin-bottom:12px">Driving Licence Details</div>
    <div class="pub-identity-card" style="margin-bottom:20px">
      <div class="pub-identity-rows pub-identity-rows-2col">

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-id-card"></i></span>
          <span class="pub-id-label">Driving Licence Number</span>
          <input name="license_no" class="pub-id-inline-input" placeholder="Licence number" />
          <div class="field-error" id="err-license_no" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span>
          <span class="pub-id-label">Driving Licence Expiry Date</span>
          <input name="license_expiry" type="date" class="pub-id-inline-input" />
          <div class="field-error" id="err-license_expiry" style="margin:0"></div>
        </div>

      </div>
    </div>

    <div class="rv-section-title" style="margin-bottom:12px">Vehicle Details</div>
    <div class="pub-identity-card" style="margin-bottom:20px">
      <div class="pub-identity-rows pub-identity-rows-2col">

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-hashtag"></i></span>
          <span class="pub-id-label">Registration No</span>
          <input name="registration_no" required class="pub-id-inline-input" placeholder="e.g. Dubai A 12345" />
          <div class="field-error" id="err-registration_no" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-regular fa-file-lines"></i></span>
          <span class="pub-id-label">Traffic File Number</span>
          <input name="mulkiya_no" required class="pub-id-inline-input" placeholder="Traffic file / Mulkiya number" />
          <div class="field-error" id="err-mulkiya_no" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-car"></i></span>
          <span class="pub-id-label">Vehicle Make</span>
          <select name="vehicle_make" required class="pub-id-inline-select">
            <option value="">Select make</option>
            ${vehicleTypes.map(v => `<option value="${v.vehicle_type}">${v.vehicle_type}</option>`).join('')}
          </select>
          <div class="field-error" id="err-vehicle_make" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-car-side"></i></span>
          <span class="pub-id-label">Vehicle Model</span>
          <input name="vehicle_model" required class="pub-id-inline-input" placeholder="e.g. Land Cruiser" />
          <div class="field-error" id="err-vehicle_model" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-sack-dollar"></i></span>
          <span class="pub-id-label">Vehicle Value (AED)</span>
          <input name="vehicle_value" type="number" class="pub-id-inline-input" placeholder="80000" />
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
          <span class="pub-id-icon"><i class="fa-solid fa-shapes"></i></span>
          <span class="pub-id-label">Body Type</span>
          <select name="body_type" class="pub-id-inline-select">
            <option value="">Select type</option>
            ${BODY_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-regular fa-calendar"></i></span>
          <span class="pub-id-label">Year of Manufacture</span>
          <select name="manuf_year" required class="pub-id-inline-select">
            <option value="">Select year</option>
            ${yearOpts}
          </select>
          <div class="field-error" id="err-manuf_year" style="margin:0"></div>
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
          <span class="pub-id-icon"><i class="fa-solid fa-weight-hanging"></i></span>
          <span class="pub-id-label">Net Weight (Empty Load)</span>
          <input name="net_weight" class="pub-id-inline-input" placeholder="kg" />
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-barcode"></i></span>
          <span class="pub-id-label">Chassis No</span>
          <input name="chassis_no" required class="pub-id-inline-input" placeholder="VIN / Chassis number" />
          <div class="field-error" id="err-chassis_no" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-gears"></i></span>
          <span class="pub-id-label">Engine No</span>
          <input name="engine_no" class="pub-id-inline-input" placeholder="Engine number" />
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
          <select name="upholstery_choice" id="cpd-upholstery-choice" class="pub-id-inline-select">
            <option value="">Select</option>
            <option value="Yes" ${upholsteryChoice === 'Yes' ? 'selected' : ''}>Yes</option>
            <option value="No" ${upholsteryChoice === 'No' ? 'selected' : ''}>No</option>
            <option value="Other" ${upholsteryChoice === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>

        <div class="pub-identity-row" id="cpd-upholstery-other-row" style="display:${upholsteryChoice === 'Other' ? '' : 'none'}">
          <span class="pub-id-icon"><i class="fa-solid fa-pen"></i></span>
          <span class="pub-id-label">Specify Upholstery</span>
          <input name="upholstery_other" class="pub-id-inline-input" placeholder="e.g. Leather" value="${upholsteryOther}" />
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-users"></i></span>
          <span class="pub-id-label">No of Seats</span>
          <input name="no_of_seats" type="number" class="pub-id-inline-input" placeholder="5" />
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-radio"></i></span>
          <span class="pub-id-label">Radio</span>
          <select name="radio" required class="pub-id-inline-select">
            <option value="">Select</option>
            <option value="Yes">Yes</option><option value="No">No</option>
          </select>
          <div class="field-error" id="err-radio" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-ring"></i></span>
          <span class="pub-id-label">Spare Tyre</span>
          <select name="spare_tyre" required class="pub-id-inline-select">
            <option value="">Select</option>
            <option value="Yes">Yes</option><option value="No">No</option>
          </select>
          <div class="field-error" id="err-spare_tyre" style="margin:0"></div>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-regular fa-comment"></i></span>
          <span class="pub-id-label">Additional Remarks</span>
          <textarea name="additional_remarks" rows="1" class="pub-id-inline-input" style="resize:vertical"
            placeholder="Any additional vehicle remarks…"></textarea>
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-list"></i></span>
          <span class="pub-id-label">Other Particulars (1)</span>
          <input name="others1" class="pub-id-inline-input" placeholder="e.g. Roof rack, bull bar…" />
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-list"></i></span>
          <span class="pub-id-label">Other Particulars (2)</span>
          <input name="others2" class="pub-id-inline-input" placeholder="e.g. Winch, spare parts…" />
        </div>

        <div class="pub-identity-row">
          <span class="pub-id-icon"><i class="fa-solid fa-briefcase"></i></span>
          <span class="pub-id-label">Usage Type</span>
          <select name="usage_type" id="cpd-usage-type" class="pub-id-inline-select">
            <option value="PERSONAL" ${usageType === 'PERSONAL' ? 'selected' : ''}>Personal Use</option>
            <option value="COMPANY" ${usageType === 'COMPANY' ? 'selected' : ''}>Company Use</option>
          </select>
        </div>

      </div>

      <div class="pub-identity-rows pub-identity-rows-bycol-4">

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
    <div style="margin-top:24px">
      <div style="font-weight:600;margin-bottom:12px;color:var(--text-secondary)">
        <i class="fa-solid fa-paperclip" style="margin-right:6px"></i>Supporting Documents
      </div>
      <div class="doc-upload-grid" id="cpd-doc-grid">
        ${cpdDocZone('eid_front',      'Emirates ID (Front)')}
        ${cpdDocZone('eid_back',       'Emirates ID (Back)')}
        ${cpdDocZone('dl_front',       'Driving License (Front)')}
        ${cpdDocZone('dl_back',        'Driving License (Back)')}
        ${cpdDocZone('traffic_front',  'Traffic File (Front)')}
        ${cpdDocZone('traffic_back',   'Traffic File (Back)')}
        ${cpdDocZone('passport_photo', 'Passport Copy')}
        <div id="cpd-corporate-docs" style="display:${usageType === 'COMPANY' ? 'contents' : 'none'}">
          ${cpdDocZone('visa_page',      'Visa Page of Owner')}
          ${cpdDocZone('trade_license',  'Trade License')}
          ${cpdDocZone('noc',            'NOC from Company Owner')}
        </div>
      </div>
    </div>`;
  }

  function stepTrip() {
    return `
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-globe"></i></div>
        <div>
          <div class="pub-step-title">Trip Details</div>
          <div class="pub-step-sub">Provide details about your intended trip.</div>
        </div>
      </div>

      <div class="field" style="margin-bottom:20px">
        <label style="display:block;margin-bottom:2px;font-weight:600">Destination Countries</label>
        <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">Select all countries you plan to visit.</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${countries.map(c => `
          <label class="cpd-country-check ${savedCountries.includes(String(c.nationality_id)) ? 'checked' : ''}">
            <input type="checkbox" value="${c.nationality_id}"
              ${savedCountries.includes(String(c.nationality_id)) ? 'checked' : ''}
              style="accent-color:var(--accent)" />
            ${c.nationality}
          </label>`).join('')}
        </div>
      </div>
      <div class="form-grid">
        <div class="field field-full"><label>Additional Remarks</label>
          <textarea name="additional_remarks" rows="3"
            style="width:100%;resize:vertical" placeholder="Any special requirements or notes…"></textarea>
        </div>
      </div>`;
  }

  function stepCPDReview() {
    const natLabel = nationalities.find(n => String(n.nationality_id) === String(formData.nationality))?.nationality ?? formData.nationality ?? '—';
    const dob       = formData.dob ? new Date(formData.dob).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '—';
    const licExpiry = formData.license_expiry ? new Date(formData.license_expiry).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '—';
    const fullName  = formData.full_name || [formData.first_name, formData.last_name].filter(Boolean).join(' ') || '—';
    const usageType = formData.usage_type === 'COMPANY' ? 'Company Use' : 'Personal Use';
    const isCompany = formData.usage_type === 'COMPANY';
    const selectedCountryNames = savedCountries
      .map(id => countries.find(c => String(c.nationality_id) === String(id))?.nationality)
      .filter(Boolean);

    const isHomeDelivery = (formData.delivery_option ?? 'home_delivery') === 'home_delivery';
    const currentOffice  = OFFICES.find(o => o.deliveryValue === formData.delivery_option) ?? OFFICES[0];
    const selectedOffice = currentOffice.id;

    const docThumb = (slot, label) => {
      const hasFile = !!savedDocs[slot];
      return `
        <div class="rv-doc-item">
          <div class="rv-doc-thumb ${hasFile ? '' : 'rv-doc-thumb-empty'}" data-slot="${slot}">
            ${hasFile ? '<span class="rv-doc-loading"><i class="fa-solid fa-spinner fa-spin"></i></span>' : '<i class="fa-solid fa-file-image"></i>'}
          </div>
          <div class="rv-doc-label">${label}</div>
        </div>`;
    };

    return `
      <!-- Header -->
      <div class="pub-step-header">
        <div class="pub-step-icon-wrap"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="pub-step-title">Review Your Details</div>
          <div class="pub-step-sub">Please review all your information before proceeding to payment.</div>
        </div>
      </div>

      <!-- Info banner -->
      <div class="rv-info-banner">
        <i class="fa-solid fa-circle-info rv-info-icon"></i>
        <div class="rv-info-lines">
          <div>After agreeing to the preview, accept and continue to payment. You will no longer be able to change the information.</div>
          <div>By proceeding, you agree to and consent to all the information provided.</div>
          <div>If you proceed and there is a mistake in the information, we will not be held responsible and no refund will be provided.</div>
        </div>
      </div>

      <!-- Identity Information -->
      <div class="rv-section">
        <div class="rv-section-header">
          <span class="rv-section-title">Your Identity Information</span>
        </div>
        <div class="rv-identity-rows">
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-user"></i></span><span class="rv-id-label">Full Name</span><span class="rv-id-value">${fullName}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-id-card"></i></span><span class="rv-id-label">Emirates ID</span><span class="rv-id-value">${formData.emirates_id || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-flag"></i></span><span class="rv-id-label">Nationality</span><span class="rv-id-value">${natLabel}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-venus-mars"></i></span><span class="rv-id-label">Gender</span><span class="rv-id-value">${formData.sex || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-mobile-screen"></i></span><span class="rv-id-label">Mobile Number</span><span class="rv-id-value">${formData.mobile_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-envelope"></i></span><span class="rv-id-label">Email Address</span><span class="rv-id-value">${formData.email || '—'}</span></div>
        </div>
      </div>

      <!-- Additional Information -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
        <div class="rv-extra-rows">
          <div class="rv-extra-row"><span class="rv-extra-label">Date of Birth</span><span class="rv-extra-value">${dob}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Passport Number</span><span class="rv-extra-value">${formData.passport_no || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">PO Box</span><span class="rv-extra-value">${formData.po_box || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Address</span><span class="rv-extra-value">${formData.address || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">City</span><span class="rv-extra-value">${formData.city || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 1 Full Name</span><span class="rv-extra-value">${formData.extra_owner1_name || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 1 Emirates ID</span><span class="rv-extra-value">${formData.extra_owner1_eid || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 1 Passport Number</span><span class="rv-extra-value">${formData.extra_owner1_passport || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 2 Full Name</span><span class="rv-extra-value">${formData.extra_owner2_name || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 2 Emirates ID</span><span class="rv-extra-value">${formData.extra_owner2_eid || '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Extra Driver 2 Passport Number</span><span class="rv-extra-value">${formData.extra_owner2_passport || '—'}</span></div>
        </div>
      </div>

      <!-- Driving Licence Details -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:14px">Driving Licence Details</div>
        <div class="rv-identity-rows">
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-id-card"></i></span><span class="rv-id-label">Licence Number</span><span class="rv-id-value">${formData.license_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-xmark"></i></span><span class="rv-id-label">Date of Expiry</span><span class="rv-id-value">${licExpiry}</span></div>
        </div>
      </div>

      <!-- Vehicle Details -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:14px">Vehicle Details</div>
        <div class="rv-identity-rows">
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-hashtag"></i></span><span class="rv-id-label">Registration No</span><span class="rv-id-value">${formData.registration_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-file-lines"></i></span><span class="rv-id-label">Traffic File No</span><span class="rv-id-value">${formData.mulkiya_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-car"></i></span><span class="rv-id-label">Vehicle Make</span><span class="rv-id-value">${formData.vehicle_make || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-car-side"></i></span><span class="rv-id-label">Vehicle Model</span><span class="rv-id-value">${formData.vehicle_model || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-sack-dollar"></i></span><span class="rv-id-label">Vehicle Value (AED)</span><span class="rv-id-value">${formData.vehicle_value || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-location-dot"></i></span><span class="rv-id-label">Vehicle Registered In</span><span class="rv-id-value">${formData.vehicle_registered_in || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-shapes"></i></span><span class="rv-id-label">Body Type</span><span class="rv-id-value">${formData.body_type || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar"></i></span><span class="rv-id-label">Year of Manufacture</span><span class="rv-id-value">${formData.manuf_year || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-palette"></i></span><span class="rv-id-label">Color as per Mulkiya</span><span class="rv-id-value">${formData.color || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-weight-hanging"></i></span><span class="rv-id-label">Net Weight (Empty Load)</span><span class="rv-id-value">${formData.net_weight || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-barcode"></i></span><span class="rv-id-label">Chassis No</span><span class="rv-id-value">${formData.chassis_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-gears"></i></span><span class="rv-id-label">Engine No</span><span class="rv-id-value">${formData.engine_no || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-gauge-high"></i></span><span class="rv-id-label">Horse Power</span><span class="rv-id-value">${formData.horse_power || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-layer-group"></i></span><span class="rv-id-label">No of Cylinders</span><span class="rv-id-value">${formData.no_of_cylinders || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-chair"></i></span><span class="rv-id-label">Upholstery</span><span class="rv-id-value">${formData.upholstery || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-users"></i></span><span class="rv-id-label">No of Seats</span><span class="rv-id-value">${formData.no_of_seats || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-radio"></i></span><span class="rv-id-label">Radio</span><span class="rv-id-value">${formData.radio || '—'}</span></div>
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-ring"></i></span><span class="rv-id-label">Spare Tyre</span><span class="rv-id-value">${formData.spare_tyre || '—'}</span></div>
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bg-base)">
          <div class="rv-extra-rows">
            <div class="rv-extra-row"><span class="rv-extra-label">Additional Remarks</span><span class="rv-extra-value">${formData.additional_remarks || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Other Particulars (1)</span><span class="rv-extra-value">${formData.others1 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Other Particulars (2)</span><span class="rv-extra-value">${formData.others2 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 1 in UAE Full Name</span><span class="rv-extra-value">${formData.uae_refree1 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 1 in UAE Mobile Number</span><span class="rv-extra-value">${formData.uae_refree1_mobile || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 2 in UAE Full Name</span><span class="rv-extra-value">${formData.uae_refree2 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 2 in UAE Mobile Number</span><span class="rv-extra-value">${formData.uae_refree2_mobile || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 1 in Destination Full Name</span><span class="rv-extra-value">${formData.destination_refree1 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 1 in Destination Mobile Number</span><span class="rv-extra-value">${formData.destination_refree1_mobile || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 2 in Destination Full Name</span><span class="rv-extra-value">${formData.destination_refree2 || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Reference 2 in Destination Mobile Number</span><span class="rv-extra-value">${formData.destination_refree2_mobile || '—'}</span></div>
            <div class="rv-extra-row"><span class="rv-extra-label">Usage Type</span><span class="rv-extra-value">${usageType}</span></div>
          </div>
        </div>
      </div>

      <!-- Documents Attached -->
      <div class="rv-section">
        <div class="rv-section-title">Documents Attached</div>
        <div class="rv-section-sub">These are the documents you have uploaded.</div>
        <div class="rv-docs-grid">
          ${docThumb('eid_front',     'Emirates ID (Front)')}
          ${docThumb('eid_back',      'Emirates ID (Back)')}
          ${docThumb('dl_front',      'Driving License (Front)')}
          ${docThumb('dl_back',       'Driving License (Back)')}
          ${docThumb('traffic_front', 'Traffic File (Front)')}
          ${docThumb('traffic_back',  'Traffic File (Back)')}
          ${docThumb('passport_photo','Passport Copy')}
          ${isCompany ? docThumb('visa_page',     'Visa Page of Owner') : ''}
          ${isCompany ? docThumb('trade_license', 'Trade License') : ''}
          ${isCompany ? docThumb('noc',           'NOC from Company Owner') : ''}
        </div>
      </div>

      <!-- Trip Details -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Trip Details</div>
        <div class="rv-extra-rows">
          <div class="rv-extra-row"><span class="rv-extra-label">Destination Countries</span><span class="rv-extra-value">${selectedCountryNames.length ? selectedCountryNames.join(', ') : '—'}</span></div>
          <div class="rv-extra-row"><span class="rv-extra-label">Additional Remarks</span><span class="rv-extra-value">${formData.additional_remarks || '—'}</span></div>
        </div>
      </div>

      <!-- Delivery / Pick-up from ATC Office -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Delivery or Pick up from ATC Office</div>

        <div style="margin-bottom:24px">
          <div class="del-method-label">Choose Delivery Method</div>
          <div class="del-method-grid">

            <label class="del-method-card ${isHomeDelivery ? 'del-method-card-active' : ''}" id="cpd-del-card-home">
              <input type="radio" name="delivery_option" value="home_delivery" ${isHomeDelivery ? 'checked' : ''} style="display:none" />
              <div class="del-method-radio" id="cpd-del-radio-home">
                ${isHomeDelivery ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>'}
              </div>
              <div class="del-method-icon-wrap"><i class="fa-solid fa-house"></i></div>
              <div>
                <div class="del-method-title">Home Delivery</div>
                <div class="del-method-fee">AED ${CPD_DELIVERY_FEE.toFixed(2)}</div>
                <div class="del-method-desc">Delivered within 24–48 hours</div>
              </div>
            </label>

            <label class="del-method-card ${!isHomeDelivery ? 'del-method-card-active' : ''}" id="cpd-del-card-collection">
              <input type="radio" name="delivery_option" id="cpd-del-radio-collection-input" value="${currentOffice.deliveryValue}" ${!isHomeDelivery ? 'checked' : ''} style="display:none" />
              <div class="del-method-radio" id="cpd-del-radio-collection">
                ${!isHomeDelivery ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>' : '<i class="fa-regular fa-circle"></i>'}
              </div>
              <div class="del-method-icon-wrap"><i class="fa-solid fa-building"></i></div>
              <div>
                <div class="del-method-title">Collection</div>
                <div class="del-method-fee del-method-fee-free">Free</div>
                <div class="del-method-desc">Collect from our office</div>
              </div>
            </label>

          </div>
        </div>

        <div class="del-body-grid">

          <div id="cpd-del-address-col" style="display:${isHomeDelivery ? '' : 'none'}">
            <div class="del-section-label">Delivery Address</div>
            <div class="del-address-grid">

              <div class="field del-addr-third">
                <label>Building / Villa / Floor #</label>
                <input name="del_building" id="cpd-del-building" placeholder="E.g. Villa 12, Floor 3" value="${formData.del_building || ''}" />
              </div>

              <div class="field del-addr-half">
                <label>Street / Road</label>
                <input name="del_street" id="cpd-del-street" placeholder="E.g. Sheikh Zayed Road" value="${formData.del_street || ''}" />
              </div>

              <div class="field del-addr-third">
                <label>Area</label>
                <input name="del_area" id="cpd-del-area" placeholder="Area" value="${formData.del_area || ''}" />
              </div>

              <div class="field del-addr-half">
                <label>Emirate *</label>
                <div class="pub-input-icon-wrap">
                  <select name="del_emirate" id="cpd-del-emirate">
                    <option value="">Select emirate</option>
                    ${UAE_STATES.map(s => `<option value="${s}" ${formData.del_emirate === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                  <i class="fa-solid fa-chevron-down pub-input-icon-right"></i>
                </div>
                <div class="field-error" id="err-del_emirate"></div>
              </div>

              <div class="field del-addr-half">
                <label>Additional Address Details <span style="color:var(--text-muted);font-weight:400">(Optional)</span></label>
                <input name="del_extra" id="cpd-del-extra" placeholder="E.g. Near landmark or building name" value="${formData.del_extra || ''}" />
              </div>

            </div>

            <div class="del-info-banner">
              <i class="fa-solid fa-circle-info" style="color:var(--accent);flex-shrink:0;font-size:1rem"></i>
              <div>
                <div>Please ensure someone is available to receive the delivery.</div>
                <div>A valid contact number is required for delivery updates.</div>
              </div>
            </div>
          </div>

          <div id="cpd-del-collection-col" style="display:${!isHomeDelivery ? '' : 'none'}">
            <div class="del-section-label">Collection Locations</div>
            <img src="${PUBLIC_BASE}/css/office_map.png" alt="Office Locations Map" class="del-map-img" />
            <div class="del-offices-grid">
              ${OFFICES.map(o => `
              <div class="del-office-card ${selectedOffice === o.id ? 'del-office-card-active' : ''}" data-office="${o.id}">
                <div class="del-office-header">
                  <i class="fa-solid fa-building" style="color:var(--accent)"></i>
                  <span class="del-office-name">${o.name}</span>
                  <span class="del-office-radio">${selectedOffice === o.id
                    ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
                    : '<i class="fa-regular fa-circle"></i>'}</span>
                </div>
                <div class="del-office-addr">${o.addr}</div>
                <div class="del-office-hours">
                  ${o.hours.map(([day, time]) => `<div class="del-hours-row"><span>${day}</span><span${time === 'Closed' ? ' class="pub-closed"' : ''}>${time}</span></div>`).join('')}
                </div>
              </div>`).join('')}
            </div>
          </div>

        </div>
      </div>

      <!-- Declaration -->
      <div class="rv-section">
        <div class="rv-section-title" style="margin-bottom:12px">Declaration</div>
        <label class="disclaimer-check" id="disclaimer-check-1">
          <input type="checkbox" name="disclaimer_1" id="disclaimer_1" />
          <span>I confirm that all the information provided is correct and complete. I understand that once I proceed to payment, I will not be able to make any changes. I agree to the <a href="#" style="color:var(--accent)">terms and conditions</a> and consent to the processing of my data.<br><br>
          I understand that if I proceed and there is a mistake in the information, I will not hold EMSO responsible and no refund will be provided.</span>
        </label>
        <div class="field-error" id="err-disclaimer_1"></div>
      </div>

      <!-- Next Steps -->
      <div class="rv-section">
        <div class="rv-next-steps-header">
          <i class="fa-solid fa-circle-check rv-next-steps-icon"></i>
          <span class="rv-section-title">Next Steps</span>
        </div>
        <div class="rv-next-steps-list">
          <div class="rv-next-step-item"><span class="rv-next-step-num">1</span><span>Your CPD application will be submitted for review after payment.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">2</span><span>A confirmation email will be sent to you.</span></div>
          <div class="rv-next-step-item"><span class="rv-next-step-num">3</span><span>You can track the status of your application anytime under History.</span></div>
        </div>
      </div>`;
  }

  // ── CPD Guarantee Calculator (DB-driven) ───────────────────────────────────
  // Build lookup structures from fetched guaranteeRules
  const _groups     = {};
  const _rates      = {};
  const _countryMap = {};
  const _bookingFees = [];  // [{country_list: "1,3,5", booking_fee: "250"}, ...]

  (guaranteeRules.groups ?? []).forEach(g => { _groups[g.group_code] = g; });
  (guaranteeRules.rates  ?? []).forEach(r => {
    if (!_rates[r.group_code]) _rates[r.group_code] = [];
    _rates[r.group_code][r.year_band] = { saloon: +r.saloon, station: +r.station, luxury: +r.luxury };
  });
  (guaranteeRules.country_map ?? []).forEach(c => {
    const entry = { group_code: c.group_code, special_note: c.special_note };
    // Index by nationality_id (most reliable — avoids name mismatch)
    if (c.nationality_id != null) _countryMap[`id:${c.nationality_id}`] = entry;
    // Also index by name as fallback
    _countryMap[c.country_name.toLowerCase()] = entry;
  });
  (guaranteeRules.booking_fees ?? []).forEach(bf => _bookingFees.push(bf));

  const LUXURY_TYPES  = ['Luxury'];
  const STATION_TYPES = ['Station','SUV','-Station','Pickup','Truck','Bus','Trailer'];

  function getVehicleTier(bodyType) {
    const bt = (bodyType ?? '').trim();
    if (LUXURY_TYPES.includes(bt))  return 'luxury';
    if (STATION_TYPES.includes(bt)) return 'station';
    return 'saloon';
  }

  function getYearBand(year) {
    const y = parseInt(year, 10);
    if (y <= 2000) return 0;
    if (y <= 2010) return 1;
    return 2;
  }

  // Returns the booking fee for the selected country IDs (highest match wins)
  function calcBookingFee(selectedIds) {
    const idSet = new Set(selectedIds.map(String));
    let best = 0;
    _bookingFees.forEach(bf => {
      if (!bf.country_list) return;
      const feeIds = bf.country_list.split(',').map(s => s.trim());
      const matches = feeIds.some(id => idSet.has(id));
      if (matches) {
        const fee = parseFloat(bf.booking_fee) || 0;
        if (fee > best) best = fee;
      }
    });
    return best;
  }

  function calcGuarantee() {
    const tier = getVehicleTier(formData.body_type);
    const band = getYearBand(formData.manuf_year);
    const isMotorcycle  = formData.body_type === 'Motor Cycle';
    const isUaeNational = nationalities.find(n => String(n.nationality_id) === String(formData.nationality))?.nationality === 'United Arab Emirates';

    const selectedNames = savedCountries
      .map(id => countries.find(c => String(c.nationality_id) === String(id))?.nationality ?? '')
      .filter(Boolean);

    if (!selectedNames.length) return { guaranteeFee: 0, bookingFee: 0, extraFee: 0, deliveryFee: 0, processingFee: 0, vat: 0, total: 0, notes: [], breakdown: [] };

    const groupAmounts   = {};
    const groupCountries = {};
    const notesSet       = new Set();

    selectedNames.forEach((name, idx) => {
      const id      = savedCountries[idx];
      // Try ID-based lookup first (most reliable), fall back to name
      const mapping = _countryMap[`id:${id}`] ?? _countryMap[name.toLowerCase()];
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
        const bandRates = (_rates[grpCode] ?? [])[band];
        amount = bandRates ? bandRates[tier] : 0;
      }

      if (grp?.special_note)      notesSet.add(grp.special_note);
      if (mapping?.special_note)  notesSet.add(mapping.special_note);

      // Track per group — keep highest for each group
      if (!groupAmounts[grpCode] || amount > groupAmounts[grpCode]) {
        groupAmounts[grpCode]   = amount;
        groupCountries[grpCode] = [];
      }
      groupCountries[grpCode].push(name);
    });

    // Guarantee fee = HIGHEST single group amount (not sum)
    const guaranteeFee = Math.max(0, ...Object.values(groupAmounts));

    // Booking fee from mn_cpd_booking_fees by country IDs
    const bookingFee = calcBookingFee(savedCountries);

    // Extra driver fee from DB config (mn_cpd_guarantee_groups via guaranteeRules)
    const EXTRA_FEE_AMOUNT = parseFloat(guaranteeRules.extra_driver_fee ?? 50);
    const extraFee = (formData.extra_owner1_name?.trim() || formData.extra_owner2_name?.trim()) ? EXTRA_FEE_AMOUNT : 0;

    // Delivery fee — charged only for Home Delivery
    const deliveryFee = (formData.delivery_option ?? 'home_delivery') === 'home_delivery' ? CPD_DELIVERY_FEE : 0;

    // Processing fee — 2.5% of the guarantee fee only
    const processingFee = Math.round(guaranteeFee * 0.025 * 100) / 100;

    // VAT 5% on booking + extra driver + delivery only (guarantee fee is excluded)
    const vatBase = bookingFee + extraFee + deliveryFee;
    const vat     = Math.round(vatBase * 0.05 * 100) / 100;
    const total   = guaranteeFee + bookingFee + extraFee + deliveryFee + processingFee + vat;

    const breakdown = Object.entries(groupAmounts).map(([grpCode, amount]) => ({
      countries: groupCountries[grpCode].join(', '),
      amount,
    }));

    return { guaranteeFee, bookingFee, extraFee, deliveryFee, processingFee, vat, total, notes: [...notesSet], breakdown };
  }
  function stepPayment() {
    const { guaranteeFee, bookingFee, extraFee, deliveryFee, processingFee, vat, total, notes, breakdown } = calcGuarantee();
    const tier      = getVehicleTier(formData.body_type);
    const band      = getYearBand(formData.manuf_year);
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const bandLabel = ['1990–2000','2001–2010','2011+'][band];
    const fmt       = n => 'AED ' + Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2 });

    const feeRow = (label, value, bold = false, accent = false) => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 16px;font-size:.875rem${bold ? ';font-weight:700' : ''}">${label}</td>
        <td style="padding:10px 16px;text-align:right;font-weight:${bold ? '700' : '500'};font-size:${bold ? '1rem' : '.875rem'};${accent ? 'color:var(--accent)' : ''}">${fmt(value)}</td>
      </tr>`;

    return `
      <!-- Application summary -->
      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border)">
        <div class="section-card-header" style="font-size:.82rem">Application Summary</div>
        <div class="section-card-body" style="padding:16px 20px">
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">Vehicle</span>
              <span class="detail-value">${formData.vehicle_make ?? '—'} ${formData.vehicle_model ?? ''}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Registration No</span>
              <span class="detail-value">${formData.registration_no ?? '—'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Year / Type</span>
              <span class="detail-value">${formData.manuf_year ?? '—'} · ${tierLabel} (${bandLabel})</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Owner</span>
              <span class="detail-value">${(formData.title ? formData.title + ' ' : '') + (formData.first_name ?? '') + ' ' + (formData.last_name ?? '')}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Guarantee group breakdown -->
      ${breakdown.length ? `
      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border)">
        <div class="section-card-header" style="font-size:.82rem">
          <i class="fa-solid fa-earth-americas" style="color:var(--accent);margin-right:6px"></i>
          Guarantee by Destination
        </div>
        <div class="section-card-body" style="padding:0">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg-elevated)">
                <th style="padding:8px 16px;text-align:left;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border)">Countries</th>
                <th style="padding:8px 16px;text-align:right;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border)">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${breakdown.map(r => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px 16px;font-size:.85rem">${r.countries}</td>
                <td style="padding:10px 16px;text-align:right;font-size:.85rem;color:var(--text-muted)">${fmt(r.amount)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--accent-dim)">
                <td style="padding:10px 16px;font-size:.82rem;color:var(--accent);font-weight:600">Guarantee Fee (highest)</td>
                <td style="padding:10px 16px;text-align:right;font-weight:700;color:var(--accent)">${fmt(guaranteeFee)}</td>
              </tr>
            </tfoot>
          </table>
          ${notes.length ? `
          <div style="padding:10px 16px;background:#fefce8;border-top:1px solid #fde68a;display:flex;flex-direction:column;gap:5px">
            ${notes.map(n => `
            <div style="display:flex;align-items:flex-start;gap:7px;font-size:.8rem;color:#92400e">
              <i class="fa-solid fa-triangle-exclamation" style="margin-top:2px;flex-shrink:0;color:#d97706"></i>
              <span>${n}</span>
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>` : `
      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border)">
        <div class="section-card-body" style="padding:20px;color:var(--text-muted);font-size:.88rem">
          No countries selected — please go back to Step 3.
        </div>
      </div>`}

      <!-- Fee breakdown -->
      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border)">
        <div class="section-card-header" style="font-size:.82rem">
          <i class="fa-solid fa-calculator" style="color:var(--accent);margin-right:6px"></i>
          Fee Breakdown
        </div>
        <div class="section-card-body" style="padding:0">
          <table style="width:100%;border-collapse:collapse">
            <tbody>
              ${feeRow('Guarantee Fee', guaranteeFee)}
              ${feeRow('Processing Fee (2.5% of Guarantee Fee)', processingFee)}
              ${feeRow('Booking Fee', bookingFee)}
              ${feeRow(`Extra Driver Fee${extraFee ? ' (driver added)' : ''}`, extraFee)}
              ${deliveryFee ? feeRow('Delivery Fee', deliveryFee) : feeRow('Delivery Fee (Collection — Free)', 0)}
              ${feeRow('VAT (5%)', vat)}
              ${feeRow('Total Payable', total, true, true)}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payment method -->
      <div class="section-card" style="margin:0 0 16px;box-shadow:none;border:1px solid var(--border)">
        <div class="section-card-header" style="font-size:.82rem">
          <i class="fa-solid fa-wallet" style="color:var(--accent);margin-right:6px"></i>
          Payment Method
        </div>
        <div class="section-card-body" style="padding:16px 20px">
          <div class="field" style="max-width:280px">
            <label>Select Payment Method *</label>
            <select id="cpd-payment-method" name="payment_method">
              <option value="">— Select —</option>
              <option value="CREDIT_CARD">Credit / Debit Card</option>
            </select>
            <div class="field-error" id="err-cpd-payment-method"></div>
          </div>
          <div id="cpd-payment-info" style="margin-top:12px"></div>
        </div>
      </div>`;
  }
  function bindPaymentMethodToggle() {
    const sel  = document.getElementById('cpd-payment-method');
    const info = document.getElementById('cpd-payment-info');
    if (!sel || !info) return;
    // Restore saved value
    if (formData.payment_method) sel.value = formData.payment_method;
    function updateInfo() {
      if (sel.value === 'CREDIT_CARD') {
        info.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius)">
            <i class="fa-solid fa-credit-card" style="color:var(--accent);font-size:1.1rem"></i>
            <div style="font-size:.85rem">You will be redirected to the <strong>Telr</strong> secure payment gateway after submitting.</div>
          </div>`;
      } else if (sel.value === 'CASH') {
        info.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius)">
            <i class="fa-solid fa-money-bill-wave" style="color:#16a34a;font-size:1.1rem"></i>
            <div style="font-size:.85rem">Your application will be saved and you can <strong>pay cash</strong> at the EMSO office.</div>
          </div>`;
      } else {
        info.innerHTML = '';
      }
    }
    sel.addEventListener('change', updateInfo);
    updateInfo();
  }

  const STEP_HTML = [stepIdentity, stepVehicle, stepTrip, stepCPDReview, stepPayment];

  function renderCPDWizard() {
    content.innerHTML = `
      <div class="page-header">
        <div class="page-title-block">
          <h1 class="page-title">${isRenew ? 'Renew your CPD' : 'Apply for CPD'}</h1>
          <p class="page-subtitle">Carnet de Passage en Douane application</p>
        </div>
      </div>
      ${isRenew ? `
      <div class="pub-renew-banner">
        <i class="fa-solid fa-rotate"></i>
        <span>Renewing your last Carnet${renewSource?.request_id ? ` &ndash; ${renewSource.request_id}` : ''}</span>
      </div>` : ''}
      <div class="wizard-progress">
        ${CPD_STEPS.map((s, i) => `
        <div class="wizard-step ${i === currentStep ? 'active' : i < currentStep ? 'done' : ''}">
          <div class="wizard-step-icon">${i < currentStep ? '<i class="fa-solid fa-check"></i>' : i + 1}</div>
          <div class="wizard-step-label">${s.label}</div>
        </div>
        ${i < CPD_STEPS.length - 1 ? '<div class="wizard-connector' + (i < currentStep ? ' done' : '') + '"></div>' : ''}`).join('')}
      </div>
      <form id="cpd-wizard-form" novalidate>
        <div class="section-card">
          ${['identity','vehicle','trip','review'].includes(CPD_STEPS[currentStep].id) ? '' : `<div class="section-card-header">${CPD_STEPS[currentStep].label}</div>`}
          <div class="section-card-body" id="cpd-step-body">
            ${STEP_HTML[currentStep]()}
          </div>
        </div>
        <div id="cpd-form-error" class="form-error hidden" style="margin-top:8px"></div>
        <div class="wizard-nav">
          <button type="button" class="btn btn-ghost" id="btn-cpd-back">
            <i class="fa-solid fa-arrow-left"></i> ${currentStep === 0 ? 'Cancel' : 'Back'}
          </button>
          <button type="button" class="btn btn-primary" id="btn-cpd-next">
            ${currentStep === CPD_STEPS.length - 1
              ? '<i class="fa-solid fa-paper-plane"></i> Submit Application'
              : 'Next <i class="fa-solid fa-arrow-right"></i>'}
          </button>
        </div>
      </form>`;

    restoreCPDStep();
    bindCPDStep();
  }

  function saveCPDStep() {
    const form = document.getElementById('cpd-wizard-form');
    if (!form) return;
    new FormData(form).forEach((val, key) => { formData[key] = val; });
    // Explode Full Name into first_name (first two words) and last_name (remaining words)
    if (formData.full_name) {
      const nameParts = formData.full_name.trim().split(/\s+/).filter(Boolean);
      formData.first_name = nameParts.slice(0, 2).join(' ');
      formData.last_name  = nameParts.slice(2).join(' ');
    }
    // Upholstery: Yes/No/Other choice + free text when Other is selected
    if (CPD_STEPS[currentStep].id === 'vehicle') {
      formData.upholstery = formData.upholstery_choice === 'Other'
        ? (formData.upholstery_other ?? '')
        : (formData.upholstery_choice ?? '');
    }
    if (CPD_STEPS[currentStep].id === 'trip') {
      savedCountries.length = 0;
      document.querySelectorAll('.cpd-country-check input:checked').forEach(cb => savedCountries.push(cb.value));
    }
    // Build delivery_address string from the structured address fields
    if (CPD_STEPS[currentStep].id === 'review') {
      const dBldg  = (formData.del_building ?? '').trim();
      const dSt    = (formData.del_street   ?? '').trim();
      const dArea  = (formData.del_area     ?? '').trim();
      const dExtra = (formData.del_extra    ?? '').trim();
      formData.delivery_address = (formData.delivery_option ?? 'home_delivery') === 'home_delivery'
        ? [dBldg, dSt, dArea, formData.del_emirate, dExtra].filter(Boolean).join(' ')
        : '';
    }
    // Capture document File objects before this step's DOM is destroyed
    if (CPD_STEPS[currentStep].id === 'vehicle') {
      const slots = ['eid_front','eid_back','dl_front','dl_back','traffic_front','traffic_back',
                     'passport_photo','visa_page','trade_license','noc'];
      slots.forEach(slot => {
        const input = document.querySelector(`input[data-cpd-doc="${slot}"]`);
        if (input?.files?.[0]) savedDocs[slot] = input.files[0];
      });
    }
  }

  function restoreCPDStep() {
    Object.entries(formData).forEach(([name, val]) => {
      if (!val && val !== '0') return;
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      el.value = val;
    });
  }

  function bindCPDStep() {
    document.getElementById('cpd-wizard-form')?.addEventListener('input', e => {
      const name = e.target.name;
      if (!name) return;
      document.getElementById(`err-${name}`)?.textContent && (document.getElementById(`err-${name}`).textContent = '');
      e.target.closest('.field')?.classList.remove('field-invalid');
    });

    // Bind payment method toggle on payment step
    bindPaymentMethodToggle();

    // Toggle corporate-only documents when Usage Type changes
    document.getElementById('cpd-usage-type')?.addEventListener('change', e => {
      const corpDocs = document.getElementById('cpd-corporate-docs');
      if (corpDocs) corpDocs.style.display = e.target.value === 'COMPANY' ? 'contents' : 'none';
    });

    // Toggle the "specify upholstery" textbox when Other is selected
    document.getElementById('cpd-upholstery-choice')?.addEventListener('change', e => {
      const otherRow = document.getElementById('cpd-upholstery-other-row');
      if (otherRow) otherRow.style.display = e.target.value === 'Other' ? '' : 'none';
    });

    // Load review step document thumbnails
    if (CPD_STEPS[currentStep].id === 'review') {
      document.querySelectorAll('.rv-doc-thumb[data-slot]').forEach(thumbEl => {
        const slot  = thumbEl.dataset.slot;
        const label = thumbEl.closest('.rv-doc-item')?.querySelector('.rv-doc-label')?.textContent ?? slot;
        const file  = savedDocs[slot];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          thumbEl.classList.remove('rv-doc-thumb-empty');
          thumbEl.innerHTML = `<img src="${ev.target.result}" alt="${slot}" /><span class="rv-doc-check"><i class="fa-solid fa-circle-check"></i></span>`;
          thumbEl.classList.add('rv-doc-thumb-clickable');
          thumbEl.addEventListener('click', () => {
            openModal({
              title: label,
              body: `<img src="${ev.target.result}" alt="${label}" style="display:block;max-width:100%;max-height:75vh;margin:0 auto;border-radius:var(--radius)" />`,
              size: 'lg',
            });
          });
        };
        reader.readAsDataURL(file);
      });
    }

    // Delivery method card toggle (review step)
    const cpdDelCards = document.querySelectorAll('#cpd-del-card-home, #cpd-del-card-collection');
    if (cpdDelCards.length) {
      const addrCol   = document.getElementById('cpd-del-address-col');
      const collCol   = document.getElementById('cpd-del-collection-col');
      const radioHome = document.getElementById('cpd-del-radio-home');
      const radioColl = document.getElementById('cpd-del-radio-collection');
      const cardHome  = document.getElementById('cpd-del-card-home');
      const cardColl  = document.getElementById('cpd-del-card-collection');

      const applyCpdDelivery = val => {
        const isHome = val === 'home_delivery';
        if (addrCol)   addrCol.style.display  = isHome ? '' : 'none';
        if (collCol)   collCol.style.display  = isHome ? 'none' : '';
        if (radioHome) radioHome.innerHTML    = isHome
          ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
          : '<i class="fa-regular fa-circle"></i>';
        if (radioColl) radioColl.innerHTML    = !isHome
          ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
          : '<i class="fa-regular fa-circle"></i>';
        cardHome?.classList.toggle('del-method-card-active', isHome);
        cardColl?.classList.toggle('del-method-card-active', !isHome);
        formData.delivery_option = val;
      };

      cpdDelCards.forEach(card => {
        card.addEventListener('click', () => {
          const radio = card.querySelector('input[type="radio"]');
          if (radio) { radio.checked = true; applyCpdDelivery(radio.value); }
        });
      });
    }

    // Collection office card selection (review step)
    const cpdOfficeCards = document.querySelectorAll('#cpd-del-collection-col .del-office-card');
    if (cpdOfficeCards.length) {
      const collectionRadio = document.getElementById('cpd-del-radio-collection-input');
      cpdOfficeCards.forEach(card => {
        card.addEventListener('click', () => {
          cpdOfficeCards.forEach(c => {
            const isSelected = c === card;
            c.classList.toggle('del-office-card-active', isSelected);
            const radioIcon = c.querySelector('.del-office-radio');
            if (radioIcon) radioIcon.innerHTML = isSelected
              ? '<i class="fa-solid fa-circle-dot" style="color:var(--accent)"></i>'
              : '<i class="fa-regular fa-circle"></i>';
          });
          const office = OFFICES.find(o => o.id === card.dataset.office);
          if (collectionRadio) { collectionRadio.value = office.deliveryValue; collectionRadio.checked = true; }
          formData.delivery_option = office.deliveryValue;
        });
      });
    }

    // Doc upload zones (vehicle step)
    document.querySelectorAll('[data-cpd-doc]').forEach(input => {
      const zone      = input.closest('.doc-upload-zone');
      const holder    = zone?.querySelector('.doc-upload-placeholder');
      const preview   = zone?.querySelector('.doc-upload-preview');
      const img       = zone?.querySelector('.doc-preview-img');
      const nameEl    = zone?.querySelector('.doc-preview-name');
      const removeBtn = zone?.querySelector('.doc-remove-btn');
      if (!zone) return;
      zone.addEventListener('click', e => { if (!e.target.closest('.doc-remove-btn')) input.click(); });
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        if (!['image/jpeg','image/png'].includes(file.type)) { toast('Only JPG/PNG accepted','error'); input.value=''; return; }
        if (file.size > 2*1024*1024) { toast('File exceeds 2 MB','error'); input.value=''; return; }
        const reader = new FileReader();
        reader.onload = ev => {
          if (img)     img.src = ev.target.result;
          if (nameEl)  nameEl.textContent = file.name;
          if (holder)  holder.style.display = 'none';
          if (preview) preview.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });
      removeBtn?.addEventListener('click', e => {
        e.stopPropagation();
        input.value = '';
        if (img)     img.src = '';
        if (nameEl)  nameEl.textContent = '';
        if (holder)  holder.style.display = '';
        if (preview) preview.style.display = 'none';
      });
      // Restore preview if file already saved
      const slot = input.dataset.cpdDoc;
      if (savedDocs[slot]) {
        const reader = new FileReader();
        reader.onload = ev => {
          if (img)     img.src = ev.target.result;
          if (nameEl)  nameEl.textContent = savedDocs[slot].name;
          if (holder)  holder.style.display = 'none';
          if (preview) preview.style.display = 'flex';
        };
        reader.readAsDataURL(savedDocs[slot]);
      }
    });

    document.getElementById('btn-cpd-back')?.addEventListener('click', () => {
      if (currentStep === 0) { navigate('public-history'); return; }
      saveCPDStep();
      currentStep--;
      renderCPDWizard();
    });

    document.getElementById('btn-cpd-next')?.addEventListener('click', async () => {
      if (!validateCPDStep(currentStep)) return;
      saveCPDStep();
      if (currentStep < CPD_STEPS.length - 1) {
        currentStep++;
        renderCPDWizard();
      } else {
        await submitCPDWizard();
      }
    });
  }

  function setErrCPD(name, msg) {
    const errEl = document.getElementById(`err-${name}`);
    const input = document.querySelector(`[name="${name}"]`);
    if (errEl) errEl.textContent = msg;
    input?.closest('.field')?.classList.add('field-invalid');
  }

  function validateCPDStep(step) {
    document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    document.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
    document.getElementById('cpd-form-error')?.classList.add('hidden');
    const key = CPD_STEPS[step].id;
    let ok = true;
    (CPD_REQUIRED[key] ?? []).forEach(({ name, label }) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el?.value?.trim()) { setErrCPD(name, `${label} is required`); ok = false; }
    });
    if (key === 'identity') {
      const emailEl = document.querySelector('[name="email"]');
      if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
        setErrCPD('email', 'Enter a valid email address'); ok = false;
      }
    }
    if (key === 'vehicle' && formData.upholstery_choice === 'Other' && !document.getElementById('cpd-upholstery-other-row')?.querySelector('input')?.value?.trim()) {
      // no dedicated error element for this nested field — surface as a generic form error
      ok = false;
      document.getElementById('cpd-form-error').textContent = 'Please specify the upholstery type';
      document.getElementById('cpd-form-error').classList.remove('hidden');
    }
    if (key === 'review') {
      const deliveryOption = document.querySelector('[name="delivery_option"]:checked')?.value ?? 'home_delivery';
      if (deliveryOption === 'home_delivery') {
        const emirate = document.getElementById('cpd-del-emirate')?.value;
        if (!emirate) { setErrCPD('del_emirate', 'Emirate is required'); ok = false; }
      }
      const d1 = document.getElementById('disclaimer_1');
      if (!d1?.checked) {
        document.getElementById('err-disclaimer_1').textContent = 'You must read and accept the declaration to proceed';
        document.getElementById('disclaimer-check-1')?.classList.add('disclaimer-invalid');
        ok = false;
      }
    }
    if (key === 'payment') {
      const pm = document.getElementById('cpd-payment-method')?.value;
      if (!pm) {
        document.getElementById('err-cpd-payment-method').textContent = 'Please select a payment method';
        ok = false;
      } else {
        formData.payment_method = pm;
      }
    }
    if (!ok) document.querySelector('.field-error:not(:empty)')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return ok;
  }

  async function submitCPDWizard() {
    const btn   = document.getElementById('btn-cpd-next');
    const errEl = document.getElementById('cpd-form-error');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    errEl?.classList.add('hidden');

    try {
      const { guaranteeFee, bookingFee, extraFee, deliveryFee, processingFee, vat, total } = calcGuarantee();
      const paymentMethod = formData.payment_method ?? 'CASH';
      const body = {
        ...formData,
        countries:        savedCountries.map(Number),
        guarantee_amount: guaranteeFee,
        booking_fee:      bookingFee,
        extra_fees:       extraFee + deliveryFee,
        processing_fee:   processingFee,
        vat_amount:       vat,
        total_amount:     total,
        payment_method:   paymentMethod,
        delivery_option:  formData.delivery_option ?? 'home_delivery',
        delivery_address: formData.delivery_address ?? '',
      };

      const res = await api.cpd.publicStore(body);

      // Upload documents
      const slots  = ['eid_front','eid_back','dl_front','dl_back','traffic_front','traffic_back',
                       'passport_photo','visa_page','trade_license','noc'];
      const fd     = new FormData();
      let hasFiles = false;
      slots.forEach(slot => {
        if (savedDocs[slot]) { fd.append(slot, savedDocs[slot]); hasFiles = true; }
      });
      if (hasFiles) {
        try {
          await api.cpd.uploadDocs(res.auto_id, fd);
        } catch {
          toast('Application submitted but document upload failed — please contact support', 'error');
        }
      }

      if (paymentMethod === 'CREDIT_CARD') {
        // Redirect to Telr — use CPD telrInit endpoint
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to payment gateway…';
        const payment = await api.cpd.telrInit(res.auto_id);
        window.location.href = payment.redirect_url;
      } else {
        // Cash — show success with application number
        content.innerHTML = `
          <div class="section-card" style="margin-top:24px">
            <div class="section-card-body" style="padding:48px;text-align:center">
              <i class="fa-solid fa-circle-check" style="font-size:3.5rem;color:var(--success);margin-bottom:16px;display:block"></i>
              <h2 style="margin-bottom:8px">Application Submitted!</h2>
              <p style="color:var(--text-muted);margin-bottom:4px">Your CPD application has been received.</p>
              <p style="margin-bottom:4px">Application Number: <strong style="color:var(--accent)">${res.request_id}</strong></p>
              <p style="color:var(--text-muted);margin-bottom:24px;font-size:.9rem">
                Please visit the EMSO office to complete your cash payment.
              </p>
              <button class="btn btn-primary" id="btn-cpd-history">
                <i class="fa-solid fa-clock-rotate-left"></i> View My Applications
              </button>
            </div>
          </div>`;
        document.getElementById('btn-cpd-history').addEventListener('click', () => navigate('public-history'));
      }

    } catch (err) {
      errEl.textContent = err.message;
      errEl?.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Application';
    }
  }

  renderCPDWizard();
}

// ── Return your CPD ─────────────────────────────────────────────────────────────
export async function renderPublicCPDReturn() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let rows = [];
  try {
    rows = (await api.cpd.myIssuedCarnets()) ?? [];
  } catch { /* show empty state below */ }

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Return your CPD</h1>
        <p class="page-subtitle">Select an issued Carnet below to submit a return request.</p>
      </div>
    </div>
    <div id="cpd-return-grid"></div>`;

  const gridEl = document.getElementById('cpd-return-grid');

  function renderGrid() {
    if (!rows.length) {
      gridEl.innerHTML = emptyState('fa-car', 'No issued Carnets', 'Carnets you have been issued will appear here once ready to be returned.');
      return;
    }

    gridEl.innerHTML = `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-body" style="padding:0">
          <table class="data-table">
            <thead><tr>
              <th>Request ID</th><th>Carnet No</th><th>Vehicle</th><th>Submitted</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><strong>${r.request_id ?? '—'}</strong></td>
                <td>${r.carnet_no ?? '—'}</td>
                <td>${[r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || '—'}</td>
                <td>${formatDateTime(r.requested_datetime)}</td>
                <td>${r.return_id
                  ? (r.return_confirmed_by
                      ? '<span class="badge badge-success">Return Confirmed</span>'
                      : '<span class="badge badge-warning">Return Pending Confirmation</span>')
                  : '<span class="badge badge-default">Not Returned</span>'}</td>
                <td>
                  ${r.return_id
                    ? ''
                    : `<button class="btn btn-primary btn-sm return-cpd-btn" data-id="${r.auto_id}">
                         <i class="fa-solid fa-rotate-left"></i> Return
                       </button>`}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    gridEl.querySelectorAll('.return-cpd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openCPDReturnModal(Number(btn.dataset.id), () => renderPublicCPDReturn());
      });
    });
  }

  renderGrid();
}

export async function renderPublicCPDRenewSearch() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let rows = [];
  try {
    rows = (await api.cpd.myIssuedCarnets()) ?? [];
  } catch { /* show empty state below */ }

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Renew your CPD</h1>
        <p class="page-subtitle">Select an issued Carnet below to renew it.</p>
      </div>
    </div>
    <div id="cpd-renew-grid"></div>`;

  const gridEl = document.getElementById('cpd-renew-grid');

  if (!rows.length) {
    gridEl.innerHTML = emptyState('fa-car', 'No issued Carnets', 'Carnets you have been issued will appear here once ready to be renewed.');
    return;
  }

  gridEl.innerHTML = `
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            <th>Request ID</th><th>Carnet No</th><th>Vehicle</th><th>Submitted</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><strong>${r.request_id ?? '—'}</strong></td>
              <td>${r.carnet_no ?? '—'}</td>
              <td>${[r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || '—'}</td>
              <td>${formatDateTime(r.requested_datetime)}</td>
              <td>${r.renewal_request_id
                ? `<span class="badge badge-success">Renewed — ${r.renewal_request_id}</span>`
                : '<span class="badge badge-default">Not Renewed</span>'}</td>
              <td>
                ${r.renewal_request_id
                  ? ''
                  : `<button class="btn btn-primary btn-sm renew-cpd-btn" data-id="${r.auto_id}">
                       <i class="fa-solid fa-rotate"></i> Renew
                     </button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  gridEl.querySelectorAll('.renew-cpd-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        const source = await api.cpd.get(Number(btn.dataset.id));
        navigate('public-apply-cpd', { mode: 'renew', source });
      } catch (e) {
        toast(e.message || 'Could not load Carnet details', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Renew';
      }
    });
  });
}

// ── History ────────────────────────────────────────────────────────────────────
export async function renderPublicHistory(defaultTab = 'idl') {
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">My History</h1>
        <p class="page-subtitle">Your IDL and CPD application history</p>
      </div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn ${defaultTab === 'idl' ? 'active' : ''}" data-tab="idl">
        <i class="fa-solid fa-id-card"></i> IDL Applications
      </button>
      <button class="tab-btn ${defaultTab === 'cpd' ? 'active' : ''}" data-tab="cpd">
        <i class="fa-solid fa-car"></i> CPD Applications
      </button>
    </div>
    <div id="tab-content-idl" class="tab-content" ${defaultTab !== 'idl' ? 'style="display:none"' : ''}>
      <div class="page-loading"><div class="spinner"></div></div>
    </div>
    <div id="tab-content-cpd" class="tab-content" ${defaultTab !== 'cpd' ? 'style="display:none"' : ''}>
      <div class="page-loading"><div class="spinner"></div></div>
    </div>`;

  content.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      content.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
      document.getElementById(`tab-content-${btn.dataset.tab}`).style.display = '';
    });
  });

  const [idlRes, cpdRes] = await Promise.allSettled([
    api.idl.myRequests(1),
    api.cpd.myRequests(1),
  ]);

  const idlEl = document.getElementById('tab-content-idl');
  if (idlRes.status === 'fulfilled' && idlRes.value.data?.length) {
    const rows = idlRes.value.data;
    idlEl.innerHTML = `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-body" style="padding:0">
          <table class="data-table">
            <thead><tr>
              <th>Request ID</th><th>Type</th><th>Submitted</th>
              <th>IDL No</th><th>Amount</th><th>Payment</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><strong>${r.request_id ?? '—'}</strong></td>
                <td><span class="badge badge-default">${r.request_type ?? '—'}</span></td>
                <td>${formatDateTime(r.requested_datetime)}</td>
                <td>${r.idl_no || '—'}</td>
                <td>${r.total_amount != null ? 'AED ' + Number(r.total_amount).toFixed(2) : '—'}</td>
                <td>${statusBadge(r.paid_status == 1 ? 'Paid' : 'Not Paid')}</td>
                <td>${statusBadge(r.status_label ?? r.request_status)}</td>
                <td>
                  <button class="btn btn-ghost btn-sm view-idl-btn" data-id="${r.auto_id}">
                    <i class="fa-solid fa-eye"></i> View
                  </button>
                  ${r.paid_status != 1 ? `
                  <button class="btn btn-primary btn-sm repay-idl-btn" data-id="${r.auto_id}">
                    <i class="fa-solid fa-credit-card"></i> Repay
                  </button>` : ''}
                  ${r.paid_status != 1 ? `
                  <button class="btn btn-danger btn-sm cancel-idl-btn" data-id="${r.auto_id}">
                    <i class="fa-solid fa-ban"></i> Cancel
                  </button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // Bind View buttons
    idlEl.querySelectorAll('.view-idl-btn').forEach(btn => {
      btn.addEventListener('click', () => renderPublicIDLView(Number(btn.dataset.id)));
    });

    // Bind Repay buttons
    idlEl.querySelectorAll('.repay-idl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting…';
        try {
          const payment = await api.idl.telrInit(Number(btn.dataset.id));
          window.location.href = payment.redirect_url;
        } catch (err) {
          toast(err.message || 'Could not start payment', 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Repay';
        }
      });
    });

    // Bind Cancel buttons
    idlEl.querySelectorAll('.cancel-idl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        confirm('Cancel this IDL application? This cannot be undone.', async () => {
          try {
            await api.idl.cancelOwn(Number(btn.dataset.id));
            toast('Application cancelled', 'info');
            renderPublicHistory();
          } catch (err) {
            toast(err.message || 'Could not cancel application', 'error');
          }
        });
      });
    });
  } else {
    idlEl.innerHTML = emptyState('fa-id-card', 'No IDL applications yet', 'Your IDL application history will appear here.');
  }

  const cpdEl = document.getElementById('tab-content-cpd');
  if (cpdRes.status === 'fulfilled' && cpdRes.value.data?.length) {
    const rows = cpdRes.value.data;

    // CPD integer status → badge type and label
    const cpdStatusBadge = rs => {
      const int = parseInt(rs, 10);
      if (int === 1) return '<span class="badge badge-warning">Pending</span>';
      if (int === 2) return '<span class="badge badge-success">Confirmed</span>';
      // Fall back to string label if available
      return statusBadge(rs);
    };

    cpdEl.innerHTML = `
      <div class="section-card" style="margin-top:16px">
        <div class="section-card-body" style="padding:0">
          <table class="data-table">
            <thead><tr>
              <th>Request ID</th><th>Category</th><th>Vehicle</th>
              <th>Amount</th><th>Submitted</th><th>Status</th><th>Payment</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><strong>${r.request_id ?? '&#8212;'}</strong></td>
                <td><span class="badge badge-default">${r.request_category ?? '&#8212;'}</span></td>
                <td>${[r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || '&#8212;'}</td>
                <td>${r.total_amount != null ? 'AED ' + Number(r.total_amount).toFixed(2) : '&#8212;'}</td>
                <td>${formatDateTime(r.requested_datetime)}</td>
                <td>${statusBadge(r.status_label ?? r.request_status)}</td>
                <td>${+r.paid_status === 1
                  ? '<span class="badge badge-success">Paid</span>'
                  : '<span class="badge badge-warning">Unpaid</span>'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm view-cpd-btn" data-id="${r.auto_id}">
                    <i class="fa-solid fa-eye"></i> View
                  </button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    cpdEl.querySelectorAll('.view-cpd-btn').forEach(btn =>
      btn.addEventListener('click', () => renderPublicCPDView(Number(btn.dataset.id))));

  } else {
    cpdEl.innerHTML = emptyState('fa-car', 'No CPD applications yet', 'Your CPD application history will appear here.');
  }
}

function emptyState(icon, title, subtitle) {
  return `
    <div class="section-card" style="margin-top:16px">
      <div class="section-card-body" style="padding:48px;text-align:center">
        <i class="fa-solid ${icon}" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:12px;display:block"></i>
        <h3 style="color:var(--text-secondary);margin-bottom:4px">${title}</h3>
        <p style="color:var(--text-muted);font-size:.9rem">${subtitle}</p>
      </div>
    </div>`;
}

// ── Shared "Return Carnet" modal (used by the CPD detail view and the Return list) ──
function openCPDReturnModal(autoId, onSuccess) {
  openModal({
    title: 'Return Carnet',
    size: 'lg',
    body: `
      <div class="field" style="margin-bottom:16px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Delivery Option</label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;
            border:1px solid var(--accent);border-radius:var(--radius);cursor:pointer;
            transition:border-color .15s" id="label-del-aramex">
            <input type="radio" name="return-delivery" value="ARAMAX" id="del-aramex" checked
              style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer" />
            <span><strong>Return via Aramex</strong><br>
              <small style="color:var(--text-muted)">We arrange Aramex pickup</small></span>
          </label>
        </div>
        <div id="aramex-fee-notice" style="margin-top:8px;padding:8px 12px;
          background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.4);border-radius:var(--radius);
          font-size:.88rem;color:var(--warning,#ca8a04)">
          <i class="fa-solid fa-circle-info"></i>
          An additional charge of <strong>AED 30.00</strong> will apply for Aramex pickup.
        </div>
      </div>

      <div class="field" style="margin-bottom:16px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Return Payment Option <span style="color:var(--accent)">*</span></label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;
            border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;
            transition:border-color .15s" id="label-pay-bank">
            <input type="radio" name="return-payment" value="BANK_DEPOSIT" id="pay-bank"
              style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer" />
            <span><strong>Deposit to Bank</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;
            border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;
            transition:border-color .15s" id="label-pay-cheque">
            <input type="radio" name="return-payment" value="COLLECT_CHEQUE" id="pay-cheque"
              style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer" />
            <span><strong>Collect Cheque from Office</strong></span>
          </label>
        </div>
      </div>

      <!-- Bank Details (shown when Deposit to Bank selected) -->
      <div id="bank-details-section" style="display:none;background:var(--bg-elevated);
        border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:16px">
        <div style="font-size:.85rem;font-weight:600;color:var(--text-muted);margin-bottom:12px;
          text-transform:uppercase;letter-spacing:.05em">Bank Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field" style="margin:0">
            <label>Bank Name <span style="color:var(--accent)">*</span></label>
            <input type="text" id="ret-bank-name" placeholder="e.g. Emirates NBD" />
          </div>
          <div class="field" style="margin:0">
            <label>Account Number <span style="color:var(--accent)">*</span></label>
            <input type="text" id="ret-account-no" placeholder="Account number" />
          </div>
          <div class="field" style="margin:0">
            <label>IBAN Number</label>
            <input type="text" id="ret-iban" placeholder="AE00 0000 0000 0000 0000 000" />
          </div>
          <div class="field" style="margin:0">
            <label>Beneficiary Name <span style="color:var(--accent)">*</span></label>
            <input type="text" id="ret-beneficiary" placeholder="Account holder name" />
          </div>
        </div>
      </div>

      <div class="field" style="margin:0">
        <label>Remarks <span style="color:var(--accent)">*</span></label>
        <textarea id="return-carnet-remarks" rows="3"
          placeholder="Describe the condition of the carnet and reason for return…"
          style="width:100%;resize:vertical"></textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Close
             </button>
             <button class="btn btn-warning" id="return-carnet-confirm">
               <i class="fa-solid fa-rotate-left"></i> Submit Return
             </button>`,
  });

  // Highlight selected option on change
  const highlightOption = (name, value, prefix) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
      const lbl = document.getElementById(`${prefix}${r.value.toLowerCase()}`);
      if (lbl) lbl.style.borderColor = r.checked ? 'var(--accent)' : 'var(--border)';
    });
  };

  // Bank details section
  document.querySelectorAll('input[name="return-payment"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('bank-details-section').style.display =
        document.getElementById('pay-bank').checked ? '' : 'none';
      highlightOption('return-payment', r.value, 'label-pay-');
    });
  });

  document.getElementById('return-carnet-confirm').onclick = async () => {
    const delivery = document.querySelector('input[name="return-delivery"]:checked')?.value;
    const payment  = document.querySelector('input[name="return-payment"]:checked')?.value;
    const remarks  = document.getElementById('return-carnet-remarks').value.trim();
    if (!delivery) return toast('Please select a delivery option', 'error');
    if (!payment)  return toast('Please select a return payment option', 'error');
    if (!remarks)  return toast('Please enter remarks', 'error');

    const body = { remarks, delivery_option: delivery, payment_option: payment };

    if (payment === 'BANK_DEPOSIT') {
      const bankName    = document.getElementById('ret-bank-name').value.trim();
      const accountNo   = document.getElementById('ret-account-no').value.trim();
      const iban        = document.getElementById('ret-iban').value.trim();
      const beneficiary = document.getElementById('ret-beneficiary').value.trim();
      if (!bankName)    return toast('Please enter the bank name', 'error');
      if (!accountNo)   return toast('Please enter the account number', 'error');
      if (!beneficiary) return toast('Please enter the beneficiary name', 'error');
      body.bank_name       = bankName;
      body.account_no      = accountNo;
      body.iban            = iban;
      body.beneficiary     = beneficiary;
    }

    const btn = document.getElementById('return-carnet-confirm');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const res = await api.cpd.returnCarnet(autoId, body);

      if (delivery === 'ARAMAX') {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Redirecting to payment…';
        try {
          const pay = await api.cpd.telrInitReturn(res.return_id);
          if (pay?.redirect_url) {
            closeModal();
            window.location.href = pay.redirect_url;
          } else {
            toast('Payment gateway did not return a redirect URL', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Submit Return';
          }
        } catch (pe) {
          console.error('telrInitReturn error:', pe);
          toast(`Payment initiation failed: ${pe.message}`, 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Submit Return';
        }
      } else {
        closeModal();
        toast('Carnet return request submitted successfully', 'success');
        onSuccess?.();
      }
    } catch (e) {
      toast(e.message || 'Failed to submit return request', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Submit Return';
    }
  };
}

// ── Public CPD Application View ───────────────────────────────────────────────
async function renderPublicCPDView(autoId) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let r, docs, comments, cancelReq, existingReturn;
  try {
    [r, docs, comments, cancelReq, existingReturn] = await Promise.all([
      api.cpd.get(autoId),
      api.cpd.getDocs(autoId).catch(() => []),
      api.cpd.getComments(autoId).catch(() => []),
      api.cpd.getCancelRequest(autoId).catch(() => null),
      api.cpd.getReturnCarnet(autoId).catch(() => null),
    ]);
  } catch (err) {
    content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${err.message}</p></div>`;
    return;
  }

  const isSentForCorrections = String(r.request_status) === '8';
  const hasCancelReq         = !!(cancelReq && cancelReq.cancel_auto_id);
  const hasReturnReq         = !!(existingReturn && existingReturn.return_id);
  const cancelApproved       = hasCancelReq ? parseInt(cancelReq.cancelled_approved) : 0;

  const d = (label, value) => `
    <div class="detail-item">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${value || '—'}</span>
    </div>`;

  // Editable field helper
  const ef = (label, name, value, type = 'text') => `
    <div class="field">
      <label>${label}</label>
      <input name="${name}" type="${type}" value="${esc(value)}" />
    </div>`;

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const payMap = { CREDIT_CARD:'Credit Card', CASH:'Cash', CARD:'Card', ONLINE:'Online', CHEQUE:'Cheque' };
  const aed = n => n != null ? 'AED ' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';

  const countries    = (r.countries ?? []).map(c => esc(c.nationality)).join(', ') || '&#8212;';
  const payMethodKey = (r.method_of_payment ?? '').toUpperCase();
  const payMethodLabel = payMap[payMethodKey] || esc(r.method_of_payment) || '&#8212;';

  // Officer correction comments banner
  const correctionBanner = isSentForCorrections && comments.length > 0 ? `
    <div style="background:#c0392b;color:#fff;border-radius:var(--radius);padding:16px 20px;margin-bottom:20px">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Corrections Required
      </div>
      ${comments.map(c => `
        <div style="margin-bottom:6px">
          <div style="font-size:.85rem;opacity:.8;margin-bottom:2px">
            ${c.first_name ?? ''} ${c.last_name ?? ''} &middot; ${formatDateTime(c.added_datetime)}
          </div>
          <div style="font-size:.9rem;line-height:1.5">${esc(c.comment)}</div>
        </div>`).join('<hr style="border-color:rgba(255,255,255,.3);margin:8px 0">')}
    </div>` : '';

  // Owner details section — editable if status 8
  const ownerSection = isSentForCorrections ? `
    <div class="section-card">
      <div class="section-card-header">Owner Details <span style="font-size:.75rem;font-weight:400;opacity:.7">(Please correct the fields below)</span></div>
      <div class="section-card-body">
        <form id="cpd-corrections-form">
          <div class="form-grid">
            ${ef('First Name',          'first_name',          r.first_name)}
            ${ef('Last Name',           'last_name',           r.last_name)}
            ${ef('Emirates ID',         'emirates_id',         r.emirates_id)}
            ${ef('Mobile',              'mobile_no',           r.mobile_no,  'tel')}
            ${ef('Email',               'email',               r.email,      'email')}
            ${ef('Passport No',         'passport_no',         r.passport_no)}
            ${ef('PO Box',              'po_box',              r.po_box)}
            ${ef('City',                'city',                r.city)}
            ${ef('UAE Address',         'uae_address',         r.uae_address)}
            ${ef('Home Country Address','home_country_address', r.home_country_address)}
          </div>
          <div class="detail-grid" style="margin-top:12px">
            ${d('Extra Driver 1 Name', esc(r.extra_owner1_name) || '—')}
            ${d('Extra Driver 2 Name', esc(r.extra_owner2_name) || '—')}
          </div>
        </form>
      </div>
    </div>` : `
    <div class="section-card">
      <div class="section-card-header">Owner Details</div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Full Name', [r.title, r.first_name, r.last_name].filter(Boolean).join(' '))}
          ${d('Emirates ID', esc(r.emirates_id))}
          ${d('Mobile', esc(r.mobile_no))}
          ${d('Email', esc(r.email))}
          ${d('Passport No', esc(r.passport_no))}
          ${d('PO Box', esc(r.po_box))}
          ${d('City', esc(r.city))}
          ${d('UAE Address', esc(r.uae_address))}
          ${d('Extra Driver 1 Name', esc(r.extra_owner1_name) || '—')}
          ${d('Extra Driver 2 Name', esc(r.extra_owner2_name) || '—')}
        </div>
      </div>
    </div>`;

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${esc(r.request_id ?? 'CPD Application')}</h1>
        <p class="page-subtitle">Carnet de Passage en Douane</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="btn-back-cpd-history">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
        ${isSentForCorrections ? `
        <button class="btn btn-primary" id="btn-submit-corrections">
          <i class="fa-solid fa-paper-plane"></i> Resubmit Application
        </button>` : ''}
        ${String(r.request_status) === '3' && !hasReturnReq ? `
        <button class="btn btn-warning" id="btn-return-carnet-header">
          <i class="fa-solid fa-rotate-left"></i> Return Carnet
        </button>` : ''}
      </div>
    </div>

    ${correctionBanner}

    <!-- Status banner -->
    <div style="margin-bottom:16px;padding:12px 16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:.82rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Status</span>
        ${statusBadge(r.status_label ?? r.request_status)}
      </div>
      <span style="font-size:.82rem;color:var(--text-muted)">Submitted: ${formatDateTime(r.requested_datetime)}</span>
    </div>

    ${ownerSection}

    <!-- Vehicle Information -->
    <div class="section-card">
      <div class="section-card-header">Vehicle Information</div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Traffic File No', esc(r.mulkiya_no))}
          ${d('Registration No', esc(r.registration_no))}
          ${d('Make', esc(r.vehicle_make))}
          ${d('Model', esc(r.vehicle_model))}
          ${d('Year', esc(r.manuf_year))}
          ${d('Color', esc(r.color))}
          ${d('Body Type', esc(r.body_type))}
          ${d('Chassis No', esc(r.chassis_no))}
          ${d('Engine No', esc(r.engine_no))}
          ${d('Horse Power', esc(r.horse_power))}
          ${d('Cylinders', esc(r.no_of_cylinders))}
          ${d('Net Weight', esc(r.net_weight))}
          ${d('Vehicle Value', r.vehicle_value != null ? 'AED ' + Number(r.vehicle_value).toLocaleString() : '—')}
          ${d('Registered In', esc(r.vehicle_registered_in))}
          ${d('Upholstery', esc(r.upholstery))}
          ${d('No of Seats', esc(r.no_of_seats))}
          ${d('Radio', esc(r.radio))}
          ${d('Spare Tyre', esc(r.spare_tyre))}
        </div>
        <div class="detail-grid" style="margin-top:12px">
          ${r.additional_remarks   ? d('Additional Remarks',                         esc(r.additional_remarks))   : ''}
          ${r.others1              ? d('Other Particulars / Extra Items (1)',         esc(r.others1))              : ''}
          ${r.others2              ? d('Other Particulars / Extra Items (2)',         esc(r.others2))              : ''}
          ${r.uae_refree1          ? d('Reference 1 (UAE) Name / Contact',            esc(r.uae_refree1))          : ''}
          ${r.destination_refree1  ? d('Reference 1 (Destination) Name / Contact',   esc(r.destination_refree1))  : ''}
          ${r.uae_refree2          ? d('Reference 2 (UAE) Name / Contact',            esc(r.uae_refree2))          : ''}
          ${r.destination_refree2  ? d('Reference 2 (Destination) Name / Contact',   esc(r.destination_refree2))  : ''}
        </div>
      </div>
    </div>

    <!-- Trip Details -->
    <div class="section-card">
      <div class="section-card-header">Trip Details</div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Destination Countries', countries)}
        </div>
      </div>
    </div>

    <!-- Documents -->
    <div class="section-card">
      <div class="section-card-header">Uploaded Documents
        ${isSentForCorrections ? '<span style="font-size:.75rem;font-weight:400;opacity:.7"> (You may replace any document below)</span>' : ''}
      </div>
      <div class="section-card-body">
        ${isSentForCorrections ? `
        <div id="cpd-doc-upload-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
          ${[
            {key:'traffic_front',  label:'Traffic File Front'},
            {key:'traffic_back',   label:'Traffic File Back'},
            {key:'eid_front',      label:'Emirates ID Front'},
            {key:'eid_back',       label:'Emirates ID Back'},
            {key:'passport_photo', label:'Passport Photo'},
            {key:'visa_page',      label:'Visa Page'},
            {key:'trade_license',  label:'Trade License'},
            {key:'noc',            label:'NOC'},
          ].map(({key, label}) => {
            const existing = docs && docs.find(d => d.key === key || d.label.toLowerCase().replace(/\s+/g,'_') === label.toLowerCase().replace(/\s+/g,'_'));
            return `
            <div class="cpd-doc-slot" data-key="${key}">
              <div style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
                color:var(--text-muted);margin-bottom:6px">${label}</div>
              <div class="doc-upload-zone" id="cpd-doc-zone-${key}" style="min-height:110px;position:relative">
                <input type="file" accept=".jpg,.jpeg,.png" class="cpd-doc-input" data-key="${key}" style="display:none" />
                ${existing
                  ? `<img src="${existing.base64}" class="cpd-doc-preview-img" style="width:100%;height:110px;object-fit:cover;border-radius:4px;cursor:pointer" />`
                  : `<div class="doc-upload-placeholder" style="height:110px"><i class="fa-solid fa-cloud-arrow-up"></i><span>Click to upload</span></div>`}
                <div class="cpd-doc-new-preview" style="display:none;position:relative">
                  <img style="width:100%;height:110px;object-fit:cover;border-radius:4px" />
                  <div style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.5);color:#fff;
                    font-size:.7rem;padding:2px 6px;border-radius:10px">New</div>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>` : `
        ${docs && docs.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
          ${docs.map(doc => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
            <a href="${doc.base64}" target="_blank" rel="noopener"
               style="display:block;width:100%;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border)">
              <img src="${doc.base64}" alt="${doc.label}"
                style="width:100%;height:110px;object-fit:cover;display:block" />
            </a>
            <span style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
              color:var(--text-muted);text-align:center">${doc.label}</span>
          </div>`).join('')}
        </div>` : '<p style="color:var(--text-muted)">No documents uploaded.</p>'}`}
      </div>
    </div>

    <!-- Payment Details -->
    <div class="section-card">
      <div class="section-card-header">Payment Details</div>
      <div class="section-card-body" style="padding:0">
        <table style="width:100%;border-collapse:collapse">
          <tbody>
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted);width:50%">Payment Method</td>
              <td style="padding:10px 16px;font-weight:500">${payMethodLabel}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted)">Guarantee Fee</td>
              <td style="padding:10px 16px;font-weight:500">${aed(r.guarantee_amount)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted)">Booking Fee</td>
              <td style="padding:10px 16px;font-weight:500">${aed(r.booking_fee)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted)">Extra Fees</td>
              <td style="padding:10px 16px;font-weight:500">${r.extra_fees != null ? aed(r.extra_fees) : 'AED 0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted)">VAT (5%)</td>
              <td style="padding:10px 16px;font-weight:500">${aed(r.vat_amount)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--border);background:var(--accent-dim)">
              <td style="padding:12px 16px;font-weight:700">Total Amount</td>
              <td style="padding:12px 16px;font-weight:700;color:var(--accent)">${aed(r.total_amount)}</td>
            </tr>
            ${r.order_ref_no ? `
            <tr>
              <td style="padding:10px 16px;font-size:.875rem;color:var(--text-muted)">Payment Reference</td>
              <td style="padding:10px 16px;font-weight:500;font-family:monospace">${esc(r.order_ref_no)}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    ${r.issued_carnet ? `
    <div class="section-card" style="margin-top:16px;border:1px solid rgba(34,197,94,.3)">
      <div class="section-card-header" style="background:rgba(34,197,94,.12)">
        <i class="fa-solid fa-clipboard-check" style="margin-right:6px;color:var(--success,#22c55e)"></i>
        Issued Carnet Details
      </div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Carnet No',   `<strong style="font-size:1.05rem;color:var(--accent)">${esc(r.issued_carnet.carnet_no)}</strong>`)}
          ${d('Issued Date', formatDateTime(r.issued_carnet.issued_datetime))}
          ${d('Issued By',   esc(r.issued_carnet.issued_by_name))}
        </div>
      </div>
    </div>` : ''}

    ${hasReturnReq ? `
    <div class="section-card" style="margin-top:16px;border:1px solid rgba(234,179,8,.3)">
      <div class="section-card-header" style="background:rgba(234,179,8,.08)">
        <i class="fa-solid fa-rotate-left" style="margin-right:6px;color:var(--warning,#ca8a04)"></i>
        Return Request
      </div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Submitted',        formatDateTime(existingReturn.added_datetime))}
          ${d('Delivery Option',  existingReturn.delivery_method === 'ARAMAX' ? 'Return via Aramex' : 'Return to Office')}
          ${d('Payment Option',   existingReturn.return_payment_method === 'BANK_DEPOSIT' ? 'Deposit to Bank' : 'Collect Cheque from Office')}
          ${existingReturn.remarks ? d('Remarks', esc(existingReturn.remarks)) : ''}
          ${d('Payment Status',   existingReturn.order_status == 1
              ? '<span class="badge badge-success">Paid</span>'
              : existingReturn.delivery_method === 'ARAMAX'
                ? '<span class="badge badge-warning">Pending Payment</span>'
                : '<span class="badge badge-info">Processing</span>')}
        </div>
      </div>
    </div>` : ''}

    <!-- Footer actions -->
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="btn-back-cpd-footer">
        <i class="fa-solid fa-arrow-left"></i> Back
      </button>
      ${String(r.request_status) === '3' && !hasReturnReq ? `
      <button class="btn btn-warning" id="btn-return-carnet-footer">
        <i class="fa-solid fa-rotate-left"></i> Return Carnet
      </button>` : ''}
    </div>

    ${hasCancelReq ? `
    <div class="section-card" style="margin-top:16px;border:1px solid rgba(239,68,68,.3)">
      <div class="section-card-header" style="background:rgba(239,68,68,.08)">
        <i class="fa-solid fa-ban" style="margin-right:6px;color:var(--danger,#ef4444)"></i>
        Cancellation Request
      </div>
      <div class="section-card-body">
        <div class="detail-grid">
          ${d('Status', cancelApproved === 1
            ? '<span class="badge badge-success">Approved</span>'
            : cancelApproved === -1
              ? '<span class="badge badge-danger">Rejected</span>'
              : '<span class="badge badge-warning">Pending Review</span>')}
          ${d('Submitted',  formatDateTime(cancelReq.cancelled_datetime))}
          ${cancelReq.remarks ? d('Reason', esc(cancelReq.remarks)) : ''}
        </div>
      </div>
    </div>` : ''}`;

  document.getElementById('btn-back-cpd-history').addEventListener('click', () => renderPublicHistory('cpd'));
  document.getElementById('btn-back-cpd-footer')?.addEventListener('click', () => renderPublicHistory('cpd'));

  // Return Carnet handler (status=3 only)
  const openReturnCarnetModal = () => openCPDReturnModal(autoId, () => {
    document.getElementById('btn-return-carnet-header')?.setAttribute('disabled', 'true');
    document.getElementById('btn-return-carnet-footer')?.setAttribute('disabled', 'true');
  });

  document.getElementById('btn-return-carnet-header')?.addEventListener('click', openReturnCarnetModal);
  document.getElementById('btn-return-carnet-footer')?.addEventListener('click', openReturnCarnetModal);

  // Resubmit corrections handler
  const submitBtn = document.getElementById('btn-submit-corrections');
  if (submitBtn) {
    // Bind doc upload click zones
    if (isSentForCorrections) {
      document.querySelectorAll('.doc-upload-zone[id^="cpd-doc-zone-"]').forEach(zone => {
        zone.addEventListener('click', () => {
          zone.querySelector('.cpd-doc-input')?.click();
        });
        const input = zone.querySelector('.cpd-doc-input');
        if (input) {
          input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
              const newPreview = zone.querySelector('.cpd-doc-new-preview');
              const img        = newPreview?.querySelector('img');
              if (img) img.src = e.target.result;
              if (newPreview) newPreview.style.display = '';
              // Hide old image
              const oldImg = zone.querySelector('.cpd-doc-preview-img');
              if (oldImg) oldImg.style.display = 'none';
              const placeholder = zone.querySelector('.doc-upload-placeholder');
              if (placeholder) placeholder.style.display = 'none';
            };
            reader.readAsDataURL(file);
          });
        }
      });
    }

    submitBtn.addEventListener('click', async () => {
      const form = document.getElementById('cpd-corrections-form');
      if (!form) return;
      const body = {};
      new FormData(form).forEach((val, key) => { body[key] = val; });
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
      try {
        // Upload any new documents first
        const newDocs = document.querySelectorAll('.cpd-doc-input');
        if (newDocs.length) {
          const fd = new FormData();
          let hasFiles = false;
          newDocs.forEach(input => {
            if (input.files[0]) {
              fd.append(input.dataset.key, input.files[0]);
              hasFiles = true;
            }
          });
          if (hasFiles) await api.cpd.uploadDocs(autoId, fd);
        }
        await api.cpd.publicUpdate(autoId, body);
        toast('Application resubmitted for review', 'success');
        renderPublicHistory('cpd');
      } catch (e) {
        toast(e.message || 'Failed to submit', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Resubmit Application';
      }
    });
  }
}

// ── Payment Result Pages ───────────────────────────────────────────────────────
export async function renderPaymentResult(outcome) {
  const content = document.getElementById('page-content');

  const OUTCOMES = {
    success: {
      icon:    'fa-circle-check',
      colour:  'var(--success)',
      title:   'Payment Successful',
      message: 'Your payment was processed successfully. Your IDL application is now under review.',
      btnLabel:'View My Applications',
      route:   'public-history',
    },
    declined: {
      icon:    'fa-circle-xmark',
      colour:  'var(--danger)',
      title:   'Payment Declined',
      message: 'Your payment was declined. Please check your card details and try again.',
      btnLabel:'Apply Again',
      route:   'public-apply-idl',
    },
    cancelled: {
      icon:    'fa-circle-minus',
      colour:  'var(--text-muted)',
      title:   'Payment Cancelled',
      message: 'You cancelled the payment. Your application has not been submitted.',
      btnLabel:'Return to Application',
      route:   'public-apply-idl',
    },
  };

  const o = OUTCOMES[outcome] ?? OUTCOMES.cancelled;

  if (outcome === 'success') {
    content.innerHTML = `
      <div class="section-card" style="margin-top:32px;max-width:520px;margin-inline:auto">
        <div class="section-card-body" style="padding:48px 40px;text-align:center">
          <div class="spinner" style="margin:0 auto 16px"></div>
          <p style="color:var(--text-muted)">Verifying your payment, please wait…</p>
        </div>
      </div>`;

    try {
      const result = await api.idl.telrVerify();
      // Adjust success message for CPD return payments
      if (result?.return_id) {
        o.message = 'Your delivery fee was paid successfully. Our team will contact you to arrange carnet collection.';
        o.route   = 'public-history';
      }
    } catch (err) {
      if (err.status === 403) {
        window.history.replaceState({}, '', '/atc_v2/public/');
        navigate('public-history');
        return;
      }
      o.message = `Payment verification error: ${err.message}. If payment was charged, please contact support.`;
    }
  }

  content.innerHTML = `
    <div class="section-card" style="margin-top:32px;max-width:520px;margin-inline:auto">
      <div class="section-card-body" style="padding:48px 40px;text-align:center">
        <i class="fa-solid ${o.icon}" style="font-size:3.5rem;color:${o.colour};display:block;margin-bottom:16px"></i>
        <h2 style="margin-bottom:10px">${o.title}</h2>
        <p style="color:var(--text-muted);margin-bottom:28px;line-height:1.6">${o.message}</p>
        <button class="btn btn-primary" id="btn-payment-action">
          <i class="fa-solid fa-arrow-right"></i> ${o.btnLabel}
        </button>
      </div>
    </div>`;

  document.getElementById('btn-payment-action').addEventListener('click', () => {
    window.history.replaceState({}, '', '/atc_v2/public/');
    navigate(o.route);
  });
}
async function renderPublicIDLView(autoId) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let r, docs;
  try {
    [r, docs] = await Promise.all([
      api.idl.get(autoId),
      api.idl.getDocuments(autoId).catch(() => ({})),
    ]);
  } catch (err) {
    content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${err.message}</p></div>`;
    return;
  }

  const idRow = (icon, label, value) => `
          <div class="rv-identity-row"><span class="rv-id-icon"><i class="${icon}"></i></span><span class="rv-id-label">${label}</span><span class="rv-id-value">${value || '—'}</span></div>`;

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const CAT_LABELS   = { A:'Motorcycle', B:'Car', C:'Heavy Vehicle', D:'Bus', E:'Car with Heavy Trailer' };
  const CAT_ICONS    = { A:'fa-motorcycle', B:'fa-car', C:'fa-truck', D:'fa-bus', E:'fa-trailer' };
  // Older requests store legacy numeric dl_type ids (mn_idl_dl_types) instead of the new A–E letter codes
  const LEGACY_CAT_MAP = { 1:'A', 2:'B', 3:'C', 4:'D', 5:'E', 6:'E' };
  const selectedCats = (r.type_of_dl || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(code => LEGACY_CAT_MAP[code] ?? code);

  const docLabels = { eid_front:'Emirates ID Front', eid_back:'Emirates ID Back', dl_front:'Driving License Front', dl_back:'Driving License Back', passport_photo:'Passport Photo', signature:'Signature' };
  const docUrl = slot => docs[slot] ? `${window.location.origin}${API_BASE}/idl/requests/${autoId}/documents/${docs[slot].split('/').pop()}` : null;
  const docThumb = (slot, label) => {
    const url = docUrl(slot);
    return `
      <div class="rv-doc-item">
        <div class="rv-doc-thumb ${url ? 'rv-doc-thumb-clickable' : 'rv-doc-thumb-empty'}" ${url ? `data-url="${url}" data-label="${label}"` : ''}>
          ${url ? `<img src="${url}" alt="${label}" /><span class="rv-doc-check"><i class="fa-solid fa-circle-check"></i></span>` : '<i class="fa-solid fa-file-image"></i>'}
        </div>
        <div class="rv-doc-label">${label}</div>
      </div>`;
  };

  const DL_OPTION_LABELS = {
    pick_from_office: 'Pick up at ATCUAE Office',
    send_to_address: 'Send to Address',
    home_delivery: 'Home Delivery',
    pick_from_dubai_office: 'Pick up at Dubai Office',
    pick_from_abudhabi_office: 'Pick up at Abu Dhabi Office',
  };

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">IDL Application</h1>
        <p class="page-subtitle">
          ${esc(r.request_id)}
          &nbsp;·&nbsp; ${statusBadge(r.paid_status == 1 ? 'Paid' : 'Not Paid')}
          &nbsp;·&nbsp; ${statusBadge(r.status_label ?? r.request_status)}
        </p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" id="btn-back-history">
          <i class="fa-solid fa-arrow-left"></i> Back to History
        </button>
      </div>
    </div>

    <!-- Personal Information -->
    <div class="rv-section">
      <div class="rv-section-header">
        <span class="rv-section-title">Personal Information</span>
      </div>
      <div class="rv-identity-rows">
        ${idRow('fa-regular fa-user',         'Full Name',           [r.first_name, r.last_name].filter(Boolean).map(esc).join(' '))}
        ${idRow('fa-regular fa-id-card',      'Emirates ID',         esc(r.emirates_id))}
        ${idRow('fa-solid fa-flag',           'Nationality',         esc(r.nationality))}
        ${idRow('fa-solid fa-venus-mars',     'Gender',              esc(r.sex))}
        ${idRow('fa-solid fa-mobile-screen',  'Mobile Number',       esc(r.mobile_no))}
        ${idRow('fa-regular fa-envelope',     'Email Address',       esc(r.email))}
        ${idRow('fa-solid fa-location-dot',   'Address in UAE',      esc(r.address_in_uae))}
        ${idRow('fa-solid fa-inbox',          'PO Box',              esc(r.po_box))}
        ${idRow('fa-solid fa-city',           'City',                esc(r.city))}
        ${idRow('fa-solid fa-globe',          'Home Country Address',esc(r.home_country_address))}
      </div>
    </div>

    <!-- Additional Information -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Additional Information</div>
      <div class="rv-extra-rows">
        <div class="rv-extra-row"><span class="rv-extra-label">Date of Birth</span><span class="rv-extra-value">${r.dob ? formatDate(r.dob) : '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Place of Birth</span><span class="rv-extra-value">${esc(r.place_of_birth) || '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">UAE Permanent Place of Residence</span><span class="rv-extra-value">${esc(r.emirate_name ?? r.emirate) || '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Additional Phone Number</span><span class="rv-extra-value">${esc(r.additional_mobile_no) || '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Additional Email</span><span class="rv-extra-value">${esc(r.additional_email) || '—'}</span></div>
      </div>
    </div>

    <!-- Driving Licence Details -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:14px">Driving Licence Details</div>
      <div class="rv-identity-rows">
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-id-card"></i></span><span class="rv-id-label">Licence Number</span><span class="rv-id-value">${esc(r.license_no) || '—'}</span></div>
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-regular fa-calendar-check"></i></span><span class="rv-id-label">Date of Issue</span><span class="rv-id-value">${r.issued_date ? new Date(r.issued_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}</span></div>
        <div class="rv-identity-row"><span class="rv-id-icon"><i class="fa-solid fa-location-dot"></i></span><span class="rv-id-label">Issuing Emirate</span><span class="rv-id-value">${esc(r.place_of_issue_name ?? r.place_of_issue) || '—'}</span></div>
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

    <!-- Documents Attached -->
    <div class="rv-section">
      <div class="rv-section-title">Documents Attached</div>
      <div class="rv-section-sub">These are the documents uploaded for this application.</div>
      <div class="rv-docs-grid">
        ${docThumb('eid_front',     docLabels.eid_front)}
        ${docThumb('eid_back',      docLabels.eid_back)}
        ${docThumb('dl_front',      docLabels.dl_front)}
        ${docThumb('dl_back',       docLabels.dl_back)}
        ${docThumb('passport_photo',docLabels.passport_photo)}
        ${docThumb('signature',     docLabels.signature)}
      </div>
    </div>

    <!-- Delivery & Payment -->
    <div class="rv-section">
      <div class="rv-section-title" style="margin-bottom:12px">Delivery &amp; Payment</div>
      <div class="rv-extra-rows">
        <div class="rv-extra-row"><span class="rv-extra-label">Delivery Option</span><span class="rv-extra-value">${(DL_OPTION_LABELS[r.delivery_option] ?? esc(r.delivery_option)) || '—'}</span></div>
        ${['send_to_address', 'home_delivery'].includes(r.delivery_option) ? `<div class="rv-extra-row"><span class="rv-extra-label">Delivery Address</span><span class="rv-extra-value">${esc(r.delivery_address) || '—'}</span></div>` : ''}
        <div class="rv-extra-row"><span class="rv-extra-label">Payment Method</span><span class="rv-extra-value">${(() => { const m = (r.payment_method ?? '').toUpperCase(); const map = { CREDIT_CARD:'Credit Card', CASH:'Cash', CARD:'Card', ONLINE:'Online', CHEQUE:'Cheque' }; return map[m] || r.payment_method || '—'; })()}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Total Amount</span><span class="rv-extra-value">${r.total_amount != null ? 'AED ' + Number(r.total_amount).toFixed(2) : '—'}</span></div>
        <div class="rv-extra-row"><span class="rv-extra-label">Paid Date</span><span class="rv-extra-value">${r.paid_date ? formatDateTime(r.paid_date) : '—'}</span></div>
        ${r.order_ref_no   ? `<div class="rv-extra-row"><span class="rv-extra-label">Payment Reference</span><span class="rv-extra-value">${esc(r.order_ref_no)}</span></div>` : ''}
        ${r.idl_no         ? `<div class="rv-extra-row"><span class="rv-extra-label">IDL No</span><span class="rv-extra-value">${esc(r.idl_no)}</span></div>` : ''}
        ${r.idl_booklet_no ? `<div class="rv-extra-row"><span class="rv-extra-label">Booklet No</span><span class="rv-extra-value">${esc(r.idl_booklet_no)}</span></div>` : ''}
        ${r.air_bill_no    ? `<div class="rv-extra-row"><span class="rv-extra-label">Air Waybill</span><span class="rv-extra-value">${esc(r.air_bill_no)}</span></div>` : ''}
      </div>
    </div>`;

  document.getElementById('btn-back-history').addEventListener('click', () => renderPublicHistory());

  document.querySelectorAll('.rv-doc-thumb-clickable').forEach(thumbEl => {
    thumbEl.addEventListener('click', () => {
      const { url, label } = thumbEl.dataset;
      openModal({
        title: label,
        body: `<img src="${url}" alt="${label}" style="display:block;max-width:100%;max-height:75vh;margin:0 auto;border-radius:var(--radius)" />`,
        size: 'lg',
      });
    });
  });
}
