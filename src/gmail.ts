export type RecentRecipient = { email: string; name: string; lastUsed: string };
const RECIPIENTS_KEY = "mail-polish-recipients-v1";
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

export function readRecipients(): RecentRecipient[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem(RECIPIENTS_KEY) ?? "[]",
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item): item is RecentRecipient =>
          item &&
          typeof item.email === "string" &&
          EMAIL.test(item.email) &&
          typeof item.name === "string" &&
          item.name.length <= 100 &&
          typeof item.lastUsed === "string",
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function resolveRecipient(
  value: string,
  recent: RecentRecipient[],
): RecentRecipient | null {
  const input = value.trim();
  if (!input) return null;
  const saved = recent.filter(
    (item) =>
      item.email.toLowerCase() === input.toLowerCase() ||
      (item.name && item.name.toLowerCase() === input.toLowerCase()),
  );
  if (saved.length === 1) return saved[0];
  const named = input.match(/^([^<>\r\n]+)\s*<([^<>\s]+)>$/);
  const email = named ? named[2] : input;
  if (!EMAIL.test(email) || /[\r\n]/.test(input))
    throw new Error(
      "Enter an email address, choose a recent recipient, or leave this blank to choose in Gmail.",
    );
  return {
    email,
    name: named ? named[1].trim().slice(0, 100) : "",
    lastUsed: new Date().toISOString(),
  };
}

export function rememberRecipient(
  recent: RecentRecipient[],
  recipient: RecentRecipient,
): RecentRecipient[] {
  return [
    { ...recipient, lastUsed: new Date().toISOString() },
    ...recent.filter(
      (item) => item.email.toLowerCase() !== recipient.email.toLowerCase(),
    ),
  ].slice(0, 8);
}

export function gmailComposeUrl(
  subject: string,
  body: string,
  to = "",
  recent: RecentRecipient[] = [],
): string {
  if (!subject.trim() || !body.trim())
    throw new Error("Add a subject and message before opening Gmail.");
  if (/\[[^\]\n]+\]/.test(subject + "\n" + body))
    throw new Error("Fill in bracketed placeholders before opening Gmail.");
  const recipient = resolveRecipient(to, recent);
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    tf: "cm",
    su: subject,
    body,
  });
  if (recipient) params.set("to", recipient.email);
  return `https://mail.google.com/mail/u/1/?${params}`;
}
