interface HatIconProps {
  className?: string;
}

export function HatIcon({ className }: HatIconProps) {
  return (
    <img
      // No ?v= cache-bust here. The file exists at this path, but `?v=` is Vite's
      // own dependency-version query: appending it routes the request into the
      // module pipeline instead of serving the public asset, and the image breaks
      // to its alt text. Use a renamed file if this ever genuinely needs busting.
      src="/assets/branding/bowler-hat.png"
      alt="Oddjob Bowler Hat"
      className={className}
    />
  );
}
