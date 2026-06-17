let currentFindings = [];
let activeProjectId = null;
let currentProjectPages = [];
let currentAudits = [];
let pollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  loadProjects();

  // Setup filters
  document.getElementById('filter-severity').addEventListener('change', renderFindings);
  document.getElementById('filter-category').addEventListener('change', renderFindings);
  document.getElementById('filter-status').addEventListener('change', renderFindings);
  document.getElementById('filter-page').addEventListener('change', renderFindings);
  document.getElementById('filter-audit').addEventListener('change', renderFindings);

  // Setup Export CSV
  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!activeProjectId) return;
      window.location.href = `/api/projects/${activeProjectId}/export`;
    });
  }

  // Setup Add Page form
  const addPageForm = document.getElementById('add-page-form');
  if (addPageForm) {
    addPageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeProjectId) return;
      const url = document.getElementById('manual-page-url').value;
      const btn = addPageForm.querySelector('button');
      btn.textContent = '...';
      try {
        const res = await fetch(`/api/projects/${activeProjectId}/pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        if (res.ok) {
          document.getElementById('manual-page-url').value = '';
          await loadProjectPages(activeProjectId);
        } else {
          alert('Failed to add page');
        }
      } catch (err) {
        console.error(err);
      } finally {
        btn.textContent = '+ Add Page';
      }
    });
  }

  // Setup create project form
  const createForm = document.getElementById('create-project-form');
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('project-name-input').value;
      const base_url = document.getElementById('project-url-input').value;
      const statusDiv = document.getElementById('create-project-status');
      
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, base_url })
        });
        
        if (res.ok) {
          statusDiv.textContent = 'Project created!';
          statusDiv.style.color = '#4ade80';
          document.getElementById('project-name-input').value = '';
          document.getElementById('project-url-input').value = '';
          await loadProjects(); // reload sidebar
        } else {
          statusDiv.textContent = 'Failed to create';
          statusDiv.style.color = '#f87171';
        }
      } catch (err) {
        statusDiv.textContent = 'Network error';
        statusDiv.style.color = '#f87171';
      }
    });
  }

  // Setup project actions
  document.getElementById('crawl-btn').addEventListener('click', async () => {
    if (!activeProjectId) return;
    const btn = document.getElementById('crawl-btn');
    btn.disabled = true;
    btn.textContent = 'Crawling... (Background)';
    
    try {
      await fetch(`/api/projects/${activeProjectId}/crawl`, { method: 'POST' });
      // We assume it finishes eventually. We can just reload pages after a delay or let user refresh.
      setTimeout(() => loadProjectPages(activeProjectId), 5000);
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '1. Crawl Site';
      }, 5000);
    }
  });

  // Modal logic
  const modal = document.getElementById('audit-modal');
  document.getElementById('run-audit-modal-btn').addEventListener('click', () => {
    modal.style.display = 'flex';
  });
  document.getElementById('close-modal-btn').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.getElementById('run-audit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeProjectId) return;
    
    const pageSelect = document.getElementById('audit-target-page');
    const isAll = pageSelect.value === 'all';
    const checkboxes = document.querySelectorAll('input[name="categories"]:checked');
    const categories = Array.from(checkboxes).map(c => c.value);
    
    try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Auditing... Please wait';

        const res = await fetch('/api/run-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: isAll ? undefined : pageSelect.options[pageSelect.selectedIndex].text,
            project_id: activeProjectId,
            page_id: isAll ? undefined : pageSelect.value,
            categories
          })
        });
        
        if (res.ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Start Audit';
          modal.style.display = 'none';
          
          // Show progress indicator
          document.getElementById('progress-indicator').style.display = 'flex';
          
          // Poll logic will catch when it finishes and reload
        }
      } catch (err) {
        console.error(err);
        alert('Failed to start audit');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Audit';
      }
  });
});

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    
    const list = document.getElementById('project-list');
    list.innerHTML = '';
    
    projects.forEach(project => {
      const li = document.createElement('li');
      li.className = 'audit-item';
      li.onclick = () => selectProject(project.id, project.name, li);
      
      li.innerHTML = `
        <div class="audit-url">${project.name}</div>
        <div class="audit-date">${project.base_url}</div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

async function selectProject(id, name, element) {
  activeProjectId = id;
  
  // Update active state in sidebar
  document.querySelectorAll('.audit-item').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');
  
  document.getElementById('current-project-title').textContent = `Project: ${name}`;
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('project-actions').style.display = 'flex';
  document.getElementById('pages-container').style.display = 'block';
  document.getElementById('findings-header').style.display = 'flex';
  document.getElementById('findings-table').style.display = 'table';
  
  await loadProjectPages(id);
  await loadProjectFindings(id);
  
  // Setup polling for active audits
  if (pollingInterval) clearInterval(pollingInterval);
  let wasRunning = false;
  
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/projects/${id}/active-audits`);
      const active = await res.json();
      const indicator = document.getElementById('progress-indicator');
      
      if (active && active.length > 0) {
        indicator.style.display = 'flex';
        wasRunning = true;
      } else {
        indicator.style.display = 'none';
        if (wasRunning) {
          // Audit just finished, reload findings!
          wasRunning = false;
          await loadProjectFindings(id);
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 3000);
}

async function loadProjectPages(id) {
  try {
    const res = await fetch(`/api/projects/${id}/pages`);
    currentProjectPages = await res.json();
    
    const list = document.getElementById('pages-list');
    const pageSelect = document.getElementById('audit-target-page');
    const filterPage = document.getElementById('filter-page');
    
    list.innerHTML = '';
    pageSelect.innerHTML = '<option value="all">All Pages</option>';
    filterPage.innerHTML = '<option value="">All Pages</option>';
    
    currentProjectPages.forEach(p => {
      const li = document.createElement('li');
      li.style.padding = '4px 0';
      li.style.borderBottom = '1px solid #333';
      li.textContent = p.url;
      list.appendChild(li);
      
      pageSelect.innerHTML += `<option value="${p.id}">${p.url}</option>`;
      filterPage.innerHTML += `<option value="${p.id}">${p.url}</option>`;
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadProjectAudits(id) {
  try {
    const res = await fetch(`/api/projects/${id}/audits`);
    currentAudits = await res.json();
    
    const select = document.getElementById('filter-audit');
    select.innerHTML = '<option value="all">All Audits</option>';
    
    if (currentAudits.length > 0) {
      currentAudits.forEach(a => {
        const date = new Date(a.started_at);
        const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        select.innerHTML += `<option value="${a.id}">Audit #${a.id} (${timeStr})</option>`;
      });
      // Default to the latest audit
      select.value = currentAudits[0].id;
      document.getElementById('delete-audit-btn').style.display = 'inline-block';
    } else {
      document.getElementById('delete-audit-btn').style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load audits:', err);
  }
}

async function deleteSelectedAudit() {
  const auditId = document.getElementById('filter-audit').value;
  if (auditId === 'all') {
    alert('Please select a specific audit to delete.');
    return;
  }
  
  if (!confirm('Are you sure you want to completely delete this audit run and all its findings?')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/audits/${auditId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadProjectFindings(activeProjectId);
    } else {
      alert('Failed to delete audit');
    }
  } catch (err) {
    console.error(err);
    alert('Error deleting audit');
  }
}

async function loadProjectFindings(id) {
  try {
    const res = await fetch(`/api/projects/${id}/findings`);
    currentFindings = await res.json();
    
    // Populate category filter
    const categories = [...new Set(currentFindings.map(f => f.category))];
    const catSelect = document.getElementById('filter-category');
    catSelect.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(cat => {
      if(cat) catSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
    
    await loadProjectAudits(id);
    renderFindings();
  } catch (err) {
    console.error('Failed to load findings:', err);
  }
}

function renderFindings() {
  const sevFilter = document.getElementById('filter-severity').value;
  const catFilter = document.getElementById('filter-category').value;
  const statFilter = document.getElementById('filter-status').value;
  const pageFilter = document.getElementById('filter-page').value;
  const auditFilter = document.getElementById('filter-audit').value;
  
  // Update delete button visibility
  document.getElementById('delete-audit-btn').style.display = auditFilter !== 'all' ? 'inline-block' : 'none';
  
  const filtered = currentFindings.filter(f => {
    return (!sevFilter || f.severity === sevFilter) &&
           (!catFilter || f.category === catFilter) &&
           (!statFilter || f.status === statFilter) &&
           (!pageFilter || f.page_id == pageFilter) &&
           (auditFilter === 'all' || f.audit_id == auditFilter);
  });
  
  const tbody = document.getElementById('findings-body');
  tbody.innerHTML = '';
  
  filtered.forEach(finding => {
    const row = document.createElement('tr');
    row.className = 'finding-row';
    row.onclick = () => toggleDetails(finding.id);
    
    row.innerHTML = `
      <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${finding.page_url || ''}">${finding.page_url ? new URL(finding.page_url).pathname : 'Site-wide'}</td>
      <td>${finding.source_tool}</td>
      <td>${finding.category}</td>
      <td><span class="badge ${finding.severity}">${finding.severity}</span></td>
      <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${finding.description}">${finding.title}</td>
      <td><span class="badge ${finding.status}" id="status-badge-${finding.id}">${finding.status}</span></td>
    `;
    
    const detailsRow = document.createElement('tr');
    const detailsTd = document.createElement('td');
    detailsTd.colSpan = 6;
    detailsTd.className = 'finding-details';
    detailsTd.id = `details-${finding.id}`;
    
    detailsTd.innerHTML = `
      <div class="details-grid">
        <div class="triage-panel">
          <h3>Triage</h3>
          <p><strong>Selector:</strong> ${finding.selector || 'N/A'}</p>
          <p><strong>Title:</strong> ${finding.title}</p>
          <p><strong>Description:</strong> ${finding.description || 'N/A'}</p>
          ${finding.html_snippet ? `<div style="margin: 10px 0;"><label style="font-weight: bold; font-size: 0.9em; display: block; margin-bottom: 5px;">HTML Snippet:</label><pre style="background: #111; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; color: #4ade80; border: 1px solid #333;"><code>${finding.html_snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></div>` : ''}
          
          <div style="margin: 15px 0; padding: 15px; background: #1e1e2f; border-radius: 6px; border: 1px solid #3a3a5a;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; color: #a78bfa;">✨ AI Insights</h4>
              <button onclick="askAI(${finding.id})" id="ai-btn-${finding.id}" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Ask AI to Explain</button>
            </div>
            <div id="ai-response-${finding.id}" style="font-size: 0.95em; line-height: 1.5; color: #e2e8f0; display: ${finding.ai_explanation ? 'block' : 'none'};">
              ${finding.ai_explanation ? parseMarkdown(finding.ai_explanation) : ''}
            </div>
          </div>
          
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
  const relativePath = '/' + finding.evidence_path.replace(/\\/g, '/');
  
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
  if (!finding.after_screenshot_path) return;
  
  const img = container.querySelector('img');
  const label = container.querySelector('.diff-label');
  const currentState = img.getAttribute('data-state');
  
  const beforeRel = '/' + finding.evidence_path.replace(/\\/g, '/');
  const afterRel = finding.after_screenshot_path ? '/' + finding.after_screenshot_path.replace(/\\/g, '/') : null;
  const diffRel = finding.diff_image_path ? '/' + finding.diff_image_path.replace(/\\/g, '/') : null;
  
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
      body: JSON.stringify({ status, is_false_positive: is_fp, notes })
    });
    
    if (res.ok) {
      const finding = currentFindings.find(f => f.id === id);
      if (finding) {
        finding.status = status;
        finding.is_false_positive = is_fp;
        finding.notes = notes;
      }
      const badge = document.getElementById(`status-badge-${id}`);
      if (badge) {
        badge.className = `badge ${status}`;
        badge.textContent = status;
      }
    }
  } catch (err) {
    alert('Failed to update finding: ' + err.message);
  }
}

async function askAI(findingId) {
  const btn = document.getElementById(`ai-btn-${findingId}`);
  const responseDiv = document.getElementById(`ai-response-${findingId}`);
  
  btn.disabled = true;
  btn.innerText = 'Thinking...';
  
  try {
    const res = await fetch(`/api/findings/${findingId}/ai-explain`, { method: 'POST' });
    const data = await res.json();
    
    if (data.error) {
      alert('Error: ' + data.error);
      btn.innerText = 'Try Again';
      btn.disabled = false;
      return;
    }
    
    responseDiv.innerHTML = parseMarkdown(data.explanation);
    responseDiv.style.display = 'block';
    btn.innerText = 'Explained';
    
    // Update local cache
    const finding = currentFindings.find(f => f.id === findingId);
    if (finding) finding.ai_explanation = data.explanation;
  } catch (err) {
    alert('Request failed: ' + err.message);
    btn.innerText = 'Ask AI to Explain';
    btn.disabled = false;
  }
}

function parseMarkdown(text) {
  if (!text) return '';
  let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // bold
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>'); // italic
  html = html.replace(/\n\n/g, '</p><p>'); // paragraphs
  html = html.replace(/\n- (.*?)(?=\n|$)/g, '<li>$1</li>'); // bullet lists
  html = html.replace(/<li>.*?<\/li>/g, match => `<ul style="margin: 5px 0 10px 20px;">${match}</ul>`); // wrap lists
  // Simple deduplication of ul wrappers
  html = html.replace(/<\/ul><ul style="[^"]+">/g, ''); 
  return `<p>${html}</p>`;
}
