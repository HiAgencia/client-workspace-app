"use client";

import { useSyncExternalStore } from "react";
import { currentLanguage, subscribeLanguage, type Language } from "./language";

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, currentLanguage, () => "en" as Language);
}
