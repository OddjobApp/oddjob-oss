"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, X, Sparkles, AlertCircle, Loader2, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";

interface PricingTier {
  id: string;
  name: string;
  description?: string;
  price: number;
  priceMonthly?: number;
  priceYearly?: number;
  currency: string;
  period: "month" | "year" | "one-time";
  features: PricingFeature[];
  highlighted?: boolean;
  badge?: string;
  ctaText: string;
  ctaUrl?: string;
  trialDays?: number;
}

interface PricingFeature {
  name: string;
  included: boolean;
  description?: string;
}

interface PlatformPricingTableBlockProps {
  collection?: string;
  tiers?: PricingTier[];
  defaultBilling?: "monthly" | "yearly";
  showToggle?: boolean;
  currencyField?: string;
  priceField?: string;
  featuresField?: string;
  titleField?: string;
  highlightedField?: string;
}

const defaultTiers: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Perfect for individuals",
    price: 9,
    priceMonthly: 9,
    priceYearly: 90,
    currency: "$",
    period: "month",
    features: [
      { name: "1 project", included: true },
      { name: "Basic analytics", included: true },
      { name: "Email support", included: true },
      { name: "API access", included: false },
      { name: "Custom domains", included: false },
    ],
    ctaText: "Get Started",
    trialDays: 14,
  },
  {
    id: "pro",
    name: "Professional",
    description: "Best for growing teams",
    price: 29,
    priceMonthly: 29,
    priceYearly: 290,
    currency: "$",
    period: "month",
    features: [
      { name: "10 projects", included: true },
      { name: "Advanced analytics", included: true },
      { name: "Priority support", included: true },
      { name: "API access", included: true },
      { name: "Custom domains", included: true },
    ],
    highlighted: true,
    badge: "Most Popular",
    ctaText: "Start Pro Trial",
    trialDays: 14,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations",
    price: 99,
    priceMonthly: 99,
    priceYearly: 990,
    currency: "$",
    period: "month",
    features: [
      { name: "Unlimited projects", included: true },
      { name: "Custom analytics", included: true },
      { name: "24/7 phone support", included: true },
      { name: "Full API access", included: true },
      { name: "White-label option", included: true },
    ],
    ctaText: "Contact Sales",
  },
];

export default function PlatformPricingTableBlock({
  collection,
  tiers: providedTiers,
  defaultBilling = "monthly",
  showToggle = true,
  currencyField = "currency",
  priceField = "price",
  featuresField = "features",
  titleField = "name",
  highlightedField = "highlighted",
}: PlatformPricingTableBlockProps) {
  const [tiers, setTiers] = useState<PricingTier[]>(providedTiers || []);
  const [loading, setLoading] = useState(!providedTiers && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(defaultBilling);

  useEffect(() => {
    if (providedTiers || !collection) {
      setLoading(false);
      return;
    }

    const fetchTiers = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mappedTiers: PricingTier[] = records.map((record: any, idx: number) => ({
          id: record.id || `tier-${idx}`,
          name: record[titleField] || record.name || "Tier",
          description: record.description,
          price: record[priceField] || record.price || 0,
          priceMonthly: record.priceMonthly || record.price || 0,
          priceYearly: record.priceYearly || (record.price || 0) * 10,
          currency: record[currencyField] || record.currency || "$",
          period: record.period || "month",
          features: parseFeatures(record[featuresField] || record.features),
          highlighted: record[highlightedField] || record.highlighted || false,
          badge: record.badge,
          ctaText: record.ctaText || "Get Started",
          ctaUrl: record.ctaUrl,
          trialDays: record.trialDays,
        }));

        setTiers(mappedTiers.length > 0 ? mappedTiers : defaultTiers);
      } catch (e: any) {
        setError(e.message || "Failed to load pricing");
        setTiers(defaultTiers);
      } finally {
        setLoading(false);
      }
    };

    fetchTiers();
  }, [collection, providedTiers, currencyField, priceField, featuresField, titleField, highlightedField]);

  const parseFeatures = (features: any): PricingFeature[] => {
    if (!features) return [];
    if (typeof features === "string") {
      return features.split(",").map((f) => ({ name: f.trim(), included: true }));
    }
    if (Array.isArray(features)) {
      return features.map((f) =>
        typeof f === "string"
          ? { name: f, included: true }
          : { name: f.name, included: f.included ?? true, description: f.description }
      );
    }
    return [];
  };

  const getPrice = (tier: PricingTier): number => {
    if (billingCycle === "yearly" && tier.priceYearly) {
      return tier.priceYearly;
    }
    if (billingCycle === "monthly" && tier.priceMonthly) {
      return tier.priceMonthly;
    }
    return tier.price;
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Skeleton key={idx} className="h-[500px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      {/* Billing Toggle */}
      {showToggle && tiers.some((t) => t.priceYearly) && (
        <div className="flex items-center justify-center gap-4">
          <span className={cn("text-sm", billingCycle === "monthly" ? "font-semibold" : "text-muted-foreground")}>
            Monthly
          </span>
          <Switch
            checked={billingCycle === "yearly"}
            onCheckedChange={(checked) => setBillingCycle(checked ? "yearly" : "monthly")}
          />
          <span className={cn("text-sm", billingCycle === "yearly" ? "font-semibold" : "text-muted-foreground")}>
            Yearly
          </span>
          {billingCycle === "yearly" && (
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              <Sparkles className="w-3 h-3 mr-1" />
              Save up to 20%
            </Badge>
          )}
        </div>
      )}

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tiers.map((tier, idx) => (
          <motion.div
            key={tier.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card
              className={cn(
                "relative h-full flex flex-col",
                tier.highlighted && "border-2 border-primary shadow-lg scale-105 z-10"
              )}
            >
              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    <Zap className="w-3 h-3 mr-1" />
                    {tier.badge}
                  </Badge>
                </div>
              )}

              <CardHeader className="text-center pb-4">
                <h3 className="text-xl font-bold">{tier.name}</h3>
                {tier.description && (
                  <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
                )}
              </CardHeader>

              <CardContent className="flex-1 flex flex-col">
                {/* Price */}
                <div className="text-center mb-6">
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-4xl font-bold">{tier.currency}{getPrice(tier)}</span>
                    <span className="text-muted-foreground">
                      /{billingCycle === "yearly" ? "year" : "month"}
                    </span>
                  </div>
                  {tier.trialDays && (
                    <p className="text-sm text-green-600 mt-1">{tier.trialDays}-day free trial</p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 flex-1">
                  {tier.features.map((feature, fidx) => (
                    <li key={fidx} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <X className="w-5 h-5 text-foreground shrink-0 mt-0.5" />
                      )}
                      <span className={cn("text-sm", !feature.included && "text-muted-foreground")}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  className={cn("w-full mt-6", tier.highlighted ? "" : "variant-outline")}
                  variant={tier.highlighted ? "default" : "outline"}
                  asChild
                >
                  <a href={tier.ctaUrl || "#"}>{tier.ctaText}</a>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
