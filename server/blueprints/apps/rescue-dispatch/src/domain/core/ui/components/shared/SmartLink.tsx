import React from "react";
import { Link as WouterLink } from "wouter";
import { isCrossEntryNav } from "@/lib/spa-utils";

interface SmartLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
}

/**
 * SmartLink Component
 * 
 * Automatically detects if a navigation target belongs to a different SPA entry point.
 * - If target is in the SAME entry point: Uses wouter for soft SPA navigation.
 * - If target is in a DIFFERENT entry point: Uses a standard <a> tag for a hard browser reload.
 * 
 * This ensures the correct optimized JS bundle is loaded for the target domain.
 */
export function SmartLink({ href, children, ...props }: SmartLinkProps) {
  const isCrossNav = isCrossEntryNav(href);

  if (isCrossNav) {
    // Hard navigate to different entry point
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  // Soft navigate within the same entry point
  return (
    <WouterLink href={href} {...props}>
      {children}
    </WouterLink>
  );
}
