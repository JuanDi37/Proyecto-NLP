# Mail Polish

Polish rough English or Spanish emails with a local Ollama model, then open the finished message in Gmail.

## Presentación del proyecto (español)

Abra **[presentacion.html](presentacion.html)** directamente en el navegador o, con `npm run dev`, visite **http://localhost:5173/presentacion.html**. La presentación ejecutiva funciona sin conexión; las explicaciones técnicas están en las notas del expositor. Para probar los modelos, la app necesita Vite y Ollama. `npm run build` también incluye `dist/presentacion.html`.

Contiene **5 diapositivas para 5 minutos**, con notas cronometradas: problema, método y resultados, feedback, valor económico y decisión. Compara **Qwen 3.5 4B y Gemma 3 4B** mediante 80 generaciones reales sobre 20 borradores ficticios, con dos repeticiones por modelo. Se midieron latencia, primer token y preservación literal; un agente revisó fidelidad, gramática, tono e intención. Las valoraciones del agente se distinguen del único feedback humano histórico. No se enviaron correos ni se incorporaron mensajes privados al HTML.

Los resultados y evaluaciones están en [`public/benchmark-results/`](public/benchmark-results/) y los registros originales en [`benchmarks/results/`](benchmarks/results/). El modelo de costos usa tarifas públicas verificadas de Runpod y el precio elegido por el usuario de **USD 5/cliente/mes**: una configuración de referencia de 30 días cuesta **USD 197,40 de infraestructura** y requiere **40 clientes para cubrirla**, antes de comisiones, impuestos y otros costos aún no cotizados. La cuota de correos requiere medir el servidor alquilado. No se asigna valor subjetivo al tiempo ahorrado. Consulte [`benchmarks/COSTS.md`](benchmarks/COSTS.md) para fuentes, fórmulas y alcance, y [`benchmarks/README.md`](benchmarks/README.md) para reproducir la comparación.

Controles: flechas o botones para navegar; **I** para índice, **N** para notas, **V** para vista completa y **F** para pantalla completa. **PDF** abre la impresión; seleccione orientación horizontal y gráficos de fondo.

## Run on Windows

Install Node.js and Ollama, then run in PowerShell:

```powershell
ollama pull qwen3.5:4b-q4_K_M
ollama pull gemma3:4b
npm install
npm run dev
```

Keep Ollama running and open **http://localhost:5173**. You can also double-click `start.bat`.
If Ollama is offline, open its desktop app or run `ollama serve` in another terminal. The app retries every 10 seconds while visible and when you return to its tab; you can also click **Recheck**. Missing models are detected automatically after installation too.

## Write, polish, and open in Gmail

1. Set your name in the editable profile at the top right and **Para:** to the recipient's name, then write your draft and click **Polish email** (or press Ctrl + Enter). Your signing name is saved automatically in this browser, including later changes.
2. Review or edit the subject and message.
3. Under **Want to mail it?**, optionally enter a recipient email or select a recent recipient.
4. Click **Open in Gmail**. A new Gmail tab opens under `/mail/u/1/` (the institutional account) with the subject, message, and optional recipient filled in.
5. Choose your sending account, use Gmail's own contact suggestions to select a recipient, and press **Send** in Gmail.

**No client ID, API keys, password, environment variables, Google Cloud project, or Contacts permission is required.** Gmail uses its normal login if you are not signed in. Any old `.env.local` Google client ID is unused and can be removed; the file remains ignored by Git.

Opening Gmail creates a compose window; it does not send the email automatically. The app cannot confirm sending or observe recipient changes made in Gmail. If Gmail does not prefill the entire message (for example, with an unusually long compose URL), use **Copy email** and paste it into Gmail. The app retains your original result.

### Recent recipients

The app remembers the last eight recipients entered here when you click **Open in Gmail**, with shortcuts and autocomplete for later drafts. Enter an address such as `maria@example.com`, or a name and address such as `Maria <maria@example.com>` to give the shortcut a friendly name. You can also type a previously saved name. Leave the field empty to choose a recipient directly in Gmail.

The recent list is stored only in this browser. Use a shortcut's X button to forget an address, or **Clear recipients** to remove all entries. Contacts picked or changed inside Gmail cannot be read back into the app. Recents record Gmail handoffs, not confirmed sent emails.

## Other features

- Permanent dark mode, self-hosted Inter typography, and Lucide icons.
- Academic/work context and formal/warm/concise tone.
- Selector **Modelo**: Qwen 3.5 4B or Gemma 3 4B. The choice persists in this browser. Connection checks, loading and rewrites use the selected model; history and feedback retain the model that actually generated each result.
- Streaming generation with Stop; stopping or a failed rewrite restores the previous result.
- Editable subject and body, with separate subject and complete-email copy buttons.
- New-email subjects omit accidental `Re:` prefixes, including in refinements and restored history.
- Recipient name for the greeting and a persistent, editable sender name for the signature. Missing names use a general greeting or omit the signature name instead of inserting name placeholders.
- Shorter, Warmer, and More direct refinements grounded in the original draft.
- Highlighted edits and approximate checks for changed names, dates, numbers, and links.
- Clear placeholders for essential missing details. Fill them before opening Gmail.
- Up to 20 recent emails in **History**, with restore, delete, clear, and an option to stop saving. **Save current edits** retains manual changes.
- Feedback appears after clicking **Open in Gmail**, with a required 1-5 rating and optional comment, saved with the original draft and result to `data/feedback.csv`. Existing good/bad records remain intact. A new rewrite or manual edit hides feedback until that version is opened in Gmail.

Automatic checks are review aids. Review names, dates, amounts, links, and wording before sending.

Las 80 pruebas comparativas también están en `data/feedback.csv`, con las mismas ocho columnas de las valoraciones de la app. Sus comentarios llevan el marcador `BENCHMARK_AGENT`, las métricas y la nota original antes del redondeo a 1–5. Se conserva el registro previo y la importación no duplica filas. Ejecute `npm run benchmark:feedback` para volver a sincronizar pruebas ya evaluadas.

## Data and privacy

Rewriting sends drafts only to Ollama on your computer. The app does not load Google's login SDK, obtain access tokens, access Contacts, or call Gmail's sending API.

Clicking **Open in Gmail** puts the subject, message, and optional recipient in a URL sent directly to `mail.google.com`; that URL may also appear in browser history. Only Gmail handles Google login, contact suggestions, account selection, and the final send.

Email history and recent recipients are stored locally in this browser in plain text and can be deleted in the UI. Disabling email history stops new email-history saves while keeping existing entries. Recipients are stored separately. Feedback is a separate plain-text CSV under `data/` (ignored by Git); delete that file to remove feedback.

## Development

```powershell
npm run build
npm run preview
```

Browser checks (Ollama and the Gmail destination are mocked; no real mail is sent):

```powershell
npx playwright install chromium
npm test
```

Both dev and preview proxy `/ollama` to `http://127.0.0.1:11434` and support local CSV feedback. A static-only deployment needs its own backend/proxy for those features. The app server binds to localhost.

Model and rewrite rules: `src/ollama.ts`. Gmail compose links and recent-recipient helpers: `src/gmail.ts`. Detail checks and highlighted edits: `src/email.ts`.
