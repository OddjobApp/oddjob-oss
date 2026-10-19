export function validateRecord(record: any, rules: any): string[] {
    const errors: string[] = [];
    if (!rules) return errors;

    for (const [field, fieldRules] of Object.entries(rules)) {
        const value = record[field];
        const ruleList = Array.isArray(fieldRules) ? fieldRules : [];

        for (const rule of ruleList) {
            // Skip checks if value is missing unless it's a required check
            if ((value === undefined || value === null || value === '') && rule.type !== 'required') {
                continue;
            }

            // @ts-ignore
            const ruleParams = rule.params;
            // @ts-ignore
            const ruleMessage = rule.message;

            switch (rule.type) {
                case 'required':
                    if (value === undefined || value === null || value === '') {
                        errors.push(ruleMessage || `${field} is required`);
                    }
                    break;
                case 'regex':
                    if (ruleParams?.pattern && !new RegExp(ruleParams.pattern).test(String(value))) {
                        errors.push(ruleMessage || `${field} format is invalid`);
                    }
                    break;
                case 'number_range':
                    const num = Number(value);
                    if (isNaN(num)) {
                        errors.push(`${field} must be a number`);
                    } else {
                        if (ruleParams?.min !== undefined && num < ruleParams.min) {
                            errors.push(ruleMessage || `${field} must be at least ${ruleParams.min}`);
                        }
                        if (ruleParams?.max !== undefined && num > ruleParams.max) {
                            errors.push(ruleMessage || `${field} must be at most ${ruleParams.max}`);
                        }
                    }
                    break;
                case 'email':
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
                        errors.push(ruleMessage || `${field} must be a valid email`);
                    }
                    break;
                case 'url':
                    try {
                        new URL(String(value));
                    } catch {
                        errors.push(ruleMessage || `${field} must be a valid URL`);
                    }
                    break;
                case 'enum':
                    if (Array.isArray(ruleParams?.values) && !ruleParams.values.includes(value)) {
                        errors.push(ruleMessage || `${field} must be one of: ${ruleParams.values.join(', ')}`);
                    }
                    break;
            }
        }
    }
    return errors;
}


