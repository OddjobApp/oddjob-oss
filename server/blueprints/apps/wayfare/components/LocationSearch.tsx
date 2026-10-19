import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, MapPin, Search } from "lucide-react";
import { tripsRequest } from "../lib/platform-client";

type Point = { latitude: number; longitude: number };
type Location = Point & { name: string };
type Suggestion = Location & { context?: string };

/**
 * Type-ahead Mapbox place search. Suggestions come from temporary geocoding
 * and are only displayed; picking one runs a single permanent lookup, and only
 * that result's coordinates reach `onSelect` to be saved with the trip.
 */
export default function LocationSearch({
  label,
  value,
  point,
  credentialId,
  disabled,
  proximity,
  onTextChange,
  onSelect,
}: {
  label: string;
  value: string;
  point: Point | null;
  credentialId: string;
  disabled: boolean;
  proximity?: Point | null;
  /** Typing edits the saved text; the parent must clear the pinned point. */
  onTextChange?: (text: string) => void;
  onSelect: (location: Location) => void;
}) {
  const id = useId(),
    listId = `${id}-suggestions`;
  const [query, setQuery] = useState(value),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [searching, setSearching] = useState(false),
    [resolving, setResolving] = useState(false),
    [error, setError] = useState("");
  const typed = useRef(false),
    sequence = useRef(0),
    container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typed.current) setQuery(value);
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!typed.current) return;
    const text = query.trim();
    if (!credentialId || text.length < 3) {
      sequence.current++;
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      const mine = ++sequence.current;
      setSearching(true);
      setError("");
      try {
        const data = await tripsRequest<{ items: Suggestion[] }>(
          {
            credentialId: Number(credentialId),
            query: text,
            mode: "suggest",
            ...(proximity ? { proximity } : {}),
          },
          "/geocode",
        );
        if (mine !== sequence.current) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setSuggestions(items);
        setActive(items.length ? 0 : -1);
        setOpen(true);
      } catch (e) {
        if (mine === sequence.current) setError((e as Error).message);
      } finally {
        if (mine === sequence.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, credentialId]);

  function edit(text: string) {
    typed.current = true;
    setQuery(text);
    setOpen(true);
    onTextChange?.(text);
  }

  async function choose(suggestion: Suggestion) {
    sequence.current++;
    setOpen(false);
    setSuggestions([]);
    setQuery(suggestion.name);
    setResolving(true);
    setError("");
    try {
      const data = await tripsRequest<{ items: Location[] }>(
        { credentialId: Number(credentialId), query: suggestion.name },
        "/geocode",
      );
      const match = Array.isArray(data?.items) ? data.items[0] : undefined;
      if (!match)
        throw new Error(
          "Mapbox could not confirm that place. Refine the search and pick again.",
        );
      typed.current = false;
      onSelect({
        name: suggestion.name,
        latitude: match.latitude,
        longitude: match.longitude,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void choose(suggestions[active]);
    }
  }

  const showList =
    open &&
    !disabled &&
    (suggestions.length > 0 ||
      (!searching &&
        typed.current &&
        query.trim().length >= 3 &&
        !!credentialId &&
        !error));
  return (
    <div ref={container} className="relative">
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 mt-[3px] -translate-y-1/2 text-zinc-500 pointer-events-none"
        />
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && active >= 0 ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          maxLength={300}
          value={query}
          placeholder={
            credentialId
              ? "Search an address, city or landmark"
              : "Enter a place"
          }
          onChange={(e) => edit(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled || resolving}
          style={{ paddingLeft: 34, paddingRight: 34 }}
        />
        {(searching || resolving) && (
          <Loader2
            size={15}
            className="absolute right-3 top-1/2 mt-[3px] -translate-y-1/2 animate-spin text-zinc-400"
          />
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-white/10 bg-zinc-900 shadow-2xl"
        >
          {suggestions.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-400">
              No places match. Try a fuller address or a nearby city.
            </li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={`${s.name}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(s)}
              className={`flex cursor-pointer gap-2 px-3 py-2 text-sm ${i === active ? "bg-indigo-500/20" : ""}`}
            >
              <MapPin size={15} className="mt-0.5 shrink-0 text-indigo-300" />
              <span className="min-w-0">
                <span className="block truncate">{s.name}</span>
                {s.context && s.context !== s.name && (
                  <span className="block truncate text-xs text-zinc-400">
                    {s.context}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="mt-1 text-amber-200 text-xs" role="alert">
          {error}
        </p>
      ) : point &&
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-emerald-300">
          <Check size={13} /> Pinned {point.latitude.toFixed(5)},{" "}
          {point.longitude.toFixed(5)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">
          {credentialId
            ? query.trim()
              ? "Pick a suggestion to pin coordinates for routing."
              : "Type at least 3 characters to search Mapbox."
            : "Select an organization Mapbox credential to search places."}
        </p>
      )}
    </div>
  );
}
