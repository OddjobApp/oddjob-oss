import http from "node:http";

/** The host broker accepts only fixed desktop operations, never arbitrary Docker flags. */
export function desktopBrokerCommand(socketPath: string, args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ args });
        const request = http.request({
            socketPath, path: "/docker", method: "POST", timeout,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
                text += chunk;
                if (text.length > 4 * 1024 * 1024) request.destroy(new Error("Desktop broker response too large"));
            });
            response.on("error", reject);
            response.on("end", () => {
                try {
                    const result = JSON.parse(text);
                    if (response.statusCode !== 200 || result.code !== 0) {
                        reject(Object.assign(new Error(result.stderr || "Desktop broker operation failed"), { stderr: result.stderr }));
                    } else if (typeof result.stdout !== "string") {
                        reject(new Error("Invalid desktop broker response"));
                    } else resolve(result.stdout);
                } catch (error) { reject(error); }
            });
        });
        request.on("error", reject);
        request.on("timeout", () => request.destroy(new Error("Desktop broker request timed out")));
        request.end(body);
    });
}
