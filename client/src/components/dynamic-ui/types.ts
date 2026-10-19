export type ComponentType =
  | "Container"
  | "Grid"
  | "Card"
  | "StatCard"
  | "DataTable"
  | "ActionButton"
  | "FormInput"
  | "FormTextArea"
  | "FormSelect"
  | "FormCheckbox";

export interface ThemeTokens {
  colors?: {
    brand?: string;
    background?: string;
    surface?: string;
    border?: string;
    text?: string;
    textMuted?: string;
  };
  borderRadius?: {
    card?: string;
    button?: string;
    input?: string;
  };
  spacing?: {
    layoutGap?: string;
    containerPadding?: string;
  };
}

export interface ComponentNode {
  id: string;
  type: ComponentType;
  gridSpan?: {
    sm?: number;
    md?: number;
    lg?: number;
  };
  props?: Record<string, any>;
  children?: ComponentNode[];
}

export interface QueryDefinition {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, string>;
  body?: any;
}

export interface ActionDefinition {
  action: "setState" | "dispatchApi" | "refetchQuery";
  payload?: Record<string, any>;
  endpoint?: string;
  method?: "GET" | "POST";
  body?: any;
  queryId?: string;
  requiresApproval?: boolean;
  approvalMessage?: string;
}

export interface TokenizedUISchema {
  version: string;
  id: string;
  title: string;
  theme?: ThemeTokens;
  queries?: Record<string, QueryDefinition>;
  state?: Record<string, any>;
  layout: {
    type: "container" | "grid";
    children: ComponentNode[];
  };
}
