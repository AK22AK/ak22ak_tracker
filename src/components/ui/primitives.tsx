import type { HTMLAttributes, ReactNode } from "react";

export type StatusTone =
  "neutral" | "brand" | "attention" | "success" | "warning" | "danger";

export function StatusPill({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`status-pill ${className}`.trim()} data-tone={tone}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export function SurfaceCard({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section className={`surface-card ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
  );
}
