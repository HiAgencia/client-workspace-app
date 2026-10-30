// The language a message declares, so the viewer's document says it and a screen reader pronounces the message in it:
// its `Content-Language` header first (the first of its list), then the `lang` of its HTML's root (`<html>`, else
// `<body>`), read before the sanitizer drops those two tags. A value that is not a language tag is not a declaration;
// with none, the caller uses the product's own.

function tagOf(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  if (!first) return null;
  try {
    return Intl.getCanonicalLocales(first)[0] ?? null;
  } catch {
    return null;
  }
}

const rootLang = (html: string, tag: "html" | "body") => {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(html)?.[0];
  if (!open) return null;
  return /\s(?:xml:)?lang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(open)?.slice(1).find((value) => value !== undefined) ?? null;
};

export function messageLanguage({ contentLanguage, html }: { contentLanguage?: string | null; html?: string | null }): string | null {
  const header = tagOf(contentLanguage);
  if (header) return header;
  if (!html) return null;
  return tagOf(rootLang(html, "html")) ?? tagOf(rootLang(html, "body"));
}
