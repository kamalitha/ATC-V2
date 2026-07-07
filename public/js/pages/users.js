// pages/users.js
import api from '../api.js';
import { DataTable, statusBadge, formatDate } from '../components/table.js';
import { openModal, closeModal, toast } from '../app.js';

let rolesCache = null;
async function getRoles() {
  if (!rolesCache) rolesCache = await api.users.roles();
  return rolesCache;
}

export async function renderUsers() {
  const content = document.getElementById('page-content');
  const roles   = await getRoles();

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">User Management</h1>
        <p class="page-subtitle">Portal accounts and role assignments</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-user">
          <i class="fa-solid fa-user-plus"></i> New User
        </button>
      </div>
    </div>
    <div id="users-table"></div>`;

  const table = new DataTable(
    document.getElementById('users-table'),
    [
      { key: 'user_id',   label: 'ID',      width: '60px' },
      { key: 'name',      label: 'Name',    render: (_, r) => `<strong>${r.first_name} ${r.last_name ?? ''}</strong>` },
      { key: 'email',     label: 'Email' },
      { key: 'user_type', label: 'Role',    render: v => {
        const role = roles.find(r => r.id == v);
        return `<span class="badge badge-accent">${role?.name ?? `Role ${v}`}</span>`;
      }},
      { key: 'date_created',   label: 'Created',    render: v => formatDate(v) },
      { key: 'last_logged_in', label: 'Last Login', render: v => formatDate(v) },
      { key: 'is_active', label: 'Status',  render: v => statusBadge(v) },
      { key: 'actions',   label: '',        width: '130px',
        render: (_, r) => `
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-icon btn-sm edit-btn"   data-id="${r.user_id}" title="Edit">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm pwd-btn"    data-id="${r.user_id}" title="Change Password">
              <i class="fa-solid fa-key"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm toggle-btn" data-id="${r.user_id}" data-active="${r.is_active}"
              title="${r.is_active ? 'Deactivate' : 'Activate'}">
              <i class="fa-solid ${r.is_active ? 'fa-lock' : 'fa-lock-open'}"></i>
            </button>
          </div>` },
    ],
    params => api.users.list(params),
    {
      searchPlaceholder: 'Search by name or email…',
      filters: [
        { key: 'role', label: 'All Roles', options: roles.map(r => ({ value: r.id, label: r.name })) },
      ],
    },
  );

  table.render();

  document.getElementById('btn-new-user').addEventListener('click', () => showUserModal(null, roles, table));

  document.getElementById('users-table').addEventListener('click', e => {
    const edit   = e.target.closest('.edit-btn');
    const pwd    = e.target.closest('.pwd-btn');
    const toggle = e.target.closest('.toggle-btn');

    if (edit)   showUserModal(edit.dataset.id, roles, table);
    if (pwd)    showPasswordModal(pwd.dataset.id);
    if (toggle) {
      const active = toggle.dataset.active === '1';
      showConfirmInline(
        `${active ? 'Deactivate' : 'Activate'} this user?`,
        async () => {
          await api.users.toggleStatus(toggle.dataset.id);
          toast(`User ${active ? 'deactivated' : 'activated'}`, 'info');
          table.reload();
        },
      );
    }
  });
}

async function showUserModal(userId, roles, table) {
  let user = null;
  if (userId) user = await api.users.get(userId);
  const isEdit = !!user;

  openModal({
    title: isEdit ? `Edit User #${userId}` : 'New User',
    size:  'lg',
    body: `
      <div class="form-grid">
        <div class="field"><label>First Name *</label>
          <input id="u-first" value="${user?.first_name ?? ''}" placeholder="First name" /></div>
        <div class="field"><label>Last Name</label>
          <input id="u-last" value="${user?.last_name ?? ''}" placeholder="Last name" /></div>
        <div class="field"><label>Email *</label>
          <input id="u-email" type="email" value="${user?.email ?? ''}" placeholder="email@domain.com" /></div>
        <div class="field"><label>Username *</label>
          <input id="u-username" value="${user?.username ?? ''}" placeholder="username" ${isEdit ? 'disabled' : ''} /></div>
        <div class="field"><label>Mobile</label>
          <input id="u-mobile" value="${user?.mobile_no ?? ''}" placeholder="+971 50 xxx xxxx" /></div>
        <div class="field"><label>Address</label>
          <input id="u-address" value="${user?.address ?? ''}" placeholder="Address" /></div>
        <div class="field"><label>Role *</label>
          <select id="u-type">
            ${roles.map(r => `<option value="${r.id}" ${user?.user_type == r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
          </select></div>
        ${!isEdit ? `<div class="field"><label>Password *</label>
          <input id="u-password" type="password" placeholder="Min 8 characters" /></div>` : ''}
      </div>
      <div id="modal-error" class="form-error hidden"></div>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModalGlobal()">
        <i class="fa-solid fa-xmark"></i> Cancel
      </button>
      <button class="btn btn-primary" id="save-user-btn">
        <i class="fa-solid fa-floppy-disk"></i> ${isEdit ? 'Save Changes' : 'Create User'}
      </button>`,
  });

  document.getElementById('save-user-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('modal-error');
    errEl.classList.add('hidden');

    const body = {
      first_name: document.getElementById('u-first').value.trim(),
      last_name:  document.getElementById('u-last').value.trim(),
      email:      document.getElementById('u-email').value.trim(),
      mobile_no:  document.getElementById('u-mobile').value.trim(),
      address:    document.getElementById('u-address').value.trim(),
      user_type:  document.getElementById('u-type').value,
    };
    if (!isEdit) {
      body.username = document.getElementById('u-username').value.trim();
      body.password = document.getElementById('u-password').value;
    }

    try {
      if (isEdit) { await api.users.update(userId, body); toast('User updated', 'success'); }
      else        { await api.users.create(body);         toast('User created', 'success'); }
      closeModal();
      table.reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

function showPasswordModal(userId) {
  openModal({
    title: 'Change Password',
    body: `
      <div class="field"><label>New Password *</label>
        <input id="new-pwd" type="password" placeholder="Min 8 characters" /></div>
      <div class="field"><label>Confirm Password *</label>
        <input id="confirm-pwd" type="password" placeholder="Repeat password" /></div>
      <div id="pwd-error" class="form-error hidden"></div>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModalGlobal()">
        <i class="fa-solid fa-xmark"></i> Cancel
      </button>
      <button class="btn btn-primary" id="save-pwd-btn">
        <i class="fa-solid fa-key"></i> Change Password
      </button>`,
  });

  document.getElementById('save-pwd-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('pwd-error');
    const pwd1  = document.getElementById('new-pwd').value;
    const pwd2  = document.getElementById('confirm-pwd').value;
    errEl.classList.add('hidden');

    if (pwd1.length < 8) { errEl.textContent = 'Minimum 8 characters'; errEl.classList.remove('hidden'); return; }
    if (pwd1 !== pwd2)   { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return; }

    try {
      await api.users.changePassword(userId, { password: pwd1 });
      toast('Password changed', 'success');
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

function showConfirmInline(message, onConfirm) {
  openModal({
    title:  'Confirm',
    body:   `<p style="color:var(--text-secondary)">${message}</p>`,
    footer: `<button class="btn btn-ghost" onclick="closeModalGlobal()">
               <i class="fa-solid fa-xmark"></i> Cancel
             </button>
             <button class="btn btn-primary" id="inline-confirm">
               <i class="fa-solid fa-check"></i> Confirm
             </button>`,
  });
  document.getElementById('inline-confirm').onclick = () => { closeModal(); onConfirm(); };
}
