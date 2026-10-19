"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Zap, Shield, Clock, Globe, Smartphone, Cloud, Database, Lock, ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";

interface Feature {
  id: string;
  title: string;
  description: string;
  icon?: string;
  badge?: string;
  ctaText?: string;
  ctaUrl?: string;
}

interface PlatformFeatureGridBlockProps {
  collection?: string;
  features?: Feature[];
  columns?: 2 | 3 | 4;
  variant?: "cards" | "compact" | "horizontal";
  showCtas?: boolean;
  titleField?: string;
  descriptionField?: string;
  iconField?: string;
}

const iconMap: Record<string, React.ReactNode> = {
  zap: <Zap className="w-6 h-6" />,
  shield: <Shield className="w-6 h-6" />,
  clock: <Clock className="w-6 h-6" />,
  globe: <Globe className="w-6 h-6" />,
  smartphone: <Smartphone className="w-6 h-6" />,
  cloud: <Cloud className="w-6 h-6" />,
  database: <Database className="w-6 h-6" />,
  lock: <Lock className="w-6 h-6" />,
};

const defaultFeatures: Feature[] = [
  {
    id: "1",
    title: "Lightning Fast",
    description: "Built for speed with optimized performance and minimal latency across all operations.",
    icon: "zap",
  },
  {
    id: "2",
    title: "Enterprise Security",
    description: "Bank-grade encryption and security protocols to keep your data safe and compliant.",
    icon: "shield",
    badge: "SOC 2",
  },
  {
    id: "3",
    title: "24/7 Availability",
    description: "Always-on infrastructure with 99.99% uptime guarantee and global CDN coverage.",
    icon: "clock",
  },
  {
    id: "4",
    title: "Global Scale",
    description: "Deploy across 30+ regions worldwide with automatic scaling and load balancing.",
    icon: "globe",
  },
  {
    id: "5",
    title: "Mobile First",
    description: "Native mobile experience with responsive design and offline capabilities.",
    icon: "smartphone",
  },
  {
    id: "6",
    title: "Cloud Native",
    description: "Born in the cloud with containerized architecture and microservices.",
    icon: "cloud",
  },
];

export default function PlatformFeatureGridBlock({
  collection,
  features: providedFeatures,
  columns = 3,
  variant = "cards",
  showCtas = false,
  titleField = "title",
  descriptionField = "description",
  iconField = "icon",
}: PlatformFeatureGridBlockProps) {
  const [features, setFeatures] = useState<Feature[]>(providedFeatures || []);
  const [loading, setLoading] = useState(!providedFeatures && !!collection);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedFeatures || !collection) {
      setLoading(false);
      return;
    }

    const fetchFeatures = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mapped: Feature[] = records.map((record: any, idx: number) => ({
          id: record.id || `feature-${idx}`,
          title: record[titleField] || record.title || record.name || "Feature",
          description: record[descriptionField] || record.description || "",
          icon: record[iconField] || record.icon,
          badge: record.badge,
          ctaText: record.ctaText,
          ctaUrl: record.ctaUrl,
        }));

        setFeatures(mapped.length > 0 ? mapped : defaultFeatures);
      } catch (e: any) {
        setError(e.message);
        setFeatures(defaultFeatures);
      } finally {
        setLoading(false);
      }
    };

    fetchFeatures();
  }, [collection, providedFeatures, titleField, descriptionField, iconField]);

  if (loading) {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-4`}>
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="h-48" />
        ))}
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-4`}>
        {features.map((feature, idx) => (
          <motion.div
            key={feature.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="flex items-start gap-3 p-4"
          >
            {feature.icon && iconMap[feature.icon] && (
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                {iconMap[feature.icon]}
              </div>
            )}
            <div>
              <h4 className="font-semibold">{feature.title}</h4>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  if (variant === "horizontal") {
    return (
      <div className="space-y-4">
        {features.map((feature, idx) => (
          <motion.div
            key={feature.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="overflow-hidden">
              <CardContent className="p-6 flex items-center gap-6">
                {feature.icon && iconMap[feature.icon] && (
                  <div className="p-4 rounded-lg bg-primary/10 text-primary shrink-0">
                    {iconMap[feature.icon]}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-lg">{feature.title}</h4>
                    {feature.badge && (
                      <Badge variant="secondary">{feature.badge}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">{feature.description}</p>
                </div>
                {showCtas && feature.ctaText && (
                  <Button variant="ghost" asChild>
                    <a href={feature.ctaUrl || "#"} className="flex items-center gap-2">
                      {feature.ctaText}
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    );
  }

  // Cards variant (default)
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-6`}>
      {features.map((feature, idx) => (
        <motion.div
          key={feature.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
        >
          <Card className="h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              {feature.icon && iconMap[feature.icon] && (
                <div className="p-3 rounded-lg bg-primary/10 text-primary w-fit mb-3">
                  {iconMap[feature.icon]}
                </div>
              )}
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-lg">{feature.title}</h4>
                {feature.badge && (
                  <Badge variant="secondary" className="text-xs">
                    {feature.badge}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{feature.description}</p>
              {showCtas && feature.ctaText && (
                <Button variant="link" className="px-0 mt-4" asChild>
                  <a href={feature.ctaUrl || "#"} className="flex items-center gap-2">
                    {feature.ctaText}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
