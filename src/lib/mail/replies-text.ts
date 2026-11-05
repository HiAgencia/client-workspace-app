import { countedNow, translateNow } from "@/lib/strings";

export function repliesText(replies: number, more: boolean): string {
  return `${countedNow(replies, "counted.possibleReply", "counted.possibleReplies")}${more ? translateNow("mailreply.andMore") : ""}`;
}

export function repliesTally(entry: { replies: unknown[]; more: unknown[]; failures: Array<{ accountId: string }> }): string {
  const accounts = new Set(entry.failures.map((failure) => failure.accountId)).size;
  const read = repliesText(entry.replies.length, entry.more.length > 0);
  return accounts > 0 ? translateNow("mailreply.tallyNotRead", { read, what: countedNow(accounts, "counted.account", "counted.accounts") }) : read;
}
