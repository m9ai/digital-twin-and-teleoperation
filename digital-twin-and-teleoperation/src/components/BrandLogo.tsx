interface BrandLogoProps {
  className?: string;
  title?: string;
}

/**
 * Vector brand mark: a 6-axis arm with telemetry arcs. Shares the geometry of
 * `public/icons/icon.svg` so favicon, app icon and in-app logo stay identical.
 */
export function BrandLogo({ className = 'h-5 w-5', title }: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title ?? 'ROS 2 Digital Twin & Teleoperation'}
      fill="none"
    >
      {title ? <title>{title}</title> : null}

      {/* telemetry arcs */}
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55">
        <path d="M23.5 7.5a5 5 0 0 1 5 5" />
        <path d="M25 4.2a9 9 0 0 1 3.8 8.3" opacity="0.6" />
      </g>

      {/* pedestal */}
      <path d="M11 27h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14.5 27v-3M17.5 27v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />

      {/* limbs */}
      <g stroke="currentColor" strokeLinecap="round">
        <path d="M16 23.5 10.5 15" strokeWidth="2.6" />
        <path d="M10.5 15 19 11.5" strokeWidth="2.2" />
        <path d="M19 11.5 22.5 9.5" strokeWidth="1.6" />
      </g>

      {/* joints */}
      <circle cx="16" cy="23.5" r="1.6" fill="#f97316" />
      <circle cx="10.5" cy="15" r="1.5" fill="#f97316" />
      <circle cx="19" cy="11.5" r="1.3" fill="#f97316" />
      <circle cx="23.5" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}
