"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { AiFeatures, Assignment, Group, Lesson, Profile, Role } from "./types";

export const LESSON_SELECT =
  "*, teacher:profiles!lessons_teacher_id_fkey(id, full_name, avatar_url), student:profiles!lessons_student_id_fkey(id, full_name, avatar_url), group:groups(id, name, color), lesson_leads(lead_id, attended, lead:leads(id, name, phone, status))";

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
