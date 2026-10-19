
import dotenv from "dotenv";
dotenv.config();

console.log("[Diagnostic] Step 1: Importing instrumentation.js");
import("./instrumentation.js").then(() => {
    console.log("[Diagnostic] Step 2: Importing routes.js");
    return import("./routes.js");
}).then(() => {
    console.log("[Diagnostic] Step 3: Importing vite.js");
    return import("./vite.js");
}).then(() => {
    console.log("[Diagnostic] Step 4: Importing database_service.js");
    return import("./database_service.js");
}).then(() => {
    console.log("[Diagnostic] Step 5: SUCCESS - All critical modules imported");
    process.exit(0);
}).catch(err => {
    console.error("[Diagnostic] FAILED:", err);
    process.exit(1);
});

setTimeout(() => {
    console.log("[Diagnostic] TIMEOUT - Still hanging after 10s");
    process.exit(1);
}, 10000);
