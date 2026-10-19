import React from "react";

export interface FormalFlexProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "row" | "column";
  gap?: number;
  minChildWidth?: number;
  maxChildWidth?: number;
  wrap?: boolean;
  children?: React.ReactNode;
}

export interface FormalGridProps extends React.HTMLAttributes<HTMLDivElement> {
  minColWidth?: number;
  maxColWidth?: number;
  gap?: number;
  children?: React.ReactNode;
}

export interface ErgonomicTouchTargetProps extends React.HTMLAttributes<HTMLDivElement> {
  minSize?: number; // default 48px
  children?: React.ReactNode;
}

/**
 * FormalFlex: Mathematical flex container with continuous viewport containment
 */
export const FormalFlex: React.FC<FormalFlexProps> = ({
  direction = "row",
  gap = 16,
  minChildWidth,
  maxChildWidth,
  wrap = true,
  style,
  children,
  ...rest
}) => {
  const flexStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: direction,
    flexWrap: wrap ? "wrap" : "nowrap",
    gap: `${gap}px`,
    width: "100%",
    boxSizing: "border-box",
    ...style
  };

  return (
    <div style={flexStyle} data-formal-layout="flex" {...rest}>
      {children}
    </div>
  );
};

/**
 * FormalGrid: Auto-responsive CSS grid with closed-form clamp() track allocation
 */
export const FormalGrid: React.FC<FormalGridProps> = ({
  minColWidth = 280,
  maxColWidth = 400,
  gap = 16,
  style,
  children,
  ...rest
}) => {
  // Synthesized mathematical clamp track sizing: clamp(minColWidth, 25vw, maxColWidth)
  const trackTemplate = `repeat(auto-fit, minmax(clamp(${minColWidth}px, 25vw, ${maxColWidth}px), 1fr))`;

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: trackTemplate,
    gap: `${gap}px`,
    width: "100%",
    boxSizing: "border-box",
    ...style
  };

  return (
    <div style={gridStyle} data-formal-layout="grid" {...rest}>
      {children}
    </div>
  );
};

/**
 * ErgonomicTouchTarget: Enforces WCAG 2.5.5 ergonomic 48px hitbox bounds
 */
export const ErgonomicTouchTarget: React.FC<ErgonomicTouchTargetProps> = ({
  minSize = 48,
  style,
  children,
  ...rest
}) => {
  const targetStyle: React.CSSProperties = {
    minWidth: `${minSize}px`,
    minHeight: `${minSize}px`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    ...style
  };

  return (
    <div style={targetStyle} data-formal-ergonomic="true" {...rest}>
      {children}
    </div>
  );
};

export const FormalLayout = FormalFlex;
export default FormalFlex;
