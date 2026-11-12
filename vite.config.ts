import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The dev server proxies /ollama -> local Ollama, which sidesteps CORS entirely.
const proxy = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, ""),
  },
};

const FEEDBACK_FILE = resolve(__dirname, "data", "feedback.csv");
const COLUMNS = [
  "timestamp",
  "model",
  "setting",
  "tone",
  "rating",
  "draft",
  "result",
  "feedback",
] as const;

// Line breaks are stored as a literal \n so every record stays on one line in any editor.
const csvCell = (v: unknown) =>
  `"${String(v ?? "")
    .replace(/^[\s]*[=+@-]/, "'$&")
    .replace(/"/g, '""')
    .replace(/\r?\n/g, "\\n")}"`;

/** POST /api/feedback appends one row to data/feedback.csv (UTF-8 with BOM so Excel reads accents). */
function feedbackCsv(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    if (req.url !== "/api/feedback" || req.method !== "POST") return next();
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    ) {
      res.statusCode = 403;
      return res.end("Origin not allowed");
    }
    let raw = "";
    let bytes = 0;
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      bytes += Buffer.byteLength(c);
      if (bytes > 256000) {
        if (!res.writableEnded) {
          res.statusCode = 413;
          res.end("Feedback too large");
        }
      } else raw += c;
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const row = { ...JSON.parse(raw), timestamp: new Date().toISOString() };
        if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5)
          throw new Error("Rating must be an integer from 1 to 5");
        for (const key of [
          "model",
          "setting",
          "tone",
          "draft",
          "result",
          "feedback",
        ]) {
          if (typeof row[key] !== "string") throw new Error(`Invalid ${key}`);
        }
        mkdirSync(dirname(FEEDBACK_FILE), { recursive: true });
        if (!existsSync(FEEDBACK_FILE)) {
          writeFileSync(FEEDBACK_FILE, "﻿" + COLUMNS.join(",") + "\r\n");
        }
        appendFileSync(
          FEEDBACK_FILE,
          COLUMNS.map((c) => csvCell(row[c])).join(",") + "\r\n",
        );
        res.statusCode = 204;
        res.end();
      } catch (e) {
        res.statusCode = 400;
        res.end(String(e));
      }
    });
  };
  return {
    name: "feedback-csv",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), feedbackCsv()],
  server: { host: "localhost", port: 5173, strictPort: true, proxy },
  preview: { host: "localhost", port: 5173, strictPort: true, proxy },
});
