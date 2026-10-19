# Autonomous Operator & Reflexion Engine (AORE)
## Multi-Channel Zero-UI Gateways, Verbal Episodic Self-Healing, and Governed Outbound IVR Execution

**Document Version:** 1.0.0  
**Status:** Approved for Design & Specifications  
**Author:** Oddjob Core Engineering & AI Architecture  
**Target Milestone:** Platform Horizon 2026.Q4  
**Classification:** Strategic Architecture Proposal & Engineering Blueprint  
**Primary Impact Domains:** `server/domain/integrations/trycua/`, `server/domain/crew/`, `server/domain/telephony/`, `server/domain/governor/`, `shared/product/`

> ## Implementation Status (2026-10, verified against code)
>
> | Pillar | Status | Where it actually lives |
> | :--- | :--- | :--- |
> | 1. Zero-UI omnichannel | **Partially shipped.** Slack/WhatsApp/Telegram inbound already ran through `server/routes/messaging-webhooks.ts` → `conversational-bridge.service.ts` before this proposal. Now wired: `omnichannel.service.ts` pairing (6-digit code, 10-min expiry, `timingSafeEqual`), authenticated routes at `/api/channels/identities`, inbound SMS at both `/api/webhooks/messaging/sms` and the documented `/api/channels/twilio/inbound-sms` (HMAC-SHA1 signature check, fail-closed in production), and an `sms` platform path in the bridge with the verified identity as connector/user source. | `server/domain/integrations/core/omnichannel.service.ts`, `server/routes/channels/omnichannel.ts`, `server/routes/messaging-webhooks.ts` |
> | 2. Verbal episodic reflexion | **Shipped, heuristic form.** Invoked inside the learned-skill replay loop and persisted to `computer_use_reflexion_buffer`; critiques are template/selector-heuristic driven rather than an LLM verbal-critic pass. | `server/domain/integrations/trycua/reflexion.ts`, `learned-skills.service.ts`, `POST|GET /skills/:id/reflexion` |
> | 3. Governed outbound IVR telephony | **Not started.** No `server/domain/telephony/`, no `telephony_session_runs` migration, no media-stream bridge. | — |
> | 4. Mobile-first HIL solver | **Weak.** Task pause + push and the approval inbox exist; the single-use 90-second MMS solver link does not (it depended on the identity binding now in place). | `computer-use-pause-push`, approval inbox |
>
> Instinct-side facts have also moved: reporting after this proposal was drafted puts the raise at ~$1B Series C / ~$10B valuation. Its two sharpest differentiators — a trusted agent-to-agent network and a take-rate on transacted commerce — are not covered by any pillar here.

---

## 1. Executive Summary & Problem Statement

### 1.1 Context: The Emergence of Instinct AI
In mid-2026, **Instinct AI** (developed by Spear Street Technology, Inc., led by Noah Shinn, author of the seminal NeurIPS 2023 paper *Reflexion*) raised $350M at a $2.5B valuation, popularizing the **"Autonomous Personal Operator"** category. Instinct demonstrated three major consumer and prosumer breakthroughs:
1. **"Zero-UI" Omnichannel Operations**: Eliminating desktop dashboards entirely in favor of continuous, low-friction interactions over SMS, iMessage, WhatsApp, and phone calls.
2. **Action-Over-Advice**: Agents don't advise users on how to resolve tasks; they log in, click, type, and call external parties to finish tasks end-to-end.
3. **Reflexion-Based Self-Correction**: Agents verbally critique their own intermediate failures into an episodic memory buffer, dynamically adjusting their execution trajectories without human intervention.

### 1.2 The Enterprise Gap in Instinct's Paradigm
While Instinct captured massive consumer traction, its underlying architecture is fundamentally incompatible with enterprise and regulated environments:
- **Unbounded Authority ("Power of Attorney")**: Users grant the agent raw credentials, passwords, and unfettered credit card access.
- **Black-Box Cloud VMs**: No granular role-based access control (RBAC), no W3C distributed tracing, no deterministic step replay, and no forensic audit trails.
- **Data Privacy & Keystroke Leakage**: Keystrokes, session cookies, and personal communications are logged and retained in persistent VM contexts, triggering severe regulatory and compliance concerns.

### 1.3 The Oddjob Opportunity
Oddjob possesses the foundational primitives that Instinct lacks: a **5-Layer Governed Control Plane**, deterministic **Playwright DevTools Protocol (CDP)** replay, cryptographic secret redaction, multi-agent CREW deliberation, and the **Knowledge Garden RAG**. 

This proposal specifies the **Autonomous Operator & Reflexion Engine (AORE)**, incorporating Instinct’s primary strengths into Oddjob's zero-trust enterprise architecture:
1. **Zero-UI Omnichannel Gateway**: Inbound/outbound SMS, WhatsApp, and Telegram dispatchers that bind mobile identities to organization-scoped CREW rooms.
2. **Verbal Episodic Reflexion Loop**: Embedding Noah Shinn’s Reflexion architecture into `learned-skills.service.ts` and `computer-use-task.service.ts` to allow autonomous self-healing when DOM locators or visual layouts shift.
3. **Governed Outbound Voice & IVR Navigator**: Outbound phone call execution via Twilio and streaming audio LLMs to navigate phone trees, dispute vendor invoices, and negotiate services under strict financial budget caps.
4. **Mobile-First Out-of-Band HIL Solver**: Pushing ephemeral visual CAPTCHA and 2FA challenges directly to mobile messaging channels for 1-tap human resolution.

---

## 2. System Architecture & Information Flow

```
                                 ┌────────────────────────────────────────────────────────┐
                                 │                 OMNICHANNEL INGRESS                    │
                                 │        (Twilio SMS / WhatsApp, Telegram, Voice)         │
                                 └───────────────────────────┬────────────────────────────┘
                                                             │
                                                             ▼
                                 ┌────────────────────────────────────────────────────────┐
                                 │              SECURE CHANNEL ROUTER                     │
                                 │    - Phone-to-Org Identity Cryptographic Binding       │
                                 │    - E.164 Identity Attestation & Magic Auth Token     │
                                 └───────────────────────────┬────────────────────────────┘
                                                             │
                                     ┌───────────────────────┴───────────────────────┐
                                     │                                               │
                                     ▼                                               ▼
     ┌────────────────────────────────────────────────────────┐  ┌───────────────────────────────────────────────┐
     │                  CREW ROOM HEADLESS DISPATCH           │  │       GOVERNED OUTBOUND IVR ENGINE            │
     │ - Inbound Turn Normalization                           │  │ - Twilio Streaming Media Bridge (WebSockets)  │
     │ - Slash Command Parser (/teach, /plan, /run)           │  │ - DTMF Keypad Audio Synthesizer               │
     │ - Speaker Triage & Consensus Deliberation              │  │ - Hold-Music / Human Speech Detector          │
     └───────────────────────────────┬────────────────────────┘  └───────────────────────┬───────────────────────┘
                                     │                                                   │
                                     ▼                                                   ▼
     ┌───────────────────────────────────────────────────────────────────────────────────────────┐
     │                         5-LAYER GOVERNED CONTROL PLANE                                    │
     │ - Zero-Trust Credential Redaction (Passwords, OTPs, Payments NEVER leak to LLMs)          │
     │ - Out-of-Band Mobile HIL Attestation (Visual CAPTCHA / 2FA Screenshot Push)               │
     │ - Budget Cap Enforcement (Max Financial Commitments per Call / Session)                   │
     └───────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                     │
                                                     ▼
     ┌───────────────────────────────────────────────────────────────────────────────────────────┐
     │                      TRYCUA DESKTOP & REFLEXION ENGINE                                    │
     │                                                                                           │
     │   ┌──────────────────────────┐    Step Failure     ┌───────────────────────────────────┐  │
     │   │      Actor Agent         ├────────────────────►│       Reflexion Evaluator         │  │
     │   │  (Playwright Replay /    │                     │  (DOM Delta + Visual Diff Critic) │  │
     │   │   Gemini Vision Loop)    │◄────────────────────┤                                   │  │
     │   └────────────┬─────────────┘    Modified Action  └─────────────────┬─────────────────┘  │
     │                │                                                     │                    │
     │                │                                                     ▼                    │
     │                │                                   ┌───────────────────────────────────┐  │
     │                │                                   │     Episodic Reflexion Memory     │  │
     │                │                                   │ (Learned Skill Healing Buffer)    │  │
     │                │                                   └───────────────────────────────────┘  │
     │                ▼                                                                          │
     │   ┌──────────────────────────┐                                                            │
     │   │  Oddjob CUA Container    │                                                            │
     │   │  (Isolated Per Org)      │                                                            │
     │   └──────────────────────────┘                                                            │
     └───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Pillar 1: "Zero-UI" Omnichannel Messaging Gateway

### 3.1 Identity Binding & Multi-Tenant Authentication
Enterprise operators must not be required to log in through a web browser to initiate workflows or review blockers. The Omnichannel Gateway maps external messaging identifiers (E.164 phone numbers, Telegram user IDs) directly to Oddjob authenticated accounts:

1. **Identity Pairing Protocol**:
   - A user enrolls their phone number in **Settings → Profile → Mobile Channels**.
   - Oddjob transmits a 6-digit cryptographic pairing code via SMS.
   - Upon verification, the mapping `{ phoneNumber, organizationId, userId, verifiedAt }` is committed to `omnichannel_identities`.
2. **Inbound Message Normalization**:
   - Webhook ingress at `POST /api/channels/twilio/inbound-sms` and `POST /api/channels/whatsapp/webhook`.
   - Validates HMAC signatures (`X-Twilio-Signature`) using tenant-specific or platform credentials.
   - Maps sender to active CREW room or spawns an ephemeral mobile session.

### 3.2 In-Chat Command & Teach Execution
The mobile interface supports natural conversation and direct execution:
- **Natural Language Tasking**: *"Book the 7:15 AM flight to SFO on United and put it on my calendar."* $\to$ Spawns durable mission with budget ceiling.
- **Mobile Slash Commands**:
  - `/teach [goal]`: Activates an isolated Trycua session and transmits an authenticated temporary viewer URL to the user's phone for remote demonstration.
  - `/status`: Returns live blackboard progress of active missions.
  - `/approve [decisionId]`: Instantly satisfies a pending Human-in-the-Loop decision.

---

## 4. Core Pillar 2: Verbal Episodic Reflexion Engine

### 4.1 Theoretical Foundation: The Reflexion Architecture
Based on Noah Shinn et al. (NeurIPS 2023), traditional Reinforcement Learning requires millions of environment steps and reward tuning. *Reflexion* instead uses **linguistic feedback**:
$$\text{Trajectory}_t = (s_0, a_0, r_0, \dots, s_n, a_n, r_n)$$
$$\text{Critique}_t = \text{Evaluator}(\text{Trajectory}_t, \text{Goal})$$
$$\text{Memory}_{t+1} = \text{Memory}_t \cup \{\text{Critique}_t\}$$
$$\text{Action}_{t+1} = \text{Actor}(\text{State}, \text{Goal}, \text{Memory}_{t+1})$$

In Oddjob, this is applied directly to **Playwright Replay and Computer Use Self-Healing**.

### 4.2 Application to Learned Skills & DOM Drift
When an active learned skill replays against a live website:
1. **Detection of Locator Rot**:
   - Step $i$ attempts `locatorCandidates` (TestID $\to$ Role $\to$ Label $\to$ Placeholder $\to$ CSS).
   - If all candidate locators time out or match ambiguously (>1 elements), or if the page transitions to an unexpected error state, replay pauses.
2. **The Reflexion Evaluator**:
   - Compares previous successful DOM snapshot with current broken DOM state and visual screenshot.
   - Generates a **Verbal Critique**:
     ```text
     "Failure in step 3 (Click 'Checkout'): The button with text 'Checkout' was obscured 
     by a high z-index modal dialog (#cookie-banner-accept). The action failed because 
     the page required cookie dismissal first.
     Next trial heuristic: Dismiss the banner with '#cookie-banner-accept' before clicking 'Checkout'."
     ```
3. **Episodic Memory Buffer Injection**:
   - The critique is written to `computer_use_reflexion_buffer` keyed by `(skillId, stepIndex, urlHostname)`.
   - On the retry attempt, the prompt for the fallback VLM or Playwright execution includes the episodic reflection.
   - Once successfully remediated, the repaired target descriptor is permanently updated via `repairTarget` in the database.

---

## 5. Core Pillar 3: Governed Outbound Telephony & IVR Phone Tree Navigator

### 5.1 Business Scope
Many mission-critical business operations cannot be automated via APIs or web browsers because they are gated behind customer service telephone lines:
- Negotiating utility / telecom corporate contract rates.
- Checking real-time status of freight shipments with dispatchers.
- Canceling vendor software subscriptions requiring verbal confirmation.
- Disputing commercial credit card chargebacks.

### 5.2 Technical Architecture
The Outbound Telephony Engine combines **Twilio Media Streams (WebSockets)**, **Gemini Live Multimodal Audio (Bidi-Streaming)**, and a **Dual-Agent Supervisor**:

```
 ┌──────────────┐     Bidirectional Audio (PCM 8kHz)     ┌────────────────────────────┐
 │ Twilio Voice ├────────────────────────────────────────►│  Oddjob Streaming Audio   │
 │ Gateway      │◄────────────────────────────────────────┤  Bridge (WebSocket)        │
 └──────┬───────┘                                        └─────────────┬──────────────┘
        │                                                              │
        │ Telephony Signals (DTMF, Silence)                            │ Audio Frames
        ▼                                                              ▼
 ┌──────────────┐                                        ┌────────────────────────────┐
 │ IVR Detector │                                        │ Gemini Live Audio Engine   │
 │ (Press 1/2)  ├───────────────────────────────────────►│ (Speech-to-Speech Actor)   │
 └──────────────┘           DTMF Directive               └─────────────┬──────────────┘
                                                                       │
                                              Real-Time Transcription  │
                                                                       ▼
                                                         ┌────────────────────────────┐
                                                         │ Dual-Agent Supervisor      │
                                                         │ - Financial Budget Guard   │
                                                         │ - Anti-Social Engineering  │
                                                         │ - HIL Hold Escalator       │
                                                         └────────────────────────────┘
```

### 5.3 Automated IVR Phone Tree Navigation
1. **State Machine Recognition**:
   - Real-time audio stream detects machine prompts: *"Press 1 for accounts payable, press 2 for cancellations."*
   - IVR Navigator translates the prompt, matches the mission objective, and transmits Twilio DTMF digits via `<Play digits="2"/>`.
2. **Hold-Music & Queue Detection**:
   - Fast Fourier Transform (FFT) / acoustic feature analysis detects repetitive music or "Your call is important to us" loops.
   - Throttles agent LLM token consumption to standby mode while waiting on hold.
   - When a human agent connects (*"Hi, my name is Marcus, how can I help you today?"*), the bridge triggers full conversational reasoning within 250ms.
3. **Supervisor Guardrails & Financial Ceiling**:
   - **Contractual Ceiling**: If the human representative says *"We can offer a settlement of $1,400"*, and the mission cap is $1,000, the supervisor locks the turn and sends an emergency SMS/Push HIL approval card:
     `"Representative offered $1,400 settlement. Cap is $1,000. Reply YES to accept or COUNTER [amount]."`

---

## 6. Core Pillar 4: Mobile-First Human-in-the-Loop (HIL) Solver

### 6.1 Instant Visual CAPTCHA & 2FA Escalation
When an agent or learned skill hits a Cloudflare Turnstile, Arkose puzzle, or SMS/authenticator 2FA prompt:
1. Trycua captures a crisp, uncompressed WebP screenshot of the challenge component.
2. The Omnichannel Gateway dispatches an instant MMS/WhatsApp card and an ephemeral single-use HTTPS solver link:
   ```
   [Oddjob Security Challenge]
   Agent 'Invoicing Bot' requires 2FA or CAPTCHA resolution for Chase Commercial Banking.
   Link expires in 90 seconds:
   https://oddjob.local/hil/c/8f92-a1b4-42de
   ```
3. The mobile web view presents an ultra-fast, responsive touch canvas:
   - Tap puzzle piece or select images.
   - Input SMS / TOTP code.
4. On submission, the solution is transmitted via WebSocket directly into `InlineApprovalCard` and `confirmTaskStep`, allowing the desktop to resume in <1.5 seconds.

---

## 7. Data Models & Database Schemas

### 7.1 Table: `omnichannel_identities`
```sql
CREATE TABLE omnichannel_identities (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(32) NOT NULL, -- 'sms', 'whatsapp', 'telegram'
    channel_identifier VARCHAR(128) NOT NULL, -- E.164 phone e.g. '+14155552671'
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_code VARCHAR(16),
    verification_expires_at TIMESTAMP WITH TIME ZONE,
    default_project_id INTEGER REFERENCES projects(id),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT unq_org_channel_identifier UNIQUE (organization_id, channel_type, channel_identifier)
);
CREATE INDEX idx_omnichannel_lookup ON omnichannel_identities(channel_identifier, channel_type);
```

### 7.2 Table: `computer_use_reflexion_buffer`
```sql
CREATE TABLE computer_use_reflexion_buffer (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    skill_id UUID REFERENCES computer_use_skills(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    site VARCHAR(255) NOT NULL,
    failure_category VARCHAR(64) NOT NULL, -- 'locator_timeout', 'modal_blocked', 'element_detached', 'validation_error'
    dom_failure_signature VARCHAR(255) NOT NULL,
    verbal_critique TEXT NOT NULL,
    proposed_remediation JSONB NOT NULL, -- { action: 'dismiss_modal', selector: '#close' }
    trial_count INTEGER NOT NULL DEFAULT 1,
    succeeded_on_next_trial BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reflexion_skill_step ON computer_use_reflexion_buffer(skill_id, step_index);
CREATE INDEX idx_reflexion_site_sig ON computer_use_reflexion_buffer(site, dom_failure_signature);
```

### 7.3 Table: `telephony_session_runs`
```sql
CREATE TABLE telephony_session_runs (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
    created_by VARCHAR(255) NOT NULL REFERENCES users(id),
    twilio_call_sid VARCHAR(64) NOT NULL UNIQUE,
    target_phone VARCHAR(32) NOT NULL,
    objective TEXT NOT NULL,
    status VARCHAR(32) NOT NULL, -- 'initiating', 'in_ivr', 'on_hold', 'in_conversation', 'escalated_to_hil', 'completed', 'failed'
    budget_cap_cents INTEGER,
    financial_commitment_cents INTEGER DEFAULT 0,
    ivr_path_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    transcript_audit_id VARCHAR(128),
    recording_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_telephony_org ON telephony_session_runs(organization_id, status);
```

---

## 8. API & Interface Specifications

### 8.1 Inbound SMS Webhook
- **Method**: `POST`
- **Path**: `/api/channels/twilio/inbound-sms`
- **Request Headers**: `X-Twilio-Signature: <hmac>`
- **Payload Form-Data**:
  ```
  From: +14155552671
  Body: /teach Log in to Salesforce and export today's pipeline
  MessageSid: SMxxxxxxxxxxxxxxxx
  ```
- **Response**:
  ```xml
  <Response>
    <Message>
      Oddjob Teach Mode Activated. Connect to desktop session:
      https://oddjob.local/workspace/computer?teach=1&token=sec_987ad82
    </Message>
  </Response>
  ```

### 8.2 Outbound Telephony Initiation
- **Method**: `POST`
- **Path**: `/api/telephony/outbound-mission`
- **Authorization**: Org Admin or Operator (`requireOrgId`)
- **Body**:
  ```json
  {
    "targetPhone": "+18005550199",
    "objective": "Call Acme Telecom, navigate billing support, dispute recurring modem rental charge of $15/mo, and request refund.",
    "budgetCapCents": 5000,
    "approvalPolicy": "escalate_on_settlement_rejection",
    "persona": "Professional Corporate Procurement Agent"
  }
  ```
- **Response**:
  ```json
  {
    "telephonyRunId": 482,
    "callSid": "CA981248019283019",
    "status": "initiating",
    "liveMonitorWebSocket": "/api/telephony/sessions/482/monitor"
  }
  ```

### 8.3 Reflexion Skill Repair Query
- **Method**: `POST`
- **Path**: `/api/integrations/trycua/skills/:id/reflexion`
- **Body**:
  ```json
  {
    "stepIndex": 2,
    "target": { "tag": "button", "css": ".submit-order" },
    "error": "Timeout 10000ms waiting for locator('.submit-order')",
    "currentDomSnippet": "<div class='banner-overlay'><button id='cookie-accept'>Accept</button></div>"
  }
  ```
- **Response**:
  ```json
  {
    "action": "execute_remediation_prestep",
    "critique": "Target blocked by cookie consent overlay.",
    "remediation": {
      "kind": "click",
      "target": { "tag": "button", "css": "#cookie-accept" }
    },
    "updatedTarget": { "tag": "button", "css": "button.submit-order" }
  }
  ```

---

## 9. Security, Governance, & Zero-Trust Boundary

1. **Non-Negotiable Redaction Boundary**:
   - Unlike Instinct, which ingests raw user credentials, Oddjob’s `skill-recorder.ts` and `learned-skills.service.ts` preserve zero-leak secret redaction. Passwords, OTP codes, and credit cards are scrubbed in memory before hitting database storage or LLM context windows.
2. **Audio Data Sovereignty & PCI-DSS Compliance**:
   - Audio recordings in `telephony_session_runs` are automatically redacted using DTMF muting during credit card or bank account transmission.
   - Transcripts are encrypted at rest with organization-specific AES-256-GCM encryption keys.
3. **Adversarial Social Engineering Guard**:
   - The Outbound Voice Supervisor evaluates live transcriptions against a constitutional blacklist:
     - Disallowed: Committing to legal liability, disclosing employee SSNs, bypassing approval thresholds.
     - Auto-Kill: If a vendor tries to elicit unauthorized corporate credentials, the call is instantly terminated with an event log.

---

## 10. Phased Engineering Delivery Roadmap

| Phase | Milestone | Deliverables & Verification Gates | Timeline |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Omnichannel SMS/WhatsApp Gateway & Mobile HIL** | 1. Database table `omnichannel_identities`.<br>2. Twilio Webhook router (`/api/channels/twilio/inbound-sms`).<br>3. In-chat `/teach` mobile deep-linking.<br>4. Mobile-optimized single-use visual challenge solver.<br>**Gate:** Unit tests + live SMS echo test. | Weeks 1–3 |
| **Phase 2** | **Verbal Episodic Reflexion Loop** | 1. Database table `computer_use_reflexion_buffer`.<br>2. Reflexion Evaluator in `learned-skills.service.ts`.<br>3. Dynamic repair target integration during Playwright retry.<br>4. RAG indexing of reflections into Knowledge Garden.<br>**Gate:** Self-healing benchmark test on mutated web pages. | Weeks 4–6 |
| **Phase 3** | **Governed Outbound Voice & IVR Engine** | 1. Table `telephony_session_runs`.<br>2. Twilio Media Streams WebSocket bridge.<br>3. DTMF keypad state machine & hold-music detector.<br>4. Dual-agent supervisor with budget cap enforcement.<br>**Gate:** Outbound test call to automated mock IVR phone tree. | Weeks 7–9 |
| **Phase 4** | **Product Capabilities Manifest & Documentation** | 1. Register `omnichannel-operator`, `reflexion-healer`, `telephony-navigator` in `oddjob-capability-manifest.ts`.<br>2. Compile executable capability docs.<br>3. Verify `npm run verify` and `npm run smoke:capabilities`. | Week 10 |

---

## 11. Conclusion & Next Steps

This proposal provides the definitive architecture to equip Oddjob with the consumer-grade ease and autonomous agency of **Instinct AI** while anchoring every interaction within Oddjob's **5-Layer Governed Control Plane**. 

Upon user approval, execution will commence with **Phase 1 (Omnichannel SMS/WhatsApp Gateway & Mobile HIL Attestation)**.
