import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { TokenizedUISchema, ActionDefinition, QueryDefinition } from "./types";
import { apiRequest } from "@/lib/queryClient";

export interface UIState {
  state: Record<string, any>;
  queries: Record<string, { data: any; isLoading: boolean; error: any }>;
}

export interface ApprovalModalState {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface DynamicUIContextProps {
  uiState: UIState;
  updateState: (payload: Record<string, any>) => void;
  executeAction: (action: ActionDefinition) => Promise<void>;
  refetchQuery: (queryId: string) => Promise<void>;
  approvalModal: ApprovalModalState;
  closeApprovalModal: () => void;
}

const DynamicUIContext = createContext<DynamicUIContextProps | undefined>(undefined);

export function useDynamicUI() {
  const context = useContext(DynamicUIContext);
  if (!context) throw new Error("useDynamicUI must be used within DynamicUIProvider");
  return context;
}

export function evaluateExpression(val: any, stateContext: UIState): any {
  if (typeof val === "string") {
    // Exact match, e.g. "{{queries.fetchIncidents.data}}"
    const exactMatch = val.match(/^\{\{([^}]+)\}\}$/);
    if (exactMatch) {
      return getNestedValue(exactMatch[1].trim(), stateContext);
    }

    // Inline template, e.g. "Incident {{state.selectedIncident}}"
    return val.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const resolved = getNestedValue(path.trim(), stateContext);
      if (resolved && typeof resolved === "object") {
        return JSON.stringify(resolved);
      }
      return String(resolved ?? "");
    });
  }

  if (Array.isArray(val)) {
    return val.map((item) => evaluateExpression(item, stateContext));
  }

  if (val && typeof val === "object") {
    const res: Record<string, any> = {};
    for (const k in val) {
      res[k] = evaluateExpression(val[k], stateContext);
    }
    return res;
  }

  return val;
}

function getNestedValue(path: string, obj: any): any {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

export function DynamicUIProvider({
  schema,
  children
}: {
  schema: TokenizedUISchema;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<Record<string, any>>(schema.state || {});
  const [queries, setQueries] = useState<Record<string, { data: any; isLoading: boolean; error: any }>>({});
  const [approvalModal, setApprovalModal] = useState<ApprovalModalState>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
    onCancel: () => {}
  });

  const closeApprovalModal = () => {
    setApprovalModal((prev) => ({ ...prev, isOpen: false }));
  };
  
  const uiState: UIState = { state, queries };
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;

  const runQuery = async (queryId: string, def: QueryDefinition) => {
    setQueries((prev) => ({
      ...prev,
      [queryId]: { ...(prev[queryId] || { data: null }), isLoading: true, error: null }
    }));

    try {
      // Evaluate variables inside params or endpoint
      const resolvedEndpoint = evaluateExpression(def.endpoint, uiStateRef.current);
      
      let finalEndpoint = resolvedEndpoint;
      if (def.params) {
        const resolvedParams = evaluateExpression(def.params, uiStateRef.current);
        const queryParams = new URLSearchParams(resolvedParams).toString();
        if (queryParams) {
          finalEndpoint += `?${queryParams}`;
        }
      }

      const res = await fetch(finalEndpoint, { credentials: "include" });
      if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
      const data = await res.json();

      setQueries((prev) => ({
        ...prev,
        [queryId]: { data, isLoading: false, error: null }
      }));
    } catch (err: any) {
      setQueries((prev) => ({
        ...prev,
        [queryId]: { data: null, isLoading: false, error: err.message || "Failed to load" }
      }));
    }
  };

  const refetchQuery = async (queryId: string) => {
    const def = schema.queries?.[queryId];
    if (def) await runQuery(queryId, def);
  };

  const updateState = (payload: Record<string, any>) => {
    setState((prev) => ({ ...prev, ...payload }));
  };

  const executeAction = async (action: ActionDefinition) => {
    switch (action.action) {
      case "setState":
        if (action.payload) {
          const resolvedPayload = evaluateExpression(action.payload, uiStateRef.current);
          updateState(resolvedPayload);
        }
        break;

      case "refetchQuery":
        if (action.queryId) {
          await refetchQuery(action.queryId);
        }
        break;

      case "dispatchApi":
        if (!action.endpoint) return;

        const resolvedEndpoint = evaluateExpression(action.endpoint, uiStateRef.current);
        const resolvedBody = evaluateExpression(action.body, uiStateRef.current);

        const dispatch = async () => {
          try {
            await apiRequest(action.method ?? "POST", resolvedEndpoint, resolvedBody);
            // Auto refetch dependent queries if we dispatch successfully
            if (schema.queries) {
              Object.entries(schema.queries).forEach(([queryId, qDef]) => {
                if (qDef.method === "GET") runQuery(queryId, qDef);
              });
            }
          } catch (err) {
            console.error("Action dispatch failed:", err);
          }
        };

        if (action.requiresApproval) {
          const message = action.approvalMessage
            ? evaluateExpression(action.approvalMessage, uiStateRef.current)
            : "Confirm operation execution?";

          setApprovalModal({
            isOpen: true,
            message,
            onConfirm: async () => {
              setApprovalModal((prev) => ({ ...prev, isOpen: false }));
              const appId = (schema as any).databaseId || 1;
              try {
                await apiRequest("POST", `/api/apps/${appId}/telemetry`, {
                  event: "hil_action_approved",
                  metadata: {
                    action: action.action,
                    endpoint: resolvedEndpoint,
                    payload: resolvedBody
                  }
                });
              } catch (e) {
                console.warn("Failed to write telemetry audit log:", e);
              }
              await dispatch();
            },
            onCancel: () => {
              setApprovalModal((prev) => ({ ...prev, isOpen: false }));
            }
          });
        } else {
          await dispatch();
        }
        break;
    }
  };

  // Initial queries load
  useEffect(() => {
    if (schema.queries) {
      Object.entries(schema.queries).forEach(([queryId, def]) => {
        if (def.method === "GET") {
          runQuery(queryId, def);
        }
      });
    }
  }, [schema.queries]);

  // Reactive dependency trigger: re-run queries if state changes
  useEffect(() => {
    if (schema.queries) {
      Object.entries(schema.queries).forEach(([queryId, def]) => {
        // Only run GET queries to avoid loop triggers on POST dispatches
        if (def.method === "GET") {
          runQuery(queryId, def);
        }
      });
    }
  }, [state]);

  return (
    <DynamicUIContext.Provider value={{ uiState, updateState, executeAction, refetchQuery, approvalModal, closeApprovalModal }}>
      {children}
    </DynamicUIContext.Provider>
  );
}
