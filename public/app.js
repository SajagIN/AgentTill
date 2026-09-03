// AgentTill App Logic
const BASE_URL = window.location.origin;

// ─── UTILS ──────────────
function formatINR(paise) {
  if (paise == null) return "N/A";
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', second:'2-digit', hour12: false });
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
}

function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(16px)';
    setTimeout(() => t.remove(), 250);
  }, duration);
}

function copyCode(btn, txt) {
  navigator.clipboard.writeText(txt);
  const old = btn.innerText;
  btn.innerText = "Copied!";
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerText = old;
    btn.classList.remove('copied');
  }, 2000);
}

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers }
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const b = await res.json(); if (b.error?.message) msg = b.error.message; } catch(e){}
      throw new Error(msg);
    }
    return await res.json();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    throw err;
  }
}

// ─── NAVIGATION ─────────
function navigate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  const nav = document.getElementById(`nav-${pageId}`);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  // Trigger loads based on page
  if (pageId === 'overview') loadOverview();
  if (pageId === 'missions') loadMissions();
  if (pageId === 'approvals') loadApprovals();
  if (pageId === 'catalog') loadCatalog();
  if (pageId === 'audit') loadMissionsForAudit();
}

// ─── WIZARD ─────────────
function wizardNext(stepNum) {
  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.progress-step').forEach(s => {
    s.classList.remove('active');
    if (parseInt(s.id.split('-')[1]) < stepNum) s.classList.add('done');
    else s.classList.remove('done');
  });

  document.getElementById(`wpanel-${stepNum}`).classList.add('active');
  document.getElementById(`wstep-${stepNum}`).classList.add('active');
}

function switchConfigTab(el, id) {
  document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`cfgpanel-${id}`).classList.add('active');
}

// ─── SERVER CHECK ───────
async function checkServer() {
  const dot = document.getElementById('server-dot');
  const txt = document.getElementById('server-status-text');
  txt.innerText = 'Checking...';

  try {
    const res = await api('/health');
    dot.className = 'status-dot online';
    txt.innerText = 'Server Online';
    document.getElementById('server-ok-callout').hidden = false;
    document.getElementById('server-fail-callout').hidden = true;

    // Set actual MCP path in tutorial
    const pathSpan = document.getElementById('mcp-path-display');
    if (pathSpan) {
        // Just make a good guess for the display based on browser URL or tell them it's the current folder
        pathSpan.innerText = `"src/mcp-server.js" (Use absolute path in production)`;
    }
  } catch (err) {
    dot.className = 'status-dot offline';
    txt.innerText = 'Server Offline';
    document.getElementById('server-ok-callout').hidden = true;
    document.getElementById('server-fail-callout').hidden = false;
  }
}

// ─── STATE POLLERS ──────
let pollInterval;
function startPolling() {
  // Silent background polls
  if (pollInterval) clearInterval(pollInterval);

  const tick = async () => {
    // Only poll approvals if not on setup page
    if (document.getElementById('page-setup').classList.contains('active')) return;

    try {
      const res = await fetch(`${BASE_URL}/approvals`);
      if (res.ok) {
        const data = await res.json();
        const pending = data.approvals.filter(a => a.status === 'pending');

        // Update badge
        const badge = document.getElementById('approval-count-badge');
        if (pending.length > 0) {
          badge.innerText = pending.length;
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }

        // Update overview stat silently
        const os = document.getElementById('stat-approvals');
        if (os) os.innerText = pending.length;
      }
    } catch (e) {}
  };

  tick();
  pollInterval = setInterval(tick, 3000);
}

// ─── OVERVIEW ───────────
async function loadOverview() {
  try {
    const [mRes, aRes] = await Promise.all([
      api('/missions'),
      api('/approvals')
    ]);

    const missions = mRes.missions || [];
    const approvals = (aRes.approvals || []).filter(a => a.status === 'pending');

    document.getElementById('stat-total').innerText = missions.length;
    document.getElementById('stat-confirmed').innerText = missions.filter(m => m.state === 'CONFIRMED').length;
    document.getElementById('stat-approvals').innerText = approvals.length;
    document.getElementById('stat-active').innerText = missions.filter(m => !['CONFIRMED', 'FAILED', 'FAILED_FINAL', 'REJECTED', 'CANCELLED'].includes(m.state)).length;

    // Render top 3 missions
    const oMissions = document.getElementById('overview-missions');
    if (missions.length > 0) {
      oMissions.innerHTML = '<div class="mission-list">' +
        missions.slice(0, 4).map(m => `
          <div class="mission-row" onclick="navigate('missions'); setTimeout(()=>loadMissionDetail('${m.missionId}'), 100)">
            <div class="mission-icon">🎯</div>
            <div class="mission-main">
              <div class="mission-intent">${m.intent}</div>
              <div class="mission-meta">${m.missionId} · <span style="font-family:monospace">${formatTime(m.createdAt)}</span></div>
            </div>
            <div class="mission-right">
              <div class="mission-budget">${formatINR(m.budgetPaise)}</div>
              <div class="badge badge-${m.state.toLowerCase()}">${m.state.replace(/_/g,' ')}</div>
            </div>
          </div>
        `).join('') + '</div>';
    }

    // Render approvals
    const oApprovals = document.getElementById('overview-approvals');
    if (approvals.length > 0) {
      oApprovals.innerHTML = '<div class="approval-list">' +
        approvals.map(a => `
          <div class="approval-card">
            <div class="approval-card-body">
              <div style="flex:1">
                <div style="font-size:11px; color:var(--text-faint); margin-bottom:4px; font-family:monospace">${a.missionId}</div>
                <div class="approval-reason">${a.reason}</div>
              </div>
              <div style="text-align:right">
                <div class="approval-amount">${formatINR(a.amountPaise)}</div>
                <button class="btn btn-secondary btn-sm mt-2" onclick="navigate('approvals')">Review →</button>
              </div>
            </div>
          </div>
        `).join('') + '</div>';
    }
  } catch (err) {
    console.error("Overview error", err);
  }
}

// ─── MISSIONS ───────────
function toggleNewMission(show) {
  const f = document.getElementById('new-mission-form');
  if (show) { f.classList.add('open'); document.getElementById('mission-intent').focus(); }
  else { f.classList.remove('open'); }
}

function setIntent(el) {
  document.getElementById('mission-intent').value = el.innerText;
}

async function createMission() {
  const intent = document.getElementById('mission-intent').value.trim();
  const rawBudget = document.getElementById('mission-budget').value;
  let budgetPaise = undefined;

  if (rawBudget) {
    const b = parseInt(rawBudget, 10);
    if (!isNaN(b)) budgetPaise = b * 100; // to paise
  }

  if (!intent) return showToast("Enter a mission intent first.", "warn");

  try {
    await api('/missions', { method: 'POST', body: JSON.stringify({ intent, budgetPaise }) });
    showToast("Mission started!");
    document.getElementById('mission-intent').value = '';
    toggleNewMission(false);
    loadMissions();
  } catch (e) {}
}

async function loadMissions() {
  const list = document.getElementById('missions-list');
  list.innerHTML = '<div style="text-align:center; padding:32px;"><div class="spinner"></div></div>';

  try {
    const data = await api('/missions');
    const missions = data.missions || [];

    if (missions.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No missions running</div>
          <div class="empty-sub">Use the Setup Guide to connect an AI and start your first mission.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = '<div class="mission-list">' +
      missions.map(m => `
        <div class="mission-row" id="mrow-${m.missionId}" onclick="loadMissionDetail('${m.missionId}')">
          <div class="mission-icon">🎯</div>
          <div class="mission-main">
            <div class="mission-intent">${m.intent}</div>
            <div class="mission-meta">${m.missionId} · <span style="font-family:monospace">${formatTime(m.createdAt)}</span></div>
          </div>
          <div class="mission-right">
            <div class="mission-budget">${formatINR(m.budgetPaise)}</div>
            <div class="badge badge-${m.state.toLowerCase()}">${m.state.replace(/_/g,' ')}</div>
          </div>
        </div>
      `).join('') + '</div>';
  } catch(e){}
}

let activeMissionId = null;
async function loadMissionDetail(id) {
  activeMissionId = id;
  document.querySelectorAll('.mission-row').forEach(r => r.classList.remove('selected'));
  const row = document.getElementById(`mrow-${id}`);
  if (row) row.classList.add('selected');

  const drawer = document.getElementById('mission-drawer');
  drawer.classList.add('open');

  try {
    const [mRes, timelineRes] = await Promise.all([
      fetch(`${BASE_URL}/missions/${id}`),
      fetch(`${BASE_URL}/audit/${id}`)
    ]);

    if (mRes.ok) {
      const m = await mRes.json();
      document.getElementById('drawer-intent').innerText = m.intent;
      document.getElementById('drawer-meta').innerText = `${m.missionId} · Budget: ${formatINR(m.budgetPaise)}`;
      document.getElementById('drawer-badge').className = `badge badge-${m.state.toLowerCase()}`;
      document.getElementById('drawer-badge').innerText = m.state.replace(/_/g,' ');

      // Load receipt if confirmed
      if (m.state === 'CONFIRMED' || m.state === 'PAYING') {
        const rRes = await fetch(`${BASE_URL}/audit/${id}/receipt`);
        if (rRes.ok) {
          const receipt = await rRes.json();
          renderReceiptDrawer(receipt);
        }
      } else {
        document.getElementById('drawer-receipt').innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🧾</div>
            <div class="empty-title">No receipt yet</div>
            <div class="empty-sub">Receipts are generated when a mission completes payment.</div>
          </div>`;
      }
    }

    if (timelineRes.ok) {
      const { events } = await timelineRes.json();
      renderTimelineList(events, 'drawer-timeline');
    }
  } catch (e) {}
}

function switchDrawerTab(el, id) {
  document.getElementById('mission-drawer').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('dtab-timeline').hidden = (id !== 'timeline');
  document.getElementById('dtab-receipt').hidden = (id !== 'receipt');
}

function closeDrawer() {
  document.getElementById('mission-drawer').classList.remove('open');
  document.querySelectorAll('.mission-row').forEach(r => r.classList.remove('selected'));
  activeMissionId = null;
}

function renderTimelineList(events, containerId) {
  const c = document.getElementById(containerId);
  if (!events || events.length === 0) {
    c.innerHTML = '<div style="color:var(--text-faint); font-size:13px; padding:12px;">No events recorded.</div>';
    return;
  }

  c.innerHTML = events.map(e => {
    let dotClass = 'info';
    let detail = JSON.stringify(e.payload);

    if (e.eventType === 'MISSION_STATE_CHANGED') {
      if (e.payload.next === 'CONFIRMED') dotClass = 'allow';
      if (e.payload.next === 'FAILED' || e.payload.next === 'REJECTED') dotClass = 'deny';
      if (e.payload.next === 'AWAITING_APPROVAL' || e.payload.next === 'POLICY_CHECK') dotClass = 'gate';
      detail = `${e.payload.prev || 'START'} → ${e.payload.next}`;
    } else if (e.eventType === 'POLICY_CHECK_FAILED') {
      dotClass = 'deny';
      detail = e.payload.reason;
    } else if (e.eventType === 'APPROVAL_CREATED') {
      dotClass = 'gate';
      detail = `Requested amount: ${formatINR(e.payload.amountPaise)} (${e.payload.reason})`;
    } else if (e.eventType === 'ORDER_CREATED') {
      dotClass = 'allow';
      detail = `Cart total: ${formatINR(e.payload.totalPaise)}. Order ID: ${e.payload.providerOrderId}`;
    } else if (e.eventType === 'MISSION_QUOTED') {
      dotClass = 'info';
      detail = `Sourced ${e.payload.itemCount} items`;
    }

    return `
      <div class="timeline-event">
        <div class="timeline-dot ${dotClass}"></div>
        <div class="timeline-time">${formatTime(e.timestamp)}</div>
        <div class="timeline-label">${e.eventType}</div>
        <div class="timeline-detail">${detail}</div>
      </div>
    `;
  }).join('');
}

function renderReceiptDrawer(r) {
  const c = document.getElementById('drawer-receipt');
  if (!r || !r.providerOrderId) return;

  const itemsHtml = r.items.map(i => `
    <div class="receipt-row">
      <span>${i.productId} x${i.quantity}</span>
      <span>${formatINR(i.subtotalPaise)}</span>
    </div>
  `).join('');

  c.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-title">Purchase Receipt</div>
        <div class="receipt-sub">AgentTill M1 Proxy</div>
        <div class="receipt-sub">Mission: ${r.missionId}</div>
        <div class="receipt-sub">Order: ${r.providerOrderId}</div>
        <div class="receipt-sub">${new Date(r.paidAt).toLocaleString()}</div>
      </div>

      <div style="padding: 16px 0;">
        ${itemsHtml}
        <div class="receipt-row total">
          <span>Total Paid</span>
          <span style="color:var(--green)">${formatINR(r.totalPaise)}</span>
        </div>
      </div>

      <div class="merkle-proof">
        <div class="merkle-label">Merkle Receipt Proof</div>
        <div class="merkle-hash">${r.merkleRoot}</div>
      </div>
    </div>
  `;
}

// ─── APPROVALS ──────────
async function loadApprovals() {
  const list = document.getElementById('approvals-list');
  const banner = document.getElementById('approval-banner');

  try {
    const data = await api('/approvals');
    const pending = (data.approvals || []).filter(a => a.status === 'pending');

    if (pending.length > 0) banner.hidden = false;
    else banner.hidden = true;

    if (pending.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <div class="empty-title">All clear</div>
          <div class="empty-sub">There are no orders awaiting your approval.</div>
        </div>`;
      return;
    }

    list.innerHTML = '<div class="approval-list">' +
      pending.map(a => `
        <div class="approval-card">
          <div class="approval-card-header">
            <span style="font-size:18px;">⚠️</span>
            <div style="flex:1">
              <div style="font-size:14px; font-weight:600;">Manual Approval Required</div>
              <div style="font-size:11px; font-family:monospace; color:var(--text-faint); margin-top:2px;">Mission: ${a.missionId}</div>
            </div>
            <div class="approval-amount">${formatINR(a.amountPaise)}</div>
          </div>
          <div class="approval-card-body">
            <div style="flex:1">
              <div style="font-size:12px; font-weight:600; color:var(--text-faint); text-transform:uppercase; margin-bottom:4px;">Policy Trigger</div>
              <div class="approval-reason">${a.reason}</div>
            </div>
            <div class="approval-actions">
              <button class="btn btn-secondary" onclick="resolveApproval('${a.approvalId}', 'deny')">Deny</button>
              <button class="btn btn-success" onclick="resolveApproval('${a.approvalId}', 'approve')">Approve Order</button>
            </div>
          </div>
        </div>
      `).join('') + '</div>';
  } catch(e) {}
}

async function resolveApproval(id, action) {
  try {
    await api(`/approvals/${id}/${action}`, { method: 'POST' });
    showToast(`Approval ${action}d successfully.`, 'success');
    loadApprovals();
  } catch (e) {}
}

// ─── CATALOG ────────────
let openCatalogData = [];
async function loadCatalog() {
  const g = document.getElementById('catalog-grid');
  g.innerHTML = '<div style="text-align:center; padding:32px; grid-column:1/-1;"><div class="spinner"></div></div>';
  try {
    const data = await api('/catalog');
    openCatalogData = data.products || [];
    renderCatalog(openCatalogData);
  } catch(e){}
}

function filterCatalog(term) {
  if (!term) return renderCatalog(openCatalogData);
  const q = term.toLowerCase();
  const f = openCatalogData.filter(i =>
    i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
  );
  renderCatalog(f);
}

function renderCatalog(items) {
  const g = document.getElementById('catalog-grid');
  if (items.length === 0) {
    g.innerHTML = '<div style="grid-column:1/-1; padding:32px; text-align:center; color:var(--text-faint);">No products found.</div>';
    return;
  }
  g.innerHTML = items.map(i => `
    <div class="catalog-item">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="catalog-item-name">${i.name}</div>
        <div class="catalog-item-cat">${i.category}</div>
      </div>
      <div style="font-size:12px; color:var(--text-muted); flex:1;">${i.sku}</div>
      <div class="catalog-item-price">${formatINR(i.pricePaise)}</div>
    </div>
  `).join('');
}

// ─── AUDIT ──────────────
async function loadMissionsForAudit() {
  try {
    const { missions } = await api('/missions');
    const sel = document.getElementById('audit-mission-select');
    sel.innerHTML = '<option value="">— Select a mission —</option>' + (missions || []).map(m =>
      `<option value="${m.missionId}">${m.missionId} (${m.intent.substring(0,30)}...)</option>`
    ).join('');
  } catch(e){}
}

async function loadAuditTimeline(missionId) {
  const c = document.getElementById('audit-timeline-container');
  if (!missionId) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Select a mission above</div>
      </div>`;
    return;
  }

  c.innerHTML = '<div style="text-align:center; padding:32px;"><div class="spinner"></div></div>';
  try {
    const { events } = await api(`/audit/${missionId}`);
    c.innerHTML = '<div class="timeline" id="full-audit-timeline" style="padding:24px;"></div>';
    renderTimelineList(events, 'full-audit-timeline');
  } catch(e){}
}

// INIT
window.onload = () => {
  navigate('setup');
  checkServer();
  startPolling();
};
