import { Suspense } from "react";
import { savedLayout } from "./saved-layout";
import { BoardShell, Overview } from "./overview";


export default async function OverviewPage() {
  const saved = await savedLayout("overview");
  return (
    <Suspense fallback={<BoardShell />}>
      <Overview saved={saved.board} />
    </Suspense>
  );
}
