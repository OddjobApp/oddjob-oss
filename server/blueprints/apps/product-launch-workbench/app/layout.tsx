import "./globals.css";
export const dynamic = 'force-dynamic';
export const metadata = { title: "Product Launch Workbench", description: "Cross-functional product launch management" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="bg-[#0a0a12] text-white antialiased">{children}</body></html>);
}
