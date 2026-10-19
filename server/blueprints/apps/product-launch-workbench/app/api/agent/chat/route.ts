import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("RECEIVED API AGENT CHAT POST REQUEST!");
  try {
    const { message, context } = await req.json();
    console.log("Parsed body:", message);
    
    // Simple mock response for testing and demonstration
    let response = "I understand. I'm processing your request.";
    
    if (message.includes("Project Phoenix")) {
      response = "I have successfully initialized a product launch process for **Project Phoenix**. I'm currently setting up the GTM strategy, Content Studio templates, and Sales Enablement resources. You can track my progress in the Live Feed and review pending actions in the Approvals tab.";
    }

    return NextResponse.json({
      response,
      agent: context?.agentName || "Agent",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
