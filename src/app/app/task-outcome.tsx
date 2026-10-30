"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { inlinePlain } from "@/lib/inline-links";
import { WRITES, type WriteOutput } from "./chat-cards";
import { tool } from "./client-api";
import { useWorkspace } from "./workspace";
import "../styles/mail.css";

// How a task that waited for mail ended, as the person says it: one press for the usual results, or their own words.
// Closing it leaves the result as a decision under the task and links the message that answered it; the undo is the chat
// card's, so the task's detail, the mail viewer and the chat take a closing back the same way.

// The results a person picks with one press; any other is written.
const OUTCOMES = ["Approved", "Rejected"] as const;

export function TaskOutcome({ question, title, onClose, onCancel }: { question: string; title: string; onClose: (outcome: string) => void; onCancel: () => void }) {
  const [other, setOther] = useState("");
  const otherId = useId();
  const written = other.trim();
  return (
    <div
      className="task-reply-outcome"
      role="group"
      aria-label={`How “${inlinePlain(title)}” ended`}
      onKeyDown={(event) => {
        // Escape leaves the choice, not the dialog or the page around it.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <p className="t-label">{question}</p>
      <div className="task-reply-actions">
        {OUTCOMES.map((outcome, index) => (
          <Button key={outcome} size="sm" autoFocus={index === 0} onClick={() => onClose(outcome)}>
            {outcome}
          </Button>
        ))}
      </div>
      <label className="t-label" htmlFor={otherId}>
        Or in your words
      </label>
      <input
        id={otherId}
        className="field"
        value={other}
        maxLength={120}
        onChange={(event) => setOther(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && written) {
            event.preventDefault();
            onClose(written);
          }
        }}
      />
      <div className="task-reply-actions">
        <Button size="sm" variant="primary" disabled={!written} onClick={() => onClose(written)}>
          Close the task
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Closes a task with the message that answered it and the result the person chose, and offers its undo. True when it
// closed.
export function useCompleteTask() {
  const { notify, touch, saving } = useWorkspace();
  return async (task: { id: string; title: string }, reply: { accountId: string; id: string }, outcome: string): Promise<boolean> => {
    const answer = await tool<WriteOutput>("complete_task", { task: task.id, outcome, reply: { account: reply.accountId, id: reply.id } });
    if (!answer.ok) {
      notify({ text: `“${inlinePlain(task.title)}” could not be closed: ${answer.message}`, tone: "error" });
      return false;
    }
    touch();
    const card = WRITES.complete_task(answer);
    const undo = card?.undo;
    notify({ text: card?.what ?? `Closed “${inlinePlain(task.title)}”`, tone: "status", undo: undo ? () => void saving(undo()) : undefined });
    return true;
  };
}
