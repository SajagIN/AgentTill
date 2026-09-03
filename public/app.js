const BASE_URL = "http://localhost:3000";

function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function formatTimestamp(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

async function fetchData(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error.message || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

// Render Missions
async function renderMissions() {
  const missionsGrid = document.getElementById('missions-grid');
  missionsGrid.innerHTML = '<div class="mission-card loading">Loading missions...</div>';
  try {
    const data = await fetchData('/missions');
    if (data.missions.length === 0) {
      missionsGrid.innerHTML = '<div class="empty-state">No missions created yet.</div>';
      return;
    }
    missionsGrid.innerHTML = data.missions.map(mission => `
      <a href="#mission-${mission.missionId}" class="mission-card">
        <div class="mission-details">
          <span class="mission-id mono">${mission.missionId}</span>
          <p class="mission-info">${mission.intent}</p>
        </div>
        <div class="mission-meta">
          <span class="mission-badge ${mission.state.toLowerCase()}">${mission.state.replace(/_/g, ' ')}</span>
          <p class="mission-info mono">Budget: ${mission.budgetPaise ? formatINR(mission.budgetPaise) : 'N/A'}</p>
        </div>
      </a>
    `).join('');

    const missionSelect = document.getElementById('mission-select');
    const receiptMissionSelect = document.getElementById('receipt-mission-select');
    missionSelect.innerHTML = '<option value="">-- Select Mission --</option>' + data.missions.map(m => `<option value="${m.missionId}">${m.missionId} (${m.intent})</option>`).join('');
    receiptMissionSelect.innerHTML = missionSelect.innerHTML;

  } catch (error) {
    missionsGrid.innerHTML = `<div class="error-state">Error loading missions: ${error.message}</div>`;
    console.error("Error loading missions:", error);
  }
}

// Render Approvals
async function renderApprovals() {
  const approvalsList = document.getElementById('approvals-list');
  approvalsList.innerHTML = '<div class="approval-card loading">Loading approvals...</div>';
  try {
    const data = await fetchData('/approvals');
    const pendingApprovals = data.approvals.filter(a => a.status === 'pending');

    if (pendingApprovals.length === 0) {
      approvalsList.innerHTML = '<div class="empty-state">No pending approvals.</div>';
      return;
    }

    approvalsList.innerHTML = pendingApprovals.map(approval => `
      <div class="approval-card">
        <p class="approval-meta mono">Approval ID: ${approval.approvalId}</p>
        <h3>${formatINR(approval.amountPaise)} for Mission ${approval.missionId}</h3>
        <p>${approval.reason}</p>
        <div class="approval-actions">
          <button class="btn btn-success btn-sm approve-btn" data-id="${approval.approvalId}">Approve</button>
          <button class="btn btn-danger btn-sm deny-btn" data-id="${approval.approvalId}">Deny</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.approve-btn').forEach(btn => {
      btn.onclick = (e) => resolveApproval(e.target.dataset.id, 'approved');
    });
    document.querySelectorAll('.deny-btn').forEach(btn => {
      btn.onclick = (e) => resolveApproval(e.target.dataset.id, 'denied');
    });

  } catch (error) {
    approvalsList.innerHTML = `<div class="error-state">Error loading approvals: ${error.message}</div>`;
    console.error("Error loading approvals:", error);
  }
}

async function resolveApproval(approvalId, decision) {
  try {
    const endpoint = `/approvals/${approvalId}/${decision}`;
    const res = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST' });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error.message || `HTTP error! status: ${res.status}`);
    }
    await renderApprovals();
    await renderTimeline(document.getElementById('mission-select').value);
    alert(`Approval ${approvalId} ${decision} successfully.`);
  } catch (error) {
    alert(`Failed to ${decision} approval ${approvalId}: ${error.message}`);
    console.error("Error resolving approval:", error);
  }
}

// Render Timeline
async function renderTimeline(missionId) {
  const timelineContainer = document.getElementById('timeline-container');
  if (!missionId) {
    timelineContainer.innerHTML = '<div class="empty-state">Select a mission to view its timeline</div>';
    return;
  }
  timelineContainer.innerHTML = '<div class="loading">Loading timeline...</div>';
  try {
    const data = await fetchData(`/audit/${missionId}`);
    if (data.timeline.length === 0) {
      timelineContainer.innerHTML = '<div class="empty-state">No audit events for this mission yet.</div>';
      return;
    }
    timelineContainer.innerHTML = data.timeline.map(event => {
      const outcomeClass = event.outcome.replace(/_/g, ' ').toLowerCase();
      return `
        <div class="timeline-event ${outcomeClass}">
          <div class="event-header">
            <span class="event-action">${event.action.replace(/_/g, ' ')}</span>
            <span class="event-actor">by ${event.actor.id} (${event.actor.type})</span>
            <span class="event-amount price ${outcomeClass}">${event.amountPaise ? formatINR(event.amountPaise) : ''}</span>
          </div>
          <div class="event-details">
            <p>${event.decision.reason}</p>
            <details>
              <summary>Rule Evaluations</summary>
              <ul>
                ${event.decision.ruleEvals.map(rule => `<li>${rule.ruleId}: ${rule.outcome}</li>`).join('')}
              </ul>
            </details>
            <p class="event-time mono">${formatTimestamp(event.ts)}</p>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    timelineContainer.innerHTML = `<div class="error-state">Error loading timeline: ${error.message}</div>`;
    console.error("Error loading timeline:", error);
  }
}

// Render Merkle Receipt
async function renderReceipt(missionId) {
  const receiptDisplay = document.getElementById('receipt-display');
  if (!missionId) {
    receiptDisplay.innerHTML = '<div class="empty-state">Select a mission to view its receipt</div>';
    return;
  }
  receiptDisplay.innerHTML = '<div class="loading">Loading receipt...</div>';
  try {
    const receipt = await fetchData(`/audit/${missionId}/receipt`);
    receiptDisplay.innerHTML = `
      <div class="receipt-root">
        <div class="label">Merkle Root</div>
        <div class="value">${receipt.root}</div>
      </div>
      <div class="receipt-topology">
        <div class="receipt-stat">
          <div class="stat-label">Topology</div>
          <div class="stat-value">${receipt.topology.replace(/_/g, ' ')}</div>
        </div>
        <div class="receipt-stat">
          <div class="stat-label">Intermediate Nodes</div>
          <div class="stat-value">${receipt.nodes.intermediate.length}</div>
        </div>
        <div class="receipt-stat">
          <div class="stat-label">Leaves</div>
          <div class="stat-value">${receipt.nodes.leaves.length}</div>
        </div>
      </div>
      <div class="receipt-tree">
        <div class="receipt-level">
          <span class="receipt-node root">ROOT: ${receipt.root.slice(0, 8)}...</span>
        </div>
        <div class="receipt-level">
          ${receipt.nodes.intermediate.map(node => `<span class="receipt-node intermediate">INTER: ${node.slice(0, 8)}...</span>`).join('')}
        </div>
        <div class="receipt-level">
          ${receipt.nodes.leaves.map(node => `<span class="receipt-node leaf">LEAF: ${node.slice(0, 8)}...</span>`).join('')}
        </div>
      </div>
    `;
  } catch (error) {
    receiptDisplay.innerHTML = `<div class="error-state">Error loading receipt: ${error.message}</div>`;
    console.error("Error loading receipt:", error);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  renderMissions();
  renderApprovals();

  document.getElementById('refresh-missions-btn').onclick = renderMissions;
  document.getElementById('refresh-approvals-btn').onclick = renderApprovals;
  document.getElementById('refresh-timeline-btn').onclick = () => renderTimeline(document.getElementById('mission-select').value);
  document.getElementById('refresh-receipts-btn').onclick = () => renderReceipt(document.getElementById('receipt-mission-select').value);

  document.getElementById('mission-select').onchange = (e) => renderTimeline(e.target.value);
  document.getElementById('receipt-mission-select').onchange = (e) => renderReceipt(e.target.value);

  // New Mission Modal (simplified for now)
  document.getElementById('new-mission-btn').onclick = async () => {
    const intent = prompt("Enter mission intent (e.g., \"restock office supplies\"):");
    if (intent) {
      try {
        const res = await fetch(`${BASE_URL}/missions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error.message || `HTTP error! status: ${res.status}`);
        }
        alert("Mission created!");
        renderMissions();
      } catch (error) {
        alert(`Failed to create mission: ${error.message}`);
        console.error("Error creating mission:", error);
      }
    }
  };

  // Initial render for money actions (can be expanded later)
  document.getElementById('money-actions-list').innerHTML = '<div class="empty-state">Money actions will appear here.</div>';
});
