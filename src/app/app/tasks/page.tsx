import { Suspense } from "react";
import { savedLayout } from "../saved-layout";
import { TasksView } from "./tasks-view";

// Every task, as a list or a board; the server reads which one the person chose last from the layout cookie.
export default async function TasksPage() {
  const saved = await savedLayout("tasks");
  return (
    <Suspense fallback={null}>
      <TasksView savedLayout={saved.layout} />
    </Suspense>
  );
}
