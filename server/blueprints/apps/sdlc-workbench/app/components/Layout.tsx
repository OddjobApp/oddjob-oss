export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className="w-64 bg-slate-900/50 border-r border-slate-700/50 p-4">
      {children}
    </aside>
  );
}

export function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="bg-slate-900/50 border-b border-slate-700/50 px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function MainContent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 p-6 overflow-auto">
      {children}
    </main>
  );
}
