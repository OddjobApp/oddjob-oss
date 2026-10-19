/**
 * Simple logger utility for GraphRAG Engine
 */

export interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, error?: any) => void;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;

  return {
    debug: (message: string, meta?: any) => {
      if (process.env.DEBUG) {
        console.debug(`${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    info: (message: string, meta?: any) => {
      console.info(`${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
    },
    warn: (message: string, meta?: any) => {
      console.warn(`${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
    },
    error: (message: string, error?: any) => {
      console.error(`${prefix} ${message}`, error);
    }
  };
}
