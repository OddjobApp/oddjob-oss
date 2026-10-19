interface HatIconProps {
  className?: string;
}

export function HatIcon({ className }: HatIconProps) {
  return (
    <img
      src="/assets/branding/bowler-hat.png"
      alt="Oddjob Bowler Hat"
      className={className}
    />
  );
}
