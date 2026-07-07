import api                                  from '../api.js';
import { navigate, toast, currentUser }     from '../app.js';
import { DataTable, statusBadge, formatDateTime } from '../components/table.js';

function esc(str) { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const PRIORITY_BADGE = {
  LOW:    '<span class="badge badge-default">Low</span>',
  MEDIUM: '<span class="badge badge-info">Medium</span>',
  HIGH:   '<span class="badge badge-warning">High</span>',
  URGENT: '<span class="badge badge-danger">Urgent</span>',
};

const STATUS_BADGE = {
  OPEN:        '<span class="badge badge-warning">Open</span>',
  IN_PROGRESS: '<span class="badge badge-info">In Progress</span>',
  RESOLVED:    '<span class="badge badge-success">Resolved</span>',
  CLOSED:      '<span class="badge badge-default">Closed</span>',
};

const CATEGORY_BADGE = {
  IDL: '<span class="badge badge-default">IDL</span>',
  CPD: '<span class="badge badge-info">CPD</span>',
};

const TICKET_TYPE_LABELS = {
  GENERAL_INQUIRY:     'General Inquiry',
  APPLICATION_INQUIRY: 'Application Inquiry',
  COMPLAINT:           'Complaint',
};

// ── List (DataTable) ──────────────────────────────────────────────────────────
export function renderSupportTickets() {
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">Support Tickets</h1>
        <p class="page-subtitle">Manage IDL and CPD support requests</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-ticket">
          <i class="fa-solid fa-plus"></i> New Ticket
        </button>
      </div>
    </div>
    <div id="support-table"></div>`;

  document.getElementById('btn-new-ticket').addEventListener('click', () => showNewTicketModal());

  const tableEl = document.getElementById('support-table');

  new DataTable(
    tableEl,
    [
      { key: 'ticket_no',   label: 'Ticket No',  width: '160px',
        render: v => `<strong>${esc(v ?? '—')}</strong>` },
      { key: 'category',    label: 'Category',   width: '90px',
        render: v => CATEGORY_BADGE[v] ?? v },
      { key: 'ticket_type', label: 'Type',
        render: v => TICKET_TYPE_LABELS[v] ?? v ?? '—' },
      { key: 'subject',     label: 'Subject',
        render: v => `<span style="max-width:260px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v)}</span>` },
      { key: 'priority',    label: 'Priority',   width: '90px',
        render: v => PRIORITY_BADGE[v] ?? v },
      { key: 'status',      label: 'Status',     width: '110px',
        render: v => STATUS_BADGE[v] ?? statusBadge(v) },
      { key: 'first_name',  label: 'Created By',
        render: (_, r) => esc(`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—') },
      { key: 'created_at',  label: 'Date',       width: '140px',
        render: v => formatDateTime(v) },
      { key: 'actions',     label: '',           width: '80px',
        render: (_, r) => `<button class="btn btn-ghost btn-sm view-ticket-btn" data-id="${r.ticket_id}">
          <i class="fa-solid fa-eye"></i> View</button>` },
    ],
    params => api.support.list(params),
    {
      idKey:             'ticket_id',
      searchPlaceholder: 'Search by ticket no, subject…',
      filters: [
        { key: 'category', label: 'All Categories', options: [
          { value: 'IDL', label: 'IDL' },
          { value: 'CPD', label: 'CPD' },
          { value: 'all', label: 'All Categories' },
        ]},
        { key: 'status', label: 'All Statuses', options: [
          { value: 'OPEN',        label: 'Open' },
          { value: 'IN_PROGRESS', label: 'In Progress' },
          { value: 'RESOLVED',    label: 'Resolved' },
          { value: 'CLOSED',      label: 'Closed' },
          { value: 'all',         label: 'All Statuses' },
        ]},
      ],
      onRowClick: (id, row) => renderTicketDetail(row.ticket_id),
    },
  ).render();

  // View button clicks (DataTable suppresses onRowClick for buttons)
  tableEl.addEventListener('click', e => {
    const btn = e.target.closest('.view-ticket-btn');
    if (btn) renderTicketDetail(Number(btn.dataset.id));
  });
}

// ── New Ticket Modal ──────────────────────────────────────────────────────────
function showNewTicketModal() {
  const overlay = document.getElementById('modal-overlay');
  const title   = document.getElementById('modal-title');
  const body    = document.getElementById('modal-body');

  title.textContent = 'New Support Ticket';
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="field">
        <label>Type *</label>
        <select id="tk-type">
          <option value="GENERAL_INQUIRY">General Inquiry</option>
          <option value="APPLICATION_INQUIRY">Application Inquiry</option>
          <option value="COMPLAINT">Complaint</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field">
          <label>Customer Phone *</label>
          <input id="tk-phone" type="tel" placeholder="+971 50 xxx xxxx" />
          <div class="field-error" id="err-tk-phone"></div>
        </div>
        <div class="field">
          <label>Customer Email *</label>
          <input id="tk-email" type="email" placeholder="customer@email.com" />
          <div class="field-error" id="err-tk-email"></div>
        </div>
      </div>
      <div class="field">
        <label>Subject *</label>
        <input id="tk-subject" placeholder="Brief description of the issue" />
        <div class="field-error" id="err-tk-subject"></div>
      </div>
      <div class="field">
        <label>Priority</label>
        <select id="tk-priority">
          <option value="LOW">Low</option>
          <option value="MEDIUM" selected>Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <div class="field">
        <label>Related Request (optional)</label>
        <input id="tk-related" placeholder="e.g. IDL-ATC-20250101/123" />
      </div>
      <div class="field">
        <label>Description *</label>
        <textarea id="tk-description" rows="4" style="width:100%;resize:vertical"
          placeholder="Describe the issue in detail…"></textarea>
        <div class="field-error" id="err-tk-description"></div>
      </div>
      <div id="tk-error" class="form-error hidden"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-ghost" id="btn-tk-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-tk-submit">
          <i class="fa-solid fa-paper-plane"></i> Submit Ticket
        </button>
      </div>
    </div>`;

  overlay.classList.remove('hidden');

  document.getElementById('btn-tk-cancel').addEventListener('click',
    () => overlay.classList.add('hidden'));

  document.getElementById('btn-tk-submit').addEventListener('click', async () => {
    const subject = document.getElementById('tk-subject').value.trim();
    const desc    = document.getElementById('tk-description').value.trim();
    const phone   = document.getElementById('tk-phone').value.trim();
    const email   = document.getElementById('tk-email').value.trim();
    const errEl   = document.getElementById('tk-error');
    let ok = true;

    ['tk-subject','tk-description','tk-phone','tk-email'].forEach(id => {
      document.getElementById(`err-${id}`)?.textContent && (document.getElementById(`err-${id}`).textContent = '');
    });

    if (!phone)   { document.getElementById('err-tk-phone').textContent = 'Customer phone is required'; ok = false; }
    if (!email)   { document.getElementById('err-tk-email').textContent = 'Customer email is required'; ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('err-tk-email').textContent = 'Enter a valid email address'; ok = false;
    }
    if (!subject) { document.getElementById('err-tk-subject').textContent = 'Subject is required'; ok = false; }
    if (!desc)    { document.getElementById('err-tk-description').textContent = 'Description is required'; ok = false; }
    if (!ok) return;

    const btn = document.getElementById('btn-tk-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    errEl.classList.add('hidden');

    try {
      const res = await api.support.create({
        ticket_type:     document.getElementById('tk-type').value,
        subject,
        description:     desc,
        priority:        document.getElementById('tk-priority').value,
        customer_phone:  phone,
        customer_email:  email,
        related_request: document.getElementById('tk-related').value.trim() || null,
      });
      overlay.classList.add('hidden');
      toast(`Ticket ${res.ticket_no} created`, 'success');
      renderTicketDetail(res.ticket_id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Ticket';
    }
  });
}

// ── Ticket Detail ─────────────────────────────────────────────────────────────
async function renderTicketDetail(ticketId) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let t;
  try {
    t = await api.support.get(ticketId);
  } catch (err) {
    content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${err.message}</p></div>`;
    return;
  }

  // Cache of comment_id → base64 data URL (avoids broken relative paths)
  const commentAttachments = {};

  function render() {
    content.innerHTML = `
      <div class="page-header">
        <div class="page-title-block">
          <h1 class="page-title">${esc(t.ticket_no ?? 'Ticket')}</h1>
          <p class="page-subtitle">${esc(t.subject)}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" id="btn-back-tickets">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">Ticket Details</div>
        <div class="section-card-body">
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">Ticket No</span>
              <span class="detail-value">${esc(t.ticket_no ?? '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Category</span>
              <span class="detail-value">${CATEGORY_BADGE[t.category] ?? esc(t.category ?? '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Type</span>
              <span class="detail-value">${TICKET_TYPE_LABELS[t.ticket_type] ?? esc(t.ticket_type ?? '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Priority</span>
              <span class="detail-value">${PRIORITY_BADGE[t.priority] ?? t.priority}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Status</span>
              <span class="detail-value">${STATUS_BADGE[t.status] ?? t.status}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Related Request</span>
              <span class="detail-value">${t.related_request ? `<code>${esc(t.related_request)}</code>` : '—'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Channel</span>
              <span class="detail-value">
                ${t.channel === 'WhatsApp'
                  ? '<span class="badge badge-success"><i class="fa-brands fa-whatsapp"></i> WhatsApp</span>'
                  : '<span class="badge badge-info">Portal</span>'}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Created By</span>
              <span class="detail-value">${esc(`${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Customer Phone</span>
              <span class="detail-value">${esc(t.customer_phone ?? '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Customer Email</span>
              <span class="detail-value">${esc(t.customer_email ?? '—')}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Created At</span>
              <span class="detail-value">${formatDateTime(t.created_at)}</span>
            </div>
          </div>
          <div style="margin-top:16px">
            <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
              color:var(--text-muted);margin-bottom:6px">Description</div>
            <div style="white-space:pre-wrap;line-height:1.6;color:var(--text-primary)">${esc(t.description)}</div>
          </div>
        </div>
      </div>

      ${['OPEN','IN_PROGRESS','RESOLVED'].includes(t.status) ? `
      <div class="section-card">
        <div class="section-card-header">Update Status</div>
        <div class="section-card-body">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${t.status === 'OPEN'     ? `<button class="btn btn-info btn-sm"    data-set-status="IN_PROGRESS"><i class="fa-solid fa-play"></i> Mark In Progress</button>` : ''}
            ${t.status !== 'RESOLVED' ? `<button class="btn btn-success btn-sm" data-set-status="RESOLVED"><i class="fa-solid fa-check"></i> Mark Resolved</button>` : ''}
            ${t.status !== 'CLOSED'   ? `<button class="btn btn-ghost btn-sm"   data-set-status="CLOSED"><i class="fa-solid fa-lock"></i> Close Ticket</button>` : ''}
          </div>
        </div>
      </div>` : ''}

      <div class="section-card">
        <div class="section-card-header">Comments (${(t.comments ?? []).length})</div>
        <div class="section-card-body">
          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
            ${(t.comments ?? []).length === 0
              ? `<p style="color:var(--text-muted);font-size:.9rem">No comments yet.</p>`
              : (t.comments ?? []).map(c => {
                const isPdf     = c.attachment_path?.endsWith('.pdf');
                const isImg     = c.attachment_path && !isPdf;
                const cached    = commentAttachments[c.comment_id];

                let attachHtml  = '';
                if (c.attachment_path) {
                  if (isPdf) {
                    // PDFs: download via serve endpoint
                    attachHtml = `
                      <div style="margin-top:10px">
                        <a href="/atc_v2/public/api/support/tickets/${ticketId}/comments/${c.comment_id}/attachment"
                           target="_blank" rel="noopener"
                           style="display:inline-flex;align-items:center;gap:6px;font-size:.85rem;color:var(--accent)">
                          <i class="fa-solid fa-file-pdf" style="color:#e74c3c"></i> View Attachment
                        </a>
                      </div>`;
                  } else if (cached) {
                    // Image already in cache — use base64 directly, open via delegated listener
                    attachHtml = `
                      <div style="margin-top:10px">
                        <img src="${cached}" alt="Attachment"
                          data-comment-id="${c.comment_id}"
                          class="comment-attachment-img"
                          style="max-width:240px;max-height:160px;border-radius:4px;border:1px solid var(--border);display:block;cursor:pointer" />
                      </div>`;
                  } else {
                    // Image not yet cached — show placeholder, load async after render
                    attachHtml = `
                      <div style="margin-top:10px">
                        <img id="cmt-img-${c.comment_id}" alt="Attachment"
                          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                          style="max-width:240px;max-height:160px;border-radius:4px;border:1px solid var(--border);display:block;opacity:.4" />
                      </div>`;
                  }
                }

                return `
              <div style="padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius)">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                  <strong style="font-size:.88rem">${esc(`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim())}</strong>
                  <span style="font-size:.78rem;color:var(--text-muted)">${formatDateTime(c.created_at)}</span>
                </div>
                <div style="white-space:pre-wrap;line-height:1.5;font-size:.9rem">${esc(c.comment)}</div>
                ${attachHtml}
              </div>`;
              }).join('')}
          </div>
          <div class="field">
            <label>Add Comment</label>
            <textarea id="new-comment" rows="3" style="width:100%;resize:vertical"
              placeholder="Write a comment…"></textarea>
          </div>
          <div class="field" style="margin-top:8px">
            <label style="font-size:.82rem;color:var(--text-muted)">
              <i class="fa-solid fa-paperclip" style="margin-right:4px"></i>Attach file (optional — JPG, PNG or PDF, max 2 MB)
            </label>
            <input type="file" id="comment-attachment" accept=".jpg,.jpeg,.png,.pdf"
              style="margin-top:4px;font-size:.85rem" />
            <div class="field-error" id="err-attachment"></div>
          </div>
          <div id="comment-error" class="form-error hidden" style="margin-top:4px"></div>
          <div style="display:flex;justify-content:flex-end;margin-top:10px">
            <button class="btn btn-primary btn-sm" id="btn-add-comment">
              <i class="fa-solid fa-comment"></i> Add Comment
            </button>
          </div>
        </div>
      </div>`;

    document.getElementById('btn-back-tickets')?.addEventListener('click',
      () => renderSupportTickets());

    // Lazy-load base64 for any image attachments not yet in cache
    (t.comments ?? []).forEach(async c => {
      if (!c.attachment_path || c.attachment_path.endsWith('.pdf')) return;
      if (commentAttachments[c.comment_id]) return; // already cached
      try {
        const res = await api.support.getAttachment(ticketId, c.comment_id);
        commentAttachments[c.comment_id] = res.base64;
        const imgEl = document.getElementById(`cmt-img-${c.comment_id}`);
        if (imgEl) {
          imgEl.src          = res.base64;
          imgEl.style.opacity = '1';
          imgEl.dataset.commentId = c.comment_id;
          imgEl.classList.add('comment-attachment-img');
        }
      } catch { /* silent */ }
    });

    // Open cached images in new tab on click (avoids inline base64 in onclick attr)
    content.addEventListener('click', e => {
      const img = e.target.closest('.comment-attachment-img');
      if (!img) return;
      const cid   = img.dataset.commentId;
      const b64   = commentAttachments[cid] ?? img.src;
      if (b64) window.open(b64, '_blank');
    });

    content.querySelectorAll('[data-set-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.setStatus;
        btn.disabled = true;
        try {
          await api.support.updateStatus(ticketId, newStatus);
          toast('Status updated', 'success');
          t.status = newStatus;
          render();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    document.getElementById('btn-add-comment')?.addEventListener('click', async () => {
      const comment    = document.getElementById('new-comment').value.trim();
      const fileInput  = document.getElementById('comment-attachment');
      const file       = fileInput?.files?.[0] ?? null;
      const errEl      = document.getElementById('comment-error');
      const attachErr  = document.getElementById('err-attachment');

      errEl.classList.add('hidden');
      if (attachErr) attachErr.textContent = '';

      if (!comment) {
        errEl.textContent = 'Comment cannot be empty';
        errEl.classList.remove('hidden');
        return;
      }

      // Validate file if selected
      if (file) {
        const allowed = ['image/jpeg','image/png','application/pdf'];
        if (!allowed.includes(file.type)) {
          if (attachErr) attachErr.textContent = 'Only JPG, PNG or PDF files are allowed';
          return;
        }
        if (file.size > 2 * 1024 * 1024) {
          if (attachErr) attachErr.textContent = 'File exceeds 2 MB limit';
          return;
        }
      }

      const btn = document.getElementById('btn-add-comment');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

      // Pre-read file as base64 so we can cache it immediately after save
      let base64Preview = null;
      if (file && file.type !== 'application/pdf') {
        base64Preview = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload  = e => resolve(e.target.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      }

      try {
        const res = await api.support.addComment(ticketId, comment, file);
        // Cache the base64 so the re-render shows the image immediately
        if (base64Preview && res.comment_id) {
          commentAttachments[res.comment_id] = base64Preview;
        }
        toast('Comment added', 'success');
        t = await api.support.get(ticketId);
        render();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-comment"></i> Add Comment';
      }
    });
  }

  render();
}

// ── Public User — My Support Tickets ─────────────────────────────────────────
export function renderPublicSupportTickets() {
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">My Support Tickets</h1>
        <p class="page-subtitle">View and track your support requests</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-pub-new-ticket">
          <i class="fa-solid fa-plus"></i> New Ticket
        </button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-body" style="padding:0">
        <table id="pub-tickets-table" class="data-table" style="width:100%">
          <thead><tr>
            <th>Ticket No</th>
            <th>Category</th>
            <th>Type</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Date</th>
            <th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  // Load jQuery DataTable
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content ?? '';
  const BASE  = '/atc_v2/public/api';

  // Fetch all pages and populate DataTable (simple approach — no server-side DT)
  async function loadTable() {
    let allRows = [];
    let page    = 1;
    let lastPage = 1;
    do {
      const res = await api.support.myTickets({ page });
      allRows    = allRows.concat(res.data ?? []);
      lastPage   = res.last_page ?? 1;
      page++;
    } while (page <= lastPage);
    populateTable(allRows);
  }

  function populateTable(rows) {
    if (window.$ && $.fn.DataTable) {
      if ($.fn.DataTable.isDataTable('#pub-tickets-table')) {
        $('#pub-tickets-table').DataTable().destroy();
      }
      $('#pub-tickets-table').DataTable({
        data: rows,
        order: [[5, 'desc']],
        pageLength: 10,
        dom: '<"dt-top"lf>rt<"dt-bottom"ip>',
        columns: [
          { data: 'ticket_no',
            render: v => `<strong>${esc(v ?? '—')}</strong>` },
          { data: 'category',
            render: v => CATEGORY_BADGE[v] ?? esc(v ?? '') },
          { data: 'ticket_type',
            render: v => TICKET_TYPE_LABELS[v] ?? esc(v ?? '') },
          { data: 'subject',
            render: v => `<span style="max-width:220px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v)}</span>` },
          { data: 'status',
            render: v => STATUS_BADGE[v] ?? esc(v ?? '') },
          { data: 'created_at',
            render: v => formatDateTime(v) },
          { data: null,
            orderable: false,
            render: (_, __, r) => `<button class="btn btn-ghost btn-sm pub-view-btn" data-id="${r.ticket_id}"><i class="fa-solid fa-eye"></i> View</button>` },
        ],
        language: {
          emptyTable: 'You have no support tickets yet.',
          zeroRecords: 'No tickets match your search.',
        },
        responsive: true,
      });

      // View click
      $('#pub-tickets-table tbody').on('click', '.pub-view-btn', function () {
        renderPublicTicketDetail(Number($(this).data('id')));
      });
    } else {
      // Fallback if jQuery DataTable not loaded
      const tbody = document.querySelector('#pub-tickets-table tbody');
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">You have no support tickets yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td><strong>${esc(r.ticket_no ?? '—')}</strong></td>
          <td>${CATEGORY_BADGE[r.category] ?? esc(r.category ?? '')}</td>
          <td>${TICKET_TYPE_LABELS[r.ticket_type] ?? esc(r.ticket_type ?? '')}</td>
          <td>${esc(r.subject)}</td>
          <td>${STATUS_BADGE[r.status] ?? esc(r.status ?? '')}</td>
          <td>${formatDateTime(r.created_at)}</td>
          <td><button class="btn btn-ghost btn-sm pub-view-btn" data-id="${r.ticket_id}"><i class="fa-solid fa-eye"></i> View</button></td>
        </tr>`).join('');
      content.querySelectorAll('.pub-view-btn').forEach(btn =>
        btn.addEventListener('click', () => renderPublicTicketDetail(Number(btn.dataset.id))));
    }
  }

  document.getElementById('btn-pub-new-ticket').addEventListener('click', () =>
    showPublicNewTicketModal(() => loadTable()));

  loadTable().catch(err => console.error('[public-support]', err));
}

// ── Public New Ticket Modal ───────────────────────────────────────────────────
function showPublicNewTicketModal(onSuccess) {
  const overlay = document.getElementById('modal-overlay');
  const title   = document.getElementById('modal-title');
  const body    = document.getElementById('modal-body');

  title.textContent = 'New Support Ticket';
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field">
          <label>Category *</label>
          <select id="pub-tk-category">
            <option value="IDL">IDL</option>
            <option value="CPD">CPD</option>
          </select>
        </div>
        <div class="field">
          <label>Type *</label>
          <select id="pub-tk-type">
            <option value="GENERAL_INQUIRY">General Inquiry</option>
            <option value="APPLICATION_INQUIRY">Application Inquiry</option>
            <option value="COMPLAINT">Complaint</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field">
          <label>Your Phone *</label>
          <input id="pub-tk-phone" type="tel" placeholder="+971 50 xxx xxxx" />
          <div class="field-error" id="err-pub-tk-phone"></div>
        </div>
        <div class="field">
          <label>Your Email *</label>
          <input id="pub-tk-email" type="email" placeholder="your@email.com" />
          <div class="field-error" id="err-pub-tk-email"></div>
        </div>
      </div>
      <div class="field">
        <label>Subject *</label>
        <input id="pub-tk-subject" placeholder="Brief description of the issue" />
        <div class="field-error" id="err-pub-tk-subject"></div>
      </div>
      <div class="field">
        <label>Description *</label>
        <textarea id="pub-tk-description" rows="4" style="width:100%;resize:vertical"
          placeholder="Describe your issue in detail…"></textarea>
        <div class="field-error" id="err-pub-tk-description"></div>
      </div>
      <div id="pub-tk-error" class="form-error hidden"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-ghost" id="btn-pub-tk-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-pub-tk-submit">
          <i class="fa-solid fa-paper-plane"></i> Submit Ticket
        </button>
      </div>
    </div>`;

  overlay.classList.remove('hidden');

  document.getElementById('btn-pub-tk-cancel').addEventListener('click',
    () => overlay.classList.add('hidden'));

  document.getElementById('btn-pub-tk-submit').addEventListener('click', async () => {
    const subject = document.getElementById('pub-tk-subject').value.trim();
    const desc    = document.getElementById('pub-tk-description').value.trim();
    const phone   = document.getElementById('pub-tk-phone').value.trim();
    const email   = document.getElementById('pub-tk-email').value.trim();
    const errEl   = document.getElementById('pub-tk-error');
    let ok = true;

    ['pub-tk-subject','pub-tk-description','pub-tk-phone','pub-tk-email'].forEach(id => {
      const el = document.getElementById(`err-${id}`);
      if (el) el.textContent = '';
    });

    if (!phone)   { document.getElementById('err-pub-tk-phone').textContent = 'Phone is required'; ok = false; }
    if (!email)   { document.getElementById('err-pub-tk-email').textContent = 'Email is required'; ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('err-pub-tk-email').textContent = 'Enter a valid email'; ok = false;
    }
    if (!subject) { document.getElementById('err-pub-tk-subject').textContent = 'Subject is required'; ok = false; }
    if (!desc)    { document.getElementById('err-pub-tk-description').textContent = 'Description is required'; ok = false; }
    if (!ok) return;

    const btn = document.getElementById('btn-pub-tk-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    errEl.classList.add('hidden');

    try {
      const res = await api.support.create({
        category:       document.getElementById('pub-tk-category').value,
        ticket_type:    document.getElementById('pub-tk-type').value,
        subject,
        description:    desc,
        priority:       'MEDIUM',
        customer_phone: phone,
        customer_email: email,
      });
      overlay.classList.add('hidden');
      toast(`Ticket ${res.ticket_no} created successfully`, 'success');
      onSuccess();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Ticket';
    }
  });
}

// ── Public Ticket Detail (read-only) ─────────────────────────────────────────
async function renderPublicTicketDetail(ticketId) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  let t;
  try {
    t = await api.support.get(ticketId);
  } catch (err) {
    content.innerHTML = `<div class="page-loading"><p style="color:var(--danger)">${err.message}</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${esc(t.ticket_no ?? 'Ticket')}</h1>
        <p class="page-subtitle">${esc(t.subject)}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="btn-back-pub-tickets">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">Ticket Details</div>
      <div class="section-card-body">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Ticket No</span>
            <span class="detail-value">${esc(t.ticket_no ?? '—')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Category</span>
            <span class="detail-value">${CATEGORY_BADGE[t.category] ?? esc(t.category ?? '—')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Type</span>
            <span class="detail-value">${TICKET_TYPE_LABELS[t.ticket_type] ?? esc(t.ticket_type ?? '—')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="detail-value">${STATUS_BADGE[t.status] ?? esc(t.status ?? '—')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created At</span>
            <span class="detail-value">${formatDateTime(t.created_at)}</span>
          </div>
        </div>
        <div style="margin-top:16px">
          <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px">Description</div>
          <div style="white-space:pre-wrap;line-height:1.6;color:var(--text-primary)">${esc(t.description)}</div>
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">Comments (${(t.comments ?? []).length})</div>
      <div class="section-card-body">
        <div style="display:flex;flex-direction:column;gap:12px">
          ${(t.comments ?? []).length === 0
            ? `<p style="color:var(--text-muted);font-size:.9rem">No comments yet.</p>`
            : (t.comments ?? []).map(c => `
            <div style="padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius)">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <strong style="font-size:.88rem">${esc(`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim())}</strong>
                <span style="font-size:.78rem;color:var(--text-muted)">${formatDateTime(c.created_at)}</span>
              </div>
              <div style="white-space:pre-wrap;line-height:1.5;font-size:.9rem">${esc(c.comment)}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  document.getElementById('btn-back-pub-tickets').addEventListener('click',
    () => renderPublicSupportTickets());
}
