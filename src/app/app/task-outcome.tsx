"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inlinePlain } from "@/lib/inline-links";
import { translateNow, useStrings } from "@/lib/strings";
import { WRITES, type WriteOutput } from "./chat-cards";
import { tool } from "./client-api";
import { useWorkspace } from "./workspace";
import "../styles/mail.css";

export function TaskOutcome({ question, title, onClose, onCancel }: { question: string; title: string; onClose: (outcome: string) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useStrings();
  const OUTCOMES = [t("outcome.approved"), t("outcome.rejected")];
  const [other, setOther] = useState("");
  const otherId = useId();
  const written = other.trim();
  const closing = useRef(false);
  async function close(outcome: string) {
    if (closing.current) return;
    closing.current = true;
    try {
      await onClose(outcome);
    } finally {
      closing.current = false;
    }
  }
  return (
    <div
      className="task-reply-outcome"
      role="group"
      aria-label={t("outcome.howEnded", { title: inlinePlain(title) })}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <p className="t-label">{question}</p>
      <div className="task-reply-actions">
        {OUTCOMES.map((outcome, index) => (
          <Button key={outcome} size="sm" autoFocus={index === 0} onClick={() => void close(outcome)}>
            {outcome}
          </Button>
        ))}
      </div>
      <label className="t-meta task-outcome-label" htmlFor={otherId}>
        {t("outcome.orWords")}
      </label>
      <div className="task-outcome-own">
        <input
          id={otherId}
          className="field"
          value={other}
          maxLength={120}
          onChange={(event) => setOther(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && written) {
              event.preventDefault();
              void close(written);
            }
          }}
        />
        <Button size="sm" variant="primary" disabled={!written} onClick={() => void close(written)}>
          {t("outcome.completeTask")}
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function useCompleteTask() {
  const { notify, touch, saving } = useWorkspace();
  return async (task: { id: string; title: string }, reply: { accountId: string; id: string }, outcome: string): Promise<boolean> => {
    const answer = await tool<WriteOutput>("complete_task", { task: task.id, outcome, reply: { account: reply.accountId, id: reply.id } });
    if (!answer.ok) {
      notify({ text: translateNow("row.couldNotCompleted", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
      return false;
    }
    touch();
    const card = WRITES.complete_task(answer);
    const undo = card?.undo;
    notify({ text: card?.what ?? translateNow("row.completed", { title: inlinePlain(task.title) }), tone: "status", undo: undo ? () => void saving(undo()) : undefined });
    return true;
  };
}
