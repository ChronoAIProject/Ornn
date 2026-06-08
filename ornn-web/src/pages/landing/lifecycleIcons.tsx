/**
 * Line icons for the skill-lifecycle ring (#840 follow-up).
 *
 * Lucide-derived (MIT), stroke-based to match the existing landing icon
 * language. Size + color come from the consumer via `currentColor` and the
 * className. Kept in their own module so `lifecycleStages` stays a pure data
 * module (and both files satisfy react-refresh's component/non-component split).
 *
 * @module pages/landing/lifecycleIcons
 */
import type { SVGProps } from "react";

const iconBase: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <circle cx="11" cy="11" r="7.5" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export const PreviewIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const AuditIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 3 6.8 7 8.2 4-1.4 7-4 7-8.2V6l-7-3Z" />
    <path d="m9 11.5 2 2 4-4" />
  </svg>
);

export const InstallIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <path d="M12 3v11" />
    <path d="m7.5 10 4.5 4.5 4.5-4.5" />
    <path d="M4.5 20h15" />
  </svg>
);

export const ExecuteIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <rect x="2.75" y="4.25" width="18.5" height="15.5" rx="2.25" />
    <path d="m6.5 9 3 3-3 3" />
    <path d="M12.5 15h4.5" />
  </svg>
);

export const BuildIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <path d="M14.6 6.3a1 1 0 0 0 0 1.4l1.7 1.7a1 1 0 0 0 1.4 0l3.6-3.6a6 6 0 0 1-7.9 7.9l-6.7 6.7a2.1 2.1 0 1 1-3-3l6.7-6.7a6 6 0 0 1 7.9-7.9l-3.6 3.6Z" />
  </svg>
);

export const PublishIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <path d="M12 21V8" />
    <path d="m7.5 12 4.5-4.5 4.5 4.5" />
    <path d="M4.5 4h15" />
  </svg>
);

export const ShareIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...iconBase} {...p}>
    <circle cx="18" cy="5.5" r="2.75" />
    <circle cx="6" cy="12" r="2.75" />
    <circle cx="18" cy="18.5" r="2.75" />
    <path d="m8.4 10.8 7.2-3.8" />
    <path d="m8.4 13.2 7.2 3.8" />
  </svg>
);
