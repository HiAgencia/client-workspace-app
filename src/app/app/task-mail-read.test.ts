import { describe, expect, it } from "vitest";
import { startRound, withAccountMail, type LinkedMessage } from "./task-mail-read";

const row = (accountId: string, id: string, hour: number, subject = id): LinkedMessage => ({
  id,
  accountId,
  accountEmail: `${accountId}@example.com`,
  from: { name: null, email: "sender@example.com" },
  subject,
  receivedAt: `2026-11-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
});
const a = { id: "a", email: "a@example.com" };
const ids = (read: { messages: LinkedMessage[] }) => read.messages.map((message) => message.id);

describe("the messages linked to a task, round after round", () => {
  const shown = { messages: [row("a", "a1", 10), row("b", "b1", 8)], mailFailures: [] };

  it("keeps what shows of an account still to answer", () => {
    expect(ids(startRound(shown, { messages: [], mailFailures: [] }, ["a", "b"]))).toEqual(["a1", "b1"]);
  });

  it("drops what shows of an account no longer linked", () => {
    expect(ids(startRound(shown, { messages: [], mailFailures: [] }, ["b"]))).toEqual(["b1"]);
    expect(ids(startRound(shown, { messages: [row("c", "c1", 9)], mailFailures: [] }, []))).toEqual(["c1"]);
  });

  it("starts from nothing on the first round", () => {
    expect(ids(startRound(null, { messages: [], mailFailures: [] }, ["a", "b"]))).toEqual([]);
  });

  it("replaces one account's rows when it answers, leaving the others, newest first", () => {
    const next = withAccountMail(shown, a, { ok: true, messages: [row("a", "a2", 9), row("a", "a3", 7)], failures: [] });
    expect(ids(next)).toEqual(["a2", "b1", "a3"]);
  });

  it("empties an account that answers with nothing", () => {
    expect(ids(withAccountMail(shown, a, { ok: true, messages: [], failures: [] }))).toEqual(["b1"]);
  });

  it("keeps an account's rows when its read fails, and says so once", () => {
    const failed = withAccountMail(shown, a, { ok: false, message: "No answer" });
    expect(ids(failed)).toEqual(["a1", "b1"]);
    expect(failed.mailFailures).toEqual([{ accountId: "a", accountEmail: "a@example.com", reason: "No answer" }]);
    const again = startRound(failed, { messages: [], mailFailures: [] }, ["a", "b"]);
    expect(again.mailFailures).toHaveLength(1);
    expect(withAccountMail(again, a, { ok: false, message: "No answer" }).mailFailures).toHaveLength(1);
  });

  const down = { accountId: "a", accountEmail: "a@example.com", reason: "the mail service did not answer" };

  it("keeps an account's rows when its read answers well and names it in its failures", () => {
    const failed = withAccountMail(shown, a, { ok: true, messages: [], failures: [down] });
    expect(ids(failed)).toEqual(["a1", "b1"]);
    expect(failed.mailFailures).toEqual([down]);
  });

  it("keeps what shows of a lone account the first read could not read", () => {
    const failed = startRound(shown, { messages: [], mailFailures: [down] }, []);
    expect(ids(failed)).toEqual(["a1"]);
    expect(failed.mailFailures).toEqual([down]);
  });

  it("keeps an account's rows when none of its messages could be read, which is a partial read too", () => {
    const none = { ...down, reason: "2 of 2 messages could not be read", partial: true };
    expect(ids(withAccountMail(shown, a, { ok: true, messages: [], failures: [none] }))).toEqual(["a1", "b1"]);
    expect(ids(startRound(shown, { messages: [], mailFailures: [none] }, []))).toEqual(["a1"]);
  });

  it("takes what a partial read brought and keeps the rows it lost, each message once", () => {
    const two = { messages: [row("a", "a1", 10), row("a", "a2", 9)], mailFailures: [] };
    const some = { ...down, reason: "1 of 2 messages could not be read", partial: true };
    const read = withAccountMail(two, a, { ok: true, messages: [row("a", "a1", 10, "Read again")], failures: [some] });
    expect(ids(read)).toEqual(["a1", "a2"]);
    expect(read.messages[0].subject).toBe("Read again");
    const first = startRound(two, { messages: [row("a", "a1", 10, "Read again")], mailFailures: [some] }, []);
    expect(ids(first)).toEqual(["a1", "a2"]);
    expect(first.messages[0].subject).toBe("Read again");
  });

  it("does not keep an account for another account's failure", () => {
    const other = { accountId: "b", accountEmail: "b@example.com", reason: "the mail service did not answer" };
    expect(ids(withAccountMail(shown, a, { ok: true, messages: [], failures: [other] }))).toEqual(["b1"]);
    expect(ids(startRound(shown, { messages: [], mailFailures: [other] }, []))).toEqual(["b1"]);
  });

  it("takes the failure away when the account answers", () => {
    const failed = withAccountMail(shown, a, { ok: false, message: "No answer" });
    expect(withAccountMail(failed, a, { ok: true, messages: [row("a", "a1", 10)], failures: [] }).mailFailures).toEqual([]);
  });
});
