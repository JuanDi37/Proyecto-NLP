import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// The dev server proxies /ollama -> local Ollama, which sidesteps CORS entirely.
const proxy = {
  '/ollama': {
    target: 'http://127.0.0.1:11434',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, ''),
  },
}

const FEEDBACK_FILE = resolve(__dirname, 'data', 'feedback.csv')
const COLUMNS = ['timestamp', 'model', 'setting', 'tone', 'rating', 'draft', 'result', 'feedback'] as const

// Line breaks are stored as a literal \n so every record stays on one line in any editor.
const csvCell = (v: unknown) =>
  `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, '\\n')}"`

/** POST /api/feedback appends one row to data/feedback.csv (UTF-8 with BOM so Excel reads accents). */
function feedbackCsv(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    if (req.url !== '/api/feedback' || req.method !== 'POST') return next()
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c))
    req.on('end', () => {
      try {
        const row = { ...JSON.parse(raw), timestamp: new Date().toISOString() }
        mkdirSync(dirname(FEEDBACK_FILE), { recursive: true })
        if (!existsSync(FEEDBACK_FILE)) {
          writeFileSync(FEEDBACK_FILE, '﻿' + COLUMNS.join(',') + '\r\n')
        }
        appendFileSync(FEEDBACK_FILE, COLUMNS.map((c) => csvCell(row[c])).join(',') + '\r\n')
        res.statusCode = 204
        res.end()
      } catch (e) {
        res.statusCode = 400
        res.end(String(e))
      }
    })
  }
  return {
    name: 'feedback-csv',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  }
}

export default defineConfig({
  plugins: [react(), feedbackCsv()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
})
