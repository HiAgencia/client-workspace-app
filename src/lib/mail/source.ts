import { z } from "zod";
import type { Db } from "@/lib/db/client";

// Where the messages of the connected accounts come from, injected like the events so the tools are tested without
// Google: the demo's sample accounts read their rows of `demo_mail`, and a real account reads Gmail with `gmail.readonly`
// (the Gmail source plugs in here; until it does, a real account answers as a failure that says so). Gmail is never
// written: what the person opens here is kept apart (`mail_opened`).

export const mailAddressSchema = z.object({ name: z.string().nullable(), email: z.string() });

// A message as every source gives it.
export const mailMessageSchema = z.object({
  // Gmail's message and thread ids.
  id: z.string(),
  threadId: z.string(),
  accountId: z.string(),
  accountEmail: z.string(),
  from: mailAddressSchema,
  to: z.array(z.string()),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: z.string(),
  // Gmail's own marks.
  unread: z.boolean(),
  important: z.boolean(),
});

export type MailMessage = z.infer<typeof mailMessageSchema>;

// A whole message, for the viewer and the daily review: the HTML as the source gave it (the tools sanitize it before it
// leaves the server) and the plain text.
export type MailContent = MailMessage & { html: string | null; text: string | null };

export type MailAccount = { id: string; email: string; isDemo: boolean; status: string; scopes: string[] };

export const mailFailureSchema = z.object({ accountId: z.string(), accountEmail: z.string(), reason: z.string() });
export type MailFailure = z.infer<typeof mailFailureSchema>;

export type MailSource = {
  // The latest messages of some accounts, newest first, at most `limit` of each account, received at or after `since`
  // when given.
  list(args: { db: Db; ownerId: string; accounts: MailAccount[]; since?: string; limit?: number }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  // One message whole, or null when the account holds no such message.
  get(args: { db: Db; ownerId: string; account: MailAccount; id: string }): Promise<MailContent | null>;
  // The latest messages whole, at most `limit` of each account, for the daily review to read.
  read(args: { db: Db; ownerId: string; accounts: MailAccount[]; since: string; limit?: number }): Promise<{ messages: MailContent[]; failures: MailFailure[] }>;
  // Every message the accounts hold unread in Gmail, whatever a list shows: what the unread count reads.
  unread(args: { db: Db; ownerId: string; accounts: MailAccount[] }): Promise<{ messages: Array<{ accountId: string; id: string }>; failures: MailFailure[] }>;
};

type DemoRow = {
  gmail_id: string;
  thread_id: string;
  account_id: string;
  from_name: string | null;
  from_email: string;
  to_emails: string[];
  subject: string;
  snippet: string;
  html: string | null;
  text_body: string | null;
  received_at: string;
  unread: boolean;
  important: boolean;
};

const DEMO_COLUMNS = "gmail_id, thread_id, account_id, from_name, from_email, to_emails, subject, snippet, html, text_body, received_at, unread, important";

function fromDemo(row: DemoRow, email: string): MailContent {
  return {
    id: row.gmail_id,
    threadId: row.thread_id,
    accountId: row.account_id,
    accountEmail: email,
    from: { name: row.from_name, email: row.from_email },
    to: row.to_emails,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    unread: row.unread,
    important: row.important,
    html: row.html,
    text: row.text_body,
  };
}

// A message without its body, for the lists.
export function withoutBody(message: MailContent): MailMessage {
  const { id, threadId, accountId, accountEmail, from, to, subject, snippet, receivedAt, unread, important } = message;
  return { id, threadId, accountId, accountEmail, from, to, subject, snippet, receivedAt, unread, important };
}

// How many of each account's latest messages a list reads when it does not say: the same for the sidebar, the Mail page,
// and Settings, so their lists agree.
export const MAIL_LIMIT = 50;

const notConnected = (account: MailAccount): MailFailure => ({ accountId: account.id, accountEmail: account.email, reason: "reading Gmail is not connected on this server yet" });

// A failure the person reads in plain words; its cause goes to the log, never swallowed.
function unreadable(account: MailAccount, cause: string): MailFailure {
  console.error(`mail: ${account.email}: ${cause}`);
  return { accountId: account.id, accountEmail: account.email, reason: "the sample messages could not be read" };
}

// The demo's sample accounts read their own rows, each account on its own so one with much mail leaves the others their
// share; a real account is not read until the Gmail source is configured.
export function demoMailSource(): MailSource {
  async function rows(db: Db, ownerId: string, accounts: MailAccount[], since: string | undefined, limit: number, whole: boolean) {
    const failures: MailFailure[] = accounts.filter((account) => !account.isDemo).map(notConnected);
    const answers = await Promise.all(
      accounts
        .filter((account) => account.isDemo)
        .map(async (account) => {
          let query = db
            .from("demo_mail")
            .select(whole ? DEMO_COLUMNS : DEMO_COLUMNS.replace(", html, text_body", ""))
            .eq("owner_id", ownerId)
            .eq("account_id", account.id);
          if (since) query = query.gte("received_at", since);
          const { data, error } = await query.order("received_at", { ascending: false }).limit(limit);
          if (error) return { messages: [] as MailContent[], failure: unreadable(account, error.message) };
          return {
            messages: (data as unknown as DemoRow[]).map((row) => fromDemo({ ...row, html: whole ? row.html : null, text_body: whole ? row.text_body : null }, account.email)),
            failure: null,
          };
        }),
    );
    const messages = answers.flatMap((answer) => answer.messages).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
    return { messages, failures: [...failures, ...answers.flatMap((answer) => (answer.failure ? [answer.failure] : []))] };
  }
  return {
    async list({ db, ownerId, accounts, since, limit = MAIL_LIMIT }) {
      const { messages, failures } = await rows(db, ownerId, accounts, since, limit, false);
      return { messages: messages.map(withoutBody), failures };
    },
    async read({ db, ownerId, accounts, since, limit = MAIL_LIMIT }) {
      return rows(db, ownerId, accounts, since, limit, true);
    },
    async unread({ db, ownerId, accounts }) {
      const failures: MailFailure[] = accounts.filter((account) => !account.isDemo).map(notConnected);
      const demo = accounts.filter((account) => account.isDemo);
      if (demo.length === 0) return { messages: [], failures };
      const { data, error } = await db
        .from("demo_mail")
        .select("account_id, gmail_id")
        .eq("owner_id", ownerId)
        .eq("unread", true)
        .in("account_id", demo.map((account) => account.id));
      if (error) return { messages: [], failures: [...failures, ...demo.map((account) => unreadable(account, error.message))] };
      return { messages: data.map((row) => ({ accountId: row.account_id, id: row.gmail_id })), failures };
    },
    async get({ db, ownerId, account, id }) {
      if (!account.isDemo) return null;
      const { data, error } = await db
        .from("demo_mail")
        .select(DEMO_COLUMNS)
        .eq("owner_id", ownerId)
        .eq("account_id", account.id)
        .eq("gmail_id", id)
        .maybeSingle();
      if (error) throw new Error(`reading the message: ${error.message}`);
      return data ? fromDemo(data as unknown as DemoRow, account.email) : null;
    },
  };
}
