"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

const PopupLayer = createContext<RefObject<HTMLElement | null> | null>(null);

export function PopupLayerProvider({ container, children }: { container: RefObject<HTMLElement | null>; children: ReactNode }) {
  return <PopupLayer.Provider value={container}>{children}</PopupLayer.Provider>;
}

export function usePopupContainer(): RefObject<HTMLElement | null> | undefined {
  return useContext(PopupLayer) ?? undefined;
}
