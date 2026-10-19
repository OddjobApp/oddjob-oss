"use client";
import dynamic from "next/dynamic";

const Content = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#090d16] p-6">
      <div className="h-8 w-64 bg-white/5 rounded animate-pulse mb-4" />
      <div className="h-4 w-96 bg-white/5 rounded animate-pulse" />
    </div>
  ),
});

export default function Page() {
  return <Content />;
}
