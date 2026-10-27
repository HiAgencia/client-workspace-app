"use client";

import { useParams, useSearchParams } from "next/navigation";
import { ChatPanel } from "../../chat-panel";
import { NodeView } from "../../node-view";

// The node and, beside it, the chat scoped to it.
export default function NodePage() {
  const { id } = useParams<{ id: string }>();
  const google = useSearchParams().get("google");
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1">
        <NodeView key={id} nodeId={id} googleOutcome={google} />
      </div>
      <ChatPanel key={`chat-${id}`} nodeId={id} />
    </div>
  );
}
