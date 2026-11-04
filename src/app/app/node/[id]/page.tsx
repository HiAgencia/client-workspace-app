import { Suspense } from "react";
import { NodeView } from "../../node-view";
import { BoardShell } from "../../overview";
import { savedLayout } from "../../saved-layout";

export default async function NodePage({ params }: PageProps<"/app/node/[id]">) {
  const { id } = await params;
  const saved = await savedLayout(`node:${id}`);
  return (
    <Suspense fallback={<BoardShell />}>
      <NodeView key={id} nodeId={id} saved={saved.board} savedLayout={saved.layout} />
    </Suspense>
  );
}
