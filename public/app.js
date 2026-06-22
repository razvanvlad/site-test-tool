let currentFindings = [];
let activeProjectId = null;
let currentProjectPages = [];
let currentAudits = [];
let pollingInterval = null;
let currentTab = 'findings';
let cachedSummary = null;
let cachedTasks = null;
let historyChartInstance = null;
// Migrate old 'grok' (xAI) preference to 'groq' (Groq.com)
if (localStorage.getItem('preferredAIModel') === 'grok') {
  localStorage.setItem('preferredAIModel', 'groq');
}
let preferredAIModel = localStorage.getItem('preferredAIModel') || 'auto';


// ── AI Model Selector ──────────────────────────────────────────────────────────

window.setPreferredModel = function(model) {
  preferredAIModel = model;
  localStorage.setItem('preferredAIModel', model);
  // Immediately update status to reflect manual override
  pollAIStatus();
};

async function pollAIStatus() {
  try {
    const res = await fetch('/api/ai-status');
    if (!res.ok) return;
    const status = await res.json();

    const badge = document.getElementById('ai-active-badge');
    if (!badge) return;

    let activeModel = preferredAIModel;
    if (activeModel === 'auto') {
      activeModel = status.gemini.exhausted ? 'groq' : 'gemini';
    }

    if (activeModel === 'gemini') {
      if (!status.gemini.configured) {
        badge.style.background = '#1c1c1c';
        badge.style.color = '#6b7280';
        badge.style.borderColor = '#374151';
        badge.textContent = '— Gemini: No Key';
      } else if (status.gemini.exhausted) {
        badge.style.background = '#450a0a';
        badge.style.color = '#fca5a5';
        badge.style.borderColor = '#991b1b';
        const resetStr = status.gemini.resetAt ? ` (resets ${new Date(status.gemini.resetAt).toLocaleTimeString()})` : '';
        badge.textContent = `⚠ Gemini Quota Exceeded${resetStr}`;
      } else {
        badge.style.background = '#14532d';
        badge.style.color = '#4ade80';
        badge.style.borderColor = '#166534';
        badge.textContent = preferredAIModel === 'auto' ? '✓ Auto: Gemini OK' : '✓ Gemini OK';
      }
    } else {
      if (!status.groq.configured) {
        badge.style.background = '#1c1c1c';
        badge.style.color = '#6b7280';
        badge.style.borderColor = '#374151';
        badge.textContent = '— Groq: No Key';
      } else if (status.groq.exhausted) {
        badge.style.background = '#450a0a';
        badge.style.color = '#fca5a5';
        badge.style.borderColor = '#991b1b';
        badge.textContent = '⚠ Groq Rate Limit Hit';
      } else {
        badge.style.background = '#1e3a5f';
        badge.style.color = '#60a5fa';
        badge.style.borderColor = '#1d4ed8';
        badge.textContent = preferredAIModel === 'auto' ? '✓ Auto: Groq Ready' : '✓ Groq Ready';
      }
    }
  } catch (e) {
    // Silently ignore - server may not be running yet
  }
}

function setActiveModelLabel(modelUsed) {
  const label = document.getElementById('ai-model-active-label');
  if (!label || !modelUsed) return;
  const icons = { gemini: '🟢', groq: '🔵', cached: '💾', auto: '⚡' };
  const names = { gemini: 'Gemini 2.5 Flash', groq: 'Groq · Llama 3.3 70B', cached: 'Cached', auto: 'Auto' };
  label.textContent = `Last used: ${icons[modelUsed] || '🤖'} ${names[modelUsed] || modelUsed}`;
}

document.addEventListener('DOMContentLoaded', () => {
  loadProjects();

  // Initialize AI model selector from localStorage
  const modelSelect = document.getElementById('ai-model-select');
  if (modelSelect) {
    modelSelect.value = preferredAIModel;
  }

  // Poll AI status every 30 seconds + immediately on load
  pollAIStatus();
  setInterval(pollAIStatus, 30000);

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
      const local_path = document.getElementById('project-local-path-input').value;
      const statusDiv = document.getElementById('create-project-status');
      
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, base_url, local_path })
        });
        
        if (res.ok) {
          statusDiv.textContent = 'Project created!';
          statusDiv.style.color = '#4ade80';
          document.getElementById('project-name-input').value = '';
          document.getElementById('project-url-input').value = '';
          document.getElementById('project-local-path-input').value = '';
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

  // Setup tabs switching click listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Setup generate AI buttons click listeners
  const genSummaryBtn = document.getElementById('generate-summary-btn');
  if (genSummaryBtn) {
    genSummaryBtn.addEventListener('click', () => {
      const auditId = document.getElementById('filter-audit').value;
      if (auditId && auditId !== 'all') {
        generateAISummary(auditId);
      }
    });
  }

  const genTasksBtn = document.getElementById('generate-tasks-btn');
  if (genTasksBtn) {
    genTasksBtn.addEventListener('click', () => {
      const auditId = document.getElementById('filter-audit').value;
      if (auditId && auditId !== 'all') {
        generateAISummary(auditId);
      }
    });
  }

  // Setup regenerate AI buttons click listeners
  const regenSummaryBtn = document.getElementById('regenerate-summary-btn');
  if (regenSummaryBtn) {
    regenSummaryBtn.addEventListener('click', () => {
      const auditId = document.getElementById('filter-audit').value;
      if (auditId && auditId !== 'all') {
        generateAISummary(auditId, true);
      }
    });
  }

  const regenTasksBtn = document.getElementById('regenerate-tasks-btn');
  if (regenTasksBtn) {
    regenTasksBtn.addEventListener('click', () => {
      const auditId = document.getElementById('filter-audit').value;
      if (auditId && auditId !== 'all') {
        generateAISummary(auditId, true);
      }
    });
  }
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
      li.onclick = () => selectProject(project.id, project.name, project.local_path, li);
      
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

async function selectProject(id, name, localPath, element) {
  activeProjectId = id;
  
  // Update active state in sidebar
  document.querySelectorAll('.audit-item').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');
  
  document.getElementById('current-project-title').textContent = `Project: ${name}`;
  
  // Local path display logic
  const localPathDisplay = document.getElementById('project-local-path-display');
  const localPathText = document.getElementById('current-local-path-text');
  const localPathInput = document.getElementById('edit-local-path-input');
  
  localPathDisplay.style.display = 'flex';
  document.getElementById('edit-local-path-form').style.display = 'none';
  
  if (localPath) {
    localPathText.textContent = localPath;
    localPathText.style.color = '';
    localPathInput.value = localPath;
  } else {
    localPathText.textContent = 'None';
    localPathText.style.color = '#6b7280';
    localPathInput.value = '';
  }

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('project-actions').style.display = 'flex';
  document.getElementById('pages-container').style.display = 'block';
  document.getElementById('findings-header').style.display = 'flex';
  document.getElementById('findings-header-filters').style.display = 'flex';
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
        document.getElementById('progress-text').textContent = active[0].progress || 'Working...';
        wasRunning = true;
      } else {
        indicator.style.display = 'none';
        document.getElementById('progress-text').textContent = 'Working...';
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

async function deleteDomain() {
  if (!activeProjectId) return;
  
  if (!confirm('Are you sure you want to delete this domain and ALL of its pages, audits, and findings? This cannot be undone.')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/projects/${activeProjectId}`, { method: 'DELETE' });
    if (res.ok) {
      alert('Domain deleted successfully');
      activeProjectId = null;
      document.getElementById('empty-state').style.display = 'flex';
      document.getElementById('project-actions').style.display = 'none';
      document.getElementById('pages-container').style.display = 'none';
      document.getElementById('findings-header').style.display = 'none';
      document.getElementById('findings-header-filters').style.display = 'none';
      document.getElementById('findings-table').style.display = 'none';
      document.getElementById('current-project-title').textContent = 'Select a Domain';
      if (pollingInterval) clearInterval(pollingInterval);
      loadProjects();
    } else {
      const data = await res.json();
      alert('Error deleting domain: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Failed to delete domain:', err);
    alert('Failed to delete domain.');
  }
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
      li.style.borderBottom = '1px solid var(--border)';
      li.style.color = 'var(--accent)';
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
  
  // Show/hide audit tabs based on selection
  const auditTabs = document.getElementById('audit-tabs');
  if (auditTabs) {
    if (auditFilter !== 'all') {
      auditTabs.style.display = 'flex';
      // Sync active tab display
      document.querySelectorAll('.tab-content').forEach(panel => {
        panel.style.display = panel.id === `${currentTab}-tab-content` ? 'block' : 'none';
      });
    } else {
      auditTabs.style.display = 'none';
      currentTab = 'findings';
      document.querySelectorAll('.tab-content').forEach(panel => {
        panel.style.display = panel.id === 'findings-tab-content' ? 'block' : 'none';
      });
      // Deactivate other tab buttons
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === 'findings') btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }
  }

  // Handle audit change cache-busting
  const targetAuditId = auditFilter === 'all' && currentAudits && currentAudits.length > 0 ? currentAudits[0].id : auditFilter;
  if (window.lastAuditId !== targetAuditId) {
    window.lastAuditId = targetAuditId;
    cachedSummary = null;
    cachedTasks = null;
    if (currentTab !== 'findings' && targetAuditId !== 'all') {
      if (currentTab === 'summary') {
        loadAISummary(targetAuditId);
      } else if (currentTab === 'tasks') {
        loadAITasks(targetAuditId);
      }
    }
  }
  if (currentTab === 'history' && activeProjectId) {
    loadProjectHistory(activeProjectId);
  }
  
  // Update delete button visibility
  document.getElementById('delete-audit-btn').style.display = auditFilter !== 'all' ? 'inline-block' : 'none';

  // Render Lighthouse Dials
  const dialsContainer = document.getElementById('lighthouse-dials');
  let selectedAuditId = auditFilter;
  if (selectedAuditId === 'all' && currentAudits && currentAudits.length > 0) {
    selectedAuditId = currentAudits[0].id; // Show latest by default
  }
  
  if (selectedAuditId !== 'all' && currentAudits) {
    const audit = currentAudits.find(a => a.id == selectedAuditId);
    if (audit && (audit.lighthouse_perf || audit.lighthouse_a11y || audit.lighthouse_seo)) {
      dialsContainer.style.display = 'flex';
      
      const getLhColor = (score) => {
        if (score === null || score === undefined) return 'lh-gray';
        const val = score * 100;
        if (val >= 90) return 'lh-green';
        if (val >= 50) return 'lh-orange';
        return 'lh-red';
      };

      dialsContainer.innerHTML = `
        <div class="lh-dial">
          <div class="lh-score ${getLhColor(audit.lighthouse_perf)}">${audit.lighthouse_perf ? Math.round(audit.lighthouse_perf * 100) : '-'}</div>
          <div>Performance</div>
        </div>
        <div class="lh-dial">
          <div class="lh-score ${getLhColor(audit.lighthouse_a11y)}">${audit.lighthouse_a11y ? Math.round(audit.lighthouse_a11y * 100) : '-'}</div>
          <div>Accessibility</div>
        </div>
        <div class="lh-dial">
          <div class="lh-score ${getLhColor(audit.lighthouse_seo)}">${audit.lighthouse_seo ? Math.round(audit.lighthouse_seo * 100) : '-'}</div>
          <div>SEO</div>
        </div>
      `;
    } else {
      dialsContainer.style.display = 'none';
    }
  } else {
    dialsContainer.style.display = 'none';
  }
  
  const filtered = currentFindings.filter(f => {
    return (!sevFilter || f.severity === sevFilter) &&
           (!catFilter || f.category === catFilter) &&
           (!statFilter || f.status === statFilter) &&
           (!pageFilter || f.page_id == pageFilter) &&
           (auditFilter === 'all' || f.audit_id == auditFilter);
  });
  
  const tbody = document.getElementById('findings-body');
  tbody.innerHTML = '';
  
  const grouped = {};
  filtered.forEach(f => {
    // Group by Page, Category, and Title
    const key = (f.page_url || 'all') + '|' + f.category + '|' + f.title;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  });

  function getComponentName(finding) {
    if (finding.category === 'network') return 'Network Request';
    if (finding.category === 'console') return 'Console / Script';
    if (finding.category === 'content' && finding.source_tool === 'linkinator') return 'Page Links';
    
    const sel = finding.selector;
    if (!sel) return 'Page Level';
    
    if (sel.includes('header')) return 'Header';
    if (sel.includes('footer')) return 'Footer';
    if (sel.includes('nav')) return 'Navigation';
    if (sel.includes('sidebar')) return 'Sidebar';
    if (sel.includes('main')) return 'Main Content';
    if (sel.includes('card')) return 'Card Component';
    if (sel.includes('form') || sel.includes('input')) return 'Form / Input';
    if (sel.includes('button') || sel.includes('btn')) return 'Button';
    
    const match = sel.match(/[#\.]?([a-zA-Z0-9_-]+)/);
    if (match) {
      let name = match[1].replace(/[-_]/g, ' ');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return 'Component';
  }

  let groupIndex = 0;
  Object.values(grouped).forEach(group => {
    groupIndex++;
    const first = group[0];
    const isSingle = group.length === 1;

    if (!isSingle) {
      const row = document.createElement('tr');
      row.className = 'finding-row group-header';
      row.style.backgroundColor = 'var(--bg)';
      row.style.borderLeft = '4px solid var(--accent)';
      row.onclick = ((idx) => () => {
        // Only toggle the child rows, not the details panels!
        const children = document.querySelectorAll('.child-row-of-' + idx);
        children.forEach(c => {
          c.style.display = c.style.display === 'none' ? 'table-row' : 'none';
        });
      })(groupIndex);
      
      const openCount = group.filter(f => f.status !== 'fixed').length;
      const groupStatus = openCount === 0 ? 'fixed' : 'open';

      const comp = getComponentName(first);
      row.innerHTML = `
        <td><strong>${comp} (${group.length})</strong></td>
        <td>${first.source_tool}</td>
        <td>${first.category}</td>
        <td><span class="badge ${first.severity}">${first.severity}</span></td>
        <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${first.description}"><strong>${first.title}</strong></td>
        <td></td>
        <td><span class="badge ${groupStatus}">${openCount} Open</span></td>
      `;
      tbody.appendChild(row);
    }

    group.forEach(finding => {
      const row = document.createElement('tr');
      row.className = 'finding-row';
      if (!isSingle) {
        row.classList.add('child-row-of-' + groupIndex);
        row.style.display = 'none'; // hidden by default
      }
      row.onclick = () => toggleDetails(finding.id);
      
      const comp = getComponentName(finding);
      const relativePath = finding.evidence_path ? '/' + finding.evidence_path.replace(/\\/g, '/') : null;
      const visualHtml = relativePath 
        ? `<img src="${relativePath}" style="max-height: 35px; max-width: 70px; border-radius: 4px; border: 1px solid var(--border); object-fit: cover; cursor: zoom-in;" onclick="event.stopPropagation(); openImageModal('${relativePath}')">`
        : `<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>`;

      row.innerHTML = `
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${!isSingle ? 'padding-left: 30px;' : ''}" title="${finding.selector || comp}">${!isSingle ? '↳ ' : ''}${comp}</td>
        <td>${finding.source_tool}</td>
        <td>${finding.category}</td>
        <td><span class="badge ${finding.severity}">${finding.severity}</span></td>
        <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${finding.description}">${finding.title}</td>
        <td style="text-align: center; vertical-align: middle;">${visualHtml}</td>
        <td><span class="badge ${finding.status}" id="status-badge-${finding.id}">${finding.status}</span></td>
      `;
      
      const detailsRow = document.createElement('tr');
      // DO NOT add child-row-of class here so it doesn't get toggled by the parent!
      const detailsTd = document.createElement('td');
      detailsTd.colSpan = 7;
      detailsTd.className = 'finding-details';
      detailsTd.id = `details-${finding.id}`;
      
      detailsTd.innerHTML = `
        <div class="details-grid">
          <div class="triage-panel">
            ${finding.source_url ? `<p><strong>Source File / URL:</strong> <a href="${finding.source_url}" target="_blank" style="color: #60a5fa; word-break: break-all;">${finding.source_url}</a></p>` : ''}
            <p><strong>Selector:</strong> ${finding.selector || 'N/A'}</p>
            <p><strong>Title:</strong> ${finding.title}</p>
            <p><strong>Description:</strong> ${finding.description || 'N/A'}</p>
            ${finding.html_snippet && finding.category !== 'console' && finding.category !== 'network' && finding.category !== 'content' ? `<div style="margin: 10px 0;"><label style="font-weight: bold; font-size: 0.9em; display: block; margin-bottom: 5px;">HTML Snippet:</label><pre style="background: #111; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; color: #4ade80; border: 1px solid #333;"><code>${finding.html_snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></div>` : ''}
            
            <div style="margin: 15px 0; padding: 15px; background: #1e1e2f; border-radius: 6px; border: 1px solid #3a3a5a;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #a78bfa;">✨ AI Insights</h4>
                <button onclick="askAI(${finding.id})" id="ai-btn-${finding.id}" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Ask AI to Explain</button>
              </div>
              <div id="ai-response-${finding.id}" style="font-size: 0.95em; line-height: 1.5; color: #e2e8f0; display: ${finding.ai_explanation ? 'block' : 'none'};">
                ${finding.ai_explanation ? parseMarkdown(finding.ai_explanation) : ''}
              </div>
            </div>

            <!-- AI Code Healer Panel -->
            <div style="margin: 15px 0; padding: 15px; background: #0f172a; border-radius: 6px; border: 1px solid #1e293b;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #38bdf8;">🛠️ AI Code Healer</h4>
                <button onclick="getAIFix(${finding.id})" id="propose-fix-btn-${finding.id}" style="background: #0ea5e9; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">Propose AI Fix</button>
              </div>
              <div id="propose-fix-loading-${finding.id}" class="spinner-text" style="display: none; margin-top: 10px;">
                <span class="spinner inline-spinner" style="display: inline-block; margin-right: 5px;"></span> AI is analyzing code context...
              </div>
              <div id="ai-fix-response-${finding.id}" style="font-size: 0.95em; line-height: 1.5; color: #cbd5e1; display: none; margin-top: 10px;">
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

            <!-- Verify Fix Button -->
            <div class="form-group" style="margin-top: 15px; display: flex; align-items: center; gap: 10px;">
              <button onclick="verifyFindingFix(${finding.id})" id="verify-fix-btn-${finding.id}" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 5px;">
                ⚡ Verify Fix
              </button>
              <span id="verify-loading-${finding.id}" class="spinner-text" style="display: none;">
                <span class="spinner inline-spinner" style="display: inline-block; margin-right: 5px;"></span> Re-auditing...
              </span>
              <span id="verify-status-msg-${finding.id}" style="font-size: 0.9em; font-weight: 500;"></span>
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
  });
}

function renderEvidence(finding) {
  if (finding.category === 'console' || finding.category === 'network' || (finding.category === 'content' && !finding.evidence_path)) {
    return `
      <div style="background: #111; padding: 15px; border-radius: 4px; border: 1px solid #333; font-family: monospace; color: #f87171; white-space: pre-wrap; word-break: break-all; margin-top: 10px;">
        ${finding.html_snippet ? finding.html_snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;') : finding.description}
      </div>
    `;
  }

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
    const res = await fetch(`/api/findings/${findingId}/ai-explain?model=${preferredAIModel}`, { method: 'POST' });
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
    
    if (data.modelUsed) {
      setActiveModelLabel(data.modelUsed);
      pollAIStatus();
    }
    
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
  
  // Split into lines
  const lines = text.split('\n');
  let inList = false;
  let listType = null; // 'ul' or 'ol'
  let html = '';
  
  for (let line of lines) {
    line = line.trim();
    
    // Headers
    if (line.startsWith('### ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      const content = line.substring(4);
      html += `<h3>${parseMarkdownInline(content)}</h3>`;
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      const content = line.substring(3);
      html += `<h2>${parseMarkdownInline(content)}</h2>`;
      continue;
    }
    if (line.startsWith('# ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      const content = line.substring(2);
      html += `<h1>${parseMarkdownInline(content)}</h1>`;
      continue;
    }
    
    // Bullet list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList || listType !== 'ul') {
        if (inList) html += `</${listType}>`;
        html += '<ul style="margin: 5px 0 10px 20px;">';
        inList = true;
        listType = 'ul';
      }
      const content = line.substring(2);
      html += `<li>${parseMarkdownInline(content)}</li>`;
      continue;
    }
    
    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html += `</${listType}>`;
        html += '<ol style="margin: 5px 0 10px 20px;">';
        inList = true;
        listType = 'ol';
      }
      const content = numMatch[2];
      html += `<li>${parseMarkdownInline(content)}</li>`;
      continue;
    }
    
    // Empty line
    if (!line) {
      if (inList) {
        html += `</${listType}>`;
        inList = false;
        listType = null;
      }
      continue;
    }
    
    // Standard paragraph line
    if (inList) {
      html += `</${listType}>`;
      inList = false;
      listType = null;
    }
    html += `<p>${parseMarkdownInline(line)}</p>`;
  }
  
  if (inList) {
    html += `</${listType}>`;
  }
  
  return html;
}

function parseMarkdownInline(text) {
  let html = text;
  // bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // inline code
  html = html.replace(/`(.*?)`/g, '<code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');
  return html;
}

function switchTab(tabName) {
  currentTab = tabName;
  
  // Update active button state
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update content panels
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });
  
  const activePanel = document.getElementById(`${tabName}-tab-content`);
  if (activePanel) {
    activePanel.classList.add('active');
    activePanel.style.display = 'block';
  }
  
  // Handle tab-specific loading
  const auditFilter = document.getElementById('filter-audit').value;
  let selectedAuditId = auditFilter;
  if (selectedAuditId === 'all' && currentAudits && currentAudits.length > 0) {
    selectedAuditId = currentAudits[0].id;
  }
  
  if (tabName === 'summary' && selectedAuditId !== 'all') {
    loadAISummary(selectedAuditId);
  } else if (tabName === 'tasks' && selectedAuditId !== 'all') {
    loadAITasks(selectedAuditId);
  } else if (tabName === 'history' && activeProjectId) {
    loadProjectHistory(activeProjectId);
  }
}

async function loadAISummary(auditId) {
  const textDiv = document.getElementById('ai-summary-text');
  const generateBtn = document.getElementById('generate-summary-btn');
  const regenerateBtn = document.getElementById('regenerate-summary-btn');
  const loadingSpan = document.getElementById('summary-loading');
  
  textDiv.style.display = 'none';
  generateBtn.style.display = 'none';
  regenerateBtn.style.display = 'none';
  loadingSpan.style.display = 'none';
  
  if (cachedSummary) {
    textDiv.innerHTML = parseMarkdown(cachedSummary);
    textDiv.style.display = 'block';
    regenerateBtn.style.display = 'inline-block';
    return;
  }
  
  loadingSpan.style.display = 'inline-block';
  try {
    const res = await fetch(`/api/audits/${auditId}/summary`);
    const data = await res.json();
    loadingSpan.style.display = 'none';
    
    if (data.summary) {
      cachedSummary = data.summary;
      cachedTasks = data.tasks; // Pre-cache tasks since they are fetched together
      textDiv.innerHTML = parseMarkdown(cachedSummary);
      textDiv.style.display = 'block';
      regenerateBtn.style.display = 'inline-block';
    } else {
      generateBtn.style.display = 'inline-block';
    }
  } catch (err) {
    loadingSpan.style.display = 'none';
    console.error('Failed to load summary:', err);
    // Show generate button so user can retry — no alert, this is a background load
    generateBtn.style.display = 'inline-block';
  }
}

async function loadAITasks(auditId) {
  const listDiv = document.getElementById('ai-tasks-list');
  const generateBtn = document.getElementById('generate-tasks-btn');
  const regenerateBtn = document.getElementById('regenerate-tasks-btn');
  const loadingSpan = document.getElementById('tasks-loading');
  
  listDiv.style.display = 'none';
  generateBtn.style.display = 'none';
  regenerateBtn.style.display = 'none';
  loadingSpan.style.display = 'none';
  
  if (cachedTasks) {
    renderTasksList(auditId, cachedTasks);
    listDiv.style.display = 'flex';
    regenerateBtn.style.display = 'inline-block';
    return;
  }
  
  loadingSpan.style.display = 'inline-block';
  try {
    const res = await fetch(`/api/audits/${auditId}/summary`);
    const data = await res.json();
    loadingSpan.style.display = 'none';
    
    if (data.tasks) {
      cachedSummary = data.summary;
      cachedTasks = data.tasks;
      renderTasksList(auditId, cachedTasks);
      listDiv.style.display = 'flex';
      regenerateBtn.style.display = 'inline-block';
    } else {
      generateBtn.style.display = 'inline-block';
    }
  } catch (err) {
    loadingSpan.style.display = 'none';
    console.error('Failed to load tasks:', err);
    // Show generate button — no alert on background load failure
    generateBtn.style.display = 'inline-block';
  }
}

async function generateAISummary(auditId, force = false) {
  const generateBtn = document.getElementById('generate-summary-btn');
  const regenerateBtn = document.getElementById('regenerate-summary-btn');
  const generateTasksBtn = document.getElementById('generate-tasks-btn');
  const regenerateTasksBtn = document.getElementById('regenerate-tasks-btn');
  const summaryLoading = document.getElementById('summary-loading');
  const tasksLoading = document.getElementById('tasks-loading');
  const summaryLoadingText = document.getElementById('summary-loading-text');
  const tasksLoadingText = document.getElementById('tasks-loading-text');
  
  const modelNames = { gemini: 'Gemini 2.5 Flash', grok: 'Grok-3 Mini', auto: 'AI' };
  const modelLabel = modelNames[preferredAIModel] || 'AI';

  const activeLoading = currentTab === 'summary' ? summaryLoading : tasksLoading;
  if (summaryLoadingText) summaryLoadingText.textContent = `Generating via ${modelLabel}...`;
  if (tasksLoadingText) tasksLoadingText.textContent = `Analyzing via ${modelLabel}...`;

  generateBtn.style.display = 'none';
  regenerateBtn.style.display = 'none';
  generateTasksBtn.style.display = 'none';
  regenerateTasksBtn.style.display = 'none';
  activeLoading.style.display = 'inline-block';
  
  try {
    const res = await fetch(`/api/audits/${auditId}/ai-summary?model=${preferredAIModel}${force ? '&force=true' : ''}`, { method: 'POST' });
    const data = await res.json();
    activeLoading.style.display = 'none';
    
    if (data.error) {
      // Show inline error + update quota badges (quota errors are common)
      pollAIStatus();
      const isQuota = data.error.toLowerCase().includes('quota') || data.error.toLowerCase().includes('429') || data.error.toLowerCase().includes('rate');
      const errorMsg = isQuota
        ? `⚠️ AI Quota/Rate limit reached. ${preferredAIModel === 'auto' ? 'Both Gemini and Groq are unavailable. Add your GROQ_API_KEY to .env to enable Groq fallback.' : 'Try switching to Auto mode for fallback.'}`
        : `❌ ${data.error}`;
      const textDiv = document.getElementById('ai-summary-text');
      if (textDiv) {
        textDiv.innerHTML = `<div style="padding:16px; background:#450a0a; border:1px solid #991b1b; border-radius:8px; color:#fca5a5;">${errorMsg}</div>`;
        textDiv.style.display = 'block';
      }
      if (currentTab === 'summary') {
        if (cachedSummary) regenerateBtn.style.display = 'inline-block';
        else generateBtn.style.display = 'inline-block';
      } else {
        if (cachedTasks) regenerateTasksBtn.style.display = 'inline-block';
        else generateTasksBtn.style.display = 'inline-block';
      }
      return;
    }
    
    if (data.modelUsed) {
      setActiveModelLabel(data.modelUsed);
      pollAIStatus();
    }

    cachedSummary = data.summary;
    cachedTasks = data.tasks;
    
    if (currentTab === 'summary') {
      loadAISummary(auditId);
    } else {
      loadAITasks(auditId);
    }
  } catch (err) {
    activeLoading.style.display = 'none';
    console.error('Failed to generate summary:', err);
    const textDiv = document.getElementById('ai-summary-text');
    if (textDiv) {
      textDiv.innerHTML = `<div style="padding:16px; background:#1e293b; border:1px solid #334155; border-radius:8px; color:#94a3b8;">⚠️ Network error generating summary. Check that the server is running.</div>`;
      textDiv.style.display = 'block';
    }
    if (currentTab === 'summary') {
      if (cachedSummary) regenerateBtn.style.display = 'inline-block';
      else generateBtn.style.display = 'inline-block';
    } else {
      if (cachedTasks) regenerateTasksBtn.style.display = 'inline-block';
      else generateTasksBtn.style.display = 'inline-block';
    }
  }
}


function renderTasksList(auditId, tasks) {
  const container = document.getElementById('ai-tasks-list');
  container.innerHTML = '';
  
  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<div class="card" style="padding: 20px;">No task recommendations found.</div>';
    return;
  }
  
  tasks.forEach((task) => {
    // Fallback if older tasks lack an id or status
    const taskId = task.id || Math.random().toString(36).substr(2, 9);
    const isCompleted = task.status === 'done';
    
    const card = document.createElement('div');
    card.className = `task-card ${isCompleted ? 'completed' : ''}`;
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '10px';
    card.dataset.taskId = taskId;
    
    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 15px;">
        <input type="checkbox" class="task-card-checkbox" ${isCompleted ? 'checked' : ''} style="margin-top: 5px; transform: scale(1.2);">
        <div class="task-card-content" style="flex: 1;">
          <h4 class="task-card-title" style="margin: 0; margin-bottom: 5px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span>${task.title}</span>
            <span class="task-priority-badge task-priority-${task.priority}">Priority ${task.priority}</span>
            <span class="task-category-badge">${task.category}</span>
          </h4>
          <p class="task-card-description" style="margin: 0; margin-bottom: 10px; color: var(--text-muted); font-size: 0.9rem;">${task.description}</p>
          
          <div style="background: var(--bg); padding: 10px; border-radius: 6px; border: 1px solid var(--border);">
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 5px;">Agent / Resolution Notes:</label>
            <textarea class="task-notes-input sidebar-input" style="width: 100%; min-height: 60px; resize: vertical;" placeholder="Write what was done or let the AI agent fill this in...">${task.agentNotes || ''}</textarea>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
              <button class="secondary-btn prompt-agent-btn" style="padding: 4px 10px; font-size: 0.8rem;">🤖 Prompt Agent</button>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="task-save-status" style="font-size: 0.8rem; color: #10b981; display: none;">Saved!</span>
                <button class="primary-btn save-task-btn" style="padding: 4px 12px; font-size: 0.8rem;">Save Task</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    const checkbox = card.querySelector('.task-card-checkbox');
    const notesInput = card.querySelector('.task-notes-input');
    const saveBtn = card.querySelector('.save-task-btn');
    const statusSpan = card.querySelector('.task-save-status');
    const promptBtn = card.querySelector('.prompt-agent-btn');
    
    // Save logic
    const saveTask = async () => {
      const newStatus = checkbox.checked ? 'done' : 'open';
      const newNotes = notesInput.value;
      
      try {
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
        const res = await fetch(`/api/audits/${auditId}/tasks/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, agentNotes: newNotes })
        });
        if (res.ok) {
          statusSpan.style.display = 'inline';
          setTimeout(() => statusSpan.style.display = 'none', 2000);
          if (newStatus === 'done') card.classList.add('completed');
          else card.classList.remove('completed');
          
          // Update local state without full re-render
          task.status = newStatus;
          task.agentNotes = newNotes;
        } else {
          alert('Failed to save task.');
        }
      } catch (err) {
        console.error('Error saving task:', err);
      } finally {
        saveBtn.textContent = 'Save Task';
        saveBtn.disabled = false;
      }
    };
    
    saveBtn.addEventListener('click', saveTask);
    checkbox.addEventListener('change', saveTask);
    
    // Prompt Agent
    promptBtn.addEventListener('click', () => {
      const currentPathText = document.getElementById('current-local-path-text').textContent;
      const localPathStr = currentPathText ? ` in the local project at ${currentPathText}` : '';
      const promptText = `Agent, please fix this task${localPathStr}:\n\nTask: ${task.title}\nPriority: ${task.priority}\nCategory: ${task.category}\n\nDescription: ${task.description}\n\nWhen you are done, please use the update_action_task tool to mark this task as done and add your resolution notes.`;
      
      navigator.clipboard.writeText(promptText).then(() => {
        const originalText = promptBtn.textContent;
        promptBtn.textContent = '✅ Copied to Clipboard!';
        setTimeout(() => promptBtn.textContent = originalText, 2000);
      });
    });
    
    container.appendChild(card);
  });
}

window.openImageModal = function(src) {
  let modal = document.getElementById('visual-image-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'visual-image-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.85)';
    modal.style.zIndex = '2000';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.cursor = 'zoom-out';
    modal.onclick = () => { modal.style.display = 'none'; };
    
    const img = document.createElement('img');
    img.id = 'visual-image-modal-img';
    img.style.maxWidth = '90%';
    img.style.maxHeight = '90%';
    img.style.borderRadius = '8px';
    img.style.border = '2px solid #fff';
    img.style.boxShadow = '0 5px 15px rgba(0,0,0,0.5)';
    modal.appendChild(img);
    
    document.body.appendChild(modal);
  }
  
  document.getElementById('visual-image-modal-img').src = src;
  modal.style.display = 'flex';
};

window.getAIFix = async function(findingId) {
  const btn = document.getElementById(`propose-fix-btn-${findingId}`);
  const loading = document.getElementById(`propose-fix-loading-${findingId}`);
  const responseDiv = document.getElementById(`ai-fix-response-${findingId}`);
  
  if (btn) btn.style.display = 'none';
  if (loading) {
    loading.style.display = 'block';
    const loadingSpan = loading.querySelector('.spinner-text') || loading;
    if (loadingSpan.querySelector) {
      const txt = loadingSpan.querySelector('span:last-child');
      if (txt && txt.tagName !== 'SPAN') txt.textContent = `Getting fix via ${preferredAIModel === 'auto' ? 'AI' : preferredAIModel}...`;
    }
  }
  if (responseDiv) responseDiv.style.display = 'none';
  
  try {
    const res = await fetch(`/api/findings/${findingId}/propose-fix?model=${preferredAIModel}`, { method: 'POST' });
    const data = await res.json();
    if (loading) loading.style.display = 'none';
    
    if (data.error) {
      alert('Error proposing fix: ' + data.error);
      if (btn) btn.style.display = 'block';
      return;
    }
    
    if (data._modelUsed) {
      setActiveModelLabel(data._modelUsed);
      pollAIStatus();
    }

    let html = `<p><strong>Explanation:</strong> ${data.explanation}</p>`;

    if (data.has_file_fix && data.file_path) {
      // Highlight code difference or show side-by-side
      const escapedFilePath = data.file_path.replace(/\\/g, '\\\\');
      const escapedOriginal = data.original_code.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      const escapedReplacement = data.replacement_code.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      
      html += `
        <div style="margin-top: 10px;">
          <p><strong>Target File:</strong> <code style="word-break: break-all;">${data.file_path}</code></p>
          <div style="display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 5px;">
            <div>
              <label style="font-size: 0.85em; color: #f87171; font-weight: bold;">Original Code:</label>
              <pre style="background: #271c1c; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; border: 1px solid #5a3a3a; max-height: 200px; margin: 4px 0 10px 0;"><code style="color: #fca5a5;">${data.original_code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
            </div>
            <div>
              <label style="font-size: 0.85em; color: #4ade80; font-weight: bold;">Replacement Code:</label>
              <pre style="background: #1c271c; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; border: 1px solid #3a5a3a; max-height: 200px; margin: 4px 0 10px 0;"><code style="color: #a7f3d0;">${data.replacement_code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
            </div>
          </div>
          <button onclick="applyAIFix(${findingId}, '${escapedFilePath.replace(/'/g, "\\'")}', \`${escapedOriginal}\`, \`${escapedReplacement}\`)" id="apply-fix-btn-${findingId}" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; display: inline-flex; align-items: center; gap: 5px;">
            Apply Fix Directly
          </button>
          <span id="apply-fix-loading-${findingId}" class="spinner-text" style="display: none; margin-left: 10px; font-size: 0.9em; vertical-align: middle;">
            <span class="spinner inline-spinner" style="display: inline-block;"></span> Applying...
          </span>
        </div>
      `;
    } else {
      // Suggest copy-paste
      const escapedOriginal = data.original_code ? data.original_code.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      const escapedReplacement = data.replacement_code ? data.replacement_code.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      
      html += `
        <div style="margin-top: 10px; border-top: 1px solid #334155; padding-top: 10px;">
          <p style="color: #94a3b8; font-size: 0.9em; margin-bottom: 5px;">⚠️ No local project mapping found. Copy and paste the suggested patch:</p>
          ${escapedOriginal ? `
            <label style="font-size: 0.85em; color: #94a3b8;">Find:</label>
            <pre style="background: #1e1e1e; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; margin: 4px 0 10px 0;"><code style="color: #f43f5e;">${escapedOriginal}</code></pre>
          ` : ''}
          ${escapedReplacement ? `
            <label style="font-size: 0.85em; color: #94a3b8;">Replace with:</label>
            <pre style="background: #1e1e1e; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.8em; margin: 4px 0 10px 0;"><code style="color: #10b981;">${escapedReplacement}</code></pre>
          ` : ''}
        </div>
      `;
    }
    
    if (responseDiv) {
      responseDiv.innerHTML = html;
      responseDiv.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    alert('Failed to get AI fix recommendation');
    if (btn) btn.style.display = 'block';
  }
};

window.applyAIFix = async function(findingId, filePath, originalCode, replacementCode) {
  const btn = document.getElementById(`apply-fix-btn-${findingId}`);
  const loading = document.getElementById(`apply-fix-loading-${findingId}`);
  
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'inline-block';
  
  try {
    const res = await fetch(`/api/findings/${findingId}/apply-fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        original_code: originalCode,
        replacement_code: replacementCode
      })
    });
    
    const data = await res.json();
    if (loading) loading.style.display = 'none';
    
    if (data.success) {
      alert('Fix applied successfully to your local source file!');
      const statusSelect = document.getElementById(`status-${findingId}`);
      if (statusSelect) statusSelect.value = 'fixed';
      
      const badge = document.getElementById(`status-badge-${findingId}`);
      if (badge) {
        badge.className = 'badge fixed';
        badge.textContent = 'fixed';
      }
      
      const finding = currentFindings.find(f => f.id === findingId);
      if (finding) {
        finding.status = 'fixed';
        finding.notes = (finding.notes || '') + '\n[AI] Applied code fix automatically.';
      }
      
      const notesArea = document.getElementById(`notes-${findingId}`);
      if (notesArea) notesArea.value = finding ? finding.notes : '';
      
      // Auto-trigger Verification to check if it succeeded
      verifyFindingFix(findingId);
    } else {
      alert('Failed to apply fix: ' + (data.error || 'Unknown error'));
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    alert('Error applying AI fix');
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;
  }
};

window.verifyFindingFix = async function(findingId) {
  const btn = document.getElementById(`verify-fix-btn-${findingId}`);
  const loading = document.getElementById(`verify-loading-${findingId}`);
  const msgSpan = document.getElementById(`verify-status-msg-${findingId}`);
  
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'inline-block';
  if (msgSpan) {
    msgSpan.textContent = '';
    msgSpan.className = '';
  }
  
  try {
    const res = await fetch(`/api/findings/${findingId}/verify-fix`, { method: 'POST' });
    const data = await res.json();
    
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;
    
    if (data.error) {
      if (msgSpan) {
        msgSpan.textContent = 'Verification error: ' + data.error;
        msgSpan.style.color = '#ef4444';
      }
      return;
    }
    
    if (data.isFixed) {
      if (msgSpan) {
        msgSpan.textContent = '✓ Fix Verified! Finding resolved.';
        msgSpan.style.color = '#10b981';
      }
      
      const statusSelect = document.getElementById(`status-${findingId}`);
      if (statusSelect) statusSelect.value = 'fixed';
      
      const badge = document.getElementById(`status-badge-${findingId}`);
      if (badge) {
        badge.className = 'badge fixed';
        badge.textContent = 'fixed';
      }
      
      const finding = currentFindings.find(f => f.id === findingId);
      if (finding) finding.status = 'fixed';
    } else {
      if (msgSpan) {
        msgSpan.textContent = '✗ Fix verification failed: ' + (data.details || 'Issue still detected.');
        msgSpan.style.color = '#ef4444';
      }
    }
  } catch (err) {
    console.error(err);
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;
    if (msgSpan) {
      msgSpan.textContent = 'Network error during verification';
      msgSpan.style.color = '#ef4444';
    }
  }
};

async function loadProjectHistory(projectId) {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;
  
  try {
    const res = await fetch(`/api/projects/${projectId}/history`);
    const history = await res.json();
    
    if (historyChartInstance) {
      historyChartInstance.destroy();
      historyChartInstance = null;
    }
    
    if (!history || history.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No history data available for this project yet. Run audits first!', canvas.width / 2, canvas.height / 2);
      return;
    }
    
    const labels = history.map(h => {
      const date = new Date(h.started_at);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    
    const perfData = history.map(h => h.lighthouse_perf !== null ? Math.round(h.lighthouse_perf * 100) : null);
    const a11yData = history.map(h => h.lighthouse_a11y !== null ? Math.round(h.lighthouse_a11y * 100) : null);
    const seoData = history.map(h => h.lighthouse_seo !== null ? Math.round(h.lighthouse_seo * 100) : null);
    
    const ctx = canvas.getContext('2d');
    historyChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Performance',
            data: perfData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointBackgroundColor: '#10b981',
            pointRadius: 4,
            spanGaps: true
          },
          {
            label: 'Accessibility',
            data: a11yData,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointBackgroundColor: '#6366f1',
            pointRadius: 4,
            spanGaps: true
          },
          {
            label: 'SEO',
            data: seoData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointBackgroundColor: '#f97316',
            pointRadius: 4,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#e2e8f0',
              font: {
                family: 'system-ui, -apple-system, sans-serif',
                size: 12
              }
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(71, 85, 105, 0.2)'
            },
            ticks: {
              color: '#94a3b8',
              maxRotation: 45,
              minRotation: 0
            }
          },
          y: {
            min: 0,
            max: 100,
            grid: {
              color: 'rgba(71, 85, 105, 0.2)'
            },
            ticks: {
              color: '#94a3b8'
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to load project history chart:', err);
  }
}

// ── Local Path Editing ──────────────────────────────────────────────────────────

window.editLocalPath = function() {
  document.getElementById('project-local-path-display').style.display = 'none';
  document.getElementById('edit-local-path-form').style.display = 'flex';
};

window.cancelEditLocalPath = function() {
  document.getElementById('project-local-path-display').style.display = 'flex';
  document.getElementById('edit-local-path-form').style.display = 'none';
};

document.getElementById('edit-local-path-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeProjectId) return;
  
  const input = document.getElementById('edit-local-path-input');
  const btn = e.target.querySelector('button[type="submit"]');
  const newPath = input.value.trim();
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  try {
    const res = await fetch(`/api/projects/${activeProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_path: newPath })
    });
    
    if (res.ok) {
      // Reload projects to get the updated data in the sidebar 
      // but preserve the current active project view
      await loadProjects();
      
      // Update the inline display
      const localPathText = document.getElementById('current-local-path-text');
      if (newPath) {
        localPathText.textContent = newPath;
        localPathText.style.color = '';
      } else {
        localPathText.textContent = 'None';
        localPathText.style.color = '#6b7280';
      }
      
      cancelEditLocalPath();
    } else {
      alert('Failed to update local path');
    }
  } catch (err) {
    console.error(err);
    alert('Error updating local path');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});
