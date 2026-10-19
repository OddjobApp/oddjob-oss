'use client';

import React from 'react';

interface TelemetryChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
}

export function TelemetryChart({
  data = [10, 15, 8, 22, 14, 25, 18, 30],
  width = 300,
  height = 80,
  color = '#6366f1', // Indigo 500
  fillColor = 'rgba(99, 102, 241, 0.1)',
}: TelemetryChartProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  // Convert data points into SVG coordinates
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 10) - 5;
    return { x, y };
  });

  // Generate SVG path for line
  const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Generate closed SVG path for filled area underneath the line
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height} className="overflow-visible">
        {/* Shaded area path */}
        <path d={fillPath} fill={fillColor} />
        {/* Foreground line path */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Interactive glow points for endpoints */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3.5}
            fill={color}
            className="animate-ping"
            style={{ transformOrigin: `${points[points.length - 1].x}px ${points[points.length - 1].y}px` }}
          />
        )}
      </svg>
    </div>
  );
}
