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

/** Small, production-only building blocks for the iOS-style information hierarchy. */
export function LargeTitleHeader({
  eyebrow,
  title,
  metadata,
  action,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  metadata?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`large-title-header ${className}`.trim()}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {metadata ? <p className="large-title-metadata">{metadata}</p> : null}
      </div>
      {action ? <div className="large-title-action">{action}</div> : null}
    </header>
  );
}

export function GroupedSection({
  label,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { label?: string }) {
  return (
    <section className={`grouped-section ${className}`.trim()} {...props}>
      {label ? <p className="grouped-section-label">{label}</p> : null}
      {children}
    </section>
  );
}

export function InsetListRow({
  title,
  detail,
  href,
  action,
}: {
  title: string;
  detail?: ReactNode;
  href?: string;
  action?: ReactNode;
}) {
  const content = (
    <>
      <span className="inset-list-row-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {action ? <span className="inset-list-row-action">{action}</span> : null}
    </>
  );
  return href ? (
    <a className="inset-list-row" href={href}>
      {content}
    </a>
  ) : (
    <div className="inset-list-row">{content}</div>
  );
}

export function MetricStrip({ children }: { children: ReactNode }) {
  return <div className="metric-strip">{children}</div>;
}

export function SafetyBanner({
  level,
  children,
}: {
  level: "yellow" | "red";
  children: ReactNode;
}) {
  return (
    <section className={`safety-banner ${level}`} role="alert">
      {children}
    </section>
  );
}

export function MaterialTabBar({ children }: { children: ReactNode }) {
  return <nav className="material-tab-bar">{children}</nav>;
}
