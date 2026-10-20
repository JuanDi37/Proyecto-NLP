export const MODEL = 'qwen3.5:4b-q4_K_M'

export type Setting = 'academic' | 'work'
export type Tone = 'formal' | 'warm' | 'concise'

export interface Options {
  setting: Setting
  tone: Tone
}

const SETTING: Record<Setting, string> = {
  academic: 'an academic setting (writing to a professor, supervisor, department, or university staff)',
  work: 'a workplace setting (writing to a manager, colleague, client, or recruiter)',
}

const TONE: Record<Tone, string> = {
  formal: 'Tone: formal and respectful.',
  warm: 'Tone: professional but warm and approachable.',
  concise: 'Tone: professional and brief; keep it as short as the content allows.',
}

const ES_WORDS = /\b(el|la|los|las|de|que|y|en|un|una|es|por|para|con|no|me|mi|se|lo|pero|como|porque|xq|pq|hola|profe|gracias|porfa|favor|puedo|puede|pude|tengo|estoy|estaba|buenas|jefe|trabajo|tarea|clase|saludos)\b/g
const EN_WORDS = /\b(the|and|to|of|is|in|it|you|that|for|on|with|i|my|me|can|cant|hey|hi|thanks|thx|please|just|but|this|have|im|u|are|was|be)\b/g

/** Cheap Spanish-vs-other detection; small models ignore "same language" rules unless told which one. */
function detectLanguage(text: string): 'Spanish' | 'English' {
  const t = text.toLowerCase()
  const es = (t.match(ES_WORDS) ?? []).length + (/[¿¡ñáéíóú]/.test(t) ? 2 : 0)
  const en = (t.match(EN_WORDS) ?? []).length
  return es > en ? 'Spanish' : 'English'
}

function systemPrompt({ setting, tone }: Options, draft: string): string {
  const lang = detectLanguage(draft)
  return `You rewrite rough, informal emails into polished professional emails for ${SETTING[setting]}.
${TONE[tone]}

Rules:
- Keep every fact, request, date and name from the draft. Never invent details, names, dates, reasons or promises.
- Fix grammar, spelling, slang and punctuation. Make the request clear and polite.
- LANGUAGE: the draft is written in ${lang}. Write the whole email, including the subject line, greeting and sign-off, in ${lang}. Never translate.
- Start with a line "Subject: ..." then a blank line, then the email.
- Use a greeting and a sign-off. If the recipient's name is not given, use a generic greeting such as "Dear Professor," or "Hello,". Do not use bracketed placeholders like [Name]. If the sender's name is not given, end after the sign-off phrase.
- Output only the email. No explanations, notes, or markdown.`
}

/** Streams the rewritten email, calling onToken with each new chunk of text. */
export async function polish(
  draft: string,
  opts: Options,
  onToken: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/ollama/api/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0.3, num_ctx: 4096 },
      messages: [
        { role: 'system', content: systemPrompt(opts, draft) },
        { role: 'user', content: draft },
      ],
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Ollama responded with ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.error) throw new Error(msg.error)
      if (msg.message?.content) onToken(msg.message.content)
    }
  }
}

/** Drops lines that are only a bracketed placeholder, e.g. "[Your Name]", which the small model sometimes adds anyway. */
export function stripPlaceholders(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*\[[^\]]{1,40}\]\s*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

export type Status = 'checking' | 'ready' | 'no-model' | 'offline'

/** Checks that Ollama is up and the model is installed. */
export async function checkOllama(): Promise<Status> {
  try {
    const res = await fetch('/ollama/api/tags')
    if (!res.ok) return 'offline'
    const data = await res.json()
    const names: string[] = (data.models ?? []).map((m: { name: string }) => m.name)
    return names.includes(MODEL) ? 'ready' : 'no-model'
  } catch {
    return 'offline'
  }
}

/** Loads the model into VRAM so the first real request isn't slow. */
export function warmUp(): void {
  fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, keep_alive: '30m' }),
  }).catch(() => {})
}
