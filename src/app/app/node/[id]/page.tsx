"use client";

import { useParams, useSearchParams } from "next/navigation";
import { NodeView } from "../../node-view";

export default function NodePage() {
  const { id } = useParams<{ id: string }>();
  const google = useSearchParams().get("google");
  return <NodeView key={id} nodeId={id} googleOutcome={google} />;
}
