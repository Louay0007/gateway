"use client";

import * as React from "react";

import { useApi } from "@/lib/api/use-api";

/**
 * Projects, fetched once for the sidebar.
 *
 * WHY THIS IS A HOOK AND NOT LOCAL STATE IN ProjectList: two components in
 * the same rail need the list — ProjectList renders it and ConversationList
 * offers "move to project" on each chat. Fetching in each would double the
 * request on every mount and let the two disagree about a project that was
 * just archived.
 *
 * The sidebar owns one instance and passes `projects` down, so there is a
 * single source for the rail.
 */
export interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  color: string;
  conversationCount: number;
}

export function useProjects() {
  const { data, loading, reload } = useApi<{ projects: ProjectRow[] }>("/api/chat/projects");
  const projects = React.useMemo(() => data?.projects ?? [], [data]);
  return { projects, loading, reload };
}
