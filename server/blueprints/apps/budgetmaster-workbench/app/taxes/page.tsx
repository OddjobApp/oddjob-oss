"use client";

import dynamic from "next/dynamic";

const Content = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-[#090d16] p-6"><div className="h-8 w-64 max-w-full animate-pulse rounded bg-white/5" /></div>,
});

export default function Page() {
  return <Content />;
}
