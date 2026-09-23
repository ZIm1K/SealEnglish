import { addDays, format, isSameDay, isToday, isTomorrow, startOfWeek } from "date-fns";
import { uk } from "date-fns/locale";

/** Display helpers use the viewer's local time zone (students may study from abroad). */
export const fmtTime = (iso: string | Date) => format(new Date(iso), "HH:mm");
export const fmtDate = (iso: string | Date, pattern = "d MMMM") => format(new Date(iso), pattern, { locale: uk });
export const fmtDateTime = (iso: string | Date) => format(new Date(iso), "d MMM, HH:mm", { locale: uk });

export function fmtRelativeDay(iso: string | Date) {
  const d = new Date(iso);
  if (isToday(d)) return "Сьогодні";
  if (isTomorrow(d)) return "Завтра";
  return format(d, "EEEE, d MMMM", { locale: uk }).replace(/^./, (c) => c.toUpperCase());
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function countdown(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "вже йде";
  const m = Math.round(ms / 60000);
  if (m < 60) return `через ${m} хв`;
  const h = Math.floor(m / 60);
  if (h < 24) return `через ${h} год ${m % 60 ? `${m % 60} хв` : ""}`.trim();
  const d = Math.round(h / 24);
  return `через ${d} дн`;
}

export { isSameDay, addDays };

/** "YYYY-MM-DD" for <input type=date> in the viewer's zone. */
export const toDateInput = (d: Date) => format(d, "yyyy-MM-dd");

export const isKyivZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Kyiv";
