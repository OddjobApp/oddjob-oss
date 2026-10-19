export interface FormField {
    key: string;
    type: "text" | "textarea" | "markdown" | "select" | "rating" | "boolean" | "number" | "date";
    label: string;
    description?: string;
    required?: boolean;
    options?: string[];
    placeholder?: string;
    max?: number;
    defaultValue?: string;
    readOnly?: boolean;
}

export interface FormStep {
    id: string;
    title: string;
    description?: string;
    fields: FormField[];
}

export interface FormSchema {
    steps?: FormStep[];
    fields?: FormField[]; // Legacy support for single-step forms
}
