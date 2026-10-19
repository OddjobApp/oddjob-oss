export interface FormField {
    key: string;
    type: "text" | "number" | "select" | "checkbox" | "multiselect" | "textarea";
    label: string;
    required?: boolean;
    defaultValue?: any;
    options?: { label: string; value: any }[];
}

export interface FormSchema {
    fields: FormField[];
    themeConfig?: {
        logoUrl?: string;
        primaryColor?: string;
        companyName?: string;
        backgroundUrl?: string; // NEW: Custom background for portal
        accentColor?: string;   // NEW: For secondary buttons/links
    };
    securityConfig?: {
        requireOtp?: boolean;
        tokenExpirationHours?: number;
    };
}

export class HilFormFactory {
    private static forms: Map<string, FormSchema> = new Map();

    public static register(key: string, schema: FormSchema) {
        this.forms.set(key, schema);
    }

    public static getSchema(key: string): FormSchema | undefined {
        return this.forms.get(key);
    }

    public static getAllKeys(): string[] {
        return Array.from(this.forms.keys());
    }

    /**
     * Generate a public, white-labeled URL for a specific HIL task.
     */
    public static async generatePublicUrl(params: {
        executionId: string;
        formId: number;
        email: string;
        baseUrl?: string;
    }): Promise<string> {
        const { generateExternalToken } = await import("@domain/auth/core/jwt.service.js");
        
        const token = generateExternalToken({
            executionId: params.executionId,
            formId: params.formId,
            email: params.email,
            role: "external",
        });

        const baseUrl = params.baseUrl || process.env.APP_URL || "http://localhost:5000";
        return `${baseUrl}/external/task?token=${token}`;
    }
}

// Register Standard Forms
HilFormFactory.register("standard_approval", {
    fields: [
        { key: "approved", type: "checkbox", label: "Approve this request?", required: true, defaultValue: true },
        { key: "comments", type: "textarea", label: "Comments", required: false }
    ]
});

HilFormFactory.register("dataset_review", {
    fields: [
        { key: "decision", type: "select", label: "Dataset Quality", required: true, options: [
            { label: "High Quality", value: "high" },
            { label: "Minor Issues", value: "minor" },
            { label: "Major Issues / Reject", value: "major" }
        ]},
        { key: "notes", type: "textarea", label: "Review Notes", required: true }
    ]
});

HilFormFactory.register("mission_steering", {
    fields: [
        { key: "steer_direction", type: "select", label: "How should the agent proceed?", required: true, options: [
            { label: "Continue as planned", value: "continue" },
            { label: "Pivot to research", value: "pivot_research" },
            { label: "Halt mission", value: "halt" }
        ]},
        { key: "feedback", type: "textarea", label: "Specific Instructions", required: true }
    ]
});
