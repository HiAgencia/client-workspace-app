import { demoMailSource, MAIL_LIMIT, type MailAccount, type MailContent, type MailFailure, type MailMessage, type MailSource } from "@/lib/mail/source";
import { GMAIL_READ_SCOPE, getMessage, getMessages, GoogleError, listMessageIds, type GmailFormat, type GmailMessage, type GmailPart } from "./api";
import { withAccessToken, type GoogleDeps, type TokenRow } from "./events";

// The mail of a real account, read from Gmail with its own token; the demo's sample accounts keep reading their rows.
// Each account is read on its own, so one that fails leaves the others their answer, and its failure is said with its
// cause. Gmail is never written: what the person opens here is kept apart (`mail_opened`).

// What a list reads of each message besides its labels, snippet and date.
const LIST_HEADERS = ["From", "To", "Subject"];
// Mail that arrived: what the account sent, drafted, or chatted is never one, in a search and by its labels alike.
const RECEIVED = "-in:sent -in:draft -in:chats";
const NOT_RECEIVED = new Set(["SENT", "DRAFT", "CHAT"]);
// A list and the unread count read the same inbox, so the number and the list agree; the daily review reads everything
// that arrived, archived included, because a filter may file away the mail a task waits for.
const INBOX = `in:inbox ${RECEIVED}`;
const UNREAD = `is:unread ${INBOX}`;
// The unread ids are read in pages of 500; past these pages the count says it stopped.
const UNREAD_PAGE = 500;
const UNREAD_PAGES = 4;
// A read Gmail answers with its rate limit or a server error, or leaves out of a batch, is asked once more; after its
// rate limit, past a pause.
const askAgain = (status: number) => status === 0 || status === 429 || status >= 500;
const RATE_PAUSE_MS = 1000;

const REVOKED = "access was revoked: connect the account again";
const NOT_GRANTED = "reading mail was not granted: connect the account again and allow Gmail";

// ---- Reading a message ------------------------------------------------------------------------------------------------

export function headerOf(part: GmailPart | undefined, name: string): string | null {
  const wanted = name.toLowerCase();
  return part?.headers?.find((header) => header.name.toLowerCase() === wanted)?.value ?? null;
}

export function base64Bytes(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const binary = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Bytes in their declared charset; one the runtime does not know reads as UTF-8 rather than failing the message.
export function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder((charset ?? "utf-8").trim().toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function quotedBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const hex = text.slice(index + 1, index + 3);
    if (char === "_") bytes.push(0x20);
    else if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 2;
    } else bytes.push(char.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

// A header's encoded words (RFC 2047, `=?charset?B?…?=` and `=?charset?Q?…?=`) as text; two in a row join without the
// space between them, and the bytes of words in a row in one charset are decoded together, because some mailers split a
// character between two words. A word that cannot be decoded stays as it came; a header that arrives already decoded
// passes through unchanged.
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?)/g, "$1")
    .replace(/(?:=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)+/g, (run) => {
      let text = "";
      let charset: string | null = null;
      let bytes: number[] = [];
      const flush = () => {
        if (charset !== null && bytes.length > 0) text += decodeBytes(new Uint8Array(bytes), charset);
        bytes = [];
      };
      for (const [whole, wordCharset, encoding, data] of run.matchAll(ENCODED_WORD)) {
        let decoded: Uint8Array;
        try {
          decoded = encoding.toUpperCase() === "B" ? base64Bytes(data) : quotedBytes(data);
        } catch {
          flush();
          charset = null;
          text += whole;
          continue;
        }
        if (charset !== null && wordCharset.toLowerCase() !== charset.toLowerCase()) flush();
        charset = wordCharset;
        bytes.push(...decoded);
      }
      flush();
      return text;
    });
}

// `Name <address>`, `"Name" <address>` or a bare address.
export function parseAddress(value: string | null): { name: string | null; email: string } {
  if (!value) return { name: null, email: "" };
  const decoded = decodeWords(value).trim();
  const angled = /^(.*?)<([^<>]+)>\s*$/.exec(decoded);
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
    return { name: name || null, email: angled[2].trim().toLowerCase() };
  }
  return { name: null, email: decoded.replace(/^mailto:/i, "").trim().toLowerCase() };
}

// The addresses of a list, split on the commas outside a quoted name or angle brackets.
export function addressList(value: string | null): string[] {
  if (!value) return [];
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === "<" && !quoted) angled = true;
    else if (char === ">" && !quoted) angled = false;
    if (char === "," && !quoted && !angled) {
      pieces.push(current);
      current = "";
    } else current += char;
  }
  pieces.push(current);
  return pieces.map((piece) => parseAddress(piece).email).filter(Boolean);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Gmail's snippet comes with its characters escaped for HTML; the lists show it as text.
export function snippetText(snippet: string | undefined): string {
  return (snippet ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    try {
      return String.fromCodePoint(point);
    } catch {
      return whole;
    }
  });
}

function charsetOf(part: GmailPart): string | null {
  return /charset="?([^";\s]+)"?/i.exec(headerOf(part, "Content-Type") ?? "")?.[1] ?? null;
}

// The first HTML and the first plain text of a message, wherever they sit in its parts; attachments are not its body.
// A body that is not valid base64 throws: the caller counts that message as one that could not be read.
export function bodiesOf(payload: GmailPart | undefined): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;
  const walk = (part: GmailPart) => {
    const attached = Boolean(part.filename) || /^\s*attachment/i.test(headerOf(part, "Content-Disposition") ?? "");
    const type = (part.mimeType ?? "").toLowerCase();
    if (!attached && part.body?.data) {
      if (type === "text/html" && html === null) html = decodeBytes(base64Bytes(part.body.data), charsetOf(part));
      else if (type === "text/plain" && text === null) text = decodeBytes(base64Bytes(part.body.data), charsetOf(part));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload) walk(payload);
  return { html, text };
}

// When Gmail received it; its own header only when Gmail's mark is missing.
function receivedAt(message: GmailMessage): string {
  const internal = Number(message.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal).toISOString();
  const dated = Date.parse(headerOf(message.payload, "Date") ?? "");
  return new Date(Number.isFinite(dated) ? dated : 0).toISOString();
}

// The subject as it came, empty when it has none, as the sample accounts give it: the screens say what a message
// without a subject is called.
export function toMailMessage(message: GmailMessage, account: { id: string; email: string }): MailMessage {
  const labels = new Set(message.labelIds ?? []);
  return {
    id: message.id,
    threadId: message.threadId,
    accountId: account.id,
    accountEmail: account.email,
    from: parseAddress(headerOf(message.payload, "From")),
    to: addressList(headerOf(message.payload, "To")),
    subject: decodeWords(headerOf(message.payload, "Subject") ?? "").trim(),
    snippet: snippetText(message.snippet),
    receivedAt: receivedAt(message),
    unread: labels.has("UNREAD"),
    important: labels.has("IMPORTANT"),
  };
}

export function toMailContent(message: GmailMessage, account: { id: string; email: string }): MailContent {
  return { ...toMailMessage(message, account), ...bodiesOf(message.payload) };
}

export function arrived(message: GmailMessage): boolean {
  return !(message.labelIds ?? []).some((label) => NOT_RECEIVED.has(label));
}

// A Gmail search from a moment on: Gmail reads `after:` in seconds since the epoch.
export function searchFrom(base: string, since?: string): string {
  if (!since) return base;
  const seconds = Math.floor(Date.parse(since) / 1000);
  return Number.isFinite(seconds) ? `${base} after:${seconds}` : base;
}

// A search for the mail of some senders, each named by words of their name or address, as a task says who it waits for:
// Gmail keeps a sender whose name or address holds all of a sender's words. Empty when no sender has a word to search.
export function senderSearch(senders: string[]): string {
  const groups = senders
    .map((words) => words.replace(/[(){}"]/g, " ").replace(/\s+/g, " ").trim().replace(/^-+/, ""))
    .filter(Boolean)
    .map((words) => `from:(${words})`);
  return groups.length > 1 ? `{${groups.join(" ")}}` : (groups[0] ?? "");
}

// ---- The source -------------------------------------------------------------------------------------------------------

type Readable = TokenRow & { status: string };

function failureOf(account: MailAccount, reason: string): MailFailure {
  return { accountId: account.id, accountEmail: account.email, reason };
}

// The person reads the reason; the log keeps it by the account's id, never by its address.
function because(account: MailAccount, error: unknown): MailFailure {
  if (error instanceof GoogleError && error.revoked) return failureOf(account, REVOKED);
  const reason = error instanceof Error ? error.message : "the mail could not be read";
  console.error(`gmail: account ${account.id}: ${reason}`);
  return failureOf(account, reason);
}

function newestFirst<T extends { receivedAt: string }>(messages: T[]): T[] {
  return messages.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

// What a batch of reads of one account brought: the messages, how many were gone by the time they were read, and the
// statuses of those that could not be read.
type BatchRead = { messages: GmailMessage[]; gone: number; lost: string[] };

export function gmailMailSource(deps: GoogleDeps): MailSource {
  const demo = demoMailSource();

  // The stored row of each real account that can be read, and the failure of each that cannot: a revoked access and an
  // account connected before reading mail was asked are not tried, only connecting again fixes them. Only the owner's
  // accounts are read.
  async function tokensFor(ownerId: string, accounts: MailAccount[]) {
    const failures: MailFailure[] = [];
    const ready: Array<{ account: MailAccount; row: Readable }> = [];
    const readable = accounts.filter((account) => {
      if (account.status === "revoked") failures.push(failureOf(account, REVOKED));
      else if (!account.scopes.includes(GMAIL_READ_SCOPE)) failures.push(failureOf(account, NOT_GRANTED));
      else return true;
      return false;
    });
    if (readable.length === 0) return { ready, failures };
    const { data, error } = await deps.service
      .from("google_accounts")
      .select("id, email, status, refresh_token, access_token, access_token_expires_at")
      .eq("owner_id", ownerId)
      .eq("is_demo", false)
      .in("id", readable.map((account) => account.id));
    if (error) {
      console.error("gmail: reading the accounts:", error.message);
      return { ready, failures: [...failures, ...readable.map((account) => failureOf(account, "the account could not be read"))] };
    }
    const rows = new Map((data as Readable[]).map((row) => [row.id, row]));
    for (const account of readable) {
      const row = rows.get(account.id);
      if (!row) failures.push(failureOf(account, "the account was not found"));
      else if (row.status === "revoked") failures.push(failureOf(account, REVOKED));
      else ready.push({ account, row });
    }
    return { ready, failures };
  }

  // Something read from each readable account at once, with a token Google accepts; an account whose read fails is a
  // failure, and the others still answer.
  async function eachAccount<T>(ownerId: string, accounts: MailAccount[], read: (account: MailAccount, token: string) => Promise<T>) {
    const { ready, failures } = await tokensFor(ownerId, accounts);
    const answers = await Promise.all(
      ready.map(async ({ account, row }) => {
        try {
          return [{ account, value: await withAccessToken(deps, row, (token) => read(account, token)) }];
        } catch (error) {
          failures.push(because(account, error));
          return [];
        }
      }),
    );
    return { answers: answers.flat(), failures };
  }

  // Some messages of one account, read in batches. What Gmail answers with its rate limit or a server error is asked once
  // more, all of it in one batch; a message deleted between the search and the read (404) is no failure.
  async function readIds(token: string, ids: string[], format: GmailFormat): Promise<BatchRead> {
    const first = await getMessages(deps.fetch, token, ids, format, LIST_HEADERS);
    const again = ids.flatMap((id, index) => {
      const answer = first[index];
      return answer instanceof GoogleError && askAgain(answer.status) ? [id] : [];
    });
    const retried = new Map<string, GmailMessage | GoogleError>();
    if (again.length > 0) {
      if (first.some((answer) => answer instanceof GoogleError && answer.status === 429)) await new Promise((resolve) => setTimeout(resolve, RATE_PAUSE_MS));
      const second = await getMessages(deps.fetch, token, again, format, LIST_HEADERS);
      again.forEach((id, index) => retried.set(id, second[index]));
    }
    const read: BatchRead = { messages: [], gone: 0, lost: [] };
    ids.forEach((id, index) => {
      const answer = retried.get(id) ?? first[index];
      if (!(answer instanceof GoogleError)) read.messages.push(answer);
      else if (answer.status === 404) read.gone++;
      else read.lost.push(answer.status ? String(answer.status) : "no answer");
    });
    return read;
  }

  // The messages of one batch that `keep` keeps, made into the product's message by `to`. One whose content cannot be
  // decoded counts with those that could not be read; what was lost is the account's failure, said with its count, and
  // its statuses go to the log.
  function fromBatch<T>(account: MailAccount, listed: number, read: BatchRead, to: (message: GmailMessage) => T, keep: (message: GmailMessage) => boolean) {
    const messages: T[] = [];
    const lost = [...read.lost];
    for (const message of read.messages) {
      if (!keep(message)) continue;
      try {
        messages.push(to(message));
      } catch {
        lost.push("undecodable");
      }
    }
    if (read.gone > 0) console.error(`gmail: account ${account.id}: ${read.gone} of ${listed} messages were deleted between the search and the read`);
    if (lost.length === 0) return { messages, failure: null };
    const statuses = new Map<string, number>();
    for (const status of lost) statuses.set(status, (statuses.get(status) ?? 0) + 1);
    console.error(`gmail: account ${account.id}: ${lost.length} of ${listed} messages could not be read (${[...statuses].map(([status, count]) => `${status} × ${count}`).join(", ")})`);
    return { messages, failure: failureOf(account, `${lost.length} of ${listed} messages could not be read`) };
  }

  const isDemo = (account: MailAccount) => account.isDemo;
  const isReal = (account: MailAccount) => !account.isDemo;
  const nothing = { messages: [], failures: [], more: [] };

  // A search's latest messages of each real account, without their body or whole.
  async function searched<T extends MailMessage>(
    ownerId: string,
    accounts: MailAccount[],
    q: string,
    limit: number,
    format: GmailFormat,
    to: (message: GmailMessage, account: MailAccount) => T,
  ) {
    const { answers, failures } = await eachAccount(ownerId, accounts, async (account, token) => {
      const page = await listMessageIds(deps.fetch, token, { q, maxResults: limit });
      const read = await readIds(token, page.messages.map((message) => message.id), format);
      return { ...fromBatch(account, page.messages.length, read, (message) => to(message, account), arrived), more: Boolean(page.nextPageToken) };
    });
    return {
      messages: answers.flatMap(({ value }) => value.messages),
      failures: [...failures, ...answers.flatMap(({ value }) => (value.failure ? [value.failure] : []))],
      more: answers.flatMap(({ account, value }) => (value.more ? [account.id] : [])),
    };
  }

  return {
    async list({ db, ownerId, accounts, since, limit = MAIL_LIMIT }) {
      const [sample, real] = await Promise.all([
        accounts.some(isDemo) ? demo.list({ db, ownerId, accounts: accounts.filter(isDemo), since, limit }) : nothing,
        accounts.some(isReal) ? searched(ownerId, accounts.filter(isReal), searchFrom(INBOX, since), limit, "metadata", toMailMessage) : nothing,
      ]);
      return { messages: newestFirst([...sample.messages, ...real.messages]), failures: [...sample.failures, ...real.failures] };
    },
    async read({ db, ownerId, accounts, since, limit = MAIL_LIMIT, from }) {
      const senders = from ? senderSearch(from) : "";
      const real = accounts.filter(isReal);
      const [sample, read] = await Promise.all([
        accounts.some(isDemo) ? demo.read({ db, ownerId, accounts: accounts.filter(isDemo), since, limit, from }) : nothing,
        // Senders named with no word to search find nothing, rather than every sender's mail.
        real.length > 0 && !(from && !senders)
          ? searched(ownerId, real, [searchFrom(RECEIVED, since), senders].filter(Boolean).join(" "), limit, "full", toMailContent)
          : nothing,
      ]);
      return {
        messages: newestFirst([...sample.messages, ...read.messages]),
        failures: [...sample.failures, ...read.failures],
        more: [...sample.more, ...read.more],
      };
    },
    async search({ db, ownerId, accounts, words, limit }) {
      const query = words.replace(/\s+/g, " ").trim();
      if (!query) return { messages: [], failures: [] };
      const [sample, real] = await Promise.all([
        accounts.some(isDemo) ? demo.search({ db, ownerId, accounts: accounts.filter(isDemo), words: query, limit }) : nothing,
        accounts.some(isReal) ? searched(ownerId, accounts.filter(isReal), `${INBOX} ${query}`, limit, "metadata", toMailMessage) : nothing,
      ]);
      return { messages: newestFirst([...sample.messages, ...real.messages]), failures: [...sample.failures, ...real.failures] };
    },
    async many({ db, ownerId, account, ids }) {
      if (account.isDemo) return demo.many({ db, ownerId, account, ids });
      if (ids.length === 0) return { messages: [], failures: [] };
      const { answers, failures } = await eachAccount(ownerId, [account], async (reached, token) => {
        const read = await readIds(token, ids, "metadata");
        // A message linked here is read as it is, whatever its labels.
        return fromBatch(reached, ids.length, read, (message) => toMailMessage(message, reached), () => true);
      });
      return {
        messages: answers.flatMap(({ value }) => value.messages),
        failures: [...failures, ...answers.flatMap(({ value }) => (value.failure ? [value.failure] : []))],
      };
    },
    async unread({ db, ownerId, accounts }) {
      const sample = accounts.some(isDemo) ? await demo.unread({ db, ownerId, accounts: accounts.filter(isDemo) }) : nothing;
      const { ready, failures } = await tokensFor(ownerId, accounts.filter(isReal));
      const answers = await Promise.all(
        ready.map(async ({ account, row }) => {
          const ids: Array<{ accountId: string; id: string }> = [];
          try {
            const pageToken = await withAccessToken(deps, row, async (token) => {
              ids.length = 0;
              let next: string | undefined;
              let pages = 0;
              do {
                const page = await listMessageIds(deps.fetch, token, { q: UNREAD, maxResults: UNREAD_PAGE, pageToken: next });
                ids.push(...page.messages.map((message) => ({ accountId: account.id, id: message.id })));
                next = page.nextPageToken;
                pages++;
              } while (next && pages < UNREAD_PAGES);
              return next;
            });
            // A count that stopped short says so instead of reading as the whole.
            return { ids, failure: pageToken ? failureOf(account, `only the latest ${ids.length} unread messages were counted`) : null };
          } catch (error) {
            // What was counted before the failure stays, and the failure says the count is not whole.
            return { ids, failure: because(account, error) };
          }
        }),
      );
      return {
        messages: [...sample.messages, ...answers.flatMap((answer) => answer.ids)],
        failures: [...sample.failures, ...failures, ...answers.flatMap((answer) => (answer.failure ? [answer.failure] : []))],
      };
    },
    async get({ db, ownerId, account, id }) {
      if (account.isDemo) return demo.get({ db, ownerId, account, id });
      const { ready, failures } = await tokensFor(ownerId, [account]);
      if (ready.length === 0) throw new Error(failures[0]?.reason ?? "the account could not be read");
      let message: GmailMessage;
      try {
        message = await withAccessToken(deps, ready[0].row, (token) => getMessage(deps.fetch, token, id, "full"));
      } catch (error) {
        if (error instanceof GoogleError && error.status === 404) return null;
        throw new Error(because(account, error).reason);
      }
      try {
        return toMailContent(message, account);
      } catch (error) {
        console.error(`gmail: account ${account.id}: decoding message ${id}:`, error instanceof Error ? error.message : error);
        throw new Error("the message's content could not be decoded");
      }
    },
  };
}
