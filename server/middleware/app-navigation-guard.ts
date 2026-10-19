/** Keep root-relative tenant app links inside their public proxy and room context. */
export function appNavigationGuard(slug: string): string {
  const safeSlug = JSON.stringify(slug).replace(/</g, '\\u003c');
  return `<script data-oddjob-app-nav-guard>
(function(){
  var slug = ${safeSlug};
  if (window.__oddjobAppNavGuard) return;
  window.__oddjobAppNavGuard = true;
  document.addEventListener("click", function(event) {
    var target = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!target || target.target === "_blank" || event.button > 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var raw = target.getAttribute("href") || "";
    if (!raw || raw[0] !== "/" || raw.indexOf("//") === 0) return;
    if (/^\\/(app|api|assets|auth|login|logout|_next)(\\/|$)/.test(raw)) return;
    if (!window.location.pathname.match(/^\\/app\\//)) return;
    event.preventDefault();
    // Next/React must not initiate a competing navigation to the unproxied path.
    event.stopImmediatePropagation();
    var next = "/app/" + slug + (raw === "/" ? "" : raw);
    var destination = new URL(next, location.origin);
    var context = new URLSearchParams(location.search);
    ['crewRoom','crewActivity','orgId','embedded'].forEach(function(key){if(context.has(key)) destination.searchParams.set(key,context.get(key));});
    destination.searchParams.set('embed','cycle');
    window.location.assign(destination.pathname + destination.search + destination.hash);
  }, true);
})();</script>`;
}
