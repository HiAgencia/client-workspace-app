"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { lastNode } from "../last-node";


export default function Resume() {
  const router = useRouter();
  useEffect(() => {
    const last = lastNode();
    router.replace(last ? `/app/node/${last}` : "/app");
  }, [router]);
  return (
    <div className="card stack" role="status" aria-busy="true">
      <p className="t-help">Opening where you left off…</p>
      <span className="skeleton" style={{ width: "40%" }} />
    </div>
  );
}
