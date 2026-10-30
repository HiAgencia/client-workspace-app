import type { Day } from "@/lib/dates";
import type { MailRow } from "@/lib/tools/mail-schema";
import type { TaskRow, TasksView } from "@/lib/tools/tasks";
import { useBoxRead, type BoxRead } from "./boxes";
import { get, tool, type TreeNode } from "./client-api";





type Account = { id: string; email: string; nodeIds: string[] };
type Failure = { accountId: string; accountEmail: string; reason: string };

export type WaitingTask = Pick<TaskRow, "id" | "title" | "nodeId" | "path" | "color"> & { waitsFor: string };

export type TaskReplies = { task: WaitingTask; replies: MailRow[]; more: string[]; failures: Failure[] };


export function accountsSeenFrom(tree: TreeNode[] | null, accounts: Account[], nodeId: string | null): string[] {
  if (nodeId === null) return accounts.map((account) => account.id);
  const line = new Set<string>();
  const byId = new Map((tree ?? []).map((node) => [node.id, node]));
  for (let node = byId.get(nodeId); node && !line.has(node.id); node = node.parentId ? byId.get(node.parentId) : undefined) line.add(node.id);
  return accounts.filter((account) => account.nodeIds.some((id) => line.has(id))).map((account) => account.id);
}

const newestFirst = (a: MailRow, b: MailRow) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);



export function useTaskReplies(place: Record<string, unknown>, today: Day | null, tree: TreeNode[] | null, perAccount: number): BoxRead<{ tasks: TaskReplies[] }> {
  const key = `task-replies:${JSON.stringify(place)}:${today}:${perAccount}:${tree ? "tree" : "no-tree"}`;
  return useBoxRead<{ tasks: TaskReplies[] }>(
    tree && today
      ? async () => {
          const [view, listed] = await Promise.all([tool<TasksView>("get_tasks", { ...place, today }), get<{ accounts: Account[] }>("/api/accounts")]);
          if (!view.ok) return view;
          if (!listed.ok) return listed;
          const { groups } = view;
          const rows = [...groups.overdue.tasks, ...groups.today.tasks, ...groups.upcoming.days.flatMap((day) => day.tasks), ...groups.noDate.tasks];
          const waiting = rows.filter((row) => row.mail !== null);
          const emails = new Map(listed.accounts.map((account) => [account.id, account.email]));
          
          
          
          const reads = waiting.flatMap((row) => {
            const seen = accountsSeenFrom(tree, listed.accounts, row.nodeId);
            const fixed = row.mail!.accountId;
            return (fixed ? seen.filter((account) => account === fixed) : seen).map((account) => ({ row, account }));
          });
          const answers = await Promise.all(
            reads.map(({ row, account }) => tool<{ replies: MailRow[]; more: string[]; failures: Failure[] }>("list_task_replies", { task: row.id, account, limit: perAccount })),
          );
          const byTask = new Map<string, TaskReplies>(
            waiting.map((row) => [
              row.id,
              { task: { id: row.id, title: row.title, nodeId: row.nodeId, path: row.path, color: row.color, waitsFor: row.mail!.waitsFor }, replies: [], more: [], failures: [] },
            ]),
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
