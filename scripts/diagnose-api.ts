


async function diagnose() {
  console.log("Diagnosing API endpoints...");
  
  const endpoints = [
    { method: 'GET', url: '/api/org-settings' },
    { method: 'GET', url: '/api/jobs?limit=50&offset=0&includeDrafts=true' },
    { method: 'GET', url: '/api/document-blueprints' }
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.method} ${endpoint.url}...`);
      const res = await fetch(`http://localhost:5000${endpoint.url}`);
      console.log(`Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`Success! Received ${Array.isArray(data) ? data.length : 'object'} results.`);
      } else {
        const text = await res.text();
        console.error(`Failed: ${text.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }
  }
}

diagnose();
