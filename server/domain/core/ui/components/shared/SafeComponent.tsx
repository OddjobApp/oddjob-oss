import React, { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";

interface SafeMapProps<T> {
  items: T[] | null | undefined;
  renderItem: (item: T, index: number) => ReactNode;
  fallback?: ReactNode;
  emptyState?: ReactNode;
  componentName?: string;
}

/**
 * SafeMap protects against "Cannot read properties of undefined (reading 'map')"
 * errors by providing explicit null guards and optional fallback UI.
 */
export function SafeMap<T>({ 
  items, 
  renderItem, 
  fallback, 
  emptyState,
  componentName = "Component" 
}: SafeMapProps<T>) {
  // If items is not an array, show fallback or error alert
  if (!Array.isArray(items)) {
    if (fallback) return <>{fallback}</>;
    
    return (
      <Alert variant="destructive" className="my-2 border-dashed bg-rose-500/5">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle className="text-xs font-bold uppercase tracking-wider">Defensive Guard Active</AlertTitle>
        <AlertDescription className="text-[10px] opacity-70">
          {componentName}: Expected an array but received {items === null ? "null" : typeof items}.
        </AlertDescription>
      </Alert>
    );
  }

  // If array is empty
  if (items.length === 0) {
    return <>{emptyState || null}</>;
  }

  // Perform the map
  try {
    return <>{items.map(renderItem)}</>;
  } catch (err: any) {
    console.error(`SafeMap execution error in ${componentName}:`, err);
    return fallback ? <>{fallback}</> : (
      <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded text-rose-400 text-xs">
        Failed to render {componentName} list items.
      </div>
    );
  }
}

/**
 * SafeValue ensures that a value is safe to render as a string/node,
 * providing a fallback if it's an object or undefined.
 */
export function SafeValue(value: any, fallback: string = "—"): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object" && !React.isValidElement(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}

/**
 * SafeAccess performs deep property access without throwing.
 */
export function SafeAccess(obj: any, path: string, fallback: any = undefined): any {
  if (!obj) return fallback;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return fallback;
    }
    current = current[key];
  }
  return current === undefined ? fallback : current;
}
