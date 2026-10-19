
/**
 * Browser Stealth Utility
 * 
 * Contains scripts and constants for masking browser automation properties
 * to avoid detection by services like Google Search.
 */

export const STEALTH_SCRIPTS = [
  // 1. Hide navigator.webdriver
  `Object.defineProperty(navigator, 'webdriver', { get: () => false });`,

  // 2. Mock languages
  `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });`,

  // 3. Mock plugins (empty list is better than no list)
  `Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });`,

  // 4. Mock window.chrome for Chromium-based browsers
  `window.chrome = { runtime: {} };`,

  // 5. Mock permissions
  `const originalQuery = window.navigator.permissions.query;
   window.navigator.permissions.query = (parameters) => (
     parameters.name === 'notifications' ?
       Promise.resolve({ state: Notification.permission }) :
       originalQuery(parameters)
   );`,

  // 6. Fix WebGL vendor/renderer
  `const getParameter = WebGLRenderingContext.prototype.getParameter;
   WebGLRenderingContext.prototype.getParameter = function(parameter) {
     if (parameter === 37445) return 'Intel Open Source Technology Center';
     if (parameter === 37446) return 'Mesa DRI Intel(R) UHD Graphics 620 (Kabylake GT2)';
     return getParameter.apply(this, arguments);
   };`,

  // 7. Mask Canvas Fingerprinting
  `const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
   CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
     const result = originalGetImageData.apply(this, arguments);
     // Add subtle noise to the image data to break fingerprinting
     for (let i = 0; i < 10; i++) {
       const index = Math.floor(Math.random() * result.data.length);
       result.data[index] = result.data[index] ^ 1;
     }
     return result;
   };`,

  // 8. Mask hardwareConcurrency
  `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });`,

  // 9. Mask deviceMemory
  `Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });`,

  // 10. Mock Battery Status
  `if (navigator.getBattery) {
     const originalGetBattery = navigator.getBattery;
     navigator.getBattery = () => Promise.resolve({
       charging: true,
       chargingTime: 0,
       dischargingTime: Infinity,
       level: 1,
       onchargingchange: null,
       onchargingtimechange: null,
       ondischargingtimechange: null,
       onlevelchange: null,
     });
   }`,

  // 11. Mock Screen Orientation
  `if (window.screen && window.screen.orientation) {
     Object.defineProperty(window.screen.orientation, 'type', { get: () => 'landscape-primary' });
     Object.defineProperty(window.screen.orientation, 'angle', { get: () => 0 });
   }`,

  // 12. Mock Connection Info
  `if (navigator.connection) {
     Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
     Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
     Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
   }`,

  // 13. Mask Web Audio API Fingerprinting
  `const originalAudioContext = window.AudioContext || window.webkitAudioContext;
   if (originalAudioContext) {
     window.AudioContext = window.webkitAudioContext = function() {
       const context = new originalAudioContext();
       const originalCreateOscillator = context.createOscillator;
       context.createOscillator = function() {
         const osc = originalCreateOscillator.apply(this, arguments);
         const originalStart = osc.start;
         osc.start = function() {
           // Add tiny frequency jitter
           osc.frequency.value += (Math.random() * 0.0001);
           return originalStart.apply(this, arguments);
         };
         return osc;
       };
       return context;
     };
   }`,

  // 14. Mask Font Fingerprinting
  `const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
   const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
   Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
     get: function() {
       const val = originalOffsetWidth.get.apply(this);
       return Math.random() > 0.95 ? val + 1 : val; // Subtle variance
     }
   });`
];

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getOrganicHeaders(userAgent: string): Record<string, string> {
    const isChrome = userAgent.includes("Chrome");
    const isFirefox = userAgent.includes("Firefox");

    const headers: Record<string, string> = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    };

    if (isChrome) {
        headers["Sec-CH-UA"] = '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"';
        headers["Sec-CH-UA-Mobile"] = "?0";
        headers["Sec-CH-UA-Platform"] = '"Windows"';
    }

    return headers;
}

