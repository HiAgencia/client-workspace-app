import { z } from "zod";
import type { Db } from "@/lib/db/client";







export const mailAddressSchema = z.object({ name: z.string().nullable(), email: z.string() });


export const mailMessageSchema = z.object({
  
  id: z.string(),
  threadId: z.string(),
  accountId: z.string(),
  accountEmail: z.string(),
  from: mailAddressSchema,
  to: z.array(z.string()),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: z.string(),
  
  unread: z.boolean(),
  important: z.boolean(),
});

export type MailMessage = z.infer<typeof mailMessageSchema>;



export type MailContent = MailMessage & { html: string | null; text: string | null; contentLanguage?: string | null };

export type MailAccount = { id: string; email: string; isDemo: boolean; status: string; scopes: string[] };




export const mailFailureSchema = z.object({ accountId: z.string(), accountEmail: z.string(), reason: z.string(), partial: z.boolean().optional(), atLimit: z.boolean().optional() });
export type MailFailure = z.infer<typeof mailFailureSchema>;

export type MailSource = {
  
  
  list(args: { db: Db; ownerId: string; accounts: MailAccount[]; since?: string; limit?: number }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  
  get(args: { db: Db; ownerId: string; account: MailAccount; id: string }): Promise<MailContent | null>;
  
  many(args: { db: Db; ownerId: string; account: MailAccount; ids: string[] }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  
  
  
  candidates(args: {
    db: Db;
    ownerId: string;
    account: MailAccount;
    since: string;
    words: string[];
    limit: number;
    pageToken?: string;
  }): Promise<{ messages: MailMessage[]; failures: MailFailure[]; nextPageToken: string | null }>;
  
  search(args: { db: Db; ownerId: string; accounts: MailAccount[]; words: string; limit: number }): Promise<{ messages: MailMessage[]; failures: MailFailure[] }>;
  
  
  unread(args: { db: Db; ownerId: string; accounts: MailAccount[] }): Promise<{ messages: Array<{ accountId: string; id: string }>; failures: MailFailure[] }>;
};



const OPTIONAL_MARKS = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu;


const OWN_LETTERS = new Set(["ñ", "Ñ", "й", "Й", "ў", "Ў", "ї", "Ї"]);



export function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(OPTIONAL_MARKS, (marked: string, letter: string) => (OWN_LETTERS.has(marked) ? marked : letter))
    .normalize("NFC")
    .toLowerCase();
}



export function waitWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{M}\p{N}@._-]/gu, "").replace(/^[-@._]+|[-@._]+$/g, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}





export function holdsEveryWord(message: Pick<MailMessage, "from" | "subject">, words: string[]): boolean {
  if (words.length === 0) return false;
  const fields = folded([message.from.name ?? "", message.from.email, message.subject].join("\n"));
  return words.every((word) => holdsWhole(fields, folded(word)));
}


const LETTER_OR_FIGURE = /[\p{L}\p{M}\p{N}]/u;


const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function holdsWhole(text: string, word: string): boolean {
  if (UNSPACED.test(word)) return text.includes(word);
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    
    const before = Array.from(text.slice(Math.max(0, at - 2), at)).pop() ?? "";
    const next = text.codePointAt(at + word.length);
    const after = next === undefined ? "" : String.fromCodePoint(next);
    if (!LETTER_OR_FIGURE.test(before) && !LETTER_OR_FIGURE.test(after)) return true;
  }
  return false;
}


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


export function withoutBody(message: MailContent): MailMessage {
  const { id, threadId, accountId, accountEmail, from, to, subject, snippet, receivedAt, unread, important } = message;
  return { id, threadId, accountId, accountEmail, from, to, subject, snippet, receivedAt, unread, important };
}



export const MAIL_LIMIT = 50;

const notConnected = (account: MailAccount): MailFailure => ({ accountId: account.id, accountEmail: account.email, reason: "reading Gmail is not configured on this server" });


function unreadable(account: MailAccount, cause: string): MailFailure {
  console.error(`mail: account ${account.id}: ${cause}`);
  return { accountId: account.id, accountEmail: account.email, reason: "the sample messages could not be read" };
}

const newestFirst = <T extends { receivedAt: string }>(messages: T[]) =>
  messages.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));




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
