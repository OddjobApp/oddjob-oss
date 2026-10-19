import React from "react";

interface SkeletonLoaderProps {
  count?: number;
  heightClass?: string;
}

export function SkeletonLoader({ count = 3, heightClass = "h-16" }: SkeletonLoaderProps) {
  return (
    <div className="space-y-3 w-full">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`${heightClass} w-full rounded-xl bg-gradient-to-r from-white/5 via-white/10 to-white/5 bg-[length:200%_100%] animate-[shimmer_1.5s_infinite] border border-white/5`}
          style={{
            backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%)",
            backgroundSize: "200% 100%"
          }}
        />
      ))}
    </div>
  );
}
