/**
 * Oddjob AI Prospector & Co-pilot JS Harness
 * Version: 1.0.0
 * Description: Lightweight, headless event tracker & proactive UI hook for the S.C.O.R.E. Engine.
 */

(function (window, document) {
    // Prevent double instantiation
    if (window.OddjobProspector) return;

    const scriptSrc = document.currentScript?.src || "";
    const baseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));

    const CONFIG = {
        endpoint: `${baseUrl}/api/prospecting/events`,
        propertyUid: document.currentScript?.getAttribute("data-property-uid"),
        debug: document.currentScript?.getAttribute("data-debug") === "true",
        pollInterval: 10000,
    };

    if (!CONFIG.propertyUid) {
        console.warn("[Oddjob Prospector] Missing data-property-uid. Tracking disabled.");
        return;
    }

    class ProspectorHarness {
        constructor() {
            this.sessionId = this.generateId();
            this.prospectUid = this.getCookie("oj_prospect_id") || this.generateId();
            this.engagementTimer = 0;
            this.themes = this.extractThemesFromMeta();
            this.eventBuffer = [];
            this._pollTimer = null;
            this.init();
        }

        init() {
            if (this.getCookie("oj_opt_out") === "true") {
                this.log("Opt-out detected. Halting tracking.");
                return;
            }
            this.setCookie("oj_prospect_id", this.prospectUid, 365);

            this.log(`Initialized with ProspectID: ${this.prospectUid}, Themes: ${this.themes.join(", ")}`);

            // Check for URL Identity Parameters
            this.checkForUrlIdentity();

            // Bind Global Events
            this.bindListeners();

            // Initial Page Load Ping
            this.trackEvent("page_view", { url: window.location.href, title: document.title });

            // Flush interval
            setInterval(() => this.flushBuffer(), 3000);

            // Flush on page exit/hide
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === 'hidden') {
                    this.flushBuffer(true);
                }
            });

            // Start Time-on-page loop
            this.startEngagementTimer();
        }

        checkForUrlIdentity() {
            try {
                const params = new URLSearchParams(window.location.search);
                const uid = params.get("oj_uid");
                const email = params.get("oj_email");

                if (uid || email) {
                    this.log(`URL Identity Found. UID: ${uid}, Email: ${email}`);
                    // Trigger identification hook (async background)
                    this.identify(uid || email, { source: "url_param", email: email });

                    // Optional: Clean URL to prevent sharing identity links accidentally
                    // const cleanUrl = window.location.href.replace(/([&?]oj_uid|oj_email)=[^&]+(&|$)/g, '$1'); 
                }
            } catch (e) { /* ignore */ }
        }


        log(msg) {
            if (CONFIG.debug) console.log(`[Oddjob Prospector] ${msg}`);
        }

        generateId() {
            return 'v_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        }

        getCookie(name) {
            const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
            return v ? v[2] : null;
        }

        setCookie(name, value, days) {
            const d = new Date();
            d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * days);
            document.cookie = name + "=" + value + ";path=/;expires=" + d.toGMTString();
        }

        extractThemesFromMeta() {
            const themes = [];
            const metaKeywords = document.querySelector('meta[name="keywords"]');
            if (metaKeywords) {
                themes.push(...metaKeywords.content.split(",").map(t => t.trim()));
            }
            // Simple heuristic based on URL path
            const path = window.location.pathname.toLowerCase();
            if (path.includes('pricing')) themes.push("Pricing & Tiers");
            if (path.includes('enterprise')) themes.push("Enterprise Requirements");
            if (path.includes('docs') || path.includes('api')) themes.push("Technical Documentation");
            if (path.includes('case-study') || path.includes('customers')) themes.push("Social Proof");

            return themes.slice(0, 5); // Limit
        }

        bindListeners() {
            // Button Clicks
            document.body.addEventListener("click", (e) => {
                const target = e.target.closest("button, a, input[type='submit']");
                if (target) {
                    const text = target.innerText || target.value || target.getAttribute("aria-label");
                    if (text) {
                        this.trackEvent("click", {
                            selector: this.getSelector(target),
                            text: text.trim().substring(0, 50),
                            tagName: target.tagName,
                        });
                    }
                }
            });
        }

        getSelector(elm) {
            if (elm.id) return `#${elm.id}`;
            if (elm.className && typeof elm.className === 'string') {
                return `${elm.tagName.toLowerCase()}.${elm.className.trim().split(/\s+/).join('.')}`;
            }
            return elm.tagName.toLowerCase();
        }

        startEngagementTimer() {
            setInterval(() => {
                this.engagementTimer += (CONFIG.pollInterval / 1000);
                // Ping engagement every 30s
                if (this.engagementTimer % 30 === 0) {
                    this.trackEvent("dwell", { duration: this.engagementTimer });
                }
            }, CONFIG.pollInterval);
        }

        trackEvent(activity, payload = {}) {
            if (this.getCookie("oj_opt_out") === "true") return;

            const eventPayload = {
                propertyUid: CONFIG.propertyUid,
                prospectUid: this.prospectUid,
                sessionId: this.sessionId,
                url: window.location.href,
                activity,
                payload: {
                    ...payload,
                    themes: this.themes
                }
            };

            this.eventBuffer.push(eventPayload);
            this.log(`Buffered ${activity}. Buffer size: ${this.eventBuffer.length}`);

            if (this.eventBuffer.length >= 10) {
                this.flushBuffer();
            }
        }

        async flushBuffer(useBeacon = false) {
            if (this.eventBuffer.length === 0) return;
            if (this.getCookie("oj_opt_out") === "true") {
                this.eventBuffer = [];
                return;
            }

            const payload = [...this.eventBuffer];
            this.eventBuffer = [];

            try {
                if (useBeacon && navigator.sendBeacon) {
                    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                    navigator.sendBeacon(CONFIG.endpoint, blob);
                    this.log(`Flushed ${payload.length} events via beacon`);
                    // No polling after beacon (page is closing)
                } else {
                    const res = await fetch(CONFIG.endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                        mode: 'cors'
                    });

                    if (res.ok || res.status === 202) {
                        this.log(`Flushed ${payload.length} events. Status: ${res.status}`);
                        // Poll for async interventions after a short delay
                        // (worker needs time to process the events and evaluate scoring)
                        this.scheduleInterventionPoll();
                    }
                }
            } catch (err) {
                this.log(`Failed to flush events: ${err.message}`);
                // Simple retry mechanism: push back to buffer if failed
                if (!useBeacon) {
                    this.eventBuffer = [...payload, ...this.eventBuffer];
                }
            }
        }

        scheduleInterventionPoll() {
            // Debounce: only one poll cycle active at a time
            if (this._pollTimer) return;

            // Wait 2s for the async worker to process, then poll up to 3 times
            this._pollTimer = setTimeout(() => {
                this._pollTimer = null;
                this.pollForIntervention(0);
            }, 2000);
        }

        async pollForIntervention(attempt) {
            if (attempt >= 3) return; // Max 3 polls (2s, 5s, 10s)
            if (this.getCookie("oj_opt_out") === "true") return;

            const pollEndpoint = CONFIG.endpoint.replace("/events", "/interventions/poll");
            const url = `${pollEndpoint}?propertyUid=${encodeURIComponent(CONFIG.propertyUid)}&prospectUid=${encodeURIComponent(this.prospectUid)}`;

            try {
                const res = await fetch(url, { mode: 'cors' });
                if (!res.ok) return;

                const data = await res.json();
                if (data.intervention) {
                    this.log(`Intervention received on poll attempt ${attempt + 1}`);
                    this.handleIntervention(data.intervention);
                    return; // Got one — stop polling
                }

                // No intervention yet — retry with backoff
                if (attempt < 2) {
                    const delay = attempt === 0 ? 3000 : 5000;
                    setTimeout(() => this.pollForIntervention(attempt + 1), delay);
                }
            } catch (err) {
                this.log(`Intervention poll failed: ${err.message}`);
            }
        }

        /**
         * Renders Spatial Awareness Highlight and Chat Invoker
         */
        handleIntervention(intervention) {
            this.log(`Received Intervention: ${intervention.type}`);

            // Dispatch event for custom webmaster hooks
            window.dispatchEvent(new CustomEvent('oj_intervention', { detail: intervention }));

            // The S.C.O.R.E. engine emits { type:"INTENT_STABILIZED", suggestion:{ user_text, user_cta, agent_prompt, ... } }.
            // Older/custom flows used { type:"concierge_prompt", config:{ message, ... } }. Support both.
            const s = intervention.suggestion || {};
            const cfg = intervention.config || {};
            const message = s.user_text || cfg.message;
            if (!message) return;

            this.renderInvoker(message, s.user_cta || cfg.cta || "Chat with us", s.agent_prompt || cfg.agent_prompt || "");

            const targetSelector = s.targetSelector || cfg.targetSelector;
            if (targetSelector) {
                this.highlightElement(targetSelector, s.hilightEffect || cfg.hilightEffect || 'pulse');
            }
        }

        renderInvoker(message, ctaLabel, agentPrompt) {
            if (document.getElementById("oj-invoker-bubble") || document.getElementById("oj-chat-panel")) return; // Only show one

            const bubble = document.createElement("div");
            bubble.id = "oj-invoker-bubble";
            bubble.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #111827; color: white; padding: 16px 18px; border-radius: 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); z-index: 999999; font-family: system-ui, sans-serif; max-width: 320px; animation: oj-slide-up 0.3s ease-out;`;

            const head = document.createElement("div");
            head.style.cssText = "font-weight: 600; font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;";
            head.innerHTML = `<span style="width:8px;height:8px;background:#10B981;border-radius:50%;display:inline-block;"></span> Sales Co-pilot`;

            const body = document.createElement("div");
            body.style.cssText = "font-size: 14px; line-height: 1.45; color: #D1D5DB; margin-bottom: 12px;";
            body.innerText = message;

            const cta = document.createElement("button");
            cta.innerText = ctaLabel || "Chat with us";
            cta.style.cssText = "background:#3B82F6; color:#fff; border:none; padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; width:100%;";
            cta.onclick = (e) => {
                e.stopPropagation();
                // Notify webmaster hooks AND open the built-in co-pilot chat.
                window.dispatchEvent(new CustomEvent('oj_open_chat', { detail: { prospectUid: this.prospectUid, agentPrompt } }));
                bubble.remove();
                this.removeHighlights();
                this.openChatPanel(message, agentPrompt);
            };

            const dismiss = document.createElement("button");
            dismiss.innerHTML = "×";
            dismiss.style.cssText = "position: absolute; top: 8px; right: 12px; background: none; border: none; color: #9CA3AF; font-size: 18px; cursor: pointer;";
            dismiss.onclick = (e) => { e.stopPropagation(); bubble.remove(); this.removeHighlights(); };

            bubble.appendChild(dismiss);
            bubble.appendChild(head);
            bubble.appendChild(body);
            bubble.appendChild(cta);

            const style = document.createElement('style');
            style.textContent = `@keyframes oj-slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } } @keyframes oj-pulse { 0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); } 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); } }`;
            document.head.appendChild(style);
            document.body.appendChild(bubble);
        }

        /** Live AI co-pilot chat, backed by the property's persona agent (P1 handoff). */
        openChatPanel(greeting, agentPrompt) {
            if (document.getElementById("oj-chat-panel")) return;
            const copilotEndpoint = CONFIG.endpoint.replace("/events", "/copilot/chat");

            const panel = document.createElement("div");
            panel.id = "oj-chat-panel";
            panel.style.cssText = `position: fixed; bottom: 20px; right: 20px; width: 360px; max-width: calc(100vw - 40px); height: 480px; max-height: calc(100vh - 40px); background: #0F172A; color: #E5E7EB; border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); z-index: 999999; font-family: system-ui, sans-serif; display: flex; flex-direction: column; overflow: hidden; animation: oj-slide-up 0.3s ease-out;`;
            panel.innerHTML = `
        <div style="padding:14px 16px; background:#111827; display:flex; align-items:center; justify-content:space-between;">
          <div style="font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px;"><span style="width:8px;height:8px;background:#10B981;border-radius:50%;display:inline-block;"></span> Sales Co-pilot</div>
          <button id="oj-chat-close" style="background:none;border:none;color:#9CA3AF;font-size:20px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div id="oj-chat-messages" style="flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px;"></div>
        <div style="padding:12px; border-top:1px solid rgba(255,255,255,.08); display:flex; gap:8px;">
          <input id="oj-chat-input" placeholder="Type a message…" style="flex:1; background:#1E293B; border:1px solid rgba(255,255,255,.1); border-radius:10px; padding:10px 12px; color:#E5E7EB; font-size:14px; outline:none;" />
          <button id="oj-chat-send" style="background:#3B82F6; border:none; color:#fff; border-radius:10px; padding:0 14px; font-weight:600; cursor:pointer;">Send</button>
        </div>`;
            document.body.appendChild(panel);

            const messagesEl = panel.querySelector("#oj-chat-messages");
            const inputEl = panel.querySelector("#oj-chat-input");
            const sendBtn = panel.querySelector("#oj-chat-send");
            panel.querySelector("#oj-chat-close").onclick = () => panel.remove();

            const history = [];
            const addBubble = (role, text) => {
                const b = document.createElement("div");
                const me = role === "user";
                b.style.cssText = `max-width:80%; padding:9px 12px; border-radius:12px; font-size:14px; line-height:1.4; word-wrap:break-word; ${me ? 'align-self:flex-end; background:#3B82F6; color:#fff;' : 'align-self:flex-start; background:#1E293B; color:#E5E7EB;'}`;
                b.innerText = text;
                messagesEl.appendChild(b);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            };

            // Seed the conversation with the proactive greeting from the intervention.
            if (greeting) { addBubble("assistant", greeting); history.push({ role: "assistant", content: greeting }); }

            const send = async () => {
                const text = inputEl.value.trim();
                if (!text) return;
                inputEl.value = "";
                addBubble("user", text);
                history.push({ role: "user", content: text });

                const typing = document.createElement("div");
                typing.style.cssText = "align-self:flex-start; color:#64748B; font-size:13px; padding:4px 0;";
                typing.innerText = "…";
                messagesEl.appendChild(typing);
                messagesEl.scrollTop = messagesEl.scrollHeight;

                try {
                    const res = await fetch(copilotEndpoint, {
                        method: "POST",
                        mode: "cors",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ propertyUid: CONFIG.propertyUid, prospectUid: this.prospectUid, messages: history, agentPrompt }),
                    });
                    const data = await res.json().catch(() => ({}));
                    typing.remove();
                    const reply = (data && data.reply) || "Sorry, I'm having trouble right now — please try again.";
                    addBubble("assistant", reply);
                    history.push({ role: "assistant", content: reply });
                } catch (err) {
                    typing.remove();
                    addBubble("assistant", "Connection error. Please try again.");
                    this.log(`Co-pilot chat error: ${err.message}`);
                }
            };

            sendBtn.onclick = send;
            inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
            inputEl.focus();
        }

        highlightElement(selector, effectType) {
            this.removeHighlights();
            const el = document.querySelector(selector);
            if (el) {
                el.classList.add('oj-hilight-target');
                el.dataset.ojOriginalOutline = el.style.outline;
                el.dataset.ojOriginalOutlineOffset = el.style.outlineOffset;
                el.dataset.ojOriginalAnimation = el.style.animation;

                el.style.outline = '3px solid #3B82F6';
                el.style.outlineOffset = '2px';
                if (effectType === 'pulse') {
                    el.style.animation = 'oj-pulse 2s infinite';
                }

                // Scroll into view gently
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        removeHighlights() {
            document.querySelectorAll('.oj-hilight-target').forEach(el => {
                el.classList.remove('oj-hilight-target');
                el.style.outline = el.dataset.ojOriginalOutline || '';
                el.style.outlineOffset = el.dataset.ojOriginalOutlineOffset || '';
                el.style.animation = el.dataset.ojOriginalAnimation || '';
            });
        }

        // Public API
        async identify(userId, metadata = {}) {
            if (this.getCookie("oj_opt_out") === "true") return;

            const payload = {
                propertyUid: CONFIG.propertyUid,
                prospectUid: this.prospectUid,
                userId: userId,
                email: metadata.email,
                metadata: metadata
            };

            const identifyEndpoint = CONFIG.endpoint.replace("/events", "/identify");

            try {
                const res = await fetch(identifyEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    mode: 'cors'
                });

                if (res.ok) {
                    const data = await res.json();
                    this.log(`Identify successful. Merged: ${data.message}`);
                    if (data.masterUid && data.masterUid !== this.prospectUid) {
                        this.log(`Federated Merge: Updating local Prospect UID from ${this.prospectUid} to ${data.masterUid}`);
                        this.prospectUid = data.masterUid;
                        this.setCookie("oj_prospect_id", this.prospectUid, 365);
                    }
                }
            } catch (err) {
                this.log(`Failed to identify: ${err.message}`);
            }
        }
    }

    window.OddjobProspector = new ProspectorHarness();

})(window, document);
