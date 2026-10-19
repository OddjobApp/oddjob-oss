import React from 'react';
import * as Icons from 'lucide-react';
import { LayoutTemplate } from 'lucide-react';
import { cn } from "@/lib/utils";

interface AppIconProps {
  icon?: string | null;
  className?: string; // Base classes like dimensions, roundedness, borders, transitions
  innerClassName?: string; // Classes for the Lucide icon inside
}

export const AppIcon: React.FC<AppIconProps> = ({ icon, className, innerClassName }) => {
  // Check if it's a URL or image path
  const isUrlOrPath = icon ? (
    icon.startsWith('http://') || 
    icon.startsWith('https://') || 
    icon.startsWith('/') || 
    icon.startsWith('./') || 
    icon.startsWith('../') ||
    icon.includes('.') || 
    icon.includes('/')
  ) : false;

  if (icon && isUrlOrPath) {
    return (
      <img 
        src={icon} 
        className={cn("object-cover", className)} 
        alt="" 
      />
    );
  }

  // Not a URL/path, so it's either a Lucide icon or fallback
  const IconComponent = icon ? (Icons as any)[icon] : null;
  const ActiveIcon = IconComponent || LayoutTemplate;

  // Let's ensure container-specific styles like bg, flex center are applied if they aren't overridden
  return (
    <div className={cn(
      "flex items-center justify-center",
      !className?.includes('bg-') && "bg-primary/10",
      className
    )}>
      <ActiveIcon className={innerClassName} />
    </div>
  );
};
