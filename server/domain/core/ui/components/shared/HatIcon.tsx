interface HatIconProps {
  className?: string;
  publicBackdrop?: boolean;
}

export function HatIcon({ className, publicBackdrop = false }: HatIconProps) {
  return (
    <img
      // No ?v= cache-bust here. The file exists at this path, but `?v=` is Vite's
      // own dependency-version query: appending it routes the request into the
      // module pipeline instead of serving the public asset, and the image breaks
      // to its alt text. Use a renamed file if this ever genuinely needs busting.
      src="/assets/branding/bowler-hat.png"
      alt="Oddjob Bowler Hat"
      // theme-lint-ignore: public brand mark intentionally uses solid white in both themes.
      className={/* theme-lint-ignore: fixed white public brand backdrop */ [className, publicBackdrop ? "rounded-full bg-white p-1 object-contain shrink-0" : ""].filter(Boolean).join(" ")}
    />
  );
}
