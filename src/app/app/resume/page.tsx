"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStrings } from "@/lib/strings";
import { lastNode } from "../last-node";

export default function Resume() {
  const { t } = useStrings();
  const router = useRouter();
  useEffect(() => {
    const last = lastNode();
    router.replace(last ? `/app/node/${last}` : "/app");
  }, [router]);
  return (
    <div className="card stack" role="status" aria-busy="true">
      <p className="t-help">{t("resume.opening")}</p>
      <span className="skeleton" style={{ width: "40%" }} />
    </div>
  );
}
