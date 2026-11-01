import type { Day } from "@/lib/dates";
import type { MailRow } from "@/lib/tools/mail-schema";
import { useBoxRead, type BoxRead } from "./boxes";
import { tool, type TreeNode } from "./client-api";
import { accountsSeenFrom, type MailFailureRow } from "./mail-store";
import { branchOf } from "./place-filters";
import { useWorkspace, type WaitingRead } from "./workspace";

export { accountsSeenFrom };






export type WaitingTask = Omit<WaitingRead, "accountId">;

export type TaskReplies = { task: WaitingTask; replies: MailRow[]; more: string[]; failures: MailFailureRow[] };

const newestFirst = (a: MailRow, b: MailRow) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);



function waitingIn(waiting: WaitingRead[], tree: TreeNode[], place: Record<string, unknown>): WaitingRead[] {
  if (!("node" in place)) return waiting;
  if (place.node === null) return waiting.filter((row) => row.nodeId === null);
  const branch = branchOf(tree, place.node as string);
  return waiting.filter((row) => row.nodeId !== null && branch.has(row.nodeId));
}



export function useTaskReplies(place: Record<string, unknown>, today: Day | null, tree: TreeNode[] | null, perAccount: number): BoxRead<{ tasks: TaskReplies[] }> {
  const { mailAccounts, mailWaiting } = useWorkspace();
  const known = tree && today && mailAccounts && mailWaiting ? { tree, accounts: mailAccounts, waiting: waitingIn(mailWaiting, tree, place) } : null;
  
  
  
  const reads = (known?.waiting ?? []).flatMap((row) => {
    const seen = accountsSeenFrom(known!.tree, known!.accounts, row.nodeId);
    return (row.accountId ? seen.filter((account) => account === row.accountId) : seen).map((account) => ({ row, account }));
  });
  const key = `task-replies:${perAccount}:${known ? JSON.stringify([known.waiting.map((row) => [row.id, row.waitsFor]), reads.map((read) => read.account)]) : "off"}`;
  return useBoxRead<{ tasks: TaskReplies[] }>(
    known
      ? async () => {
          const emails = new Map(known.accounts.map((account) => [account.id, account.email]));
          const answers = await Promise.all(
            reads.map(({ row, account }) => tool<{ replies: MailRow[]; more: string[]; failures: MailFailureRow[] }>("list_task_replies", { task: row.id, account, limit: perAccount })),
          );
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
          return { ok: true as const, tasks: [...byTask.values()] };
        }
      : null,
    key,
  );
}
