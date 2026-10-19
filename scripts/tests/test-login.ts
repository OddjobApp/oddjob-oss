
import "dotenv/config";

async function main() {
    console.log("Testing Login...");

    const username = "admin";
    const password = "admin";

    try {
        const response = await fetch("http://127.0.0.1:5000/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        console.log(`Response Status: ${response.status} ${response.statusText}`);

        const text = await response.text();
        console.log("Response Body:", text);

        if (response.ok) {
            console.log("Login Successful!");
            // Check for set-cookie header
            const cookies = response.headers.get('set-cookie');
            console.log("Set-Cookie:", cookies);
        } else {
            console.log("Login Failed!");
        }
    } catch (error) {
        console.error("Network Error:", error);
    }
}

main().catch(console.error);
