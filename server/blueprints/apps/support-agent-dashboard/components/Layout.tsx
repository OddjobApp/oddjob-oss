import { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Headphones, KanbanSquare, FileEdit, Home, AlertTriangle } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/queue", label: "Queue Manager", icon: KanbanSquare },
  { href: "/kb-editor", label: "KB Editor", icon: FileEdit },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle },
];

export default function Layout({ children, title, subtitle }: LayoutProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans flex">
      <aside className="hidden md:flex flex-col w-56 border-r border-white/5 bg-white/[0.02] backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Headphones size={14} className="text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight">Support Desk</span>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = router.pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  active
                    ? "bg-blue-600/20 text-blue-300 border border-blue-500/20"
                    : "text-white/40 hover:text-white/80 hover:bg-white/5"
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-white/5 bg-white/[0.02] backdrop-blur-xl px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-white/40 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 md:hidden">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`p-2 rounded-lg transition-colors ${router.pathname === href ? "bg-blue-600/20 text-blue-400" : "text-white/30 hover:text-white/60"}`} title={label}>
                <Icon size={16} />
              </Link>
            ))}
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
