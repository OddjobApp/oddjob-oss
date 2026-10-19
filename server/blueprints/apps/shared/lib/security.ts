/**
 * Security Middleware for Oddjob Generated Apps
 *
 * Auto-injected by the forge pipeline for all generated applications.
 * Provides security headers, CSP, and protection against common vulnerabilities.
 *
 * This file is automatically included in all Oddjob-generated applications.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security headers configuration
 * These headers protect against XSS, clickjacking, and other common attacks
 */
export const securityHeaders = {
  // Prevent clickjacking
  "X-Frame-Options": "DENY",

  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",

  // XSS protection (legacy browsers)
  "X-XSS-Protection": "1; mode=block",

  // Referrer policy
  "Referrer-Policy": "strict-origin-when-cross-origin",

  // Permissions policy (formerly Feature-Policy)
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",

  // Strict transport security (HTTPS only)
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

/**
 * Content Security Policy
 * Restricts what resources can be loaded and executed
 */
export const contentSecurityPolicy = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'", // Required for Next.js
    "'unsafe-eval'", // Required for Next.js dynamic imports
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'"],
  "connect-src": [
    "'self'",
    process.env.ODDJOB_API_URL || "https://api.oddjob.io",
  ],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "base-uri": ["'self'"],
  "upgrade-insecure-requests": [],
};

/**
 * Build CSP string from policy object
 */
function buildCSP(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([directive, sources]) => {
      if (sources.length === 0) return directive;
      return `${directive} ${sources.join(" ")}`;
    })
    .join("; ");
}

/**
 * Main security middleware
 * Apply to all routes for comprehensive protection
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Apply security headers
  Object.entries(securityHeaders).forEach(([header, value]) => {
    response.headers.set(header, value);
  });

  // Apply CSP
  response.headers.set(
    "Content-Security-Policy",
    buildCSP(contentSecurityPolicy)
  );

  // Add cache control for sensitive pages
  if (
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api")
  ) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  return response;
}

/**
 * Middleware configuration
 * Match all routes except static files and API routes (handled separately)
 */
export const config = {
  matcher: "/:path*",
};

/**
 * API route security wrapper
 * Apply additional protections to API routes
 */
export function withSecurity(handler: Function) {
  return async function securedHandler(
    req: Request,
    ...args: any[]
  ): Promise<Response> {
    // Check for common attack patterns
    const url = new URL(req.url);
    const userAgent = req.headers.get("user-agent") || "";

    // Block known bad user agents
    const badUserAgents = [
      /sqlmap/i,
      /nikto/i,
      /nmap/i,
      /masscan/i,
      /zgrab/i,
      /gobuster/i,
      /dirbuster/i,
    ];

    if (badUserAgents.some((ua) => ua.test(userAgent))) {
      return new Response("Forbidden", { status: 403 });
    }

    // Block common attack paths
    const suspiciousPaths = [
      /\.\./, // Path traversal
      /\.env$/i, // Environment files
      /\.git/i, // Git repositories
      /\.htaccess/i, // Apache config
      /phpmyadmin/i, // phpMyAdmin
      /wp-admin/i, // WordPress admin
      /admin\.php/i, // Common admin paths
    ];

    if (suspiciousPaths.some((pattern) => pattern.test(url.pathname))) {
      return new Response("Forbidden", { status: 403 });
    }

    // Call original handler
    return handler(req, ...args);
  };
}

/**
 * Input sanitization utilities
 */
export const sanitizer = {
  /**
   * Sanitize HTML to prevent XSS
   */
  html(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/\//g, "&#x2F;");
  },

  /**
   * Sanitize for safe JSON inclusion
   */
  json(input: string): string {
    return input
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  },

  /**
   * Sanitize file path to prevent path traversal
   */
  path(input: string): string {
    // Remove null bytes
    let sanitized = input.replace(/\0/g, "");

    // Remove traversal sequences
    sanitized = sanitized.replace(/\.\.\/|\.\.\\/g, "");

    // Ensure path is relative (no leading slash)
    sanitized = sanitized.replace(/^\/+/, "");

    return sanitized;
  },

  /**
   * Sanitize SQL identifier (table/column names)
   * Note: This is NOT for values - use parameterized queries for values
   */
  sqlIdentifier(input: string): string {
    // Only allow alphanumeric and underscores
    return input.replace(/[^a-zA-Z0-9_]/g, "");
  },

  /**
   * Remove control characters
   */
  controlChars(input: string): string {
    return input.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
  },

  /**
   * Trim and normalize whitespace
   */
  normalize(input: string): string {
    return input.replace(/\s+/g, " ").trim();
  },
};

/**
 * Validation utilities
 */
export const validator = {
  /**
   * Validate email format
   */
  isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  },

  /**
   * Validate URL is safe (no javascript: protocol, etc.)
   */
  isSafeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const allowedProtocols = ["http:", "https:", "mailto:", "tel:"];
      return allowedProtocols.includes(parsed.protocol);
    } catch {
      return false;
    }
  },

  /**
   * Check for common XSS patterns
   */
  containsXSS(input: string): boolean {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // event handlers
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
    ];

    return xssPatterns.some((pattern) => pattern.test(input));
  },

  /**
   * Check for SQL injection patterns
   */
  containsSQLInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
      /(--|#|\/\*)/, // SQL comments
      /(\bOR\b|\bAND\b)\s+\d+\s*=\s*\d+/gi, // Boolean-based
      /;\s*\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b/gi, // Stacked queries
    ];

    return sqlPatterns.some((pattern) => pattern.test(input));
  },

  /**
   * Validate file extension is safe
   */
  isSafeFileExtension(filename: string, allowed: string[]): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return allowed.includes(ext);
  },
};

/**
 * Security utilities for client-side code
 */
export const clientSecurity = {
  /**
   * Safe localStorage/sessionStorage wrapper
   * Prevents XSS via stored data
   */
  storage: {
    set(key: string, value: any): void {
      try {
        const sanitized = JSON.stringify(value);
        localStorage.setItem(key, sanitized);
      } catch (e) {
        console.error("Failed to store data:", e);
      }
    },

    get(key: string): any {
      try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
      } catch (e) {
        console.error("Failed to parse stored data:", e);
        return null;
      }
    },

    remove(key: string): void {
      localStorage.removeItem(key);
    },
  },

  /**
   * Safe URL opener
   */
  openUrl(url: string, target: string = "_blank"): void {
    if (!validator.isSafeUrl(url)) {
      console.error("Attempted to open unsafe URL:", url);
      return;
    }

    const features = ["noopener", "noreferrer"].join(",");
    window.open(url, target, features);
  },

  /**
   * Escape HTML for safe DOM insertion
   */
  escapeHtml(input: string): string {
    return sanitizer.html(input);
  },
};

export default {
  middleware,
  config,
  withSecurity,
  sanitizer,
  validator,
  clientSecurity,
  securityHeaders,
  contentSecurityPolicy,
};
