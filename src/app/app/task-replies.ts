import type { Day } from "@/lib/dates";
import type { MailRow } from "@/lib/tools/mail-schema";
import { useBoxRead, type BoxRead } from "./boxes";
import { peekTool, tool, type Answer, type TreeNode } from "./client-api";
import { accountsSeenFrom, type MailAccountRef, type MailFailureRow } from "./mail-store";
import { branchOf } from "./place-filters";
import type { Kept } from "./read-cache";
import { useWorkspace, type WaitingRead } from "./workspace";

export { accountsSeenFrom };






export type WaitingTask = Omit<WaitingRead, "accountId">;

export type TaskReplies = { task: WaitingTask; replies: MailRow[]; more: string[]; failures: MailFailureRow[] };

type RepliesAnswer = Answer<{ replies: MailRow[]; more: string[]; failures: MailFailureRow[] }>;
type Known = { tree: TreeNode[]; accounts: MailAccountRef[]; waiting: WaitingRead[] };
type Asked = { row: WaitingRead; account: string };

const newestFirst = (a: MailRow, b: MailRow) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);



function waitingIn(waiting: WaitingRead[], tree: TreeNode[], place: Record<string, unknown>): WaitingRead[] {
  if (!("node" in place)) return waiting;
  if (place.node === null) return waiting.filter((row) => row.nodeId === null);
  const branch = branchOf(tree, place.node as string);
  return waiting.filter((row) => row.nodeId !== null && branch.has(row.nodeId));
}




function readsOf(known: Known): Asked[] {
  return known.waiting.flatMap((row) => {
    const seen = accountsSeenFrom(known.tree, known.accounts, row.nodeId);
    return (row.accountId ? seen.filter((account) => account === row.accountId) : seen).map((account) => ({ row, account }));
  });
}

const inputOf = ({ row, account }: Asked, perAccount: number) => ({ task: row.id, account, limit: perAccount });


function repliesOf(known: Known, reads: Asked[], answers: RepliesAnswer[]): TaskReplies[] {
  const emails = new Map(known.accounts.map((account) => [account.id, account.email]));
  const byTask = new Map<string, TaskReplies>(
    known.waiting.map((row) => [row.id, { task: { id: row.id, title: row.title, nodeId: row.nodeId, path: row.path, color: row.color, waitsFor: row.waitsFor }, replies: [], more: [], failures: [] }]),
  );
  answers.forEach((answer, index) => {
    const { row, account } = reads[index];
    const entry = byTask.get(row.id)!;
    if (!answer.ok) entry.failures.push({ accountId: account, accountEmail: emails.get(account) ?? "An account", reason: answer.message });
    else {
      entry.replies.push(...answer.replies);
      entry.more.push(...answer.more);
      entry.failures.push(...answer.failures);
    }
  });
  for (const entry of byTask.values()) entry.replies.sort(newestFirst);
  return [...byTask.values()];
}


async function readReplies(known: Known, perAccount: number): Promise<{ ok: true; tasks: TaskReplies[] }> {
  const reads = readsOf(known);
  const answers = await Promise.all(reads.map((asked) => tool<{ replies: MailRow[]; more: string[]; failures: MailFailureRow[] }>("list_task_replies", inputOf(asked, perAccount))));
  return { ok: true as const, tasks: repliesOf(known, reads, answers) };
}


function keptReplies(known: Known, perAccount: number): Kept<{ ok: true; tasks: TaskReplies[] }> | null {
  const reads = readsOf(known);
  const parts = reads.map((asked) => peekTool<{ replies: MailRow[]; more: string[]; failures: MailFailureRow[] }>("list_task_replies", inputOf(asked, perAccount)));
  if (parts.some((part) => part === null)) return null;
  const at = parts.length > 0 ? Math.min(...parts.map((part) => part!.at)) : Date.now();
  return { value: { ok: true as const, tasks: repliesOf(known, reads, parts.map((part) => part!.value)) }, at };
}



export function warmReplies(place: Record<string, unknown>, tree: TreeNode[], accounts: MailAccountRef[], waiting: WaitingRead[], perAccount: number): void {
  const known: Known = { tree, accounts, waiting: waitingIn(waiting, tree, place) };
  for (const asked of readsOf(known)) {
    const input = inputOf(asked, perAccount);
    if (!peekTool("list_task_replies", input)) void tool("list_task_replies", input);
  }
}



export function useTaskReplies(place: Record<string, unknown>, today: Day | null, tree: TreeNode[] | null, perAccount: number): BoxRead<{ tasks: TaskReplies[] }> {
  const { mailAccounts, mailWaiting, treeError, refreshTree } = useWorkspace();
  const known: Known | null = tree && today && mailAccounts && mailWaiting ? { tree, accounts: mailAccounts, waiting: waitingIn(mailWaiting, tree, place) } : null;
  const reads = known ? readsOf(known) : [];
  const key = `task-replies:${perAccount}:${known ? JSON.stringify([known.waiting.map((row) => [row.id, row.waitsFor]), reads.map((read) => read.account)]) : "off"}`;
  const read = useBoxRead<{ tasks: TaskReplies[] }>(known ? () => readReplies(known, perAccount) : null, key, () => (known ? keptReplies(known, perAccount) : null));
  
  return !known && treeError ? { ...read, error: treeError, retry: () => void refreshTree() } : read;
}
