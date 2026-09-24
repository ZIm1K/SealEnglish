"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format, isSameDay, isToday } from "date-fns";
import { uk } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, LayoutGrid, List } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { LessonDialog, LessonRow, NewLessonDialog, lessonState } from "@/components/app/lessons";
import { useMe, isStaffRole } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Segmented, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/misc";
import { useLessons, usePeople, targetLabel } from "@/lib/queries";
import { fmtRelativeDay, fmtTime, weekDays } from "@/lib/dates";
import { GROUP_COLORS, type Lesson } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_PX = 56;

/** Side-by-side lanes for overlapping lessons (several teachers at the same hour). */
function layoutDay(list: Lesson[]) {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: Lesson[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    for (const l of cluster) out.set(l.id, { ...out.get(l.id)!, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const l of sorted) {
    const s = new Date(l.starts_at).getTime();
    const e = new Date(l.ends_at).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    out.set(l.id, { lane, lanes: 1 });
    cluster.push(l);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export default function SchedulePage() {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const canCreate = staff || me.role === "teacher";
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"week" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches ? "list" : "week",
  );
  const [teacher, setTeacher] = useState<string>("");
  const [open, setOpen] = useState<Lesson | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDate, setCreateDate] = useState<Date | undefined>();

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const from = days[0];
  const to = addDays(days[6], 1);
  const { data: lessons = [], isLoading } = useLessons(from, to, { teacherId: teacher || undefined });
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);

  const title = `${format(days[0], "d MMM", { locale: uk })} — ${format(days[6], "d MMM yyyy", { locale: uk })}`;

  return (
    <div>
      <PageHeader
        title="Розклад"
        description={title}
        actions={
          <>
            {staff && (
              <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} className="h-10 w-48">
                <option value="">Усі викладачі</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </Select>
            )}
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "week", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" />Тиждень</span> },
                { value: "list", label: <span className="flex items-center gap-1.5"><List className="size-4" />Список</span> },
              ]}
            />
            {canCreate && (
              <Button onClick={() => { setCreateDate(undefined); setCreating(true); }}>
                <Plus /> Новий урок
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addDays(d, -7))} aria-label="Попередній тиждень"><ChevronLeft /></Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Сьогодні</Button>
        <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addDays(d, 7))} aria-label="Наступний тиждень"><ChevronRight /></Button>
        <span className="ml-2 text-sm text-mute">{(() => {
          const n = lessons.filter((l) => l.status !== "cancelled").length;
          return `${n} ${plural(n, "урок", "уроки", "уроків")} цього тижня`;
        })()}</span>
      </div>

      {isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : view === "week" ? (
        <WeekGrid
          days={days}
          lessons={lessons}
          showTeacher={staff}
          onOpen={setOpen}
          onCreate={canCreate ? (d) => { setCreateDate(d); setCreating(true); } : undefined}
        />
      ) : lessons.length === 0 ? (
        <EmptyState title="Цього тижня уроків немає" text="Можна відпочити або переглянути наступний тиждень." emotion="sleepy" />
      ) : (
        <div className="grid gap-6">
          {days.map((d) => {
            const list = lessons.filter((l) => isSameDay(new Date(l.starts_at), d));
            if (!list.length) return null;
            return (
              <section key={d.toISOString()}>
                <h2 className={cn("mb-2 font-display text-sm font-semibold", isToday(d) ? "text-coral-600" : "text-ink-soft")}>{fmtRelativeDay(d)}</h2>
                <div className="grid gap-2">
                  {list.map((l) => <LessonRow key={l.id} lesson={l} showTeacher={staff} onClick={() => setOpen(l)} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <LessonDialog lesson={open} onClose={() => setOpen(null)} />
      {canCreate && <NewLessonDialog open={creating} onOpenChange={setCreating} defaultDate={createDate} />}
    </div>
  );
}

function WeekGrid({
  days, lessons, onOpen, onCreate, showTeacher,
}: {
  days: Date[];
  lessons: Lesson[];
  onOpen: (l: Lesson) => void;
  onCreate?: (d: Date) => void;
  showTeacher?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // widen the grid for early/late lessons (e.g. students abroad in other time zones)
  const startHour = Math.min(HOUR_START, ...lessons.map((l) => new Date(l.starts_at).getHours()));
  const endHour = Math.max(HOUR_END, ...lessons.map((l) => {
    const e = new Date(l.ends_at);
    return Math.min(24, e.getHours() + (e.getMinutes() ? 1 : 0) || 24);
  }));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const top = (d: Date) => ((d.getHours() + d.getMinutes() / 60 - startHour) * HOUR_PX);

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-line bg-seal-50/50">
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className="px-2 py-3 text-center">
                <div className="text-xs font-medium text-mute uppercase">{format(d, "EEEEEE", { locale: uk })}</div>
                <div className={cn("mx-auto mt-1 flex size-8 items-center justify-center rounded-full font-display text-sm font-semibold", isToday(d) ? "bg-coral-500 text-white" : "text-ink")}>
                  {format(d, "d")}
                </div>
              </div>
            ))}
          </div>
          <div className="relative grid grid-cols-[3.5rem_repeat(7,1fr)]" style={{ height: hours.length * HOUR_PX }}>
            <div className="relative">
              {hours.map((h) => (
                <div key={h} className="absolute right-2 -translate-y-2 text-[11px] text-mute" style={{ top: (h - startHour) * HOUR_PX }}>
                  {h}:00
                </div>
              ))}
            </div>
            {days.map((d) => {
              const list = lessons.filter((l) => isSameDay(new Date(l.starts_at), d));
              const lanes = layoutDay(list);
              return (
                <div
                  key={d.toISOString()}
                  className={cn("relative border-l border-line", isToday(d) && "bg-seal-50/40")}
                  onDoubleClick={(e) => {
                    if (!onCreate) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const h = Math.floor((e.clientY - rect.top) / HOUR_PX) + startHour;
                    const dt = new Date(d);
                    dt.setHours(h, 0, 0, 0);
                    onCreate(dt);
                  }}
                >
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: (h - startHour) * HOUR_PX }} />
                  ))}
                  {isToday(d) && now.getHours() >= startHour && now.getHours() < endHour && (
                    <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: top(now) }}>
                      <span className="-ml-1 size-2.5 rounded-full bg-coral-500" />
                      <span className="h-0.5 flex-1 bg-coral-500" />
                    </div>
                  )}
                  {list.map((l) => {
                    const s = new Date(l.starts_at);
                    const e = new Date(l.ends_at);
                    const t = Math.max(0, top(s));
                    const h = Math.max(26, top(e) - t - 3);
                    const color = GROUP_COLORS[l.group?.color ?? (l.kind === "trial" ? "coral" : "sky")] ?? GROUP_COLORS.sky;
                    const st = lessonState(l);
                    const { lane, lanes: n } = lanes.get(l.id) ?? { lane: 0, lanes: 1 };
                    return (
                      <button
                        key={l.id}
                        onClick={() => onOpen(l)}
                        aria-label={`${fmtTime(l.starts_at)} ${targetLabel(l)}${l.teacher ? `, ${l.teacher.full_name}` : ""}`}
                        className={cn(
                          "absolute z-10 cursor-pointer overflow-hidden rounded-xl border-l-4 px-2 py-1 text-left text-xs shadow-soft transition hover:z-30 hover:shadow-lift",
                          color.soft,
                          st === "cancelled" && "opacity-50 line-through",
                          st === "live" && "ring-2 ring-coral-400",
                        )}
                        style={{
                          top: t + 1,
                          height: h,
                          borderLeftColor: color.hex,
                          left: `calc(${(lane / n) * 100}% + 4px)`,
                          width: `calc(${100 / n}% - 8px)`,
                        }}
                      >
                        <div className={cn("font-semibold", color.text)}>{fmtTime(l.starts_at)} {l.kind === "trial" && "· Пробний"}</div>
                        <div className="truncate font-medium text-ink">{targetLabel(l)}</div>
                        {showTeacher && h > 50 && <div className="truncate text-mute">{l.teacher?.full_name}</div>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {onCreate && <div className="border-t border-line px-4 py-2 text-xs text-mute">Подвійний клік по сітці — швидко створити урок у цей час</div>}
    </div>
  );
}
