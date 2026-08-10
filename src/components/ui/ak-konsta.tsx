"use client";

import Link from "next/link";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Button,
  Card,
  Chip,
  KonstaProvider,
  List,
  ListItem,
} from "konsta/react";

import type { StatusTone } from "./primitives";

const chipColors = {
  neutral: "bg-ios-light-surface-variant text-ios-light-on-surface-variant",
  brand: "bg-primary/15 text-primary",
  attention: "bg-orange-100 text-orange-800",
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-900",
  danger: "bg-red-100 text-red-800",
} satisfies Record<StatusTone, string>;

export function AkKonstaProvider({ children }: { children: ReactNode }) {
  return <KonstaProvider theme="ios">{children}</KonstaProvider>;
}

export function AkScreenHeader({
  title,
  subtitle,
  actions,
  status,
  className = "",
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  status?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`ak-screen-header ${className}`.trim()}
      data-ak-screen-header
    >
      <div className="ak-screen-header-copy">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? (
        <div className="ak-screen-header-actions">{actions}</div>
      ) : null}
      {status ? <div className="ak-screen-header-status">{status}</div> : null}
    </header>
  );
}

export function AkToolbarAction({
  label,
  icon,
  children,
  onClick,
  disabled,
  title,
  className = "",
  variant = "clear",
}: {
  label: string;
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: "clear" | "tonal";
}) {
  return (
    <Button
      {...(variant === "tonal" ? { tonalIos: true } : { clearIos: true })}
      inline
      type="button"
      aria-label={label}
      title={title ?? label}
      className={`ak-toolbar-action ${className}`.trim()}
      data-ak-today-action="toolbar"
      data-ak-toolbar-variant={variant}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </Button>
  );
}

export function AkCard({
  title,
  subtitle,
  ariaLabel,
  status,
  children,
  footer,
  className = "",
  dataTodayWorkout = false,
  dataTodayRecords = false,
  dataTodayFeedback = false,
  dataTestId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  ariaLabel?: string;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  dataTodayWorkout?: boolean;
  dataTodayRecords?: boolean;
  dataTodayFeedback?: boolean;
  dataTestId?: string;
}) {
  return (
    <section
      className={`ak-card ${className}`.trim()}
      data-ak-card
      data-today-workout={dataTodayWorkout ? "true" : undefined}
      data-today-records={dataTodayRecords ? "true" : undefined}
      data-today-feedback={dataTodayFeedback ? "true" : undefined}
      data-testid={dataTestId}
      role="region"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
    >
      <Card
        header={
          <div className="ak-card-header">
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {status ? <div>{status}</div> : null}
          </div>
        }
        footer={
          footer ? <div className="ak-card-footer">{footer}</div> : undefined
        }
        contentWrap={false}
        headerDivider={false}
        footerDivider={false}
        className="ak-konsta-card"
      >
        <div className="ak-card-content">{children}</div>
      </Card>
    </section>
  );
}

export function AkCompactActionCard({
  title,
  action,
  ariaLabel,
  className = "",
  dataTodayFeedback = false,
}: {
  title: ReactNode;
  action: AkCompactActionLinkProps;
  ariaLabel?: string;
  className?: string;
  dataTodayFeedback?: boolean;
}) {
  return (
    <section
      className={`ak-card ${className}`.trim()}
      data-ak-card
      data-today-feedback={dataTodayFeedback ? "true" : undefined}
      role="region"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
    >
      <Card
        contentWrap={false}
        headerDivider={false}
        footerDivider={false}
        className="ak-konsta-card ak-compact-action-card"
      >
        <div className="ak-compact-action-row">
          <h2>{title}</h2>
          <AkCompactActionLink {...action} />
        </div>
      </Card>
    </section>
  );
}

type AkActionLinkProps = {
  href: string;
  label: string;
  scroll?: boolean;
  variant?: "tonal" | "filled";
  className?: string;
  disabled?: boolean;
  compact?: boolean;
  todayAction?: "feedback";
  calendarAction?: "assistant";
};

export type AkCompactActionLinkProps = Omit<
  AkActionLinkProps,
  "variant" | "compact"
>;

export function AkActionLink({
  href,
  label,
  scroll,
  variant = "filled",
  className = "",
  disabled = false,
  compact = false,
  todayAction,
  calendarAction,
}: AkActionLinkProps) {
  const handleClick = disabled
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
      }
    : undefined;
  const ActionLink = forwardRef<
    HTMLAnchorElement,
    ComponentPropsWithoutRef<typeof Link>
  >((props, ref) => <Link {...props} ref={ref} scroll={scroll} />);
  ActionLink.displayName = "AkActionNextLink";

  return (
    <Button
      component={ActionLink}
      {...(variant === "tonal" ? { tonalIos: true } : {})}
      inline
      href={href}
      role="link"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`ak-action-link ${className}`.trim()}
      data-ak-action-variant={variant}
      data-ak-today-action={todayAction}
      data-ak-calendar-action={calendarAction}
      data-ak-compact-action={compact ? "true" : undefined}
      disabled={disabled}
      onClick={handleClick}
    >
      {label}
    </Button>
  );
}

export type AkCalendarActionLinkProps = Omit<
  AkActionLinkProps,
  "variant" | "compact" | "todayAction" | "calendarAction"
>;

export function AkCalendarActionLink(props: AkCalendarActionLinkProps) {
  return (
    <AkActionLink
      {...props}
      compact
      variant="tonal"
      todayAction={undefined}
      calendarAction="assistant"
      className={`ak-calendar-action-link ${props.className ?? ""}`.trim()}
    />
  );
}

export function AkCompactActionLink(props: AkCompactActionLinkProps) {
  return (
    <AkActionLink
      {...props}
      compact
      variant="tonal"
      todayAction="feedback"
      className={`ak-compact-action-link ${props.className ?? ""}`.trim()}
    />
  );
}

export function AkInsetList({ children }: { children: ReactNode }) {
  return (
    <List inset strongIos dividersIos className="ak-inset-list">
      {children}
    </List>
  );
}

export function AkListRow({
  title,
  subtitle,
  after,
  media,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
  media?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <ListItem
      title={title}
      subtitle={subtitle}
      after={after}
      media={media}
      contentChildren={children}
      innerClassName="ak-list-row-inner"
      contentClassName="ak-list-row-content"
      titleWrapClassName="ak-list-row-title-wrap"
      className="ak-list-row"
    />
  );
}

export function AkStatusChip({
  tone = "neutral",
  children,
  icon,
}: {
  tone?: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Chip
      component="span"
      className={`status-pill ak-status-chip ${chipColors[tone]}`}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </Chip>
  );
}

export function AkActionRow({
  children,
  onClick,
  disabled,
  className = "",
  ariaExpanded,
  ariaControls,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  return (
    <Button
      clearIos
      type="button"
      className={`ak-action-row ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      data-ak-action-row="true"
      data-ak-today-action="secondary"
    >
      {children}
    </Button>
  );
}
