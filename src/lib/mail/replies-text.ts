import { count } from "@/lib/count";

export function repliesText(replies: number, more: boolean): string {
  return `${count(replies, "possible reply", "possible replies")}${more ? " and more" : ""}`;
}

export function repliesTally(entry: { replies: unknown[]; more: unknown[]; failures: Array<{ accountId: string }> }): string {
  const accounts = new Set(entry.failures.map((failure) => failure.accountId)).size;
  const read = repliesText(entry.replies.length, entry.more.length > 0);
  return accounts > 0 ? `${read}, ${count(accounts, "account", "accounts")} not read` : read;
}
