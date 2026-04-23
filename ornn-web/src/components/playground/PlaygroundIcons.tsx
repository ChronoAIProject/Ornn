/**
 * Shared SVG icon components for the Playground feature.
 * Centralizes icon definitions to avoid duplication across playground components.
 * @module components/playground/PlaygroundIcons
 */

interface IconProps {
  className?: string;
}

/** Wrench/tool icon for tool call indicators. */
export function ToolIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M11.42 15.17l-5.658-5.66a2.002 2.002 0 010-2.83l.707-.706a2 2 0 012.828 0l5.66 5.657m-3.537 3.538l5.658 5.66a2.002 2.002 0 002.83 0l.706-.707a2 2 0 000-2.828l-5.66-5.66"
      />
    </svg>
  );
}

/** X/close icon for delete and dismiss actions. */
export function XIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/** Pencil/edit icon for edit actions. */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
      />
    </svg>
  );
}
