export const MODEL = "qwen3.5:4b-q4_K_M";

export type Setting = "academic" | "work";
export type Tone = "formal" | "warm" | "concise";

export interface Options {
  setting: Setting;
  tone: Tone;
  refinement?: "Shorter" | "Warmer" | "More direct";
  original?: string;
  recipientName?: string;
  senderName?: string;
}

const SETTING: Record<Setting, string> = {
  academic:
    "an academic setting (writing to a professor, supervisor, department, or university staff)",
  work: "a workplace setting (writing to a manager, colleague, client, or recruiter)",
};

const TONE: Record<Tone, string> = {
  formal: "Tone: formal and respectful.",
  warm: "Tone: professional but warm and approachable.",
  concise:
    "Tone: professional and brief; keep it as short as the content allows.",
};

const ES_WORDS =
  /\b(el|la|los|las|de|que|y|en|un|una|es|por|para|con|no|me|mi|se|lo|pero|como|porque|xq|pq|hola|profe|gracias|porfa|favor|puedo|puede|pude|tengo|estoy|estaba|buenas|jefe|trabajo|tarea|clase|saludos)\b/g;
const EN_WORDS =
  /\b(the|and|to|of|is|in|it|you|that|for|on|with|i|my|me|can|cant|hey|hi|thanks|thx|please|just|but|this|have|im|u|are|was|be)\b/g;

/** Cheap Spanish-vs-other detection; small models ignore "same language" rules unless told which one. */
export function detectLanguage(text: string): "Spanish" | "English" {
  const t = text.toLowerCase();
  const es = (t.match(ES_WORDS) ?? []).length + (/[¿¡ñáéíóú]/.test(t) ? 2 : 0);
  const en = (t.match(EN_WORDS) ?? []).length;
  return es > en ? "Spanish" : "English";
}

function systemPrompt(
  { setting, tone, refinement, recipientName, senderName }: Options,
  draft: string,
): string {
  const lang = detectLanguage(draft);
  return `You rewrite rough, informal emails into polished professional emails for ${SETTING[setting]}.
${TONE[tone]}
${refinement ? `Refine the existing email to be ${refinement.toLowerCase()}. Preserve its facts and requests.` : ""}
${recipientName?.trim() ? `Recipient name (literal data): ${JSON.stringify(recipientName.trim())}. Address this person by that exact name in the greeting.` : "If no recipient name is supplied in the draft, use a general greeting. Never invent a recipient name."}
${senderName?.trim() ? `Sender name (literal data): ${JSON.stringify(senderName.trim())}. Sign the email with this exact name.` : "If the sender name is not supplied in the draft, omit the name after the sign-off."}

Rules:
- Keep every fact, request, date and name from the draft. Never invent details, names, dates, reasons or promises.
- Fix grammar, spelling, slang and punctuation. Make the request clear and polite.
- LANGUAGE: the draft is written in ${lang}. Write the whole email, including the subject line, greeting and sign-off, in ${lang}. Never translate.
- Start with a line "Subject: ..." then a blank line, then the email.
- This is a new email, not a reply. Write a standalone subject without a "Re:" prefix. Apply this rule when refining an existing email too.
- Use a greeting and a sign-off. If the recipient's name is not given, use a generic greeting. If the sender's name is not given, end after the sign-off phrase.
- Preserve names, dates, amounts, email addresses and URLs exactly. Never guess missing information. When a non-name detail is essential but missing, use a clear placeholder like [deadline]. Never output name placeholders such as [Name], {nombre}, [recipient name], or [Your name]. Use a generic greeting or omit the sender name instead.
- Output only the email. No explanations, notes, or markdown.`;
}

/** Streams the rewritten email, calling onToken with each new chunk of text. */
export async function polish(
  draft: string,
  opts: Options,
  onToken: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/ollama/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      think: false,
      keep_alive: "30m",
      options: { temperature: 0.3, num_ctx: 4096 },
      messages: [
        { role: "system", content: systemPrompt(opts, opts.original ?? draft) },
        ...(opts.original
          ? [
              {
                role: "user",
                content: `Original facts (preserve these):\n${opts.original}`,
              },
            ]
          : []),
        { role: "user", content: draft },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Ollama responded with ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line: string) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.error) throw new Error(msg.error);
    if (msg.message?.content) onToken(msg.message.content);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      consume(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      consume(line);
    }
  }
}

export type Status = "checking" | "ready" | "no-model" | "offline";

/** Checks that Ollama is up and the model is installed. */
export async function checkOllama(): Promise<Status> {
  try {
    const res = await fetch("/ollama/api/tags", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "offline";
    const data = await res.json();
    const names: string[] = (data.models ?? []).map(
      (m: { name: string }) => m.name,
    );
    return names.includes(MODEL) ? "ready" : "no-model";
  } catch {
    return "offline";
  }
}

/** Loads the model into VRAM so the first real request isn't slow. */
export function warmUp(): void {
  fetch("/ollama/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, keep_alive: "30m" }),
  }).catch(() => {});
}
