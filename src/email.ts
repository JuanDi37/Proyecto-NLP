export function cleanGeneratedSubject(subject: string): string {
  return subject.replace(/^(?:\s*re(?:\[\d+\])?\s*:\s*)+/i, "").trim();
}

export function splitEmail(text: string) {
  const match = text.match(/^\s*(?:Subject|Asunto):\s*([^\r\n]*)\r?\n?/i);
  return match
    ? {
        subject: cleanGeneratedSubject(match[1]),
        body: text.slice(match[0].length).trimStart(),
      }
    : { subject: "", body: text };
}

/** Keep the supplied names even when a small model ignores the prompt. */
export function personalizeEmail(
  text: string,
  recipientName: string,
  senderName: string,
  language: "Spanish" | "English",
) {
  const parsed = splitEmail(text);
  const lines = parsed.body.trim().split("\n");
  const placeholder =
    /[\[{<]\s*(?:nombre|name|tu nombre|su nombre|your name|sender(?:'s)? name|recipient(?:'s)? name|nombre del destinatario|nombre del remitente)\s*[\]}>]/iu;
  const greeting =
    /^(?:estimad[oa]s?|hola|buenos días|buenas tardes|buenas noches|dear|hello|hi)\b/iu;
  const signoff =
    /^(?:atentamente|saludos(?: cordiales)?|cordialmente|un saludo|sincerely|best(?: regards)?|kind regards|regards|thank you|thanks)[,.:!\s]*$/iu;
  const name = recipientName.trim();
  if (name) {
    const first = lines[0] ?? "";
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasExactName = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapedName}(?:$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(first);
    if (!greeting.test(first) || !hasExactName || placeholder.test(first)) {
      const addressed =
        language === "Spanish" ? `Hola ${name},` : `Dear ${name},`;
      if (greeting.test(first) || placeholder.test(first)) lines[0] = addressed;
      else lines.unshift(addressed, "");
    }
  } else if (placeholder.test(lines[0] ?? "")) {
    lines[0] = language === "Spanish" ? "Hola," : "Hello,";
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (placeholder.test(lines[lines.length - 1] ?? "")) lines.pop();
  const sender = senderName.trim();
  if (
    sender &&
    lines[lines.length - 1]?.trim().toLocaleLowerCase() !==
      sender.toLocaleLowerCase()
  ) {
    const previous =
      lines
        .slice(0, -1)
        .filter((line) => line.trim())
        .pop() ?? "";
    if (signoff.test(previous)) lines.pop();
    if (!signoff.test(lines[lines.length - 1] ?? ""))
      lines.push("", language === "Spanish" ? "Saludos," : "Best regards,");
    lines.push(sender);
  }
  return { subject: parsed.subject, body: lines.join("\n").trim() };
}

export function detailWarnings(original: string, result: string): string[] {
  // Conservative review hints, not a guarantee that the model preserved every fact.
  const patterns =
    /https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:[$€£]\s*)?\b\d+(?:[.,:/-]\d+)*(?:\s*(?:USD|EUR|GBP|%))?|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*\b/gu;
  const ignored = new Set([
    "I",
    "Subject",
    "Asunto",
    "Dear",
    "Hello",
    "Hi",
    "Hey",
    "Thanks",
    "Please",
    "Best",
    "Regards",
  ]);
  const calendar =
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/giu;
  const details = [
    ...new Set([
      ...(original.match(patterns) ?? []),
      ...(original.match(calendar) ?? []),
    ]),
  ].filter((x) => !ignored.has(x));
  const missing = details.filter(
    (x) => !result.toLocaleLowerCase().includes(x.toLocaleLowerCase()),
  );
  const added = (
    result.match(
      /https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:[$€£]\s*)?\b\d+(?:[.,:/-]\d+)*/gi,
    ) ?? []
  ).filter(
    (x) => !original.toLocaleLowerCase().includes(x.toLocaleLowerCase()),
  );
  return [
    ...missing.map((x) => `Check original detail: ${x}`),
    ...[...new Set(added)].map((x) => `Check added detail: ${x}`),
    ...(result.match(/\[[^\]\n]+\]/g) ?? []).map((x) => `Fill in ${x}`),
  ];
}

export type Edit = { type: "same" | "added" | "removed"; text: string };
export function diffWords(before: string, after: string): Edit[] {
  const a = before.match(/\S+\s*/g) ?? [],
    b = after.match(/\S+\s*/g) ?? [];
  if (a.length * b.length > 250000)
    return [
      { type: "removed", text: before },
      { type: "added", text: after },
    ];
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i].trim() === b[j].trim()
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0,
    j = 0;
  const edits: Edit[] = [];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].trim() === b[j].trim()) {
      edits.push({ type: "same", text: b[j++] });
      i++;
    } else if (
      j < b.length &&
      (i === a.length || table[i][j + 1] >= table[i + 1][j])
    )
      edits.push({ type: "added", text: b[j++] });
    else edits.push({ type: "removed", text: a[i++] });
  }
  return edits;
}
