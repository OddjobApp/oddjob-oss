"use client";

import Link, { type LinkProps } from "next/link";
import { type AnchorHTMLAttributes, useEffect, useMemo, useState } from "react";

type ProxyLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | "href"> &
  LinkProps & {
    href: string;
  };

function proxiedHref(href: string, currentPath: string): string {
  if (!href.startsWith("/")) return href;
  const match = currentPath.match(/^\/app\/([^/?#]+)/);
  if (!match) return href;
  if (href === "/") return `/app/${match[1]}?embed=cycle`;
  return `/app/${match[1]}${href}?embed=cycle`;
}

export function ProxyLink({ href, ...props }: ProxyLinkProps) {
  const [currentPath, setCurrentPath] = useState("");

  useEffect(() => {
    setCurrentPath(window.location.pathname);
  }, []);

  const safeHref = useMemo(() => proxiedHref(href, currentPath), [href, currentPath]);
  return <Link href={safeHref} {...props} />;
}
