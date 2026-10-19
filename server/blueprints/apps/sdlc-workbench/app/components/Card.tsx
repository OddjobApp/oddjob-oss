export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}
