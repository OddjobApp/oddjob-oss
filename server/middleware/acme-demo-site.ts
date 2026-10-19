/**
 * Acme Operations Command - Deployed Live Demo Site with Form Builder & Identity Bridge Harness
 * 
 * Provides an authentic, interactive web application with:
 * 1. Industrial Operations Dashboard (KPIs, active workloads, latency)
 * 2. Deployed Form Builder (Live Form Runner + Form Studio Schema Customizer)
 * 3. Oddjob Prospector Identity Bridge Harness (real-time zero-party de-anonymization & Kafka outbox)
 */

export function renderAcmeOpsCommandDemoSite(slug: string = "acme-ops-command-00y63"): string {
  const propertyUid = "prp_c3cdec43-b853-4f8a-9660-a92b9f05e003";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Acme Operations Command | Deployed Form Builder Demo</title>
  <!-- Oddjob Identity Bridge & Prospector Client Harness -->
  <script src="/oddjob-prospector.js" data-property-uid="${propertyUid}" data-debug="true"></script>
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --card-border: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #8b5cf6;
      --primary-hover: #7c3aed;
      --emerald: #10b981;
      --amber: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 0;
      margin: 0;
      min-height: 100vh;
    }
    header {
      background: #0d1322;
      border-bottom: 1px solid var(--card-border);
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(139, 92, 246, 0.15);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.3);
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .badge.green {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.3);
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
    .kpi-value { font-size: 22px; font-weight: 700; color: #fff; }
    .kpi-hint { font-size: 11px; color: #34d399; }
    
    .layout-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 24px;
    }
    @media (max-width: 860px) {
      .layout-grid { grid-template-columns: 1fr; }
    }
    
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 12px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .tabs {
      display: flex;
      gap: 8px;
      background: rgba(0,0,0,0.25);
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--primary);
      color: #fff;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }
    label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
    }
    input, select, textarea {
      width: 100%;
      background: #090d16;
      border: 1px solid #26334d;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 13px;
      color: #fff;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
    }
    .btn-secondary:hover { background: #334155; }
    
    .quick-fills {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .pill-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      color: #cbd5e1;
      cursor: pointer;
    }
    .pill-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    
    .hud-terminal {
      background: #060910;
      border: 1px solid #1a2234;
      border-radius: 10px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #38bdf8;
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .log-line { display: flex; gap: 8px; }
    .log-time { color: #64748b; }
    .log-green { color: #34d399; }
    .log-purple { color: #c084fc; }
    .log-amber { color: #fbbf24; }

    .result-box {
      border: 1px solid rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.08);
      border-radius: 10px;
      padding: 14px;
      display: none;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      Acme Operations Command
      <span class="badge">v2.4 Live Archetype</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <span class="badge green">
        <span class="dot"></span> Identity Bridge Active
      </span>
      <a href="/armory/identity-bridge" target="_blank" style="color: #94a3b8; font-size: 12px; text-decoration: none; display: flex; align-items: center; gap: 4px;">
        View Armory Leads ↗
      </a>
    </div>
  </header>

  <div class="container">
    <!-- Industrial KPIs -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Active Workloads</div>
        <div class="kpi-value">42 Micro-VMs</div>
        <div class="kpi-hint">Isolated Tenant Network</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Global Fleet Latency</div>
        <div class="kpi-value">14ms</div>
        <div class="kpi-hint">Edge CDN Route</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Telemetry SLA</div>
        <div class="kpi-value">99.98%</div>
        <div class="kpi-hint">No dropped signals</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">S.C.O.R.E. Intent Pressure</div>
        <div class="kpi-value" id="kpi-score">Need: 9.1 • Budget: 8.4</div>
        <div class="kpi-hint" style="color: #c084fc;">Real-Time Visitor Scoring</div>
      </div>
    </div>

    <!-- Main Content Grid -->
    <div class="layout-grid">
      <!-- Left: Deployed Form Builder -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Deployed Form Builder: Enterprise Tier Request
          </div>
          <div class="tabs">
            <button class="tab-btn active" id="tab-runner" onclick="switchTab('runner')">Live Form Runner</button>
            <button class="tab-btn" id="tab-customizer" onclick="switchTab('customizer')">Form Studio Editor</button>
          </div>
        </div>

        <!-- Tab 1: Live Form Runner -->
        <div id="view-runner">
          <div class="quick-fills">
            <span>Quick Persona Pre-fills:</span>
            <button class="pill-btn" onclick="fillPersona('sarah')">Sarah Chen (VP Eng @ Vertex Financial)</button>
            <button class="pill-btn" onclick="fillPersona('david')">David Park (CTO @ Quantum Cloud)</button>
          </div>

          <form id="enterprise-form" onsubmit="handleFormSubmit(event)">
            <div class="form-row">
              <div class="form-group">
                <label for="form-name">Full Name *</label>
                <input id="form-name" type="text" required placeholder="e.g. Sarah Chen" />
              </div>
              <div class="form-group">
                <label for="form-email">Work Email *</label>
                <input id="form-email" type="email" required placeholder="s.chen@vertex.io" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="form-role">Job Role *</label>
                <select id="form-role" required>
                  <option value="VP Engineering">VP Engineering</option>
                  <option value="Chief Technology Officer">Chief Technology Officer</option>
                  <option value="Principal Solutions Architect">Principal Solutions Architect</option>
                  <option value="Head of Infrastructure">Head of Infrastructure</option>
                </select>
              </div>
              <div class="form-group">
                <label for="form-company">Company / Account *</label>
                <input id="form-company" type="text" required placeholder="Vertex Financial" />
              </div>
            </div>

            <div class="form-group">
              <label for="form-budget">Target Compute / Annual AI Spend</label>
              <select id="form-budget">
                <option value="$50,000 - $250,000 / yr">$50,000 - $250,000 / yr (Tier 2)</option>
                <option value="$250,000+ / yr" selected>$250,000+ / yr (Tier 3 Enterprise Dedicated)</option>
                <option value="Custom Multi-Region SLA">Custom Multi-Region Private VPC</option>
              </select>
            </div>

            <div class="form-group">
              <label for="form-notes">Technical Requirements & Objectives</label>
              <textarea id="form-notes" rows="2" placeholder="Evaluating Oddjob 5-layer control plane, Trycua sandboxes, and CREW agent swarms."></textarea>
            </div>

            <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px;">
              <button type="submit" class="btn" id="btn-submit" data-testid="form-submit-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Submit & De-anonymize Lead
              </button>
              <span style="font-size: 11px; color: var(--text-muted);">
                Triggers <code>window.OddjobProspector.identify()</code>
              </span>
            </div>
          </form>

          <!-- Result Success Banner -->
          <div class="result-box" id="result-box" style="margin-top: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <strong style="color: #34d399; display: flex; align-items: center; gap: 6px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Identity Resolved & Kafka Outbox Event Enqueued!
              </strong>
              <span class="badge green" id="res-lead-id">Lead Resolved</span>
            </div>
            <p id="res-desc" style="color: #e2e8f0;"></p>
            <div style="display: flex; gap: 8px; margin-top: 4px;">
              <a href="/armory/identity-bridge" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 6px 12px;">
                Open Armory Leads Dashboard ↗
              </a>
            </div>
          </div>
        </div>

        <!-- Tab 2: Form Studio Customizer -->
        <div id="view-customizer" style="display: none; flex-direction: column; gap: 14px;">
          <div style="font-size: 12px; color: var(--text-muted);">
            Oddjob Form Studio Schema Editor. Add or modify fields rendered by this deployed form:
          </div>

          <div id="schema-fields-list" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--card-border);">
              <span style="font-size: 12px; font-weight: 600;">1. Full Name (text, required)</span>
              <span class="badge">Canonical</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--card-border);">
              <span style="font-size: 12px; font-weight: 600;">2. Work Email (email, required)</span>
              <span class="badge">Identity Primary</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--card-border);">
              <span style="font-size: 12px; font-weight: 600;">3. Role (select)</span>
              <span class="badge">BANT: Authority</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--card-border);">
              <span style="font-size: 12px; font-weight: 600;">4. Budget Tier (select)</span>
              <span class="badge">BANT: Budget</span>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button class="btn btn-secondary" onclick="addCustomField()">+ Add Custom Question Field</button>
            <button class="btn" onclick="switchTab('runner')">Save & Return to Form Runner</button>
          </div>
        </div>
      </div>

      <!-- Right: Real-Time Identity Bridge & Kafka HUD -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Live Identity Bridge & Kafka Inspector
          </div>
          <span class="badge">Topic: spatial.signal.v1</span>
        </div>

        <div style="font-size: 12px; color: var(--text-muted);">
          Inspect telemetry handshakes streamed from this page directly to PostgreSQL and the transactional Kafka Outbox:
        </div>

        <div class="hud-terminal" id="terminal-feed">
          <div class="log-line">
            <span class="log-time">[00:00.1]</span>
            <span class="log-green">[INIT]</span>
            <span>oddjob-prospector.js loaded on Acme Ops Command</span>
          </div>
          <div class="log-line">
            <span class="log-time">[00:00.2]</span>
            <span class="log-purple">[PROPERTY]</span>
            <span>Bound to ${propertyUid}</span>
          </div>
          <div class="log-line">
            <span class="log-time">[00:00.3]</span>
            <span class="log-green">[TRACK]</span>
            <span>Anonymous visitor session registered</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-muted); padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div>• <strong>Zero-Party Fusion:</strong> Form submits commit directly to <code>prospect_profiles</code> and <code>prospect_leads</code>.</div>
          <div>• <strong>Kafka Transactional Outbox:</strong> Writes <code>spatial.signal.v1:observation</code> atomic with merge.</div>
          <div>• <strong>CREW Agent Handoff:</strong> SDR Pilot awakens with de-anonymized BANT vector.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function logHud(tag, msg, colorClass = 'log-green') {
      const feed = document.getElementById('terminal-feed');
      const now = new Date();
      const timeStr = '[' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0') + '.' + Math.floor(now.getMilliseconds() / 100) + ']';
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = '<span class="log-time">' + timeStr + '</span> <span class="' + colorClass + '">[' + tag + ']</span> <span>' + msg + '</span>';
      feed.appendChild(line);
      feed.scrollTop = feed.scrollHeight;
    }

    function switchTab(tab) {
      if (tab === 'runner') {
        document.getElementById('view-runner').style.display = 'block';
        document.getElementById('view-customizer').style.display = 'none';
        document.getElementById('tab-runner').classList.add('active');
        document.getElementById('tab-customizer').classList.remove('active');
      } else {
        document.getElementById('view-runner').style.display = 'none';
        document.getElementById('view-customizer').style.display = 'flex';
        document.getElementById('tab-runner').classList.remove('active');
        document.getElementById('tab-customizer').classList.add('active');
        logHud('STUDIO', 'Opened Form Builder schema customizer', 'log-purple');
      }
    }

    function fillPersona(persona) {
      if (persona === 'sarah') {
        document.getElementById('form-name').value = 'Sarah Chen';
        document.getElementById('form-email').value = 'sarah.chen@vertex.io';
        document.getElementById('form-role').value = 'VP Engineering';
        document.getElementById('form-company').value = 'Vertex Financial';
        document.getElementById('form-budget').value = '$250,000+ / yr';
        document.getElementById('form-notes').value = 'Need dedicated micro-VM sandbox clusters and transactional Kafka outbox relays.';
        logHud('PREFILL', 'Autofilled Sarah Chen (VP Engineering @ Vertex Financial)', 'log-amber');
      } else {
        document.getElementById('form-name').value = 'David Park';
        document.getElementById('form-email').value = 'david.park@quantumcloud.ai';
        document.getElementById('form-role').value = 'Chief Technology Officer';
        document.getElementById('form-company').value = 'Quantum Cloud AI';
        document.getElementById('form-budget').value = '$50,000 - $250,000 / yr';
        document.getElementById('form-notes').value = 'Evaluating automated agent handoff for incoming enterprise prospects.';
        logHud('PREFILL', 'Autofilled David Park (CTO @ Quantum Cloud AI)', 'log-amber');
      }
    }

    function addCustomField() {
      const fieldName = prompt('Enter field label:', 'Security Compliance Tier (SOC2, HIPAA, FedRAMP)');
      if (!fieldName) return;
      const list = document.getElementById('schema-fields-list');
      const item = document.createElement('div');
      item.style = 'display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--card-border);';
      item.innerHTML = '<span style="font-size: 12px; font-weight: 600;">Custom: ' + fieldName + ' (text)</span> <span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399;">Added</span>';
      list.appendChild(item);
      logHud('SCHEMA', 'Added custom question field: ' + fieldName, 'log-purple');
    }

    async function handleFormSubmit(e) {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Resolving Identity & Streaming to Kafka...';

      const name = document.getElementById('form-name').value;
      const email = document.getElementById('form-email').value;
      const role = document.getElementById('form-role').value;
      const company = document.getElementById('form-company').value;
      const budget = document.getElementById('form-budget').value;
      const notes = document.getElementById('form-notes').value;

      logHud('IDENTIFY', 'Triggering window.OddjobProspector.identify() for ' + email, 'log-purple');

      const userId = 'usr_' + email.replace(/[^a-zA-Z0-9]/g, '_');

      try {
        // 1. Call OddjobProspector Client SDK if present
        if (window.OddjobProspector && typeof window.OddjobProspector.identify === 'function') {
          window.OddjobProspector.identify(userId, { name, email, role, company, budget, notes });
        }

        // 2. Direct API call to backend /api/prospecting/identify
        const res = await fetch('/api/prospecting/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyUid: '${propertyUid}',
            prospectUid: 'anon_' + Date.now(),
            userId: userId,
            email: email,
            metadata: {
              name,
              role,
              account: company,
              budgetTier: budget,
              notes,
              source: 'Acme Operations Command (Deployed Form Builder)',
            }
          })
        });

        const data = await res.json();
        logHud('API', 'POST /api/prospecting/identify completed (200 OK)', 'log-green');
        logHud('KAFKA', 'Kafka Outbox Event enqueued: spatial.signal.v1 (identity.resolved)', 'log-purple');
        logHud('CREW', 'Lead signal dispatched to CREW War Room for account synthesis', 'log-green');

        // Show result box
        const resultBox = document.getElementById('result-box');
        resultBox.style.display = 'flex';
        document.getElementById('res-lead-id').innerText = data.leadId ? 'Lead #' + data.leadId : 'Resolved';
        document.getElementById('res-desc').innerHTML = 'Successfully resolved <strong>' + name + '</strong> (' + role + ' @ ' + company + '). Anonymous browsing signals merged with master record, and transactional Kafka event published.';

        document.getElementById('kpi-score').innerText = 'Need: 9.8 • Budget: 9.4 (Max)';
      } catch (err) {
        logHud('ERROR', 'Identification failed: ' + String(err), 'log-amber');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Submit & De-anonymize Lead';
      }
    }
  </script>
</body>
</html>`;
}
