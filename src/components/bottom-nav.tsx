"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BottomNav() {
  const pathname = usePathname();
  const current = pathname === "/calendar" ? "calendar" : "today";
  return (
    <nav className="bottom-nav" aria-label="主导航">
      <Link href="/" aria-current={current === "today" ? "page" : undefined}>
        <span aria-hidden="true">⌂</span>今日
      </Link>
      <Link
        href="/calendar"
        aria-current={current === "calendar" ? "page" : undefined}
      >
        <span aria-hidden="true">▦</span>日历
      </Link>
      <span className="nav-disabled" aria-disabled="true">
        <span aria-hidden="true">⌁</span>趋势
      </span>
      <span className="nav-disabled" aria-disabled="true">
        <span aria-hidden="true">•••</span>设置
      </span>
    </nav>
  );
}
