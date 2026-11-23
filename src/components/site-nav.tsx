"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Radar, Bell, Wallet, CalendarDays, Newspaper } from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/holdings", label: "My holdings", icon: Wallet },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/market", label: "Market scan", icon: Radar },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/track-record", label: "Track record", icon: LayoutDashboard },
];

function PendingTab() {
  const { pending } = useLinkStatus();
  return <>
    <span role="status" className="sr-only">{pending ? "Loading tab…" : ""}</span>
    {pending && <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-current opacity-70 motion-safe:animate-pulse" />}
  </>;
}

export function SiteNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return <nav aria-label="Main navigation" className="site-nav">
    {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
      <Icon className="size-4" aria-hidden="true" />{label}
      <PendingTab />
    </Link>)}
  </nav>;
}
