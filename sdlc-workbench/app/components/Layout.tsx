import Link from 'next/link';

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
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/procurement-workbench" className="text-sm text-slate-400 hover:text-white transition-colors">
            Procurement
          </Link>
          <Link href="/vendor-workbench" className="text-sm text-slate-400 hover:text-white transition-colors">
            Vendors
          </Link>
          {children}
        </div>
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
