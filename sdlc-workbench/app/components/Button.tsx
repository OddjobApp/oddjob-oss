export function Button({ 
  children, 
  onClick, 
  variant = "primary",
  className = "" 
}: { 
  children: React.ReactNode; 
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const baseStyles = "px-4 py-2 rounded-lg font-medium transition-colors";
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-slate-700 hover:bg-slate-600 text-white",
    danger: "bg-red-600 hover:bg-red-700 text-white"
  };

  return (
    <button 
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
