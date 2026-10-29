"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

// Where a popup (a dropdown's list, the calendar, a menu) is mounted. A modal `<dialog>` lives in the top layer and makes
// everything outside it inert, so a list mounted on the page's body would paint behind the dialog and take no click: a
// dialog hands its own element to the popups opened inside it. Outside any dialog, the body.
const PopupLayer = createContext<RefObject<HTMLElement | null> | null>(null);

export function PopupLayerProvider({ container, children }: { container: RefObject<HTMLElement | null>; children: ReactNode }) {
  return <PopupLayer.Provider value={container}>{children}</PopupLayer.Provider>;
}

export function usePopupContainer(): RefObject<HTMLElement | null> | undefined {
  return useContext(PopupLayer) ?? undefined;
}
