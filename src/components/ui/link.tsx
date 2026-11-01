"use client";

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";



export function Link({ onPointerEnter, onFocus, ...props }: ComponentProps<typeof NextLink>) {
  const [going, setGoing] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={going ? null : false}
      onPointerEnter={(event) => {
        setGoing(true);
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        setGoing(true);
        onFocus?.(event);
      }}
    />
  );
}
