import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Log Levels
 */
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    FATAL = 'FATAL',
}

/**
 * Log Entry Structure - for structured logging
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    correlationId?: string;
    component?: string;
    context?: Record<string, any>;
    error?: {
        name: string;
        message: string;
        stack?: string;
        code?: string;
    };
    duration?: number;
    userId?: string;
    requestId?: string;
    path?: string;
    method?: string;
}

/**
 * Logger Configuration
 */
export interface LoggerConfig {
    minLevel: LogLevel;
    prettyPrint: boolean;
    includeTimestamp: boolean;
    includeStack: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
    [LogLevel.FATAL]: 4,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '\x1b[36m', // Cyan
    [LogLevel.INFO]: '\x1b[32m',  // Green
    [LogLevel.WARN]: '\x1b[33m',  // Yellow
    [LogLevel.ERROR]: '\x1b[31m', // Red
    [LogLevel.FATAL]: '\x1b[35m', // Magenta
};

const RESET_COLOR = '\x1b[0m';

/**
 * Central Logger Class
 * 
 * Provides structured logging with correlation IDs, context, and consistent formatting.
 */
export class Logger {
    private component: string;
    private config: LoggerConfig;
    private static globalCorrelationId: string | undefined;

    constructor(component: string, config?: Partial<LoggerConfig>) {
        this.component = component;
        this.config = {
            minLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
            prettyPrint: process.env.NODE_ENV !== 'production',
            includeTimestamp: true,
            includeStack: process.env.NODE_ENV !== 'production',
            ...config,
        };
    }

    /**
     * Set a global correlation ID (useful for request context)
     */
    static setCorrelationId(id: string) {
        Logger.globalCorrelationId = id;
    }

    /**
     * Generate a new correlation ID
     */
    static generateCorrelationId(): string {
        return randomUUID().slice(0, 8);
    }

    /**
     * Get the current correlation ID
     */
    static getCorrelationId(): string | undefined {
        return Logger.globalCorrelationId;
    }

    /**
     * Clear the correlation ID
     */
    static clearCorrelationId() {
        Logger.globalCorrelationId = undefined;
    }

    /**
     * Check if the log level should be logged
     */
    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel];
    }

    /**
     * Format error for logging
     */
    private formatError(error: Error | any): LogEntry['error'] {
        if (!error) return undefined;

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: this.config.includeStack ? error.stack : undefined,
                code: (error as any).code,
            };
        }

        return {
            name: 'UnknownError',
            message: String(error),
        };
    }

    /**
     * Create a log entry
     */
    private createEntry(
        level: LogLevel,
        message: string,
        context?: Record<string, any>,
        error?: Error | any
    ): LogEntry {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            correlationId: context?.correlationId || Logger.globalCorrelationId,
            component: this.component,
            context: context ? this.sanitizeContext(context) : undefined,
            error: error ? this.formatError(error) : undefined,
            duration: context?.duration,
            userId: context?.userId,
            requestId: context?.requestId,
            path: context?.path,
            method: context?.method,
        };
    }

    /**
     * Sanitize context to avoid logging sensitive data
     */
    private sanitizeContext(context: Record<string, any>): Record<string, any> {
        const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'authorization', 'cookie'];
        const sanitized: Record<string, any> = {};

        for (const [key, value] of Object.entries(context)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveKeys.some(k => lowerKey.includes(k))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                sanitized[key] = this.sanitizeContext(value);
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Format log entry for output
     */
    private format(entry: LogEntry): string {
        if (!this.config.prettyPrint) {
            // JSON format for production/log aggregation
            return JSON.stringify(entry);
        }

        // Pretty format for development
        const color = LOG_LEVEL_COLORS[entry.level];
        const parts: string[] = [];

        // Timestamp
        if (this.config.includeTimestamp) {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            parts.push(`\x1b[90m${time}${RESET_COLOR}`);
        }

        // Level with color
        parts.push(`${color}[${entry.level.padEnd(5)}]${RESET_COLOR}`);

        // Correlation ID (shortened for readability)
        if (entry.correlationId) {
            parts.push(`\x1b[90m(${entry.correlationId})${RESET_COLOR}`);
        }

        // Component
        parts.push(`\x1b[36m[${entry.component}]${RESET_COLOR}`);

        // Message
        parts.push(entry.message);

        // Duration if present
        if (entry.duration !== undefined) {
            parts.push(`\x1b[90m(${entry.duration}ms)${RESET_COLOR}`);
        }

        let output = parts.join(' ');

        // Add context on new line if present
        if (entry.context && Object.keys(entry.context).length > 0) {
            const contextStr = JSON.stringify(entry.context, null, 2)
                .split('\n')
                .map(line => `  ${line}`)
                .join('\n');
            output += `\n\x1b[90m${contextStr}${RESET_COLOR}`;
        }

        // Add error details on new line if present
        if (entry.error) {
            output += `\n${color}  Error: ${entry.error.name}: ${entry.error.message}${RESET_COLOR}`;
            if (entry.error.stack && this.config.includeStack) {
                const stackLines = entry.error.stack
                    .split('\n')
                    .slice(1, 6) // First 5 stack frames
                    .map(line => `\x1b[90m  ${line.trim()}${RESET_COLOR}`)
                    .join('\n');
                output += `\n${stackLines}`;
            }
        }

        return output;
    }

    /**
     * Write log to output
     */
    private write(entry: LogEntry) {
        const formatted = this.format(entry);

        if (entry.level === LogLevel.ERROR || entry.level === LogLevel.FATAL) {
            console.error(formatted);
        } else if (entry.level === LogLevel.WARN) {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }

        // File logging
        const logsPath = process.env.LOGS_PATH;
        if (logsPath) {
            try {
                const logFile = path.join(logsPath, `${new Date().toISOString().split('T')[0]}.log`);
                const line = JSON.stringify(entry) + '\n';
                fs.promises.appendFile(logFile, line).catch(() => { });
            } catch (err) {
                // Fail silently for file logging to avoid crashing the app
            }
        }
    }

    /**
     * Log a debug message
     */
    debug(message: string, context?: Record<string, any>) {
        if (!this.shouldLog(LogLevel.DEBUG)) return;
        this.write(this.createEntry(LogLevel.DEBUG, message, context));
    }

    /**
     * Log an info message
     */
    info(message: string, context?: Record<string, any>) {
        if (!this.shouldLog(LogLevel.INFO)) return;
        this.write(this.createEntry(LogLevel.INFO, message, context));
    }

    /**
     * Log a warning message
     */
    warn(message: string, context?: Record<string, any>, error?: Error | any) {
        if (!this.shouldLog(LogLevel.WARN)) return;
        this.write(this.createEntry(LogLevel.WARN, message, context, error));
    }

    /**
     * Log an error message
     */
    error(message: string, error?: Error | any, context?: Record<string, any>) {
        if (!this.shouldLog(LogLevel.ERROR)) return;
        this.write(this.createEntry(LogLevel.ERROR, message, context, error));
    }

    /**
     * Log a fatal error message
     */
    fatal(message: string, error?: Error | any, context?: Record<string, any>) {
        if (!this.shouldLog(LogLevel.FATAL)) return;
        this.write(this.createEntry(LogLevel.FATAL, message, context, error));
    }

    /**
     * Create a child logger with additional component prefix
     */
    child(subComponent: string): Logger {
        return new Logger(`${this.component}:${subComponent}`, this.config);
    }

    /**
     * Log operation timing
     */
    time(label: string): () => void {
        const start = Date.now();
        return () => {
            const duration = Date.now() - start;
            this.debug(`${label} completed`, { duration });
        };
    }

    /**
     * Wrap an async operation with timing and error logging
     */
    async withTiming<T>(
        label: string,
        operation: () => Promise<T>,
        context?: Record<string, any>
    ): Promise<T> {
        const start = Date.now();
        try {
            const result = await operation();
            const duration = Date.now() - start;
            this.debug(`${label} completed`, { ...context, duration });
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.error(`${label} failed`, error, { ...context, duration });
            throw error;
        }
    }
}

/**
 * Create pre-configured loggers for different components
 */
export const createLogger = (component: string): Logger => new Logger(component);

// Default loggers for common components
export const pipelineLogger = createLogger('Pipeline');
export const jobLogger = createLogger('Job');
export const apiLogger = createLogger('API');
export const authLogger = createLogger('Auth');
export const dbLogger = createLogger('Database');
export const aiLogger = createLogger('AI');
export const schedulerLogger = createLogger('Scheduler');
export const webhookLogger = createLogger('Webhook');
export const knowledgeLogger = createLogger('Knowledge');
export const logger = pipelineLogger;

