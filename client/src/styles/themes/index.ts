export const lightTheme = {
    // Base colors
    background: '#ffffff',
    backgroundSecondary: '#f8f9fa',
    backgroundTertiary: '#e9ecef',

    // Text colors
    text: '#212529',
    textSecondary: '#6c757d',
    textTertiary: '#adb5bd',

    // Primary brand colors
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryActive: '#1d4ed8',

    // Semantic colors
    success: '#10b981',
    successHover: '#059669',
    warning: '#f59e0b',
    warningHover: '#d97706',
    error: '#ef4444',
    errorHover: '#dc2626',
    info: '#3b82f6',
    infoHover: '#2563eb',

    // UI elements
    border: '#dee2e6',
    borderHover: '#adb5bd',
    shadow: 'rgba(0, 0, 0, 0.1)',
    shadowHover: 'rgba(0, 0, 0, 0.15)',

    // Interactive elements
    hover: '#f1f3f5',
    active: '#e9ecef',
    focus: '#3b82f6',

    // Status colors
    statusRunning: '#f59e0b',
    statusCompleted: '#10b981',
    statusFailed: '#ef4444',
    statusPending: '#6c757d',
    statusCancelled: '#adb5bd',

    // Code/syntax
    codeBackground: '#f8f9fa',
    codeBorder: '#dee2e6',
    codeText: '#212529',
};

export const darkTheme = {
    // Base colors
    background: '#0f172a',
    backgroundSecondary: '#1e293b',
    backgroundTertiary: '#334155',

    // Text colors
    text: '#f1f5f9',
    textSecondary: '#cbd5e1',
    textTertiary: '#94a3b8',

    // Primary brand colors
    primary: '#60a5fa',
    primaryHover: '#3b82f6',
    primaryActive: '#2563eb',

    // Semantic colors
    success: '#34d399',
    successHover: '#10b981',
    warning: '#fbbf24',
    warningHover: '#f59e0b',
    error: '#f87171',
    errorHover: '#ef4444',
    info: '#60a5fa',
    infoHover: '#3b82f6',

    // UI elements
    border: '#475569',
    borderHover: '#64748b',
    shadow: 'rgba(0, 0, 0, 0.3)',
    shadowHover: 'rgba(0, 0, 0, 0.4)',

    // Interactive elements
    hover: '#1e293b',
    active: '#334155',
    focus: '#60a5fa',

    // Status colors
    statusRunning: '#fbbf24',
    statusCompleted: '#34d399',
    statusFailed: '#f87171',
    statusPending: '#94a3b8',
    statusCancelled: '#64748b',

    // Code/syntax
    codeBackground: '#1e293b',
    codeBorder: '#475569',
    codeText: '#f1f5f9',
};

export type Theme = typeof lightTheme;
export type ThemeMode = 'light' | 'dark';
