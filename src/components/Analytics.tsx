"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { GTM_ID, isPrivatePath, loadGtm, track } from "@/lib/analytics";

/** Query params that must never leave the site (one-time level-test token, auth codes). */
const SECRET_PARAMS = ["t", "token", "code"];

function pageLocation() {
  const url = new URL(window.location.href);
  for (const k of SECRET_PARAMS) url.searchParams.delete(k);
  return url.toString();
}

/** Sends a page_view on every client-side navigation between public pages (the GA4 tag in GTM has send_page_view off). */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (!GTM_ID || isPrivatePath(pathname)) return;
    loadGtm();
    track("page_view", { page_location: pageLocation(), page_title: document.title });
  }, [pathname]);
  return null;
}
