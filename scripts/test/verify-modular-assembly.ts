import "dotenv/config";

async function verify() {
  const forgedRes = await fetch("http://localhost:5000/forged/rescue-dispatch");
  console.log("FORGED PAGE STATUS:", forgedRes.status);
  const text = await forgedRes.text();
  console.log("PAGE TITLE:", text.match(/<title>([^<]+)<\/title>/)?.[1]);
  
  const linkMatches = text.match(/<link[^>]+rel=["']stylesheet["'][^>]+>/g) || [];
  console.log(`FOUND ${linkMatches.length} STYLESHEET LINKS`);

  for (const linkTag of linkMatches) {
    const href = linkTag.match(/href=["']([^"']+)["']/)?.[1];
    if (href) {
      const cssRes = await fetch(`http://localhost:5000${href}`);
      const cssText = await cssRes.text();
      console.log(`- CSS ${href} -> STATUS: ${cssRes.status}, CONTENT-TYPE: ${cssRes.headers.get("content-type")}, SIZE: ${cssText.length} bytes`);
    }
  }

  // Component assertions
  const checks = [
    { name: "IndustrialDashboardHero", pass: text.includes("Rescue Dispatch Control") },
    { name: "MetricGrid", pass: text.includes("Mean Response Time") },
    { name: "TacticalMapControl", pass: text.includes("Tactical") || text.includes("Radar") || text.includes("Sector 7") },
    { name: "TacticalSimulationControlBlock", pass: text.includes("What-If Route") || text.includes("Eulerian") },
    { name: "TacticalDispatchQueueBlock", pass: text.includes("Priority Rescues Triage") },
    { name: "TacticalSquadStatusBlock", pass: text.includes("Squad Fleet Readiness") },
    { name: "TacticalServiceProviderBlock", pass: text.includes("Service Provider Network") },
    { name: "TacticalCommsBroadcastBlock", pass: text.includes("Emergency Ops Channel") },
    { name: "StatusTimeline", pass: text.includes("Recent Tactical Activity Stream") }
  ];

  console.log("\nCOMPONENT GALLERY MODULAR ASSEMBLY VERIFICATION:");
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}`);
  }

  process.exit(0);
}

verify().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
