"use client";

import { useState } from "react";
import { initialOf } from "@/lib/session-person";
import { cx } from "@/lib/utils";





export function Avatar({ src, name, email, className }: { src: string | null; name: string | null; email: string | null; className?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && failed !== src ? src : null;
  return (
    <span className={cx("avatar", className)} aria-hidden="true" data-photo={photo && loaded === photo ? "" : undefined}>
      <span className="avatar-initial">{initialOf(name, email)}</span>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- the person's own small photo, already sized by Google: no optimizer to run.
        <img className="avatar-photo" src={photo} alt="" referrerPolicy="no-referrer" decoding="async" onLoad={() => setLoaded(photo)} onError={() => setFailed(photo)} />
      )}
    </span>
  );
}
