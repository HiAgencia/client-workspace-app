"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { NodeView } from "../../node-view";
import { useChatScope } from "../../workspace";


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
