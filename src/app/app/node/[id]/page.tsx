"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { NodeView } from "../../node-view";
import { useChatScope } from "../../workspace";

// A client's or a project's page; the chat beside it, on demand, works on that node and what is below it.
export default function NodePage() {
  return (
    <Suspense fallback={null}>
      <Node />
    </Suspense>
  );
}

function Node() {
  const { id } = useParams<{ id: string }>();
  const google = useSearchParams().get("google");
  useChatScope(id);
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <NodeView key={id} nodeId={id} googleOutcome={google} />
    </ViewTransition>
  );
}
