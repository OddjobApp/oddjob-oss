
import "dotenv/config";
try {
    const { AGENT_TOOLS } = await import("../domain/tools/v1/capabilities/index");
    console.log("Agent Tools Loaded Successfully");
    console.log("Has Mission Tools:", !!AGENT_TOOLS.launch_mission);
} catch (e: any) {
    console.error("Verification Failed:", e.message);
    console.error(e.stack);
}

