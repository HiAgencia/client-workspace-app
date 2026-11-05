export const LANGUAGE_KEY = "client-workspace:language";
export const LANGUAGE_OFFER_KEY = "client-workspace:language-offer";

export type Language = "en" | "es";

export const SPANISH_COUNTRIES: ReadonlySet<string> = new Set([
  "AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "ES", "GQ", "GT", "HN", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "UY", "VE",
]);

export function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === "es" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

export function currentLanguage(): Language {
  if (typeof document !== "undefined") {
    const marked = document.documentElement.dataset.lang;
    if (marked === "es" || marked === "en") return marked;
  }
  return storedLanguage() ?? "en";
}

export function subscribeLanguage(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-lang"] });
  window.addEventListener("storage", listener);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", listener);
  };
}

export function setLanguage(next: Language): void {
  const root = document.documentElement;
  root.lang = next;
  root.dataset.lang = next;
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
  }
}

export function languageOfferDismissed(): boolean {
  try {
    return localStorage.getItem(LANGUAGE_OFFER_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissLanguageOffer(): void {
  try {
    localStorage.setItem(LANGUAGE_OFFER_KEY, "dismissed");
  } catch {
  }
}
