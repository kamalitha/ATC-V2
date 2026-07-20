// api.js — Centralised fetch wrapper
// Derive base paths dynamically — works on any deployment path
const _base = window.location.pathname.replace(/\/[^/]*$/, ''); // e.g. /atc_v2/public
export const PUBLIC_BASE = _base;                                // e.g. /atc_v2/public
export const API_BASE    = _base + '/api';                       // e.g. /atc_v2/public/api

let csrfToken = null;

export function setToken(token) { csrfToken = token; }
export function clearToken()    { csrfToken = null; }

async function request(method, path, { body, params } = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const opts = { method, headers, credentials: 'include' };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  let json;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body (e.g. a server misconfiguration page) is always an error,
    // regardless of HTTP status — silently accepting it hides real failures
    // behind a blank/"undefined" UI instead of surfacing them.
    const err = new Error('Invalid server response');
    err.status = res.status;
    throw err;
  }

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  if (!json.success && res.status >= 400) {
    const err = new Error(json.message || 'Request failed');
    err.status = res.status;
    err.errors = json.errors ?? null;
    throw err;
  }

  return json.data ?? json;
}

async function requestUpload(path, formData) {
  const url = new URL(API_BASE + path, window.location.origin);
  // Add CSRF token as a form field (header can't be set on multipart fetch without stripping Content-Type)
  if (csrfToken) formData.append('_csrf_token', csrfToken);

  const res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });

  let json;
  try {
    json = await res.json();
  } catch {
    const err = new Error('Invalid server response');
    err.status = res.status;
    throw err;
  }

  if (res.status === 401) { clearToken(); window.dispatchEvent(new CustomEvent('auth:expired')); }

  if (!json.success && res.status >= 400) {
    const err = new Error(json.message || 'Upload failed');
    err.status = res.status;
    err.errors = json.errors ?? null;
    throw err;
  }
  return json.data ?? json;
}

const api = {
  get:    (path, params)        => request('GET',    path, { params }),
  post:   (path, body, params)  => request('POST',   path, { body, params }),
  put:    (path, body)          => request('PUT',     path, { body }),
  delete: (path)                => request('DELETE',  path),
  upload: (path, formData)      => requestUpload(path, formData),

  // Auth
  auth: {
    login:  (creds)  => request('POST', '/auth/login',  { body: creds }),
    logout: ()       => request('POST', '/auth/logout'),
    me:     ()       => request('GET',  '/auth/me'),
  },

  // Users
  users: {
    list:           (p) => request('GET',  '/users',               { params: p }),
    get:            (id)=> request('GET',  `/users/${id}`),
    create:         (b) => request('POST', '/users',               { body: b }),
    update:     (id, b) => request('PUT',  `/users/${id}`,         { body: b }),
    toggleStatus: (id)  => request('PUT',  `/users/${id}/status`,  { body: {} }),
    changePassword:(id,b)=>request('PUT',  `/users/${id}/password`,{ body: b }),
    roles:          ()  => request('GET',  '/roles'),
  },

  // IDL
  idl: {
    stats:          ()  => request('GET',  '/idl/stats'),
    list:           (p) => request('GET',  '/idl/requests',              { params: p }),
    get:            (id)=> request('GET',  `/idl/requests/${id}`),
    create:         (b) => request('POST', '/idl/requests',              { body: b }),
    update:     (id, b) => request('PUT',  `/idl/requests/${id}`,        { body: b }),
    approve:        (id, body={})=> request('POST', `/idl/requests/${id}/approve`, body),
    reject:     (id, b) => request('POST', `/idl/requests/${id}/reject`, { body: b }),
    issue:      (id, b) => request('POST', `/idl/requests/${id}/issue`,  { body: b }),
    voidRequest:(id, b) => request('POST', `/idl/requests/${id}/void`,   { body: b }),
    nationalities:  ()    => request('GET',  '/idl/nationalities'),
    dlTypes:        ()    => request('GET',  '/idl/dl-types'),
    emirates:       ()    => request('GET',  '/idl/emirates'),
    config:         ()    => request('GET',  '/idl/config'),
    chartData:      ()    => request('GET',  '/idl/chart-data'),
    myRequests:     (p=1) => request('GET',  `/idl/my-requests?page=${p}`),
    getReceipt:     (id)  => request('GET',  `/idl/requests/${id}/receipt`),
    telrInit:       (id)  => request('POST', `/idl/requests/${id}/telr-init`),
    telrVerify:     ()    => request('POST', '/idl/telr-verify'),
    searchByEid:    (eid) => request('GET',  `/idl/search-by-eid?eid=${encodeURIComponent(eid)}`),
    getDocuments:   (id)=> request('GET',  `/idl/requests/${id}/documents`),
    printUrl:       (id)=> `${window.location.origin}${API_BASE}/idl/requests/${id}/print`,
    cancelOwn:      (id)=> request('POST', `/idl/requests/${id}/cancel-own`),
    salesReport:    (p) => request('GET',  '/idl/sales-report',  { params: p }),
    aramexReport:   (p) => request('GET',  '/idl/aramex-report', { params: p }),
    empostReport:   (p) => request('GET',  '/idl/empost-report', { params: p }),
    moeReport:      (p) => request('GET',  '/idl/moe-report',    { params: p }),
  },

  // CPD
  cpd: {
    stats:          ()  => request('GET',  '/cpd/stats'),
    list:           (p) => request('GET',  '/cpd/requests',                   { params: p }),
    get:            (id)=> request('GET',  `/cpd/requests/${id}`),
    create:         (b) => request('POST', '/cpd/requests',                   { body: b }),
    update:     (id, b) => request('PUT',  `/cpd/requests/${id}`,             { body: b }),
    approve:        (id)=> request('POST', `/cpd/requests/${id}/approve`,     { body: {} }),
    reject:     (id, b) => request('POST', `/cpd/requests/${id}/reject`,      { body: b }),
    issueCarnet:(id, b) => request('POST', `/cpd/requests/${id}/issue-carnet`,{ body: b }),
    cancel:     (id, b) => request('POST', `/cpd/requests/${id}/cancel`,      { body: b }),
    carnets:        (p) => request('GET',  '/cpd/carnets',                    { params: p }),
    countries:      ()  => request('GET',  '/cpd/countries'),
    guaranteeRules: ()  => request('GET',  '/cpd/guarantee-rules'),
    vehicleTypes:   ()  => request('GET',  '/cpd/vehicle-types'),
    locations:      ()  => request('GET',  '/cpd/locations'),
    myRequests:     (p=1) => request('GET', `/cpd/my-requests?page=${p}`),
    publicStore:    (b)      => request('POST', '/cpd/public-store', { body: b }),
    telrInit:       (id)     => request('POST', `/cpd/requests/${id}/telr-init`),
    uploadDocs:     (id, fd) => requestUpload(`/cpd/requests/${id}/documents`, fd),
    searchByEid:    (eid)    => request('GET',  '/cpd/search-by-eid', { params: { eid } }),
    getByRef:       (ref)    => request('GET',  '/cpd/search-by-ref',   { params: { ref } }),
    searchOwnByCarnet: (carnetNo) => request('GET', '/cpd/search-own-by-carnet', { params: { carnet_no: carnetNo } }),
    searchClaims:   (carnetNo) => request('GET',  '/cpd/claims/search',        { params: { carnet_no: carnetNo } }),
    addClaim:             (fd)                   => requestUpload('/cpd/claims', fd),
    getClaims:            (requestId)            => request('GET', `/cpd/requests/${requestId}/claims`),
    claimDocumentUrl:     (claimId, filename)    => `${API_BASE}/cpd/claims/${claimId}/documents/${encodeURIComponent(filename)}`,
    getClaimNotes:        (claimId)              => request('GET', `/cpd/claims/${claimId}/notes`),
    addClaimNote:         (claimId, fd)          => requestUpload(`/cpd/claims/${claimId}/notes`, fd),
    claimNoteDocumentUrl: (claimId, noteId, filename) => `${API_BASE}/cpd/claims/${claimId}/notes/${noteId}/documents/${encodeURIComponent(filename)}`,
    listHolds:   (p)        => request('GET',  '/cpd/holds/list', { params: p }),
    searchHold:  (eid)      => request('GET',  '/cpd/holds', { params: { eid } }),
    placeHold:   (body)     => request('POST', '/cpd/holds', { body }),
    liftHold:    (holdId)   => request('PUT',  `/cpd/holds/${holdId}/lift`, { body: {} }),
    locations:      ()       => request('GET',  '/cpd/locations'),
    carnetTypes:    ()       => request('GET',  '/cpd/carnet-types'),
    stockRequest:   (b)      => request('POST', '/cpd/stock-requests', { body: b }),
    stockRequests:          (p)      => request('GET',  '/cpd/stock-requests', { params: p }),
    getStockRequest:        (id)     => request('GET',  `/cpd/stock-requests/${id}`),
    approveStockRequest:    (id)     => request('POST', `/cpd/stock-requests/${id}/approve`, { body: {} }),
    rejectStockRequest:     (id, b)  => request('POST', `/cpd/stock-requests/${id}/reject`,  { body: b }),
    getDocs:        (id)     => request('GET',  `/cpd/requests/${id}/documents`),
    renew:          (b)      => request('POST', '/cpd/renew-requests',           { body: b }),
    getComments:    (id)     => request('GET', `/cpd/requests/${id}/comments`),
    publicUpdate:   (id, b)  => request('PUT', `/cpd/requests/${id}/public-update`, { body: b }),
    returnCheque:       (id, b) => request('POST', `/cpd/requests/${id}/return-cheque`, { body: b }),
    pay:                (id, b) => request('POST', `/cpd/requests/${id}/pay`,            { body: b }),
    cancelRequest:      (id, b) => request('POST', `/cpd/requests/${id}/cancel-request`, { body: b }),
    returnCarnet:       (id, b) => request('POST', `/cpd/requests/${id}/return-carnet`,   { body: b }),
    officerReturn:      (id, b) => request('POST', `/cpd/requests/${id}/officer-return`,  { body: b }),
    getReturnCarnet:    (id)    => request('GET',  `/cpd/requests/${id}/return-carnet`),
    telrInitReturn:     (id)    => request('POST', `/cpd/return/${id}/telr-init`,         { body: {} }),
    telrVerifyReturn:   ()      => request('POST', '/cpd/return/telr-verify',             { body: {} }),
    telrModuleCheck:    ()      => request('GET',  '/cpd/return/telr-module'),
    getCancelRequest:   (id)    => request('GET',  `/cpd/requests/${id}/cancel-request`),
    cancellations:      (p)     => request('GET',  '/cpd/cancellations',    { params: p }),
    returnRequests:         (p)     => request('GET',  '/cpd/return-requests',          { params: p }),
    approveReturnRequest:   (id)    => request('POST', `/cpd/return-requests/${id}/approve`, { body: {} }),
    printAwb:           (id)    => request('POST', `/cpd/requests/${id}/print-awb`,     { body: {} }),
    getReturnCheque:    (id)    => request('GET',  `/cpd/requests/${id}/return-cheque`),
    updateReturnCheque: (id, b) => request('PUT',  `/cpd/requests/${id}/return-cheque`, { body: b }),
  },

  support: {
    list:         (p)     => request('GET',  '/support/tickets',    { params: p }),
    myTickets:    (p)     => request('GET',  '/support/my-tickets', { params: p }),
    get:          (id)    => request('GET',  `/support/tickets/${id}`),
    create:       (b)     => request('POST', '/support/tickets', { body: b }),
    updateStatus: (id, s) => request('POST', `/support/tickets/${id}/status`, { body: { status: s } }),
    addComment:   (id, comment, file) => {
      const fd = new FormData();
      fd.append('comment', comment);
      if (file) fd.append('attachment', file);
      return requestUpload(`/support/tickets/${id}/comment`, fd);
    },
    getAttachment: (ticketId, commentId) => request('GET', `/support/tickets/${ticketId}/comments/${commentId}/attachment`),
  },
};

export default api;
