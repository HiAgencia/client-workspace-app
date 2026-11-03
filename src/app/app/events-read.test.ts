import { describe, expect, it, vi } from "vitest";
import type { Answer } from "./client-api";
import { keptEvents, readEvents } from "./events-read";

type Event = { id: string; origin: "google" | "local"; accountId: string; calendarId: string; start: string; allDay: boolean };

const google = (accountId: string, id: string, start: string): Event => ({ id, origin: "google", accountId, calendarId: "primary", start, allDay: false });
const own = (id: string, start: string): Event => ({ id, origin: "local", accountId: "", calendarId: "workspace", start, allDay: true });

const INPUT = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z", fromDay: "2026-11-02", toDay: "2026-11-08" };
const ACCOUNTS = [
  { id: "a", email: "a@example.com" },
  { id: "b", email: "b@example.com" },
];


function server(first: Record<string, unknown>, byAccount: Record<string, Answer<{ events: Event[]; failures: unknown[] }>>) {
  const asked: Array<Record<string, unknown>> = [];
  const ask = async (name: string, input: Record<string, unknown>) => {
    expect(name).toBe("browse_events");
    asked.push(input);
    const account = input.account as string | undefined;
    return (account ? byAccount[account] : { ok: true, events: [], failures: [], accounts: ACCOUNTS, toRead: [], ...first }) as Answer<unknown>;
  };
  return { ask, asked };
}

describe("reading the events account by account", () => {
  it("asks the first read and one per account of its list, joined in time order", async () => {
    const { ask, asked } = server(
      { events: [own("mine", "2026-11-03")], toRead: ["a", "b"] },
      {
        a: { ok: true, events: [google("a", "late", "2026-11-05T10:00:00Z")], failures: [] },
        b: { ok: true, events: [google("b", "early", "2026-11-02T10:00:00Z")], failures: [] },
      },
    );
    const read = await readEvents<Event>(INPUT, { ask });
    expect(read).toMatchObject({ ok: true, failures: [] });
    if (!read.ok) throw new Error(read.message);
    expect(read.events.map((event) => event.id)).toEqual(["early", "mine", "late"]);
    expect(asked).toEqual([INPUT, { ...INPUT, account: "a" }, { ...INPUT, account: "b" }]);
  });

  it("with nothing to read apart, the first read is the only request", async () => {
    const { ask, asked } = server({ events: [own("mine", "2026-11-03")] }, {});
    await readEvents<Event>(INPUT, { ask });
    expect(asked).toHaveLength(1);
  });

  it("says what has arrived as each account answers, so a slow one holds back only its own", async () => {
    let slowAnswers!: (answer: Answer<Record<string, unknown>>) => void;
    const ask = async (_name: string, input: Record<string, unknown>): Promise<Answer<Record<string, unknown>>> => {
      if (input.account === "a") return new Promise((done) => (slowAnswers = done));
      if (input.account === "b") return { ok: true, events: [google("b", "quick", "2026-11-02T10:00:00Z")], failures: [] };
      return { ok: true, events: [own("mine", "2026-11-03")], failures: [], accounts: ACCOUNTS, toRead: ["a", "b"] };
    };
    const heard: Array<{ ids: string[]; waiting: number }> = [];
    const reading = readEvents<Event>(INPUT, { ask, onArrived: (read) => heard.push({ ids: read.events.map((event) => event.id), waiting: read.waiting }) });
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(heard).toEqual([
      { ids: ["mine"], waiting: 2 },
      { ids: ["quick", "mine"], waiting: 1 },
    ]);
    slowAnswers({ ok: true, events: [google("a", "slow", "2026-11-05T10:00:00Z")], failures: [] });
    const read = await reading;
    if (!read.ok) throw new Error(read.message);
    expect(read.waiting).toBe(0);
    expect(read.events.map((event) => event.id)).toEqual(["quick", "mine", "slow"]);
    
    expect(heard).toHaveLength(2);
  });

  it("with nothing to read apart, nothing is heard before the answer", async () => {
    const { ask } = server({ events: [own("mine", "2026-11-03")] }, {});
    const heard: unknown[] = [];
    await readEvents<Event>(INPUT, { ask, onArrived: (read) => heard.push(read) });
    expect(heard).toEqual([]);
  });

  it("says which account failed and why, and keeps what the others brought", async () => {
    const { ask } = server(
      { toRead: ["a", "b"], failures: [] },
      {
        a: { ok: false, message: "The server could not answer. Try again." },
        b: { ok: true, events: [google("b", "kept", "2026-11-02T10:00:00Z")], failures: [{ accountId: "b", accountEmail: "b@example.com", reason: "access was revoked: connect the account again" }] },
      },
    );
    const read = await readEvents<Event>(INPUT, { ask });
    if (!read.ok) throw new Error(read.message);
    expect(read.events.map((event) => event.id)).toEqual(["kept"]);
    expect(read.failures).toEqual([
      { accountId: "a", accountEmail: "a@example.com", reason: "The server could not answer. Try again." },
      { accountId: "b", accountEmail: "b@example.com", reason: "access was revoked: connect the account again" },
    ]);
  });

  it("a first read that fails is the answer, and no account is asked", async () => {
    const asked: unknown[] = [];
    const ask = async (_name: string, input: Record<string, unknown>) => {
      asked.push(input);
      return { ok: false as const, message: "No connection to the server." };
    };
    expect(await readEvents<Event>(INPUT, { ask })).toEqual({ ok: false, message: "No connection to the server." });
    expect(asked).toHaveLength(1);
  });

  it("an event read twice shows once; the same id in another account is another event", async () => {
    const same = google("a", "same", "2026-11-04T10:00:00Z");
    const { ask } = server(
      { events: [same], toRead: ["a", "b"] },
      {
        a: { ok: true, events: [same], failures: [] },
        b: { ok: true, events: [google("b", "same", "2026-11-04T10:00:00Z")], failures: [] },
      },
    );
    const read = await readEvents<Event>(INPUT, { ask });
    if (!read.ok) throw new Error(read.message);
    expect(read.events.map((event) => event.accountId).sort()).toEqual(["a", "b"]);
  });

  it("a place that needs only the first read asks no account", async () => {
    const { ask, asked } = server({ toRead: ["a", "b"] }, {});
    const read = await readEvents<Event>(INPUT, { ask, withAccounts: false });
    expect(read).toMatchObject({ ok: true, events: [], failures: [] });
    expect(asked).toEqual([INPUT]);
  });
});

describe("the events put together from what each request last brought", () => {
  
  function kept(entries: Record<string, { value: unknown; at: number }>) {
    return (name: string, input: Record<string, unknown>) => {
      expect(name).toBe("browse_events");
      return entries[JSON.stringify(input)] ?? null;
    };
  }
  const first = { ok: true, events: [own("mine", "2026-11-03")], failures: [], accounts: ACCOUNTS, toRead: ["a", "b"] };

  it("is the same read the page would make, aged as its oldest part", () => {
    const peek = kept({
      [JSON.stringify(INPUT)]: { value: first, at: 300 },
      [JSON.stringify({ ...INPUT, account: "a" })]: { value: { ok: true, events: [google("a", "late", "2026-11-05T10:00:00Z")], failures: [] }, at: 200 },
      [JSON.stringify({ ...INPUT, account: "b" })]: { value: { ok: true, events: [google("b", "early", "2026-11-02T10:00:00Z")], failures: [] }, at: 400 },
    });
    const read = keptEvents<Event>(INPUT, { peek });
    expect(read?.at).toBe(200);
    expect(read?.value.events.map((event) => event.id)).toEqual(["early", "mine", "late"]);
    expect(read?.value.waiting).toBe(0);
  });

  it("is nothing while any account's part is missing: the page reads it as it arrives", () => {
    const peek = kept({
      [JSON.stringify(INPUT)]: { value: first, at: 300 },
      [JSON.stringify({ ...INPUT, account: "a" })]: { value: { ok: true, events: [], failures: [] }, at: 200 },
    });
    expect(keptEvents<Event>(INPUT, { peek })).toBeNull();
    
    expect(keptEvents<Event>(INPUT, { peek, withAccounts: false })?.value.events.map((event) => event.id)).toEqual(["mine"]);
  });
});
