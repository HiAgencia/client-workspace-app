"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { firstWeekday, instantsOf, weekOf, type Day } from "@/lib/dates";
import type { TasksView } from "@/lib/tools/tasks";
import { useToolRead } from "./boxes";
import { placeValue, readPlace, type MailList, type Place } from "./box-kinds";
import type { TreeNode } from "./client-api";
import { AccountFilter, ALL, PlaceFilter } from "./place-filters";

// The header filters of the pages of boxes and of Tasks: the workspace's own place and account filters, with what each
// option counts on these pages —open tasks for a place, what the Mail box shows for an account—, kept in the address.

export function useAddress() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = useCallback(
    (change: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, set };
}

export function usePlaceParam(tree: TreeNode[] | null): Place {
  return readPlace(useSearchParams().get("place"), tree);
}

const total = (view: TasksView) => view.groups.overdue.count + view.groups.today.count + view.groups.upcoming.count + view.groups.noDate.count;

type Content = { content: { nodes: string[]; general: boolean } | null };

// The places that have something to show in some box besides their tasks —the mail of an account they see, the notes of
// what is below them, the week's events—, in one light read the tree gives.
function useShows(now: Day | null): Set<string> {
  const week = now ? weekOf(now, firstWeekday()) : null;
  const instants = week ? instantsOf(week.from, week.to) : null;
  const read = useToolRead<Content>("list_tree", week && instants ? { withContent: { from: instants.from, to: instants.to, fromDay: week.from, toDay: week.to } } : null);
  const content = read.data?.content;
  const shows = new Set<string>(content?.nodes ?? []);
  if (content?.general) shows.add("general");
  return shows;
}

// The place: every place, General, and each client and project with what is below it. Each option says its open tasks, the
// sidebar's number; a place is offered when some box has something to show for it, and one with nothing is not.
export function TasksPlaceFilter({ place, onChange, tree, now }: { place: Place; onChange: (place: Place) => void; tree: TreeNode[] | null; now: Day | null }) {
  const general = useToolRead<TasksView>("get_tasks", now ? { node: null, today: now } : null);
  const shows = useShows(now);
  const generalCount = general.data ? total(general.data) : 0;
  const counts = new Map<string, number>([[ALL, (tree ?? []).filter((node) => node.parentId === null).reduce((sum, node) => sum + node.openTasks, 0) + generalCount], ["general", generalCount]]);
  for (const node of tree ?? []) counts.set(node.id, node.openTasks);
  return <PlaceFilter value={placeValue(place) ?? ALL} tree={tree} counts={counts} shows={shows} onChange={(value) => onChange(value === ALL ? { kind: "all" } : readPlace(value, tree))} />;
}

// The account the Mail box reads, each option with what it would show there: what a task waits for and what is unread.
export function MailAccountFilter({ account, onChange, mail }: { account: string | null; onChange: (account: string | null) => void; mail: MailList | null }) {
  const shown = mail ? [...mail.groups.forTasks.messages, ...mail.groups.unread.messages] : [];
  const counts = new Map<string, number>([[ALL, new Set(shown.map((message) => `${message.accountId}:${message.id}`)).size]]);
  for (const entry of mail?.accounts ?? []) counts.set(entry.id, new Set(shown.filter((message) => message.accountId === entry.id).map((message) => message.id)).size);
  return <AccountFilter value={account ?? ALL} accounts={mail?.accounts ?? []} counts={counts} onChange={(value) => onChange(value === ALL ? null : value)} />;
}
