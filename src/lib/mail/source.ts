import { z } from "zod";
import type { Db } from "@/lib/db/client";

// Where the messages of the connected accounts come from, injected like the events so the tools are tested without
// Google: the demo's sample accounts read their rows of `demo_mail`, and a real account reads Gmail with `gmail.readonly`
// (`@/lib/google/gmail`, which reads the sample accounts through this source too). Without Google configured on the
// server, a real account answers as a failure that says so. Gmail is never written: what the person opens here is kept
// apart (`mail_opened`).

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

// A whole message, for the viewer: the HTML as the source gave it (the tools sanitize it before it leaves the server), the
// plain text, and the language its `Content-Language` declares when the source reads headers.
export type MailContent = MailMessage & { html: string | null; text: string | null; contentLanguage?: string | null };

export type MailAccount = { id: string; email: string; isDemo: boolean; status: string; scopes: string[] };

export const mailFailureSchema = z.object({ accountId: z.string(), accountEmail: z.string(), reason: z.string() });
export type MailFailure = z.infer<typeof mailFailureSchema>;

export type MailSource = {
  // The latest messages of some accounts, newest first, at most `limit` of each account, received at or after `since`
  // when given.
  list(args: { db: Db; ownerId: string; accounts: MailAccount[]; since?: string; limit?: number }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  // One message whole, or null when the account holds no such message.
  get(args: { db: Db; ownerId: string; account: MailAccount; id: string }): Promise<MailContent | null>;
  // Some messages of one account, without their body, in one read; one the account no longer holds is left out.
  many(args: { db: Db; ownerId: string; account: MailAccount; ids: string[] }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  // The possible replies to what a task waits for, in one account: what arrived since a moment —never what was sent,
  // drafted, chatted, or sits in spam or the trash— whose sender's name or address or whose subject holds every word,
  // newest first, at most `limit`. `nextPageToken` reads the next ones.
  candidates(args: {
    db: Db;
    ownerId: string;
    account: MailAccount;
    since: string;
    words: string[];
    limit: number;
    pageToken?: string;
  }): Promise<{ messages: MailMessage[]; failures: MailFailure[]; nextPageToken: string | null }>;
  // The latest messages of the inbox that hold some words, at most `limit` of each account.
  search(args: { db: Db; ownerId: string; accounts: MailAccount[]; words: string; limit: number }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  // Every message the accounts hold unread in Gmail, whatever a list shows: what the unread count reads. An account
  // whose count failed or stopped short is a failure, and its messages are only those it counted.
  unread(args: { db: Db; ownerId: string; accounts: MailAccount[] }): Promise<{ messages: Array<{ accountId: string; id: string }>; failures: MailFailure[] }>;
};

// A text without accents or capitals, as the words a task waits for are compared.
export function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// The words of what a task waits for, each cleaned to letters, figures and `@._-` so none of them works as a search
// operator; a word left with no letter or figure is dropped.
export function waitWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}@._-]/gu, "").replace(/^[-@._]+|[-@._]+$/g, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

// Whether a message is a possible reply to what a task waits for: every word whole in its sender's name or address or in
// its subject, without accents or capitals. A word is whole as Gmail reads it —no letter or figure right before or after
// it—, so «Dev» is not found in «Developer» by the sample accounts either; a word of a script written without spaces is
// found inside a longer run. No word, no reply: a wait with nothing to look for would take every message.
export function holdsEveryWord(message: Pick<MailMessage, "from" | "subject">, words: string[]): boolean {
  if (words.length === 0) return false;
  const fields = folded([message.from.name ?? "", message.from.email, message.subject].join("\n"));
  return words.every((word) => holdsWhole(fields, folded(word)));
}

const LETTER_OR_FIGURE = /[\p{L}\p{N}]/u;
// Scripts written without spaces between words —or, in Korean, with particles joined to them— have no whole word to cut
// at a space: a word of them is found inside a longer run.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function holdsWhole(text: string, word: string): boolean {
  if (UNSPACED.test(word)) return text.includes(word);
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    // The characters around it, whole: a letter outside the basic plane takes two code units.
    const before = Array.from(text.slice(Math.max(0, at - 2), at)).pop() ?? "";
    const next = text.codePointAt(at + word.length);
    const after = next === undefined ? "" : String.fromCodePoint(next);
    if (!LETTER_OR_FIGURE.test(before) && !LETTER_OR_FIGURE.test(after)) return true;
  }
  return false;
}

// Whether a message holds some words in its sender, subject, or text, as a search reads the sample accounts.
export function holdsWords(message: Pick<MailMessage, "from" | "subject" | "snippet">, words: string): boolean {
  const wanted = words.trim().toLowerCase();
  return [message.subject, message.snippet, message.from.name ?? "", message.from.email].some((value) => value.toLowerCase().includes(wanted));
}

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

const notConnected = (account: MailAccount): MailFailure => ({ accountId: account.id, accountEmail: account.email, reason: "reading Gmail is not configured on this server" });

// A failure the person reads in plain words; its cause goes to the log by the account's id, never swallowed.
function unreadable(account: MailAccount, cause: string): MailFailure {
  console.error(`mail: account ${account.id}: ${cause}`);
  return { accountId: account.id, accountEmail: account.email, reason: "the sample messages could not be read" };
}

const newestFirst = <T extends { receivedAt: string }>(messages: T[]) =>
  messages.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));

// The demo's sample accounts read their own rows, each account on its own so one with much mail leaves the others their
// share; a real account is read by the Gmail source, or answers as not configured. A sample account holds a few rows the
// seed planted, so what a sender or a search keeps is chosen from all of them.
export function demoMailSource(): MailSource {
  type Read = { since?: string; limit: number; whole: boolean; keep?: (message: MailContent) => boolean };
  async function rows(db: Db, ownerId: string, accounts: MailAccount[], { since, limit, whole, keep }: Read) {
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
          query = query.order("received_at", { ascending: false });
          // One more than asked says whether the account holds more.
          const { data, error } = await (keep ? query : query.limit(limit + 1));
          if (error) return { messages: [] as MailContent[], failure: unreadable(account, error.message), more: null };
          const all = (data as unknown as DemoRow[])
            .map((row) => fromDemo({ ...row, html: whole ? row.html : null, text_body: whole ? row.text_body : null }, account.email))
            .filter((message) => !keep || keep(message));
          return { messages: all.slice(0, limit), failure: null, more: all.length > limit ? account.id : null };
        }),
    );
    return {
      messages: newestFirst(answers.flatMap((answer) => answer.messages)),
      failures: [...failures, ...answers.flatMap((answer) => (answer.failure ? [answer.failure] : []))],
      more: answers.flatMap((answer) => (answer.more ? [answer.more] : [])),
    };
  }
  return {
    async list({ db, ownerId, accounts, since, limit = MAIL_LIMIT }) {
      const { messages, failures } = await rows(db, ownerId, accounts, { since, limit, whole: false });
      return { messages: messages.map(withoutBody), failures };
    },
    async candidates({ db, ownerId, account, since, words, limit, pageToken }) {
      if (!account.isDemo) return { messages: [], failures: [notConnected(account)], nextPageToken: null };
      if (words.length === 0) return { messages: [], failures: [], nextPageToken: null };
      const { messages, failures } = await rows(db, ownerId, [account], { since, limit: Number.MAX_SAFE_INTEGER, whole: false, keep: (message) => holdsEveryWord(message, words) });
      // The token is where the next page starts among what the words keep.
      const start = Math.max(0, Math.trunc(Number(pageToken ?? 0)) || 0);
      return {
        messages: messages.slice(start, start + limit).map(withoutBody),
        failures,
        nextPageToken: start + limit < messages.length ? String(start + limit) : null,
      };
    },
    async search({ db, ownerId, accounts, words, limit }) {
      const { messages, failures } = await rows(db, ownerId, accounts, { limit, whole: false, keep: (message) => holdsWords(message, words) });
      return { messages: messages.map(withoutBody), failures };
    },
    async many({ db, ownerId, account, ids }) {
      if (!account.isDemo) return { messages: [], failures: [notConnected(account)] };
      if (ids.length === 0) return { messages: [], failures: [] };
      const { data, error } = await db
        .from("demo_mail")
        .select(DEMO_COLUMNS.replace(", html, text_body", ""))
        .eq("owner_id", ownerId)
        .eq("account_id", account.id)
        .in("gmail_id", ids);
      if (error) return { messages: [], failures: [unreadable(account, error.message)] };
      return { messages: (data as unknown as DemoRow[]).map((row) => withoutBody(fromDemo({ ...row, html: null, text_body: null }, account.email))), failures: [] };
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
