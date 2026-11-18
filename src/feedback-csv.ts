export const FEEDBACK_COLUMNS = [
  "timestamp", "model", "setting", "tone", "rating", "draft", "result", "feedback",
] as const;

// Keep the app and benchmark imports on the same one-record-per-line format.
export const feedbackCsvCell = (value: unknown): string =>
  `"${String(value ?? "")
    .replace(/^[\s]*[=+@-]/, "'$&")
    .replace(/"/g, '""')
    .replace(/\r?\n/g, "\\n")}"`;
