import { describe, expect, it, vi } from "vitest";
import type { Answer } from "./client-api";
import { accountsSeenFrom, createMailStore, figureText, type AccountMail, type MailAccountRef } from "./mail-store";

const ref = (id: string): MailAccountRef => ({ id, email: `${id}@example.com`, isDemo: false, status: "active", nodeId: null, nodeIds: [] });
const empty = { count: 0, messages: [] };
const row = (id: string, accountId: string, receivedAt: string) => ({ id, accountId, receivedAt }) as AccountMail["groups"]["unread"]["messages"][number];
const listOf = (id: string, unread: number, messages: AccountMail["groups"]["unread"]["messages"] = []): Answer<AccountMail> =>
  ({ ok: true, groups: { forTasks: empty, unread: { count: messages.length, messages }, earlier: empty }, unread, unreadByAccount: { [id]: unread }, failures: [], countFailures: [] }) as Answer<AccountMail>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));


function asked() {
  const pending: Array<{ name: string; account: string; answer: (value: unknown) => void }> = [];
  const ask = vi.fn((name: string, input: Record<string, unknown>) => new Promise<Answer<unknown>>((resolve) => pending.push({ name, account: String(input.account), answer: resolve as (value: unknown) => void })));
  return { ask, pending };
}

describe("the mail the screens hold", () => {
  it("shows each account as it arrives, and says how many are still on their way", async () => {
    const { ask, pending } = asked();
    const store = createMailStore(ask);
    const [a, b] = [ref("a"), ref("b")];
    store.list(a);
    store.list(b);
    expect(store.mailOf([a, b]).waiting).toBe(2);
    pending[1].answer(listOf("b", 2, [row("old", "b", "2026-01-01T00:00:00Z")]));
    await flush();
    expect(store.mailOf([a, b])).toMatchObject({ waiting: 1, unread: 2 });
    pending[0].answer(listOf("a", 1, [row("new", "a", "2026-02-01T00:00:00Z")]));
    await flush();
    const whole = store.mailOf([a, b]);
    expect(whole).toMatchObject({ waiting: 0, unread: 3 });
    
    expect(whole.groups.unread.messages.map((message) => message.id)).toEqual(["new", "old"]);
  });

  it("asks each account once per round, however many places show it", async () => {
    const { ask, pending } = asked();
    const store = createMailStore(ask);
    const a = ref("a");
    store.list(a);
    store.list(a);
    store.count(a);
    expect(ask).toHaveBeenCalledTimes(1);
    pending[0].answer(listOf("a", 1));
    await flush();
    store.list(a);
    store.count(a);
    expect(ask).toHaveBeenCalledTimes(1);
    store.forget();
    store.list(a);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("a page with no list counts alone, and a message opened counts again", async () => {
    const { ask, pending } = asked();
    const store = createMailStore(ask);
    const a = ref("a");
    store.count(a);
    expect(pending.map((entry) => entry.name)).toEqual(["count_unread_mail"]);
    pending[0].answer({ ok: true, unread: 4, failures: [] });
    await flush();
    expect(store.figure([a])).toMatchObject({ unread: 4, partial: false });
    store.count(a);
    expect(ask).toHaveBeenCalledTimes(1);
    store.recount(a);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("gives no figure until every account answered, and an account that failed makes it a part", async () => {
    const { ask, pending } = asked();
    const store = createMailStore(ask);
    const [a, b] = [ref("a"), ref("b")];
    store.count(a);
    store.count(b);
    pending[0].answer({ ok: true, unread: 2, failures: [] });
    await flush();
    expect(store.figure([a, b])).toBeNull();
    pending[1].answer({ ok: false, status: 503, message: "the platform cut the read" });
    await flush();
    const figure = store.figure([a, b])!;
    expect(figure).toMatchObject({ unread: 2, partial: true });
    expect(figureText(figure)).toMatchObject({ shown: "2+" });
    expect(figure.why).toContain("b@example.com");
  });

  it("an account whose list failed says why, and what the others brought stays", async () => {
    const { ask, pending } = asked();
    const store = createMailStore(ask);
    const [a, b] = [ref("a"), ref("b")];
    store.list(a);
    store.list(b);
    pending[0].answer({ ok: false, status: 503, message: "the platform cut the read" });
    pending[1].answer(listOf("b", 1));
    await flush();
    expect(store.mailOf([a, b])).toMatchObject({ waiting: 0, unread: 1, failures: [{ accountId: "a", reason: "the platform cut the read" }] });
  });

  it("says nothing when nothing is unread and nothing failed", () => {
    expect(figureText({ unread: 0, partial: false, why: null })).toBeNull();
    expect(figureText({ unread: 2, partial: false, why: null })).toEqual({ shown: "2", spoken: "2 unread" });
  });
});

describe("the accounts a place sees", () => {
  const tree = [
    { id: "client", parentId: null },
    { id: "project", parentId: "client" },
    { id: "other", parentId: null },
  ] as Parameters<typeof accountsSeenFrom>[0];
  const accounts = [
    { id: "a", nodeIds: ["client"] },
    { id: "b", nodeIds: ["project"] },
    { id: "c", nodeIds: ["other"] },
  ];

  it("are those of the place and of the places above it; General sees all", () => {
    expect(accountsSeenFrom(tree, accounts, "project")).toEqual(["a", "b"]);
    expect(accountsSeenFrom(tree, accounts, "client")).toEqual(["a"]);
    expect(accountsSeenFrom(tree, accounts, null)).toEqual(["a", "b", "c"]);
  });
});
