"use client"

import * as React from "react"
import {
  Label,
  PolarGrid,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
} from "recharts"
import { ChartConfig, ChartContainer } from './chart.js'

const chartConfig = {
  value: {
    label: "Value",
  },
} satisfies ChartConfig

interface GaugeProps {
  value: number
  max?: number
  label?: string
  description?: string
  color?: string
  className?: string
}

export function Gauge({
  value,
  max = 100,
  label,
  description,
  color = "hsl(var(--primary))",
  className,
}: GaugeProps) {
  const chartData = [
    { name: "value", value: value, fill: color },
  ]

  const startAngle = 90 + 135 // Start from bottom left
  const endAngle = -45 // End at bottom right

  return (
    <div className={className}>
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square max-h-[250px]"
      >
        <RadialBarChart
          data={chartData}
          startAngle={180}
          endAngle={0}
          innerRadius={80}
          outerRadius={110}
        >
          <PolarGrid
            gridType="circle"
            radialLines={false}
            stroke="none"
            className="first:fill-muted last:fill-background"
            polarRadius={[86, 74]}
          />
          <RadialBar dataKey="value" background cornerRadius={10} />
          <PolarRadiusAxis tick={false} axisLine={false}>
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-4xl font-bold"
                      >
                        {value.toLocaleString()}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 24}
                        className="fill-muted-foreground text-xs font-medium uppercase tracking-widest"
                      >
                        {label || "Current"}
                      </tspan>
                    </text>
                  )
                }
              }}
            />
          </PolarRadiusAxis>
        </RadialBarChart>
      </ChartContainer>
      {description && (
        <p className="text-center text-xs text-muted-foreground mt-2 font-medium">
          {description}
        </p>
      )}
    </div>
  )
}
