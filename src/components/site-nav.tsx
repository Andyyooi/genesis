"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Radar, Bell, Wallet } from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/holdings", label: "My holdings", icon: Wallet },
  { href: "/market", label: "Market scan", icon: Radar },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/track-record", label: "Track record", icon: LayoutDashboard },
];

export function SiteNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return <nav aria-label="Main navigation" className="site-nav">
    {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
      <Icon className="size-4" aria-hidden="true" />{label}
    </Link>)}
  </nav>;
}
