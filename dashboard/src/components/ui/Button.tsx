import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "accent" | "danger";

const VARIANT: Record<Variant, string> = {
  default: "border-edge bg-panel text-ink hover:border-running/60 hover:text-running",
  accent: "border-edge bg-panel text-ink hover:border-accent/60 hover:text-accent",
  danger: "border-edge bg-panel text-failed hover:border-failed/60",
};

/** Small mono button used across the dashboard. */
export function Button({
  variant = "default",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`cursor-pointer rounded-md border px-3 py-1.5 font-mono text-xs
        transition-colors disabled:cursor-wait disabled:opacity-60
        ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
