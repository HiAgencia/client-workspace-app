"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LAST_NODE_KEY } from "../workspace";

// Opening the workspace resumes on the last open node, or on Today the first time.
export default function Resume() {
  const router = useRouter();
  useEffect(() => {
    const last = localStorage.getItem(LAST_NODE_KEY);
    router.replace(last ? `/app/node/${last}` : "/app");
  }, [router]);
  return <p>Opening where you left off…</p>;
}
