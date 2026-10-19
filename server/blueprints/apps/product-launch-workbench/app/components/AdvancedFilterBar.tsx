"use client";
import React, { useState } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";

export interface FilterState {
  search?: string;
  statuses?: string[];
  types?: string[];
  owner?: string;
}

interface AdvancedFilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  statusOptions?: { label: string; value: string; color?: string }[];
  typeOptions?: { label: string; value: string; color?: string }[];
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

const DEFAULT_STATUS_OPTIONS = [
  { label: "Draft", value: "draft", color: "bg-slate-700 text-slate-300" },
  { label: "In Review", value: "in_review", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  { label: "Approved", value: "approved", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  { label: "Published", value: "published", color: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
];

const DEFAULT_TYPE_OPTIONS = [
  { label: "Landing Page", value: "Landing Page" },
  { label: "Press Release", value: "Press Release" },
  { label: "Blog Post", value: "Blog Post" },
  { label: "Email Sequence", value: "Email Sequence" },
  { label: "Sales Deck", value: "Sales Collateral" },
];

export function AdvancedFilterBar({
  filters,
  onFiltersChange,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  typeOptions = DEFAULT_TYPE_OPTIONS,
  placeholder = "Filter launch milestones, collateral, campaigns…",
  className = "",
  compact = false,
}: AdvancedFilterBarProps) {
  const [showFilters, setShowFilters] = useState(!compact);

  const handleStatusToggle = (status: string) => {
    const current = filters.statuses || [];
    const updated = current.includes(status)
      ? current.filter((s) => s !== status)
      : [...current, status];

    onFiltersChange({
      ...filters,
      statuses: updated.length > 0 ? updated : undefined,
    });
  };

  const handleTypeToggle = (type: string) => {
    const current = filters.types || [];
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];

    onFiltersChange({
      ...filters,
      types: updated.length > 0 ? updated : undefined,
    });
  };

  const handleClearAll = () => {
    onFiltersChange({});
  };

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.statuses?.length || 0) +
    (filters.types?.length || 0) +
    (filters.owner ? 1 : 0);

  return (
    <div className={`flex flex-col gap-2.5 p-3 rounded-xl border border-white/10 bg-slate-900/80 backdrop-blur ${className}`}>
      {/* Search Input Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={placeholder}
            value={filters.search || ""}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value || undefined })}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-white/10 bg-slate-950/80 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            showFilters
              ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
              : "bg-white/5 text-slate-400 border-white/10 hover:text-white"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Facets
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-300 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/30 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Expanded Filter Facets */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/5 text-xs">
          {/* Status Facet */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">Status:</span>
            {statusOptions.map((opt) => {
              const isSelected = filters.statuses?.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStatusToggle(opt.value)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                    isSelected
                      ? "bg-violet-500/20 text-violet-300 border-violet-500 shadow-sm"
                      : "bg-slate-950/60 text-slate-400 border-white/5 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  {isSelected && <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 mr-1" />}
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Type Facet */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase text-slate-500 font-bold">Type:</span>
            {typeOptions.map((opt) => {
              const isSelected = filters.types?.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTypeToggle(opt.value)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                    isSelected
                      ? "bg-pink-500/20 text-pink-300 border-pink-500 shadow-sm"
                      : "bg-slate-950/60 text-slate-400 border-white/5 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  {isSelected && <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-400 mr-1" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdvancedFilterBar;
