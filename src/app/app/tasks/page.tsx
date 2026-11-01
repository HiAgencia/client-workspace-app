import type { Metadata } from "next";
import { Suspense } from "react";
import { savedLayout } from "../saved-layout";
import { SCREEN_TITLES } from "../screen-titles";
import { TasksView } from "./tasks-view";

export const metadata: Metadata = { title: SCREEN_TITLES["/app/tasks"] };


export default async function TasksPage() {
  const saved = await savedLayout("tasks");
  return (
    <Suspense fallback={null}>
      <TasksView savedLayout={saved.layout} />
    </Suspense>
  );
}
