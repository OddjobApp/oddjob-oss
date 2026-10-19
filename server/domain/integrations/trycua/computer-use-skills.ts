// ============================================================================
// COMPUTER-USE SKILL TEMPLATES
// Structured prompt blueprints for common computer-use workflows.
// Each skill defines a system prompt, risk class, default settings,
// and suggested follow-up actions — similar to OpenClaw workspace skills.
// ============================================================================

export type SkillId =
    | "browser_task"
    | "form_filling"
    | "qa_website"
    | "research_task"
    | "admin_console"
    | "desktop_app"
    | "file_management"
    | "data_extraction";

export type SkillRiskClass = "low" | "medium" | "high" | "critical";

export interface ComputerUseSkill {
    id: SkillId;
    name: string;
    description: string;
    icon: string;
    riskClass: SkillRiskClass;
    defaultOs: "windows" | "linux" | "macos";
    defaultMaxSteps: number;
    requireConfirmation: boolean;
    allowedActions: string[];
    systemPrompt: string;
    exampleGoals: string[];
    blockedPatterns: string[];
}

const BASE_LOOP = `
## Execution Loop
1. Take a screenshot to observe the current screen state.
2. Analyze what you see and determine the next action toward the goal.
3. Execute the action.
4. Take a screenshot to verify the result.
5. Repeat until the goal is complete or you are blocked.
6. Report the final result with a clear summary.

## Rules
- Always screenshot before and after significant actions.
- Use exact pixel coordinates from screenshots for click targets.
- If uncertain, screenshot and re-analyze before acting.
- Never exceed your action budget.
- Prefer keyboard shortcuts over mouse when available.
`;

export const COMPUTER_USE_SKILLS: Record<SkillId, ComputerUseSkill> = {

    browser_task: {
        id: "browser_task",
        name: "Browser Task",
        description: "Navigate websites, interact with web UIs, fill forms, extract information, and automate browser workflows.",
        icon: "Globe",
        riskClass: "medium",
        defaultOs: "windows",
        defaultMaxSteps: 15,
        requireConfirmation: false,
        allowedActions: ["browser_navigate", "browser_back", "browser_forward", "browser_refresh", "click", "double_click", "type_text", "key_press", "scroll", "screenshot", "wait"],
        systemPrompt: `You are a browser automation agent controlling a sandboxed desktop browser.
${BASE_LOOP}
## Browser-Specific Rules
- Use browser_navigate to go to URLs.
- Use browser_back/forward for navigation history.
- Use browser_refresh if the page appears stale.
- Prefer clicking visible links and buttons over typing URLs.
- Handle popups, modals, and cookie consent banners before proceeding.
- If login is required and no credentials are provided, stop and report.`,
        exampleGoals: [
            "Go to example.com and take a screenshot of the homepage",
            "Search for 'AI agents' on Google and list the top 5 results",
            "Navigate to GitHub and find the trending repositories today",
        ],
        blockedPatterns: ["payment", "checkout", "purchase", "credit card"],
    },

    form_filling: {
        id: "form_filling",
        name: "Form Filling",
        description: "Fill out web or desktop forms using provided data, then submit or save the result.",
        icon: "ClipboardList",
        riskClass: "high",
        defaultOs: "windows",
        defaultMaxSteps: 10,
        requireConfirmation: true,
        allowedActions: ["click", "type_text", "key_press", "scroll", "clipboard", "screenshot", "wait"],
        systemPrompt: `You are a form-filling agent. You will be given a form location and data to fill in.
${BASE_LOOP}
## Form-Filling Rules
- Read the form fields carefully before typing.
- Use Tab to move between fields when available.
- Verify each field value after entering it before moving on.
- ALWAYS screenshot the completed form before submitting.
- Do NOT submit until instructed — pause and show the filled form for review.
- Never invent data; only use what you are given.
- Report any required fields that have no data provided.`,
        exampleGoals: [
            "Fill out the contact form with the provided name and email, then show me the result before submitting",
            "Complete the registration form with the given details and pause before clicking Submit",
        ],
        blockedPatterns: ["password", "ssn", "credit card", "bank account"],
    },

    qa_website: {
        id: "qa_website",
        name: "QA Website",
        description: "Systematically test a website: check pages load, links work, forms submit, and UI elements are present.",
        icon: "TestTube",
        riskClass: "low",
        defaultOs: "windows",
        defaultMaxSteps: 25,
        requireConfirmation: false,
        allowedActions: ["browser_navigate", "browser_back", "browser_refresh", "click", "double_click", "type_text", "key_press", "scroll", "screenshot", "wait"],
        systemPrompt: `You are a QA engineer testing a website for correctness and usability.
${BASE_LOOP}
## QA Testing Rules
- Record what you see at each step: page title, visible content, any errors.
- Click every primary navigation link and report the result.
- Check that key UI elements (header, footer, navigation) are present on each page.
- Test any forms by filling them with dummy data (e.g. test@example.com, "Test User").
- Screenshot any broken pages, missing images, or error messages.
- Produce a final summary: pages checked, issues found, pass/fail.`,
        exampleGoals: [
            "QA test the main navigation on example.com and report any broken links",
            "Test the login form on the dev site and report what happens with invalid credentials",
        ],
        blockedPatterns: [],
    },

    research_task: {
        id: "research_task",
        name: "Research Task",
        description: "Search the web, read pages, and compile information into a structured summary.",
        icon: "Search",
        riskClass: "low",
        defaultOs: "windows",
        defaultMaxSteps: 20,
        requireConfirmation: false,
        allowedActions: ["browser_navigate", "browser_back", "browser_forward", "browser_refresh", "click", "scroll", "key_press", "screenshot", "wait"],
        systemPrompt: `You are a research agent. Your job is to find and compile information from the web.
${BASE_LOOP}
## Research Rules
- Use search engines to find relevant sources.
- Read multiple sources and cross-reference before reporting.
- Screenshot key findings for traceability.
- Do NOT sign up for services or create accounts.
- Summarize findings clearly at the end with source URLs.
- Flag if information seems unreliable or contradictory.`,
        exampleGoals: [
            "Research the top 3 open-source computer-use frameworks and summarize their features",
            "Find the current pricing for AWS EC2 t3.medium instances in us-east-1",
        ],
        blockedPatterns: [],
    },

    admin_console: {
        id: "admin_console",
        name: "Admin Console Operation",
        description: "Perform administrative operations in a web console, dashboard, or management UI.",
        icon: "Settings",
        riskClass: "high",
        defaultOs: "windows",
        defaultMaxSteps: 10,
        requireConfirmation: true,
        allowedActions: ["click", "double_click", "type_text", "key_press", "scroll", "clipboard", "screenshot", "wait", "browser_navigate"],
        systemPrompt: `You are an admin automation agent operating in a management console. Every action you take may have system-wide consequences.
${BASE_LOOP}
## Admin Rules
- ALWAYS screenshot and describe what you see before taking any action.
- ALWAYS pause and request confirmation before: creating, modifying, or deleting resources.
- NEVER delete or disable anything without explicit instruction.
- NEVER change passwords, API keys, or billing information.
- Document every action taken in your final report.
- If unsure about scope, stop and ask for clarification.`,
        exampleGoals: [
            "Go to the admin panel and take a screenshot of the user list",
            "Check the system health dashboard and report any warnings",
        ],
        blockedPatterns: ["delete", "remove", "disable", "payment", "billing", "password"],
    },

    desktop_app: {
        id: "desktop_app",
        name: "Desktop Application",
        description: "Automate interactions with native desktop applications (Office, IDEs, design tools, etc.).",
        icon: "Monitor",
        riskClass: "medium",
        defaultOs: "windows",
        defaultMaxSteps: 15,
        requireConfirmation: false,
        allowedActions: ["click", "double_click", "right_click", "mouse_move", "drag", "type_text", "key_press", "hotkey", "clipboard", "scroll", "screenshot", "wait", "window_focus", "window_maximize"],
        systemPrompt: `You are a desktop automation agent controlling native applications.
${BASE_LOOP}
## Desktop Rules
- Use window_focus to bring the target application to the foreground.
- Use keyboard shortcuts (hotkey) for menu access where possible — it is faster and more reliable than clicking menus.
- Use clipboard for large text transfers to avoid typing errors.
- Save files before closing applications.
- Use right_click to access context menus when standard UI elements are not visible.`,
        exampleGoals: [
            "Open Notepad, type 'Hello World', and save the file as hello.txt on the Desktop",
            "Open the Calculator app and compute 1234 × 5678",
        ],
        blockedPatterns: [],
    },

    file_management: {
        id: "file_management",
        name: "File Management",
        description: "Navigate the file system, organize files, and manage uploads/downloads.",
        icon: "FolderOpen",
        riskClass: "medium",
        defaultOs: "windows",
        defaultMaxSteps: 10,
        requireConfirmation: true,
        allowedActions: ["click", "double_click", "right_click", "key_press", "hotkey", "clipboard", "screenshot", "wait", "file_upload", "file_download_wait", "window_focus"],
        systemPrompt: `You are a file management agent. You handle file system operations carefully.
${BASE_LOOP}
## File Management Rules
- Always screenshot the file browser before and after operations.
- Confirm the destination path before moving or copying files.
- NEVER delete files without explicit instruction and confirmation.
- Use Ctrl+Z (undo) if you make a mistake.
- Report the final file locations and names in your summary.`,
        exampleGoals: [
            "Organize the Downloads folder by moving PDFs to a 'Documents' subfolder",
            "Upload the report file to the web portal's upload section",
        ],
        blockedPatterns: ["delete", "remove", "format", "wipe"],
    },

    data_extraction: {
        id: "data_extraction",
        name: "Data Extraction",
        description: "Extract structured data from screens, tables, PDFs, and web pages via OCR and vision.",
        icon: "Table",
        riskClass: "low",
        defaultOs: "windows",
        defaultMaxSteps: 10,
        requireConfirmation: false,
        allowedActions: ["click", "scroll", "key_press", "hotkey", "screenshot", "wait", "browser_navigate", "browser_refresh"],
        systemPrompt: `You are a data extraction agent. Your job is to read and extract structured information from the screen.
${BASE_LOOP}
## Extraction Rules
- Use OCR (take screenshots and analyze them) to read text from the screen.
- Extract data into a clean, structured format (JSON or table).
- Navigate to all pages if data is paginated.
- Screenshot each page/section you extract from.
- Do NOT modify the source data.
- Return the extracted data at the end of your task.`,
        exampleGoals: [
            "Extract the table of pricing tiers from the pricing page into a JSON array",
            "Read the invoice on screen and extract vendor, date, amount, and line items",
        ],
        blockedPatterns: [],
    },
};

export function getSkill(id: string): ComputerUseSkill | null {
    return COMPUTER_USE_SKILLS[id as SkillId] ?? null;
}

export function listSkills(): ComputerUseSkill[] {
    return Object.values(COMPUTER_USE_SKILLS);
}

export function buildSkillSystemPrompt(skill: ComputerUseSkill, goal: string, os: string): string {
    return `${skill.systemPrompt.replace(/\${BASE_LOOP}/g, "")}\n\n## Your Goal\n${goal}\n\n## Environment\nOS: ${os}`;
}
