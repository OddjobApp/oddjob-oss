import { memo } from 'react';

export const Badge = memo(function Badge({ 
  children, 
  variant = "default",
  className = "" 
}: { 
  children: React.ReactNode; 
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}) {
  const baseStyles = "px-2 py-1 rounded-full text-xs font-medium";
  const variants = {
    default: "bg-slate-700 text-slate-200",
    success: "bg-green-600/20 text-green-400 border border-green-600/30",
    warning: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
    danger: "bg-red-600/20 text-red-400 border border-red-600/30"
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
});
