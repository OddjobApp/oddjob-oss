
/**
 * Math Utilities
 */

/**
 * Calculate Shannon entropy of a string
 * Used for detecting high-entropy strings like API keys or encrypted data.
 */
export function calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const frequencies: Record<string, number> = {};
    for (const char of str) {
        frequencies[char] = (frequencies[char] || 0) + 1;
    }
    let entropy = 0;
    for (const char in frequencies) {
        const p = frequencies[char] / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

