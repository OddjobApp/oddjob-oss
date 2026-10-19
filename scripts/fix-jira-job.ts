import { db } from "../server/db/index.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function fixJob() {
    console.log("🛠️ Fixing Job 67 (Jira Migration Report Generator)...");

    const scriptContent = `
import json
import sys
import jinja2

def generate_report(data):
    template_str = """
# Jira Migration Report
Generated at: {{ timestamp }}

## Summary
- Total Issues: {{ issues|length }}
- Status: {{ status }}

## Details
{% for issue in issues %}
- [{{ issue.key }}]: {{ issue.summary }} ({{ issue.status }})
{% endfor %}

## Conclusion
The migration is proceedding as {{ status }}.
"""
    template = jinja2.Template(template_str)
    return template.render(data)

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
    except:
        input_data = {"issues": [], "status": "unknown", "timestamp": "N/A"}

    report = generate_report(input_data)
    print(report)
`;

    const [updated] = await db
        .update(jobs)
        .set({
            config: {
                script: "report_generator.py",
                dependencies: ["jinja2"],
                scriptContent: scriptContent
            }
        })
        .where(eq(jobs.id, 67))
        .returning();

    if (updated) {
        console.log("✅ Job 67 updated successfully with scriptContent.");
        console.log("New Config:", JSON.stringify(updated.config, null, 2));
    } else {
        console.error("❌ Job 67 not found in the database.");
    }

    process.exit(0);
}

fixJob().catch(err => {
    console.error("❌ Fix failed:", err);
    process.exit(1);
});
