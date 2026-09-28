"use client";

import { useEffect, useState } from "react";
import { PLANS, PROMO, promoOff } from "@/content/site";

const END = Date.parse(PROMO.endsAt);

export const isPromoActive = () => Date.now() < END;

export const promoMaxOff = Math.max(...PLANS.map(promoOff));

/** "29 вересня о 13:00", in Kyiv time whatever the visitor's clock says. */
export const promoEndLabel = (() => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", ...o }).format(END);
  return `${f({ day: "numeric", month: "long" })} о ${f({ hour: "2-digit", minute: "2-digit" })}`;
})();

/** Ticks every second. Inactive until mounted, so the static HTML never shows a promo that may already be over. */
export function usePromo() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const left = now === null ? 0 : Math.max(0, END - now);
  return { active: left > 0, left };
}

export function formatLeft(ms: number) {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Appended to the lead comment so the manager sees which price was promised. */
export function promoNote() {
  if (!isPromoActive()) return "";
  const p = PROMO.prices;
  return `🔥 Акція 24 год (заявка до ${promoEndLabel}): ${PROMO.term} — група ${p.group} ₴, індивідуально ${p.solo} ₴, НМТ ${p.exam} ₴ за урок`;
}
