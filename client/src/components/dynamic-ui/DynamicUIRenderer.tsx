import React from "react";
import { TokenizedUISchema, ComponentNode, ThemeTokens } from "./types";
import { DynamicUIProvider, useDynamicUI, evaluateExpression } from "./DynamicUIContext";

// UI Components Library imports
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export interface DynamicUIRendererProps {
  schema: TokenizedUISchema;
}

export function getThemeStyles(theme?: ThemeTokens): React.CSSProperties {
  if (!theme) return {};

  return {
    "--theme-brand": theme.colors?.brand ?? "#a855f7",
    "--theme-background": theme.colors?.background ?? "rgba(0, 0, 0, 0.2)",
    "--theme-surface": theme.colors?.surface ?? "rgba(24, 24, 27, 0.4)",
    "--theme-border": theme.colors?.border ?? "rgba(255, 255, 255, 0.1)",
    "--theme-text": theme.colors?.text ?? "#f4f4f5",
    "--theme-text-muted": theme.colors?.textMuted ?? "#a1a1aa",

    "--theme-radius-card": theme.borderRadius?.card ?? "0.75rem",
    "--theme-radius-button": theme.borderRadius?.button ?? "0.5rem",
    "--theme-radius-input": theme.borderRadius?.input ?? "0.375rem",

    "--theme-gap": theme.spacing?.layoutGap ?? "1.5rem",
    "--theme-padding": theme.spacing?.containerPadding ?? "1.5rem",
  } as React.CSSProperties;
}

export function DynamicUIRenderer({ schema }: DynamicUIRendererProps) {
  return (
    <DynamicUIProvider schema={schema}>
      <DynamicUIInner schema={schema} />
    </DynamicUIProvider>
  );
}

function DynamicUIInner({ schema }: DynamicUIRendererProps) {
  const { uiState, approvalModal } = useDynamicUI();
  const styles = getThemeStyles(schema.theme);
  const resolvedTitle = evaluateExpression(schema.title, uiState);

  return (
    <div 
      style={styles} 
      className="w-full h-full flex flex-col relative text-foreground p-4 bg-background/40 rounded-2xl border border-white/5"
    >
      <header className="border-b border-white/10 pb-3 flex justify-between items-center">
        <div>
          <h1 className="text-base font-bold tracking-tight text-[var(--theme-text)]">{resolvedTitle}</h1>
          <span className="text-[10px] text-purple-400 font-mono font-semibold uppercase tracking-wider">Dynamic Tokenized UI Preview</span>
        </div>
        <span className="text-[9px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded">
          v{schema.version}
        </span>
      </header>

      {/* Main Layout Area */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-1">
        {schema.layout.children.map((node) => (
          <RenderNode key={node.id} node={node} />
        ))}
      </div>

      {/* Glassmorphic HIL Confirmation Overlay */}
      {approvalModal.isOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md rounded-2xl animate-fade-in">
          <div className="bg-background border border-purple-500/30 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl shadow-purple-500/15">
            <div className="flex items-center gap-3 border-b border-white/5 pb-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400 text-xs">
                ⚠️
              </div>
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Approval Required</h3>
                <span className="text-[8px] text-purple-400 font-mono font-semibold">SAIF Action Gate</span>
              </div>
            </div>
            
            <p className="text-[11px] text-foreground leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5 font-mono">
              {approvalModal.message}
            </p>

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button 
                variant="ghost" 
                onClick={approvalModal.onCancel}
                className="text-[10px] font-semibold h-7 text-muted-foreground hover:text-foreground hover:bg-foreground/5 px-3"
              >
                Reject Action
              </Button>
              <Button 
                onClick={approvalModal.onConfirm}
                className="text-[10px] font-semibold h-7 bg-purple-600 hover:bg-purple-500 text-foreground px-3 shadow-lg shadow-purple-600/20"
              >
                Approve & Execute
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenderNode({ node }: { node: ComponentNode }) {
  const { uiState, executeAction, updateState } = useDynamicUI();
  
  // Evaluate the props dynamically using expression interpolator
  const props = evaluateExpression(node.props || {}, uiState);

  const smSpan = node.gridSpan?.sm ? `col-span-${node.gridSpan.sm}` : "col-span-1";
  const mdSpan = node.gridSpan?.md ? `md:col-span-${node.gridSpan.md}` : "md:col-span-12";
  const spanClass = `${smSpan} ${mdSpan}`;

  switch (node.type) {
    case "Container":
      return (
        <div className={`${spanClass} p-4 rounded-xl border border-white/5 bg-background/20 space-y-4`}>
          {node.children?.map((child) => (
            <RenderNode key={child.id} node={child} />
          ))}
        </div>
      );

    case "Grid":
      return (
        <div className={`${spanClass} grid grid-cols-1 md:grid-cols-2 gap-4`}>
          {node.children?.map((child) => (
            <RenderNode key={child.id} node={child} />
          ))}
        </div>
      );

    case "Card":
      return (
        <Card className={`${spanClass} border-white/10 bg-black/35 text-foreground overflow-hidden`} style={{ borderRadius: "var(--theme-radius-card)", borderColor: "var(--theme-border)", backgroundColor: "var(--theme-surface)" }}>
          <CardHeader className="pb-2.5 border-b border-white/5">
            <CardTitle className="text-xs font-semibold text-[var(--theme-text)]">{props.title}</CardTitle>
            {props.description && (
              <CardDescription className="text-[10px] text-muted-foreground">{props.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="pt-3.5 space-y-4">
            {node.children?.map((child) => (
              <RenderNode key={child.id} node={child} />
            ))}
          </CardContent>
        </Card>
      );

    case "StatCard":
      return (
        <div 
          className={`${spanClass} p-4 bg-card/40 border border-white/10 rounded-xl flex flex-col justify-between`}
          style={{ borderRadius: "var(--theme-radius-card)", borderColor: "var(--theme-border)", backgroundColor: "var(--theme-surface)" }}
        >
          <div>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">{props.label}</span>
            <h3 className="text-xl font-bold tracking-tight mt-1 text-foreground">{props.value}</h3>
          </div>
          {props.change && (
            <span className={`text-[9px] mt-2 font-mono ${props.changeType === "positive" ? "text-emerald-400" : "text-rose-400"}`}>
              {props.changeType === "positive" ? "▲" : "▼"} {props.change}
            </span>
          )}
        </div>
      );

    case "ActionButton":
      const action = props.onClick || (props.action ? props : null);
      return (
        <Button 
          className={`${spanClass} text-foreground text-xs font-semibold h-8 px-4`}
          style={{ backgroundColor: "var(--theme-brand)", borderRadius: "var(--theme-radius-button)" }}
          disabled={props.disabled}
          onClick={() => action && executeAction(action)}
        >
          {props.label ?? "Submit"}
        </Button>
      );

    case "FormInput":
      const bindKeyInput = props.bindToState;
      const valueInput = bindKeyInput ? (uiState.state[bindKeyInput] ?? "") : "";
      return (
        <div className={`${spanClass} flex flex-col gap-1.5`}>
          {props.label && <label className="text-[11px] text-foreground font-medium">{props.label}</label>}
          <Input 
            type={props.inputType ?? "text"} 
            placeholder={props.placeholder} 
            value={valueInput}
            onChange={(e) => bindKeyInput && updateState({ [bindKeyInput]: e.target.value })}
            className="bg-black/35 border-white/10 text-foreground text-xs h-8 focus:ring-purple-500 focus:border-purple-500"
            style={{ borderRadius: "var(--theme-radius-input)", borderColor: "var(--theme-border)" }}
          />
        </div>
      );

    case "FormTextArea":
      const bindKeyText = props.bindToState;
      const valueText = bindKeyText ? (uiState.state[bindKeyText] ?? "") : "";
      return (
        <div className={`${spanClass} flex flex-col gap-1.5`}>
          {props.label && <label className="text-[11px] text-foreground font-medium">{props.label}</label>}
          <Textarea 
            placeholder={props.placeholder} 
            value={valueText}
            onChange={(e) => bindKeyText && updateState({ [bindKeyText]: e.target.value })}
            className="bg-black/35 border-white/10 text-foreground text-xs min-h-[70px] focus:ring-purple-500 focus:border-purple-500"
            style={{ borderRadius: "var(--theme-radius-input)", borderColor: "var(--theme-border)" }}
          />
        </div>
      );

    case "DataTable":
      const tableData = props.data || [];
      const tableColumns = props.columns || [];
      return (
        <div 
          className={`${spanClass} border border-white/10 rounded-xl overflow-hidden bg-black/25`}
          style={{ borderRadius: "var(--theme-radius-card)", borderColor: "var(--theme-border)", backgroundColor: "var(--theme-surface)" }}
        >
          <Table>
            <TableHeader className="bg-foreground/5">
              <TableRow className="border-white/10">
                {tableColumns.map((col: any, idx: number) => (
                  <TableHead key={idx} className="text-foreground text-xs font-semibold py-2">
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableData.length > 0 ? (
                tableData.map((row: any, rIdx: number) => (
                  <TableRow 
                    key={rIdx} 
                    className={`border-white/5 hover:bg-foreground/5 ${props.onRowClick ? "cursor-pointer animate-fade-in" : ""}`}
                    onClick={() => {
                      if (props.onRowClick) {
                        const resolvedAction = evaluateExpression(props.onRowClick, {
                          state: { ...uiState.state, event: { row } },
                          queries: uiState.queries
                        });
                        executeAction(resolvedAction);
                      }
                    }}
                  >
                    {tableColumns.map((col: any, cIdx: number) => (
                      <TableCell key={cIdx} className={`py-1.5 text-xs text-foreground ${col.font === "mono" ? "font-mono text-[10px]" : ""}`}>
                        {col.badge ? (
                          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20`}>
                            {row[col.accessor]}
                          </span>
                        ) : (
                          row[col.accessor]
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={tableColumns.length || 1} className="text-center py-4 text-xs text-muted-foreground italic">
                    No data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      );

    case "FormInput":
      return (
        <div className={`${spanClass} space-y-1.5`}>
          {props.label && <Label className="text-xs text-[var(--theme-text)]">{props.label}</Label>}
          <Input 
            type={props.inputType || "text"}
            placeholder={props.placeholder}
            value={uiState.state[props.name] || ""}
            onChange={(e) => updateState({ [props.name]: e.target.value })}
            className="bg-black/35 border-white/10 text-foreground"
            style={{ borderRadius: "var(--theme-radius-input)", borderColor: "var(--theme-border)" }}
          />
        </div>
      );

    case "FormTextArea":
      return (
        <div className={`${spanClass} space-y-1.5`}>
          {props.label && <Label className="text-xs text-[var(--theme-text)]">{props.label}</Label>}
          <Textarea 
            placeholder={props.placeholder}
            value={uiState.state[props.name] || ""}
            onChange={(e) => updateState({ [props.name]: e.target.value })}
            className="bg-black/35 border-white/10 text-foreground resize-none"
            rows={props.rows || 3}
            style={{ borderRadius: "var(--theme-radius-input)", borderColor: "var(--theme-border)" }}
          />
        </div>
      );

    case "FormCheckbox":
      return (
        <div className={`${spanClass} flex items-center space-x-2`}>
          <Checkbox 
            id={node.id}
            checked={!!uiState.state[props.name]}
            onCheckedChange={(checked) => updateState({ [props.name]: checked })}
            className="border-white/20 data-[state=checked]:bg-[var(--theme-brand)] data-[state=checked]:text-foreground"
          />
          <Label htmlFor={node.id} className="text-sm font-medium leading-none text-[var(--theme-text)]">
            {props.label}
          </Label>
        </div>
      );

    case "FormSelect":
      return (
        <div className={`${spanClass} space-y-1.5`}>
          {props.label && <Label className="text-xs text-[var(--theme-text)]">{props.label}</Label>}
          <Select 
            value={uiState.state[props.name] || ""}
            onValueChange={(val) => updateState({ [props.name]: val })}
          >
            <SelectTrigger 
              className="bg-black/35 border-white/10 text-foreground"
              style={{ borderRadius: "var(--theme-radius-input)", borderColor: "var(--theme-border)" }}
            >
              <SelectValue placeholder={props.placeholder || "Select an option"} />
            </SelectTrigger>
            <SelectContent className="bg-background border-white/10 text-foreground">
              {props.options?.map((opt: { value: string; label: string }) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "ActionButton":
      return (
        <div className={`${spanClass}`}>
          <Button 
            className="w-full font-semibold shadow-lg hover:brightness-110 transition-all"
            style={{ 
              backgroundColor: props.variant === 'secondary' ? 'transparent' : "var(--theme-brand)",
              color: props.variant === 'secondary' ? "var(--theme-brand)" : "white",
              border: props.variant === 'secondary' ? "1px solid var(--theme-brand)" : "none",
              borderRadius: "var(--theme-radius-button)" 
            }}
            onClick={() => {
              if (props.action) {
                executeAction(props.action);
              }
            }}
            disabled={props.disabled}
          >
            {props.label}
          </Button>
        </div>
      );

    default:
      return (
        <div className="p-3 border border-dashed border-rose-500/30 bg-rose-950/10 rounded-lg text-xs text-rose-400">
          Unrecognized component type: <strong>{node.type}</strong> (ID: {node.id})
        </div>
      );
  }
}
