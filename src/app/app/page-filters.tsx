"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { firstWeekday, instantsOf, weekOf, type Day } from "@/lib/dates";
import { useEventsRead } from "./use-events-read";
import { mailBoxRows, placeValue, readPlace, type MailList, type Place } from "./box-kinds";
import type { TreeNode } from "./client-api";
import { AccountFilter, ALL, GENERAL, MESSAGES, PlaceFilter, placesThatShow, TASKS, type ShownEvent } from "./place-filters";
import type { TaskReplies } from "./task-replies";
import { useWorkspace } from "./workspace";




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




function useShows(now: Day | null): Set<string> {
  const { tree, mailAccounts, notePlaces } = useWorkspace();
  const week = now ? weekOf(now, firstWeekday()) : null;
  const instants = week ? instantsOf(week.from, week.to) : null;
  const read = useEventsRead<ShownEvent>(week && instants ? { from: instants.from, to: instants.to, fromDay: week.from, toDay: week.to } : null, false);
  
  if (read.error && !read.data) return new Set([GENERAL, ...(tree ?? []).map((node) => node.id)]);
  return placesThatShow(tree, mailAccounts ?? [], notePlaces, read.data?.events ?? []);
}



export function TasksPlaceFilter({ place, onChange, tree, now }: { place: Place; onChange: (place: Place) => void; tree: TreeNode[] | null; now: Day | null }) {
  const { generalTasks } = useWorkspace();
  const shows = useShows(now);
  
  const counts = tree === null || generalTasks === null ? null : new Map<string, number>([[ALL, tree.filter((node) => node.parentId === null).reduce((sum, node) => sum + node.openTasks, 0) + generalTasks], ["general", generalTasks], ...tree.map((node): [string, number] => [node.id, node.openTasks])]);
  return <PlaceFilter value={placeValue(place) ?? ALL} tree={tree} counts={counts} unit={TASKS} shows={shows} onChange={(value) => onChange(value === ALL ? { kind: "all" } : readPlace(value, tree))} />;
}



export function MailAccountFilter({
  account,
  onChange,
  mail,
  replies,
}: {
  account: string | null;
  onChange: (account: string | null) => void;
  mail: MailList | null;
  replies: TaskReplies[];
}) {
  const counts = new Map<string, number>([[ALL, mail ? mailBoxRows(mail, replies, null).length : 0]]);
  for (const entry of mail?.accounts ?? []) counts.set(entry.id, mail ? mailBoxRows(mail, replies, entry.id).length : 0);
  return <AccountFilter value={account ?? ALL} accounts={mail?.accounts ?? []} counts={counts} unit={MESSAGES} onChange={(value) => onChange(value === ALL ? null : value)} />;
}
