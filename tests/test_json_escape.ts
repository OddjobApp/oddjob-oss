const jsons = [
    '{"key": "C:\\\\users\\\\bob"}', // valid
    '{"key": "C:\\Apps\\test"}',   // bad escaped character (\A)
    '{"key": "C:\\users\\bob"}'    // bad unicode escape (\u... sers)
];

for (const json of jsons) {
    console.log("----");
    console.log("Testing:", json);
    try {
        JSON.parse(json);
        console.log("Parsed fine");
    } catch (e) {
        console.log("Original error:", e.message);
        
        let fixed = json;
        // Fix 1: Bad escaped character (not in our allowed list)
        fixed = fixed.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
        
        // Fix 2: Bad unicode escape (u followed by < 4 hex digits)
        fixed = fixed.replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u');
        
        console.log("Fixed string:", fixed);
        try {
            JSON.parse(fixed);
            console.log("Parsed fixed string successfully");
        } catch (e2) {
            console.log("Error after fix:", e2.message);
        }
    }
}
