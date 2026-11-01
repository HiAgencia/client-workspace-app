"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Day } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { mailFailureText } from "@/lib/mail/failure-text";
import { repliesTally } from "@/lib/mail/replies-text";
import { mailWhen } from "./box-kinds";
import { BoxFailed, type BoxRead } from "./boxes";
import { subjectOf } from "./mail/subject";
import { Fold } from "./side-nav";
import type { TaskReplies } from "./task-replies";
import { openTaskDetail } from "./task-row";


function inOrder(tasks: TaskReplies[]): TaskReplies[] {
  const newest = (entry: TaskReplies) => entry.replies[0]?.receivedAt ?? "";
  return [...tasks].sort((a, b) => (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0));
}




export function ReplyStrip({ read, now }: { read: BoxRead<{ tasks: TaskReplies[] }>; now: Day | null }) {
  const [open, setOpen] = useState(false);
  const foldId = useId();
  const titleId = useId();
  const tasks = read.data ? inOrder(read.data.tasks) : null;
  const waiting = tasks?.filter((entry) => entry.replies.length === 0 && entry.failures.length === 0).length ?? 0;
  
  
  const noneArrived = tasks !== null && tasks.length > 0 && waiting === tasks.length;
  const folded = noneArrived ? tasks : (tasks?.slice(1) ?? []);
  return (
    <section className="reply-strip" data-replies-strip data-stale={read.stale || undefined} aria-labelledby={titleId}>
      <div className="reply-strip-head">
        <h2 id={titleId} className="t-title reply-strip-title">
          For your tasks
        </h2>
        <p className="reply-strip-purpose">What may answer the tasks that wait for mail. You decide which one does.</p>
        {folded.length > 0 && (
          <Button size="sm" className="reply-strip-more" aria-expanded={open} aria-controls={foldId} onClick={() => setOpen((value) => !value)}>
            {noneArrived ? `Show ${waiting === 1 ? "it" : "them"}` : `${folded.length} more`}
          </Button>
        )}
      </div>
      {tasks === null ? (
        read.error ? (
          <BoxFailed what="The possible replies of the tasks" message={read.error} kept={false} onRetry={read.retry} />
        ) : (
          <p className="t-meta reply-strip-note" role="status" aria-busy="true">
            Reading what may answer your tasks…
          </p>
        )
      ) : tasks.length === 0 ? (
        <p className="t-help reply-strip-note" data-empty="no-waits">
          No task waits for mail. In a task&apos;s details, say what it waits for, and what may answer it shows here.
        </p>
      ) : noneArrived ? (
        <>
          <p className="t-help reply-strip-note" data-empty="nothing-arrived">
            {`${waiting === 1 ? "One task waits" : `${waiting} tasks wait`} for mail, and nothing arrived for ${waiting === 1 ? "it" : "them"} yet.`}
          </p>
          <Others open={open} id={foldId} tasks={folded} now={now} />
        </>
      ) : (
        <>
          <ReplyEntry entry={tasks[0]} now={now} />
          {folded.length > 0 && <Others open={open} id={foldId} tasks={folded} now={now} />}
        </>
      )}
      {read.data && read.error && <BoxFailed what="The possible replies of the tasks" message={read.error} kept onRetry={read.retry} />}
    </section>
  );
}

function Others({ open, id, tasks, now }: { open: boolean; id: string; tasks: TaskReplies[]; now: Day | null }) {
  return (
    <Fold open={open} id={id}>
      <ul className="reply-strip-others">
        {tasks.map((entry) => (
          <li key={entry.task.id}>
            <ReplyEntry entry={entry} now={now} />
          </li>
        ))}
      </ul>
    </Fold>
  );
}



function ReplyEntry({ entry, now }: { entry: TaskReplies; now: Day | null }) {
  const newest = entry.replies[0];
  const failure = entry.failures[0];
  const unread = entry.replies.length === 0 && failure;
  const tally = entry.replies.length > 0 ? repliesTally(entry) : failure ? "Its mail could not be read" : "Nothing arrived yet";
  return (
    <button type="button" className="reply-entry" data-reply-task={entry.task.id} onClick={() => openTaskDetail({ id: entry.task.id })}>
      <span className="reply-entry-title">{inlinePlain(entry.task.title)}</span>
      <span className="pill reply-entry-tally" data-tone={unread ? "alert" : entry.replies.length === 0 ? undefined : failure ? "warn" : "accent"}>
        {tally}
      </span>
      {newest ? (
        <span className="reply-entry-mail">
          <span className="reply-entry-from">{newest.from.name || newest.from.email}</span>
          <span className="reply-entry-subject">{subjectOf(newest)}</span>
        </span>
      ) : (
        <span className="reply-entry-mail">
          <span className="reply-entry-wait">{unread ? mailFailureText(failure) : `It waits for “${entry.task.waitsFor}”`}</span>
        </span>
      )}
      <span className="reply-entry-when">{newest && now ? mailWhen(newest.receivedAt, now) : ""}</span>
      <span className="reply-entry-go">Open the task</span>
    </button>
  );
}
