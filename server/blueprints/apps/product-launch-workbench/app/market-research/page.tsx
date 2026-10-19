"use client";
import dynamic from "next/dynamic";
const Content = dynamic(() => import("./content"), { ssr: false, loading: () => <div className="min-h-screen bg-[#0a0a12] p-6"><div className="h-8 w-48 bg-white/5 rounded animate-pulse" /></div> });
export default function Page() { return <Content />; }
