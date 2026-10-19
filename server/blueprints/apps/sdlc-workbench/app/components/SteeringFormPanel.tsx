"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

export interface SteeringField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "multiselect";
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface SteeringMode {
  id: string;
  label: string;
  description: string;
  intent: string;
  outputArtifact: string;
  fields: SteeringField[];
}

export function buildSteeringPreviewPrompt(
  mode: SteeringMode,
  values: Record<string, string | string[]>,
): string {
  const details = mode.fields
    .map((field) => {
      const value = values[field.name];
      const rendered = Array.isArray(value) ? value.join(", ") : value;
      return rendered ? `- ${field.label}: ${rendered}` : null;
    })
    .filter(Boolean)
    .join("\n");

  return [
    `STEERING CASE: ${mode.label}`,
    `Intent: ${mode.intent}`,
    `Expected artifact: ${mode.outputArtifact}`,
    details,
    "",
    "Prepare a steering preview only. Separate detected facts, user-supplied values, assumptions, missing information, conflicts, and recommendations.",
    "Include proposed dependency/resource mappings, affected SDLC phases, risks, owners, readiness checks, and measurable acceptance conditions.",
    "Do not create records, map resources, trigger missions, forge or deploy an app, request approval, or treat this preview as approval.",
    "End with the exact confirmation and any formal HIL gate required before execution.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function SteeringFormPanel({
  modes,
  onPrepared,
  onError,
}: {
  modes: SteeringMode[];
  onPrepared: (prompt: string) => void;
  onError: (message: string | null) => void;
}) {
  const [active, setActive] = useState<SteeringMode | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});

  const open = (mode: SteeringMode) => {
    setActive(mode);
    setValues(
      Object.fromEntries(
        mode.fields.map((field) => [
          field.name,
          field.type === "multiselect" ? [] : "",
        ]),
      ),
    );
    onError(null);
  };

  const prepare = () => {
    if (!active) return;
    const missing = active.fields.find((field) => {
      if (!field.required) return false;
      const value = values[field.name];
      return Array.isArray(value) ? value.length === 0 : !value?.trim();
    });
    if (missing) {
      onError(`${missing.label} is required.`);
      return;
    }
    onPrepared(buildSteeringPreviewPrompt(active, values));
    setActive(null);
    onError(null);
  };

  if (modes.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <SlidersHorizontal className="h-3 w-3" />
        Structured steering
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => open(mode)}
            title={mode.description}
            className="shrink-0 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[10px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20"
          >
            {mode.label}
          </button>
        ))}
      </div>

      {active && (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-indigo-500/20 bg-slate-950/95 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">{active.label}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {active.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close steering form"
              className="text-slate-500 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {active.fields.map((field) => (
            <label
              key={field.name}
              className="block text-[10px] font-medium text-slate-400"
            >
              {field.label}
              {field.required ? " *" : ""}
              {field.type === "textarea" ? (
                <textarea
                  value={(values[field.name] as string) || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  placeholder={field.placeholder}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                />
              ) : field.type === "select" ? (
                <select
                  value={(values[field.name] as string) || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                >
                  <option value="">Select…</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "multiselect" ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {field.options?.map((option) => {
                    const selected = (
                      (values[field.name] as string[]) || []
                    ).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() =>
                          setValues((current) => {
                            const existing =
                              (current[field.name] as string[]) || [];
                            return {
                              ...current,
                              [field.name]: selected
                                ? existing.filter((value) => value !== option)
                                : [...existing, option],
                            };
                          })
                        }
                        className={`rounded border px-2 py-1 text-[10px] ${
                          selected
                            ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 text-slate-400"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  value={(values[field.name] as string) || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-500"
                />
              )}
            </label>
          ))}

          <button
            type="button"
            onClick={prepare}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            Prepare preview
          </button>
        </div>
      )}
    </div>
  );
}
