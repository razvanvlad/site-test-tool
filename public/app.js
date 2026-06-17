let currentFindings = [];
let activeAuditId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadAudits();

  // Setup filters
  document.getElementById('filter-severity').addEventListener('change', renderFindings);
  document.getElementById('filter-category').addEventListener('change', renderFindings);
  document.getElementById('filter-status').addEventListener('change', renderFindings);
});

async function loadAudits() {
  try {
    const res = await fetch('/api/audits');
    const audits = await res.json();
    
    const list = document.getElementById('audit-list');
    list.innerHTML = '';
    
    audits.forEach(audit => {
      const li = document.createElement('li');
      li.className = 'audit-item';
      li.onclick = () => selectAudit(audit.id, audit.url, li);
      
      const date = new Date(audit.started_at).toLocaleString();
      li.innerHTML = `
        <div class="audit-url">${audit.url}</div>
        <div class="audit-date">${date}</div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load audits:', err);
  }
}

async function selectAudit(id, url, element) {
  activeAuditId = id;
  
  // Update active state in sidebar
  document.querySelectorAll('.audit-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  
  document.getElementById('current-audit-title').textContent = `Audit: ${url}`;
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('findings-table').style.display = 'table';
  
  try {
    const res = await fetch(`/api/findings/${id}`);
    currentFindings = await res.json();
    
    // Populate category filter
    const categories = [...new Set(currentFindings.map(f => f.category))];
    const catSelect = document.getElementById('filter-category');
    catSelect.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(cat => {
      catSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
    
    renderFindings();
  } catch (err) {
    console.error('Failed to load findings:', err);
  }
}

function renderFindings() {
  const sevFilter = document.getElementById('filter-severity').value;
  const catFilter = document.getElementById('filter-category').value;
  const statFilter = document.getElementById('filter-status').value;
  
  const filtered = currentFindings.filter(f => {
    return (!sevFilter || f.severity === sevFilter) &&
           (!catFilter || f.category === catFilter) &&
           (!statFilter || f.status === statFilter);
  });
  
  const tbody = document.getElementById('findings-body');
  tbody.innerHTML = '';
  
  filtered.forEach(finding => {
    // Main row
    const row = document.createElement('tr');
    row.className = 'finding-row';
    row.onclick = () => toggleDetails(finding.id);
    
    row.innerHTML = `
      <td>${finding.engine}</td>
      <td>${finding.category}</td>
      <td><span class="badge ${finding.severity}">${finding.severity}</span></td>
      <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${finding.message}">${finding.message}</td>
      <td><span class="badge ${finding.status}" id="status-badge-${finding.id}">${finding.status}</span></td>
    `;
    
    // Details row
    const detailsRow = document.createElement('tr');
    const detailsTd = document.createElement('td');
    detailsTd.colSpan = 5;
    detailsTd.className = 'finding-details';
    detailsTd.id = `details-${finding.id}`;
    
    detailsTd.innerHTML = `
      <div class="details-grid">
        <div class="triage-panel">
          <h3>Triage</h3>
          <p><strong>Selector:</strong> ${finding.selector || 'N/A'}</p>
          <p><strong>Message:</strong> ${finding.message}</p>
          
          <div class="form-group">
            <label>Status:</label>
            <select id="status-${finding.id}" onchange="updateFinding(${finding.id})">
              <option value="open" ${finding.status === 'open' ? 'selected' : ''}>Open</option>
              <option value="fixed" ${finding.status === 'fixed' ? 'selected' : ''}>Fixed</option>
              <option value="wontfix" ${finding.status === 'wontfix' ? 'selected' : ''}>Won't Fix</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>
              <input type="checkbox" id="fp-${finding.id}" ${finding.is_false_positive ? 'checked' : ''} onchange="updateFinding(${finding.id})">
              False Positive
            </label>
          </div>
          
          <div class="form-group">
            <label>Notes:</label>
            <textarea id="notes-${finding.id}" onchange="updateFinding(${finding.id})">${finding.notes || ''}</textarea>
          </div>
        </div>
        
        <div class="screenshot-panel">
          <h3>Evidence</h3>
          ${renderEvidence(finding)}
        </div>
      </div>
    `;
    
    detailsRow.appendChild(detailsTd);
    tbody.appendChild(row);
    tbody.appendChild(detailsRow);
  });
}

function renderEvidence(finding) {
  if (!finding.evidence_path) {
    return '<p>No screenshot available.</p>';
  }
  
  // Replace absolute path with relative for serving (assuming it's in reports/screenshots)
  const relativePath = '/' + finding.evidence_path.split(/[\/\\]/).slice(-2).join('/');
  
  let html = `
    <div class="diff-image-container" onclick='cycleDiff(this, ${JSON.stringify(finding).replace(/'/g, "&apos;")})'>
      <div class="diff-label" id="label-${finding.id}">Before</div>
      <img id="img-${finding.id}" src="${relativePath}" alt="Screenshot evidence" data-state="before">
    </div>
  `;
  
  if (finding.after_screenshot_path) {
    html += `<p style="font-size: 0.8rem; margin-top: 10px;">Click image to toggle Before / After ${finding.diff_image_path ? '/ Diff' : ''}</p>`;
    if (finding.diff_percentage !== null) {
      html += `<p><strong>Diff:</strong> ${finding.diff_percentage}% (${finding.diff_pixels} pixels)</p>`;
    }
  }
  
  return html;
}

window.cycleDiff = function(container, finding) {
  if (!finding.after_screenshot_path) return; // No diff available to cycle
  
  const img = container.querySelector('img');
  const label = container.querySelector('.diff-label');
  const currentState = img.getAttribute('data-state');
  
  const beforeRel = '/' + finding.evidence_path.split(/[\/\\]/).slice(-2).join('/');
  const afterRel = '/' + finding.after_screenshot_path.split(/[\/\\]/).slice(-2).join('/');
  const diffRel = finding.diff_image_path ? '/' + finding.diff_image_path.split(/[\/\\]/).slice(-2).join('/') : null;
  
  if (currentState === 'before') {
    img.src = afterRel;
    img.setAttribute('data-state', 'after');
    label.textContent = 'After';
  } else if (currentState === 'after' && diffRel) {
    img.src = diffRel;
    img.setAttribute('data-state', 'diff');
    label.textContent = 'Diff';
  } else {
    img.src = beforeRel;
    img.setAttribute('data-state', 'before');
    label.textContent = 'Before';
  }
};

function toggleDetails(id) {
  const details = document.getElementById(`details-${id}`);
  details.classList.toggle('expanded');
}

window.updateFinding = async function(id) {
  const status = document.getElementById(`status-${id}`).value;
  const is_fp = document.getElementById(`fp-${id}`).checked;
  const notes = document.getElementById(`notes-${id}`).value;
  
  try {
    const res = await fetch(`/api/findings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        is_false_positive: is_fp,
        notes
      })
    });
    
    if (res.ok) {
      // Update local state
      const finding = currentFindings.find(f => f.id === id);
      if (finding) {
        finding.status = status;
        finding.is_false_positive = is_fp;
        finding.notes = notes;
      }
      
      // Update badge visually
      const badge = document.getElementById(`status-badge-${id}`);
      if (badge) {
        badge.className = `badge ${status}`;
        badge.textContent = status;
      }
    }
  } catch (err) {
    console.error('Failed to update finding:', err);
    alert('Failed to save changes.');
  }
};
