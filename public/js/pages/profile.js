// pages/profile.js
import api, { setToken } from '../api.js';
import { toast } from '../app.js';
import { formatDate, formatDateTime } from '../components/table.js';

export async function renderProfile() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  const user = await api.auth.me();
  setToken(user.csrf_token);

  const initials = `${user.first_name?.[0]??''}${user.last_name?.[0]??''}`.toUpperCase();
  const activebadge = user.is_active
    ? '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active</span>'
    : '<span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Inactive</span>';

  content.innerHTML = `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">My Profile</h1>
        <p class="page-subtitle">Manage your account settings</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px">

      <!-- Account overview -->
      <div class="section-card" style="grid-column:1/-1">
        <div class="section-card-header">Account Information</div>
        <div class="section-card-body">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px">
            <div style="width:72px;height:72px;border-radius:50%;background:var(--accent-dim);color:var(--accent);
                        display:flex;align-items:center;justify-content:center;font-size:1.75rem;font-weight:700;flex-shrink:0">
              ${initials}
            </div>
            <div>
              <div style="font-size:1.25rem;font-weight:700">${user.first_name} ${user.last_name??''}</div>
              <div style="color:var(--text-muted);margin-top:2px">${user.email}</div>
              <div style="margin-top:6px">
                <span class="badge badge-accent">${(user.role_name??'').replace(/_/g,' ')}</span>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div class="detail-item"><label>User ID</label><div class="detail-val">#${user.user_id}</div></div>
            <div class="detail-item"><label>Username</label><div class="detail-val">${user.username??'—'}</div></div>
            <div class="detail-item"><label>Registered</label><div class="detail-val">${formatDate(user.date_created)}</div></div>
            <div class="detail-item"><label>Last Login</label><div class="detail-val">${formatDateTime(user.last_logged_in)}</div></div>
            <div class="detail-item"><label>Status</label><div class="detail-val">${activebadge}</div></div>
            <div class="detail-item"><label>Access</label><div class="detail-val" style="display:flex;gap:4px;flex-wrap:wrap">
              ${(user.modules??[]).map(m=>`<span class="badge badge-default">${m.toUpperCase()}</span>`).join('')||'—'}
            </div></div>
          </div>
        </div>
      </div>

      <!-- Edit profile -->
      <div class="section-card">
        <div class="section-card-header">Edit Profile</div>
        <div class="section-card-body">
          <form id="profile-form" novalidate>
            <div class="field"><label>First Name *</label>
              <input id="p-first" value="${esc(user.first_name??'')}" required /></div>
            <div class="field"><label>Last Name</label>
              <input id="p-last" value="${esc(user.last_name??'')}" /></div>
            <div class="field"><label>Email *</label>
              <input id="p-email" type="email" value="${esc(user.email??'')}" required /></div>
            <div class="field"><label>Mobile</label>
              <input id="p-mobile" value="${esc(user.mobile_no??'')}" placeholder="+971 50 xxx xxxx" /></div>
            <div class="field"><label>Address</label>
              <input id="p-address" value="${esc(user.address??'')}" placeholder="Street, area, emirate" /></div>
            <div id="profile-error" class="form-error hidden"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">
              <i class="fa-solid fa-floppy-disk"></i> Save Changes
            </button>
          </form>
        </div>
      </div>

      <!-- Change password -->
      <div class="section-card">
        <div class="section-card-header">Change Password</div>
        <div class="section-card-body">
          <form id="pwd-form" novalidate>
            <div class="field"><label>New Password *</label>
              <input id="p-new" type="password" required placeholder="Enter new password" /></div>
            <div class="field"><label>Confirm New Password *</label>
              <input id="p-confirm" type="password" required placeholder="Repeat new password" /></div>
            <div id="pwd-error" class="form-error hidden"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">
              <i class="fa-solid fa-key"></i> Change Password
            </button>
          </form>
        </div>
      </div>

    </div>`;

  // Profile form
  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('profile-error');
    errEl.classList.add('hidden');
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    try {
      await api.put('/auth/profile', {
        first_name: document.getElementById('p-first').value.trim(),
        last_name:  document.getElementById('p-last').value.trim(),
        email:      document.getElementById('p-email').value.trim(),
        mobile_no:  document.getElementById('p-mobile').value.trim(),
        address:    document.getElementById('p-address').value.trim(),
      });
      toast('Profile updated', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }
  });

  // Password form
  document.getElementById('pwd-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl   = document.getElementById('pwd-error');
    const newPwd  = document.getElementById('p-new').value;
    const confirm = document.getElementById('p-confirm').value;
    errEl.classList.add('hidden');

    if (newPwd !== confirm) {
      errEl.textContent = 'Passwords do not match';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating…';

    try {
      await api.put('/auth/change-password', {
        new_password: newPwd,
      });
      toast('Password changed successfully', 'success');
      e.target.reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-key"></i> Change Password';
    }
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
