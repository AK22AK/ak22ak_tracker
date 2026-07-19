"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

const tabs = [
  { href: "/", label: "今日", icon: "⌂" },
  { href: "/calendar", label: "日历", icon: "▦" },
  { href: "/trends", label: "趋势", icon: "⌁" },
  { href: "/settings", label: "设置", icon: "•••" },
] as const;

function isCurrentTab(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

function shouldUseNativeNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function BottomNav({
  activePath,
  onNavigate,
}: {
  activePath: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={isCurrentTab(activePath, tab.href) ? "page" : undefined}
          onClick={(event) => {
            if (shouldUseNativeNavigation(event)) return;
            event.preventDefault();
            onNavigate(tab.href);
          }}
        >
          <span aria-hidden="true">{tab.icon}</span>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
