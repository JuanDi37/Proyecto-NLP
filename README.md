# Mail Polish

Turns rough, informal emails into professional academic or work emails. Runs fully locally with Ollama (`qwen3.5:4b-q4_K_M`); nothing leaves your machine.

## Run

Double-click `start.bat`, or:

```
npm install
npm run dev     # http://localhost:5173
```

Ollama must be running and the model pulled: `ollama pull qwen3.5:4b-q4_K_M`.

## Notes

- Vite dev server proxies `/ollama` to `http://127.0.0.1:11434`, so no CORS setup is needed.
- To change the model, edit `MODEL` in `src/ollama.ts`.
- Prompt, language detection and output cleanup live in `src/ollama.ts`.
