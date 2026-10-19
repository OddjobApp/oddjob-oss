async function checkMission() {
    const missionId = 465;
    console.log(`Checking mission ${missionId}...`);
    
    try {
        const res = await fetch(`http://127.0.0.1:5000/api/mission-runs/${missionId}`);
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Fetch failed:', err.message);
    }
}

checkMission();
