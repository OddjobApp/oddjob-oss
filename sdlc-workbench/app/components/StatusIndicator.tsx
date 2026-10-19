export function StatusIndicator({ 
  status,
  className = "" 
}: { 
  status: "active" | "inactive" | "pending" | "error";
  className?: string;
}) {
  const config = {
    active: { color: "bg-green-500", label: "Active" },
    inactive: { color: "bg-slate-500", label: "Inactive" },
    pending: { color: "bg-yellow-500", label: "Pending" },
    error: { color: "bg-red-500", label: "Error" }
  };

  const { color, label } = config[status];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-sm text-slate-300">{label}</span>
    </div>
  );
}
