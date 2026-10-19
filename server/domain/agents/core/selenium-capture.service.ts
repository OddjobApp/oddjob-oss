/**
 * Selenium Capture Service
 * 
 * Provides interactive capture tools via custom right-click context menu
 * for capturing images, text blocks, and selected text during browser sessions.
 */

import type { SeleniumStep } from "@shared/schema/index.js";
import { EventEmitter } from 'events';

export interface CaptureResult {
    id: string;
    type: 'image' | 'text' | 'selection' | 'element' | 'screenshot';
    content: string; // base64 for images, text for text captures
    selector?: string;
    metadata: {
        sourceUrl: string;
        elementPath?: string;
        boundingBox?: { x: number; y: number; width: number; height: number };
        timestamp: string;
        alt?: string;
        title?: string;
    };
}

export interface InteractionResult {
    id: string;
    type: 'interaction';
    action: 'click' | 'type' | 'navigate' | 'submit';
    value?: string;
    selector?: string;
    metadata: {
        sourceUrl: string;
        timestamp: string;
    };
}

export type UnifiedEvent = CaptureResult | InteractionResult;

export interface CaptureSession {
    id: string;
    url: string;
    events: UnifiedEvent[]; // Merged timeline of captures and interactions
    active: boolean;
    createdAt: Date;
}

// JavaScript to inject into page for custom context menu
// Using string concatenation for browser-side variables to avoid server-side template literal issues
const CAPTURE_INJECTION_SCRIPT = `
(function() {
    // Prevent re-injection
    if (window.__oddjobCaptureInjected) return;
    window.__oddjobCaptureInjected = true;

    console.log('[OddjobCapture] Script initializing...');

    let targetElement = null;
    let menuX = 0;
    let menuY = 0;

    function ensureMenuExists() {
        if (document.getElementById('oddjob-capture-menu')) return;
        
        const menu = document.createElement('div');
        menu.id = 'oddjob-capture-menu';
        menu.style.cssText = 'position:fixed;background:#1a1a2e;border:1px solid #4a4a6a;border-radius:8px;padding:4px 0;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.6);z-index:2147483647;display:none;font-family:sans-serif;font-size:13px;';

        const menuItems = [
            { label: '📷 Capture Image', action: 'captureImage', icon: '📷' },
            { label: '📝 Capture Text Block', action: 'captureTextBlock', icon: '📝' },
            { label: '✂️ Capture Selection', action: 'captureSelection', icon: '✂️' },
            { label: '🎯 Capture Element', action: 'captureElement', icon: '🎯' },
            { label: '📸 Full Screenshot', action: 'captureScreenshot', icon: '📸' },
            { type: 'separator' },
            { label: '❌ Cancel', action: 'cancel', icon: '❌' }
        ];

        menuItems.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:#4a4a6a;margin:4px 8px;';
                menu.appendChild(sep);
                return;
            }

            const menuItem = document.createElement('div');
            menuItem.style.cssText = 'padding:8px 16px;cursor:pointer;color:#e0e0e0;display:flex;align-items:center;gap:8px;transition:background 0.15s;';
            menuItem.innerHTML = item.label;
            menuItem.dataset.action = item.action;

            menuItem.addEventListener('mouseenter', () => { menuItem.style.background = '#2a2a4e'; });
            menuItem.addEventListener('mouseleave', () => { menuItem.style.background = 'transparent'; });
            menuItem.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCapture(item.action);
                hideMenu();
            });

            menu.appendChild(menuItem);
        });

        (document.body || document.documentElement).appendChild(menu);
        return menu;
    }

    function getMenu() {
        return document.getElementById('oddjob-capture-menu') || ensureMenuExists();
    }

    function showMenu(x, y) {
        const menu = getMenu();
        if (!menu) return;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';
        menuX = x;
        menuY = y;
    }

    function hideMenu() {
        const menu = document.getElementById('oddjob-capture-menu');
        if (menu) menu.style.display = 'none';
        if (targetElement) {
            targetElement.style.outline = '';
        }
        targetElement = null;
    }

    function getUniqueSelector(el) {
        try {
            if (!el || el === document || el === document.body) return 'body';
            
            // 1. Check for unique ID (skipping numeric or generated-looking IDs)
            if (el.id && !/^[0-9]/.test(el.id) && !/[-_][0-9a-f]{6,}/i.test(el.id)) { 
                const idSelector = '#' + el.id;
                try {
                    if (document.querySelectorAll(idSelector).length === 1) return idSelector;
                } catch(e) {}
            }

            // 2. Check for robust data attributes and other semantic attributes
            const robustAttrs = [
                'data-testid', 'data-qa', 'data-ui', 'data-automation-id', 'data-cy',
                'aria-label', 'name', 'placeholder', 'title', 'role', 'for', 'data-id'
            ];
            for (const attr of robustAttrs) {
                const val = el.getAttribute(attr);
                if (val) {
                    const selector = '[' + attr + '="' + val.replace(/"/g, '\\"') + '"]';
                    try {
                        if (document.querySelectorAll(selector).length === 1) return selector;
                        // If not unique, try combining with tag
                        const tagSelector = el.tagName.toLowerCase() + selector;
                        if (document.querySelectorAll(tagSelector).length === 1) return tagSelector;
                    } catch(e) {}
                }
            }

            // 3. Text based locator for buttons and links (more robust)
            if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && el.innerText.length < 50) {
                const text = el.innerText.trim();
                // Avoid using text selector if it contains looks like dynamic content (dates, numbers)
                if (text && text.length > 0 && !/^\d+$/.test(text) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
                    // Start with simple text match if unique
                    // NOTE: This uses Playwright/Puppeteer specific pseudo-class, checking if likely to be supported or fall back to contains ref
                    // For pure CSS, we can't use :has-text, so we will generate a path that might be brittle but annotated.
                    // However, since this recorded selector is used eventually by Playwright, we CAN use :text() or :has-text()!
                    
                    // Let's try to generate a Playwright text selector if possible, but for the UI display we might want standard CSS.
                    // The backend executes these with Playwright, so we can use text=...
                    // But 'document.querySelector' won't work with it for uniqueness check here in the browser.
                    
                    // So we fallback to standard CSS checking for now.
                }
            }

            // 4. Hierarchical path with intelligent class usage
            const path = [];
            let current = el;
            while (current && current.nodeType === Node.ELEMENT_NODE) {
                let selector = current.tagName.toLowerCase();
                
                // If we find a strong ID, use it and stop
                if (current.id && !/^[0-9]/.test(current.id) && !/[-_][0-9a-f]{6,}/i.test(current.id)) {
                    const idSelector = '#' + current.id;
                    try {
                        if (document.querySelectorAll(idSelector).length === 1) {
                            path.unshift(idSelector);
                            return path.join(' > ');
                        }
                    } catch(e) {}
                    path.unshift(idSelector);
                    break;
                }

                // Try to use usable classes (not utility classes like 'p-4', 'flex')
                if (current.className && typeof current.className === 'string') {
                    const classes = current.className.split(/\s+/).filter(c => {
                        // Filter out common utility class patterns (very basic heuristic)
                        if (/^(p|m)[xy]?-?\d+$/.test(c)) return false; // margin/padding
                        if (/^(flex|grid|block|hidden|relative|absolute|fixed)$/.test(c)) return false; // layout
                        if (/^(text|bg|border)-/.test(c)) return false; // colors/typography
                        if (/[-_][0-9a-f]{6,}/i.test(c)) return false; // generated hashes
                        return c.length > 3;
                    });
                    
                    if (classes.length > 0) {
                        // Try adding classes one by one until unique or sufficiently specific
                        // For now just taking the first 'meaningful' class
                        selector += '.' + classes[0];
                    }
                }

                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName) index++;
                    sibling = sibling.previousElementSibling;
                }
                
                if (index > 1) {
                    selector += ':nth-of-type(' + index + ')';
                } else if (current.nextElementSibling) {
                    // Check if it needs differentiation from next sibling
                    let next = current.nextElementSibling;
                    let hasSameType = false;
                    while(next) {
                        if (next.tagName === current.tagName) { hasSameType = true; break; }
                        next = next.nextElementSibling;
                    }
                    if (hasSameType) selector += ':nth-of-type(1)';
                }

                path.unshift(selector);
                
                // Verify uniqueness of partial path from document root
                try {
                    const fullPath = path.join(' > ');
                    if (document.querySelectorAll(fullPath).length === 1) return fullPath;
                } catch(e) {}

                current = current.parentElement;
            }
            return path.join(' > ');
        } catch (err) { return 'body'; }
    }

    function getXPath(el) {
        try {
            if (!el) return '';
            if (el.id) return '//*[@id="' + el.id + '"]';
            const parts = [];
            while (el && el.nodeType === Node.ELEMENT_NODE) {
                let index = 1;
                let sibling = el.previousSibling;
                while (sibling) {
                    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === el.tagName) index++;
                    sibling = sibling.previousSibling;
                }
                parts.unshift(el.tagName.toLowerCase() + '[' + index + ']');
                el = el.parentElement;
            }
            return '/' + parts.join('/');
        } catch (err) { return ''; }
    }

    async function handleCapture(action) {
        const result = {
            id: 'capture_' + Date.now(),
            type: action.replace('capture', '').toLowerCase(),
            content: '',
            selector: '',
            metadata: {
                sourceUrl: window.location.href,
                timestamp: new Date().toISOString(),
            }
        };

        try {
            switch (action) {
                case 'captureImage':
                    if (targetElement && targetElement.tagName === 'IMG') {
                        result.content = targetElement.src;
                        result.selector = getUniqueSelector(targetElement);
                    } else {
                        const img = targetElement?.querySelector('img') || targetElement?.closest('img');
                        if (img) {
                            result.content = img.src;
                            result.selector = getUniqueSelector(img);
                        } else {
                            alert('No image found at this location');
                            return;
                        }
                    }
                    break;
                case 'captureTextBlock':
                    if (targetElement) {
                        result.content = targetElement.innerText || targetElement.textContent;
                        result.selector = getUniqueSelector(targetElement);
                    }
                    break;
                case 'captureSelection':
                    const selection = window.getSelection();
                    if (selection && selection.toString().trim()) {
                        result.content = selection.toString();
                        if (selection.anchorNode && selection.anchorNode.parentElement) {
                            result.selector = getUniqueSelector(selection.anchorNode.parentElement);
                        }
                    } else {
                        alert('No text selected. Please select text first.');
                        return;
                    }
                    break;
                case 'captureElement':
                    if (targetElement) {
                        result.content = targetElement.outerHTML;
                        result.selector = getUniqueSelector(targetElement);
                    }
                    break;
                case 'captureScreenshot':
                    result.type = 'screenshot';
                    result.content = '__SCREENSHOT_REQUEST__';
                    break;
            }

            if (result.selector) {
                result.metadata.elementPath = getXPath(document.querySelector(result.selector));
                result.metadata.boundingBox = document.querySelector(result.selector)?.getBoundingClientRect();
            }

            if (window.__oddjobCaptureCallback) {
                window.__oddjobCaptureCallback(result);
            }
            showNotification('Captured: ' + result.type);
        } catch (err) { console.error('[OddjobCapture] Error:', err); }
    }

    function showNotification(message) {
        const notification = document.createElement('div');
        notification.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#10b981;color:white;padding:12px 20px;border-radius:8px;font-family:sans-serif;font-size:14px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        notification.textContent = '✓ ' + message;
        (document.body || document.documentElement).appendChild(notification);
        setTimeout(() => { notification.remove(); }, 2000);
    }

    function ensureRecorderBadge() {
        if (document.getElementById('oddjob-recorder-badge')) return;
        const badge = document.createElement('div');
        badge.id = 'oddjob-recorder-badge';
        badge.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(220,38,38,0.9);color:white;padding:4px 10px;border-radius:20px;font-family:monospace;font-size:11px;font-weight:bold;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.2);';
        badge.innerHTML = '<span style="width:8px;height:8px;background:#fff;border-radius:50%;display:inline-block;"></span> ODDJOB REC';
        (document.body || document.documentElement).appendChild(badge);
    }

    // High-priority event listeners
    window.addEventListener('contextmenu', (e) => {
        if (e.ctrlKey || e.shiftKey || e.metaKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            targetElement = e.target;
            targetElement.style.outline = '2px solid #10b981';
            showMenu(e.clientX, e.clientY);
        }
    }, true);

    window.addEventListener('click', (e) => {
        const menu = document.getElementById('oddjob-capture-menu');
        if ((menu && menu.style.display === 'block') || (menu && menu.contains(e.target))) return;
        
        // Visual feedback
        if (e.target && e.target.style) {
            const el = e.target;
            const originalTransition = el.style.transition;
            const originalOutline = el.style.outline;
            
            el.style.transition = 'outline 0.2s';
            el.style.outline = '2px solid rgba(16, 185, 129, 0.8)'; // Green highlight
            
            setTimeout(() => {
                el.style.outline = originalOutline;
                el.style.transition = originalTransition;
            }, 800);
        }

        const interaction = {
            id: 'interaction_' + Date.now(),
            type: 'interaction',
            action: 'click',
            selector: getUniqueSelector(e.target),
            metadata: { sourceUrl: window.location.href, timestamp: new Date().toISOString() }
        };
        if (window.__oddjobInteractionCallback) window.__oddjobInteractionCallback(interaction);
        showNotification('Recorded: Click');
    }, true);

    window.addEventListener('blur', (e) => {
        const el = e.target;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            if (!el.value) return;
            const interaction = {
                id: 'interaction_' + Date.now(),
                type: 'interaction',
                action: 'type',
                selector: getUniqueSelector(el),
                value: el.value,
                metadata: { sourceUrl: window.location.href, timestamp: new Date().toISOString() }
            };
            if (window.__oddjobInteractionCallback) window.__oddjobInteractionCallback(interaction);
            showNotification('Recorded: Type');
        }
    }, true);

    window.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('oddjob-capture-menu');
        if (menu && !menu.contains(e.target)) hideMenu();
    }, true);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMenu();
    }, true);

    // Initial check
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { ensureRecorderBadge(); });
    } else {
        ensureRecorderBadge();
    }
    
    // Recovery check
    setInterval(ensureRecorderBadge, 2000);

    console.log('[OddjobCapture] Recorder active.');
})();
`;

export class SeleniumCaptureService extends EventEmitter {
    private sessions: Map<string, CaptureSession> = new Map();

    async startCaptureSession(url: string, preRunSteps?: SeleniumStep[]): Promise<{ sessionId: string; page: any; cleanup: () => Promise<void> }> {
        const sessionId = `capture_${Date.now()}`;
        const session: CaptureSession = {
            id: sessionId,
            url,
            active: true,
            events: [],
            createdAt: new Date(),
        };
        this.sessions.set(sessionId, session);

        const playwright = await import("playwright");
        const browser = await playwright.chromium.launch({
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--start-maximized'
            ]
        });

        const context = await browser.newContext({
            viewport: null
        });

        await context.addInitScript(CAPTURE_INJECTION_SCRIPT);
        const page = await context.newPage();

        await page.exposeFunction('__oddjobCaptureCallback', (capture: any) => {
            session.events.push(capture);
            this.emit('capture', { sessionId, capture });
        });

        await page.exposeFunction('__oddjobInteractionCallback', (interaction: any) => {
            session.events.push(interaction);
            this.emit('interaction', { sessionId, interaction });
        });

        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) {
                session.events.push({
                    id: `nav_${Date.now()}`,
                    type: 'interaction',
                    action: 'navigate',
                    value: page.url(),
                    metadata: { sourceUrl: page.url(), timestamp: new Date().toISOString() }
                });
            }
        });

        page.on('console', async (msg) => {
            if (msg.text().includes('__SCREENSHOT_REQUEST__')) {
                try {
                    const screenshotBuffer = await page.screenshot();
                    const capture = {
                        id: `capture_${Date.now()}`,
                        type: 'screenshot',
                        content: screenshotBuffer.toString('base64'),
                        metadata: { sourceUrl: page.url(), timestamp: new Date().toISOString() }
                    };
                    session.events.push(capture as any);
                    this.emit('capture', { sessionId, capture });
                } catch (e) {
                    console.error('[CaptureService] Screenshot failed:', e);
                }
            }
        });

        try {
            if (preRunSteps && preRunSteps.length > 0) {
                for (const step of preRunSteps) {
                    await this.executeStepOnPage(page, step);
                }
            } else {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
        } catch (e) {
            console.warn('[CaptureService] Navigation Warning:', e);
        }

        return {
            sessionId,
            page,
            cleanup: async () => {
                session.active = false;
                await context.close();
                await browser.close();
            },
        };
    }

    private async executeStepOnPage(page: any, step: SeleniumStep) {
        switch (step.action) {
            case 'goto':
                await page.goto(step.value!, { waitUntil: 'domcontentloaded' });
                break;
            case 'click':
                await page.click(step.selector!);
                break;
            case 'type':
                await page.fill(step.selector!, step.value!);
                break;
            case 'wait':
                await new Promise(r => setTimeout(r, step.waitMs || 1000));
                break;
            case 'waitForSelector':
                await page.waitForSelector(step.selector!);
                break;
        }
    }

    eventsToSteps(events: UnifiedEvent[]): SeleniumStep[] {
        return events.map(event => {
            if (event.type === 'interaction') {
                return {
                    action: event.action as any,
                    selector: event.selector,
                    value: event.value,
                    optional: false,
                };
            } else {
                return {
                    action: `capture${event.type.charAt(0).toUpperCase() + event.type.slice(1)}` as any,
                    selector: event.selector,
                    extractAs: event.id,
                    captureType: event.type as any,
                    captureMetadata: {
                        sourceUrl: event.metadata.sourceUrl,
                        elementPath: event.metadata.elementPath,
                        boundingBox: event.metadata.boundingBox,
                        timestamp: event.metadata.timestamp,
                    },
                    optional: false,
                };
            }
        });
    }

    getEvents(sessionId: string): UnifiedEvent[] {
        return this.sessions.get(sessionId)?.events || [];
    }

    getActiveSessions(): CaptureSession[] {
        return Array.from(this.sessions.values()).filter(s => s.active);
    }

    cleanupSessions(maxAgeMs: number = 3600000) {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (!session.active && now - session.createdAt.getTime() > maxAgeMs) {
                this.sessions.delete(id);
            }
        }
    }
}

export const seleniumCaptureService = new SeleniumCaptureService();


