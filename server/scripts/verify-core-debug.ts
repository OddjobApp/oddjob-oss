
import "dotenv/config";
try {
    const { CORE_TOOLS } = await import("../domain/tools/v1/capabilities/core");
    console.log("Core Tools:", Object.keys(CORE_TOOLS));
} catch (e: any) {
    console.error("Verification Failed:", e.message);
    console.error(e.stack);
}

