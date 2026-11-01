


export const ROUND_AGE_MS = 5 * 60_000;


export const CHECK_MS = 60_000;

const TYPING = "input, textarea, [contenteditable='true']";

type Page = Pick<Document, "hidden" | "activeElement" | "addEventListener" | "removeEventListener">;


export function watchRounds(page: Page, roundAge: () => number, again: () => void): () => void {
  const due = () => !page.hidden && roundAge() >= ROUND_AGE_MS;
  const onChange = () => {
    if (due()) again();
  };
  const check = setInterval(() => {
    if (due() && !page.activeElement?.matches(TYPING)) again();
  }, CHECK_MS);
  page.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(check);
    page.removeEventListener("visibilitychange", onChange);
  };
}
