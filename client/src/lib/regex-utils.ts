/**
 * Regex-to-Verbal Translation Utilities
 * 
 * Translates regex patterns into human-readable descriptions for form validation errors.
 * Used by both the public AgentInputForm and the internal Oddjob Assistant.
 */

/**
 * Translates a regex pattern into a user-friendly verbal description.
 * Falls back to generic message if pattern cannot be interpreted.
 */
export function translateRegexToVerbal(pattern: string): string {
    // Common exact-length patterns: ^[A-Z]{3}$, ^[0-9]{5}$, ^.{10}$
    const exactLengthMatch = pattern.match(/^\^?\[?([^\]{}]+)\]?\{(\d+)\}\$?$/);
    if (exactLengthMatch) {
        const [, charClass, count] = exactLengthMatch;
        const charDesc = describeCharClass(charClass);
        return `Must be exactly ${count} ${charDesc}`;
    }

    // Range-length patterns: ^[A-Z]{3,5}$
    const rangeLengthMatch = pattern.match(/^\^?\[?([^\]{}]+)\]?\{(\d+),(\d+)\}\$?$/);
    if (rangeLengthMatch) {
        const [, charClass, min, max] = rangeLengthMatch;
        const charDesc = describeCharClass(charClass);
        return `Must be between ${min} and ${max} ${charDesc}`;
    }

    // Min-length patterns: ^.{5,}$
    const minLengthMatch = pattern.match(/^\^?\[?([^\]{}]+)\]?\{(\d+),\}\$?$/);
    if (minLengthMatch) {
        const [, charClass, min] = minLengthMatch;
        const charDesc = describeCharClass(charClass);
        return `Must be at least ${min} ${charDesc}`;
    }

    // Email pattern detection
    if (pattern.includes('@') || pattern.toLowerCase().includes('email')) {
        return 'Must be a valid email address';
    }

    // Phone number patterns
    if (pattern.includes('\\d') && (pattern.includes('-') || pattern.includes('('))) {
        return 'Must be a valid phone number';
    }

    // URL patterns
    if (pattern.includes('http') || pattern.includes('://')) {
        return 'Must be a valid URL';
    }

    // VIN pattern (17 alphanumeric)
    if (pattern.includes('[A-HJ-NPR-Z0-9]') && pattern.includes('17')) {
        return 'Must be a valid 17-character VIN (no I, O, or Q)';
    }

    // Analyze individual components
    const parts: string[] = [];

    if (pattern.includes('[A-Z]') && !pattern.includes('[a-z]')) {
        parts.push('uppercase letters only');
    } else if (pattern.includes('[a-z]') && !pattern.includes('[A-Z]')) {
        parts.push('lowercase letters only');
    } else if (pattern.includes('[A-Za-z]') || pattern.includes('[a-zA-Z]')) {
        parts.push('letters only');
    }

    if (pattern.includes('[0-9]') || pattern.includes('\\d')) {
        if (parts.length > 0) {
            parts[parts.length - 1] = parts[parts.length - 1].replace(' only', '');
            parts.push('and numbers');
        } else {
            parts.push('numbers only');
        }
    }

    if (pattern.includes('^') && pattern.includes('$')) {
        // Has anchors - exact match required
        const lengthMatch = pattern.match(/\{(\d+)(?:,(\d*))?\}/);
        if (lengthMatch) {
            const [, min, max] = lengthMatch;
            if (max === undefined) {
                parts.unshift(`exactly ${min} characters`);
            } else if (max === '') {
                parts.unshift(`at least ${min} characters`);
            } else {
                parts.unshift(`${min}-${max} characters`);
            }
        }
    }

    if (parts.length > 0) {
        return `Must be ${parts.join(', ')}`;
    }

    return 'Invalid format. Please check the required format.';
}

/**
 * Describes a regex character class in plain English
 */
export function describeCharClass(charClass: string): string {
    if (charClass === '.') return 'characters';
    if (charClass === 'A-Z') return 'uppercase letters';
    if (charClass === 'a-z') return 'lowercase letters';
    if (charClass === 'A-Za-z' || charClass === 'a-zA-Z') return 'letters';
    if (charClass === '0-9' || charClass === '\\d') return 'digits';
    if (charClass === 'A-Z0-9' || charClass === '0-9A-Z') return 'uppercase letters or digits';
    if (charClass === 'a-z0-9' || charClass === '0-9a-z') return 'lowercase letters or digits';
    if (charClass.includes('A-Z') && charClass.includes('a-z') && charClass.includes('0-9')) {
        return 'letters or digits';
    }
    return 'characters';
}
