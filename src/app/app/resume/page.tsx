"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LAST_NODE_KEY } from "../workspace";

// Opening the workspace resumes on the last open client or project, or on the Overview the first time.
export default function Resume() {
  const router = useRouter();
  useEffect(() => {
    const last = localStorage.getItem(LAST_NODE_KEY);
    router.replace(last ? `/app/node/${last}` : "/app");
  }, [router]);
  return (
    <div className="card stack" role="status" aria-busy="true">
      <p className="t-help">Opening where you left off…</p>
      <span className="skeleton" style={{ width: "40%" }} />
    </div>
  );
}
