"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { AiFeatures, Assignment, Group, Lesson, Profile, Role, StudentBalance } from "./types";

export const LESSON_SELECT =
  "*, teacher:profiles!lessons_teacher_id_fkey(id, full_name, avatar_url), substitute:profiles!lessons_substitute_for_fkey(id, full_name), student:profiles!lessons_student_id_fkey(id, full_name, avatar_url), group:groups(id, name, color), lesson_leads(lead_id, attended, lead:leads(id, name, phone, status))";

export async function fetchLessons(from: Date, to: Date, opts: { teacherId?: string } = {}) {
  let q = supabase
    .from("lessons")
    .select(LESSON_SELECT)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");
  if (opts.teacherId) q = q.eq("teacher_id", opts.teacherId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Lesson[];
}

export function useLessons(from: Date, to: Date, opts: { teacherId?: string } = {}) {
  return useQuery({
    queryKey: ["lessons", from.toISOString(), to.toISOString(), opts.teacherId ?? null],
    queryFn: () => fetchLessons(from, to, opts),
  });
}

export function useGroups(opts: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: ["groups", !!opts.includeArchived],
    queryFn: async () => {
      let q = supabase
        .from("groups")
        .select("*, teacher:profiles!groups_teacher_id_fkey(id, full_name, avatar_url), members:group_members(student:profiles!group_members_student_id_fkey(id, full_name, avatar_url, email, level))")
        .order("name");
      if (!opts.includeArchived) q = q.eq("is_archived", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Group[];
    },
  });
}

export function usePeople(roles?: Role[]) {
  return useQuery({
    queryKey: ["people", roles?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("profiles").select("*").order("full_name");
      if (roles) q = q.in("role", roles);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}

export const ASSIGNMENT_SELECT =
  "*, teacher:profiles!assignments_teacher_id_fkey(id, full_name, avatar_url), group:groups(id, name, color), student:profiles!assignments_student_id_fkey(id, full_name, avatar_url), submissions(*, student:profiles!submissions_student_id_fkey(id, full_name, avatar_url))";

export function useAssignments() {
  return useQuery({
    queryKey: ["assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assignments").select(ASSIGNMENT_SELECT).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });
}

/** Human label for who a lesson/assignment is for. */
export function targetLabel(x: {
  group?: { name: string } | null;
  student?: { full_name: string } | null;
  lesson_leads?: { lead?: { name: string } | null }[];
}) {
  if (x.group) return x.group.name;
  if (x.student) return x.student.full_name;
  const leads = (x.lesson_leads ?? []).map((l) => l.lead?.name).filter(Boolean);
  if (leads.length) return `Пробний · ${leads.join(", ")}`;
  return "—";
}

/** AI feature flags for the signed-in user (server decides: settings, key, pilot groups, daily limit). */
export function useAiFeatures() {
  return useQuery({
    queryKey: ["ai-features"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ai_features");
      if (error) return null;
      return data as AiFeatures | null;
    },
  });
}

// numeric columns arrive as strings from PostgREST
const toBalance = (r: Record<string, unknown>): StudentBalance => ({
  ...(r as unknown as StudentBalance),
  paid_uah: Number(r.paid_uah),
  balance_uah: Number(r.balance_uah),
  price_per_lesson: r.price_per_lesson == null ? null : Number(r.price_per_lesson),
});

/** One student's balance (own one when no id); null when it is hidden from the caller. */
export function useStudentBalance(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["student-balance", studentId ?? "me"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_balance", studentId ? { p_student: studentId } : {});
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? toBalance(row) : null;
    },
  });
}

/** Balances of every student the caller may see, keyed by student id. */
export function useStudentBalances(enabled = true) {
  return useQuery({
    queryKey: ["student-balances"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_balances");
      if (error) throw error;
      return new Map(((data ?? []) as Record<string, unknown>[]).map((r) => [r.student_id as string, toBalance(r)]));
    },
  });
}
