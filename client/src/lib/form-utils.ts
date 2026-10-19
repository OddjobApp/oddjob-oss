export type FormErrorObject = { message?: string; ref?: unknown; type?: string } | Record<string, unknown>;

export const getErrorMessages = (errorObj: FormErrorObject | unknown, prefix = ''): string[] => {
    let messages: string[] = [];

    // Handle direct message
    if (errorObj && typeof errorObj === 'object' && 'message' in errorObj && errorObj.message) {
        messages.push(`${prefix}${errorObj.message}`);
    }

    // Handle regular object (nested fields) or array (steps)
    if (typeof errorObj === 'object' && errorObj !== null) {
        Object.entries(errorObj).forEach(([key, value]) => {
            if (key === 'message' || key === 'ref' || key === 'type') return; // Skip internal fields

            // Special handling for array steps to show "Step X"
            const newPrefix = Array.isArray(errorObj)
                ? `Step ${parseInt(key) + 1}: `
                : prefix ? `${prefix}${key}: ` : `${key}: `;

            messages = [...messages, ...getErrorMessages(value, newPrefix)];
        });
    }

    return messages;
};
