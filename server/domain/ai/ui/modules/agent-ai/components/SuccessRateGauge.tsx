import React from 'react';
import { motion } from "framer-motion";

export function SuccessRateGauge() {
    const successRate = 94.2;
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (successRate / 100) * circumference;

    return (
        <div className="relative flex items-center justify-center w-64 h-64 group">
            {/* Background Glow */}
            <div className="absolute inset-0 bg-primary/10 blur-[60px] rounded-full animate-pulse" />
            
            <svg className="w-full h-full -rotate-90 transform">
                {/* Background Ring */}
                <circle
                    cx="128"
                    cy="128"
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    className="text-foreground/5"
                />
                
                {/* Success Ring */}
                <motion.circle
                    cx="128"
                    cy="128"
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="12"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 2, ease: "easeOut" }}
                    fill="transparent"
                    strokeLinecap="round"
                    className="text-primary shadow-glow"
                />

                {/* Decorative Ticks */}
                {[...Array(12)].map((_, i) => (
                    <line
                        key={i}
                        x1="128"
                        y1="38"
                        x2="128"
                        y2="48"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-foreground/10"
                        transform={`rotate(${i * 30} 128 128)`}
                    />
                ))}
            </svg>

            <div className="absolute flex flex-col items-center justify-center text-center">
                <motion.span 
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1 }}
                    className="text-5xl font-black italic tracking-tighter text-foreground"
                >
                    {successRate}%
                </motion.span>
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Global Reliability</span>
            </div>
            
            {/* Interactive Scanning Line */}
            <motion.div 
                className="absolute inset-0 border-t-2 border-primary/40 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
        </div>
    );
}
