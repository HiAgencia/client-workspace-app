"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState, ViewTransition } from "react";
import { Tabs } from "@/components/ui/tabs";
import { ChatPanel } from "../../chat-panel";
import { NodeView } from "../../node-view";

// The node and, beside it, the chat scoped to it. Where the window cannot hold both, they are two tabs: the chat keeps
// its own place, so the node growing when it is read again never moves the chat's card.
export default function NodePage() {
  const { id } = useParams<{ id: string }>();
  const google = useSearchParams().get("google");
  const [pane, setPane] = useState<"project" | "chat">("project");
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="node-page">
        <Tabs
          className="node-tabs"
          label="Project or chat"
          value={pane}
          onChange={setPane}
          options={[
            { value: "project", label: "Project", controls: "pane-project" },
            { value: "chat", label: "Chat", controls: "pane-chat" },
          ]}
        />
        <div id="pane-project" role="tabpanel" aria-labelledby="tab-pane-project" data-pane="project" data-active={pane === "project"}>
          <NodeView key={id} nodeId={id} googleOutcome={google} />
        </div>
        <div id="pane-chat" role="tabpanel" aria-labelledby="tab-pane-chat" className="node-chat" data-pane="chat" data-active={pane === "chat"}>
          <ChatPanel key={`chat-${id}`} nodeId={id} />
        </div>
      </div>
    </ViewTransition>
  );
}
