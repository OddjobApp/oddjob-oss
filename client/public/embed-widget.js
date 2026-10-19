/**
 * Oddjob Floating Chat Widget
 * Intercom-style chat button + popup iframe.
 * Usage: <script src="https://your-oddjob.app/embed-widget.js" data-slug="YOUR_AGENT_SLUG"></script>
 * Config: data-slug (required), data-position="bottom-right"|"bottom-left", data-theme="light"|"dark"
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var slug = script.getAttribute('data-slug');
  var position = script.getAttribute('data-position') || 'bottom-right';
  var theme = script.getAttribute('data-theme') || 'light';
  var baseUrl = script.src.replace(/\/embed-widget\.js.*$/, '');

  if (!slug) {
    console.warn('[Oddjob Widget] data-slug is required');
    return;
  }

  var container = document.createElement('div');
  container.id = 'oddjob-widget-root';
  container.style.cssText = 'position:fixed;z-index:999999;font-family:system-ui,sans-serif;';

  var btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  btn.style.cssText = 'width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;background:#3b82f6;color:white;transition:transform 0.2s;';
  btn.onmouseover = function () { btn.style.transform = 'scale(1.05)'; };
  btn.onmouseout = function () { btn.style.transform = 'scale(1)'; };

  var popup = document.createElement('div');
  popup.id = 'oddjob-widget-popup';
  popup.style.cssText = 'display:none;position:absolute;width:380px;height:520px;max-height:80vh;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.2);background:#fff;';
  if (position === 'bottom-right') {
    popup.style.bottom = '72px';
    popup.style.right = '0';
    container.style.bottom = '20px';
    container.style.right = '20px';
  } else {
    popup.style.bottom = '72px';
    popup.style.left = '0';
    container.style.bottom = '20px';
    container.style.left = '20px';
  }

  var header = document.createElement('div');
  header.style.cssText = 'height:40px;background:#f3f4f6;display:flex;align-items:center;justify-content:space-between;padding:0 12px;flex-shrink:0;';
  var title = document.createElement('span');
  title.textContent = 'Chat';
  title.style.cssText = 'font-weight:600;font-size:14px;';
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'background:none;border:none;font-size:24px;cursor:pointer;line-height:1;color:#6b7280;';
  header.appendChild(title);
  header.appendChild(closeBtn);

  var iframe = document.createElement('iframe');
  var iframeSrc = baseUrl + '/a/' + encodeURIComponent(slug) + '?embed=1&widget=1';
  iframe.src = iframeSrc;
  iframe.title = 'Chat with Assistant';
  iframe.style.cssText = 'width:100%;height:calc(100% - 40px);border:none;';

  popup.appendChild(header);
  popup.appendChild(iframe);
  container.appendChild(popup);
  container.appendChild(btn);
  document.body.appendChild(container);

  function toggle() {
    var isOpen = popup.style.display === 'block';
    popup.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'oddjob:embed:ready', slug: slug }, '*');
    }
  }

  btn.onclick = toggle;
  closeBtn.onclick = toggle;

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'oddjob:embed:ready' && event.data.slug === slug) {
      iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'oddjob:embed:ready', slug: slug }, '*');
    }
  });
})();
