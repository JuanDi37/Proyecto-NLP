import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODEL,
  checkOllama,
  detectLanguage,
  polish,
  warmUp,
  type Setting,
  type Status,
  type Tone,
  type Options,
} from "./ollama";
import {
  detailWarnings,
  diffWords,
  splitEmail,
  cleanGeneratedSubject,
  personalizeEmail,
} from "./email";
import {
  ArrowUpRight,
  UserRound,
  ChevronRight,
  Copy,
  History,
  Mail,
  MailCheck,
  PenLine,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  gmailComposeUrl,
  resolveRecipient,
  readRecipients,
  rememberRecipient,
  type RecentRecipient,
} from "./gmail";

type Entry = {
  recipientName?: string;
  senderName?: string;
  recipientEmail?: string;
  id: string;
  date: string;
  draft: string;
  subject: string;
  body: string;
  setting: Setting;
  tone: Tone;
};
const HISTORY_KEY = "mail-polish-history-v1";
function readHistory(): Entry[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (x): x is Entry =>
              x &&
              ["id", "date", "draft", "subject", "body"].every(
                (k) => typeof x[k] === "string",
              ) &&
              ["academic", "work"].includes(x.setting) &&
              ["formal", "warm", "concise"].includes(x.tone) &&
              ["recipientName", "senderName", "recipientEmail"].every(
                (key) => x[key] === undefined || typeof x[key] === "string",
              ),
          )
          .slice(0, 20)
          .map((entry) => ({
            ...entry,
            subject: cleanGeneratedSubject(entry.subject),
          }))
      : [];
  } catch {
    return [];
  }
}
const EXAMPLE =
  "hey prof, cant make it to class thursday im sick, can u send me the notes. also is the essay still due fri? thx";

export default function App() {
  const [recipientName, setRecipientName] = useState("");
  const [senderName, setSenderName] = useState(() => {
    try {
      return localStorage.getItem("mail-polish-sender-name") ?? "";
    } catch {
      return "";
    }
  });
  const [senderSaveError, setSenderSaveError] = useState("");
  const [generatedNames, setGeneratedNames] = useState({
    recipient: "",
    sender: "",
  });
  const [feedbackReady, setFeedbackReady] = useState(false);
  const [panel, setPanel] = useState<"history" | null>(null);
  const [to, setTo] = useState("");
  const [recipients, setRecipients] =
    useState<RecentRecipient[]>(readRecipients);
  const [recipientStorageError, setRecipientStorageError] = useState("");
  const [draft, setDraft] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [source, setSource] = useState("");
  const [setting, setSetting] = useState<Setting>("academic"),
    [tone, setTone] = useState<Tone>("formal");
  const [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [status, setStatus] = useState<Status>("checking"),
    [rating, setRating] = useState(0),
    [comment, setComment] = useState("");
  const [fbState, setFbState] = useState<"idle" | "sending" | "sent" | "error">(
      "idle",
    ),
    [showDiff, setShowDiff] = useState(false);
  const [history, setHistory] = useState<Entry[]>(readHistory),
    [historyError, setHistoryError] = useState("");
  const [historyEnabled, setHistoryEnabled] = useState(() => {
    try {
      return localStorage.getItem("mail-polish-save-history") !== "false";
    } catch {
      return false;
    }
  });
  const abortRef = useRef<AbortController | null>(null),
    runLock = useRef(false);
  const gmailLink = useMemo(() => {
    if (!complete || busy) return { url: "", error: "" };
    try {
      return { url: gmailComposeUrl(subject, body, to, recipients), error: "" };
    } catch (error) {
      return { url: "", error: (error as Error).message };
    }
  }, [complete, busy, subject, body, to, recipients]);
  const warnings = useMemo(
    () => detailWarnings(source, `${subject}\n${body}`),
    [source, subject, body],
  );
  const changes = useMemo(
    () => (showDiff ? diffWords(source, body) : []),
    [source, body, showDiff],
  );
  const refresh = async () => {
    setStatus("checking");
    const next = await checkOllama();
    setStatus(next);
    if (next === "ready") warmUp();
  };
  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = document.querySelector<HTMLButtonElement>(
      '#workspace-panel [aria-label="Close panel"]',
    );
    close?.focus();
    return () => {
      previous?.focus();
    };
  }, [panel]);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      setHistoryError("");
    } catch {
      setHistoryError(
        "History could not be saved. Browser storage may be full or disabled.",
      );
    }
  }, [history]);
  useEffect(() => {
    try {
      localStorage.setItem("mail-polish-sender-name", senderName);
      setSenderSaveError("");
    } catch {
      setSenderSaveError("No se pudo guardar tu nombre en este navegador.");
    }
  }, [senderName]);
  useEffect(() => {
    if (feedbackReady)
      document
        .getElementById("response-feedback")
        ?.scrollIntoView({ block: "nearest" });
  }, [feedbackReady]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "mail-polish-recipients-v1",
        JSON.stringify(recipients),
      );
      setRecipientStorageError("");
    } catch {
      setRecipientStorageError(
        "Recent recipients could not be saved in this browser.",
      );
    }
  }, [recipients]);
  const openGmail = () => {
    setFeedbackReady(true);
    const recipient = resolveRecipient(to, recipients);
    if (recipient)
      setRecipients((items) =>
        rememberRecipient(items, {
          ...recipient,
          name: recipientName.trim() || recipient.name,
        }),
      );
    setNotice(
      "Gmail opens with your draft. Choose the recipient and press Send there.",
    );
  };
  const saveEntry = (entry: Entry) => {
    if (historyEnabled)
      setHistory((items) =>
        [entry, ...items.filter((x) => x.id !== entry.id)].slice(0, 20),
      );
  };
  const run = async (refinement?: Options["refinement"]) => {
    if (!draft.trim() || runLock.current || status !== "ready") return;
    runLock.current = true;
    const original = refinement ? source : draft,
      input = refinement ? `Subject: ${subject}\n\n${body}` : draft;
    const previous = { subject, body, source, complete, feedbackReady },
      ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError("");
    setNotice("");
    setComplete(false);
    setFeedbackReady(false);
    setSubject("");
    setBody("");
    setSource(original);
    setRating(0);
    setComment("");
    setFbState("idle");
    let result = "";
    try {
      await polish(
        input,
        {
          setting,
          tone,
          refinement,
          original: refinement ? original : undefined,
          recipientName: recipientName.trim(),
          senderName: senderName.trim(),
        },
        (chunk) => {
          result += chunk;
          const parsed = splitEmail(result);
          setSubject(parsed.subject);
          setBody(parsed.body);
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const parsed = personalizeEmail(
        result,
        recipientName,
        senderName,
        detectLanguage(original),
      );
      if (!parsed.body.trim())
        throw new Error("The model returned an empty email. Try again.");
      setComplete(true);
      setSubject(parsed.subject);
      setBody(parsed.body);
      setGeneratedNames({
        recipient: recipientName.trim(),
        sender: senderName.trim(),
      });
      saveEntry({
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        draft: original,
        ...parsed,
        setting,
        tone,
        recipientName: recipientName.trim(),
        senderName: senderName.trim(),
        recipientEmail: to,
      });
    } catch (e) {
      setSubject(previous.subject);
      setBody(previous.body);
      setSource(previous.source);
      setComplete(previous.complete);
      setFeedbackReady(previous.feedbackReady);
      if ((e as Error).name === "AbortError")
        setNotice("Generation stopped. Your previous result has been kept.");
      else setError((e as Error).message || "Could not rewrite this email.");
    } finally {
      setBusy(false);
      runLock.current = false;
    }
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied.`);
    } catch {
      setError("Clipboard unavailable. Select and copy the text manually.");
    }
  };
  const sendFeedback = async () => {
    if (!rating || fbState === "sending") return;
    setFbState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          setting,
          tone,
          rating,
          draft: source,
          result: `Subject: ${subject}\n\n${body}`,
          feedback: comment,
        }),
      });
      setFbState(res.ok ? "sent" : "error");
    } catch {
      setFbState("error");
    }
  };
  const restore = (entry: Entry) => {
    setFeedbackReady(false);
    setPanel(null);
    setDraft(entry.draft);
    setSource(entry.draft);
    setSubject(entry.subject);
    setBody(entry.body);
    setSetting(entry.setting);
    setTone(entry.tone);
    setComplete(true);
    setRating(0);
    setComment("");
    setFbState("idle");
    setError("");
    setNotice("Saved email restored.");
    setTo(entry.recipientEmail ?? "");
    setRecipientName(entry.recipientName ?? "");
    setGeneratedNames({
      recipient: entry.recipientName ?? "",
      sender: entry.senderName ?? "",
    });
  };
  const statusLabel = {
    checking: "Checking connection",
    ready: "Local model ready",
    offline: "Ollama offline",
    "no-model": "Model not installed",
  }[status];
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Mail size={19} strokeWidth={1.7} />
            <span />
          </span>
          Mail<span className="brand-light">Polish</span>
        </a>
        <span className="header-divider" />
        <span className="workspace-label">Writing workspace</span>
        <nav className="header-actions" aria-label="Workspace tools">
          <button
            className={`nav-button ${panel === "history" ? "selected" : ""}`}
            aria-expanded={panel === "history"}
            aria-controls="workspace-panel"
            onClick={() => setPanel(panel === "history" ? null : "history")}
          >
            <History size={15} /> History
          </button>
          <div
            className="profile-control"
            title={senderSaveError || "Tu perfil se guarda en este navegador"}
          >
            <span className="profile-avatar" aria-hidden="true">
              <UserRound size={15} />
            </span>
            <label className="profile-fields" htmlFor="sender-name">
              <span>Tu nombre</span>
              <input
                id="sender-name"
                aria-label="Tu nombre:"
                aria-describedby="sender-save-status"
                value={senderName}
                maxLength={100}
                disabled={busy}
                autoComplete="name"
                placeholder="Tu nombre"
                onChange={(e) => setSenderName(e.target.value)}
              />
            </label>
            <small id="sender-save-status" className="sr-only">
              {senderSaveError || "Se guarda automaticamente en este navegador"}
            </small>
          </div>
        </nav>
      </header>
      <main className="main">
        <div className="workspace-breadcrumb">
          <span>Workspace</span>
          <ChevronRight size={12} />
          <span>Compose</span>
        </div>
        <div className="intro">
          <div>
            <h1>
              A clearer message.
              <br className="mobile-break" /> Still your voice<span>.</span>
            </h1>
            <p>Turn a rough draft into an email you feel good about sending.</p>
          </div>
          <div className={`status ${status}`}>
            <i />
            {statusLabel}
            <button
              className="icon-button"
              aria-label="Recheck"
              title="Recheck model connection"
              onClick={refresh}
              disabled={status === "checking"}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        {(status === "offline" || status === "no-model") && (
          <aside className="setup">
            <strong>{statusLabel}</strong>
            <p>
              {status === "offline"
                ? "Open Ollama, or run this in another terminal:"
                : "Download the model in your terminal:"}
            </p>
            <code>
              {status === "offline" ? "ollama serve" : `ollama pull ${MODEL}`}
            </code>
            <p>
              Then click Recheck. First-time model loading can take a minute.
            </p>
          </aside>
        )}
        <div role="status" className="notice">
          {notice}
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}
        <div className="workspace">
          <div className="editor-area">
            <div className="controls">
              <span className="toolbar-label">
                <WandSparkles size={15} /> Rewrite preferences
              </span>
              <label>
                Context
                <select
                  value={setting}
                  disabled={busy}
                  onChange={(e) => setSetting(e.target.value as Setting)}
                >
                  <option value="academic">Academic</option>
                  <option value="work">Work</option>
                </select>
              </label>
              <div className="tone-control">
                <span className="field-label">Tone</span>
                <div className="segmented" role="group" aria-label="Tone">
                  {(["formal", "warm", "concise"] as Tone[]).map((t) => (
                    <button
                      key={t}
                      disabled={busy}
                      aria-pressed={tone === t}
                      className={tone === t ? "active" : ""}
                      onClick={() => setTone(t)}
                    >
                      {t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="name-fields">
              <label htmlFor="recipient-name">
                <span>Para:</span>
                <input
                  id="recipient-name"
                  value={recipientName}
                  maxLength={100}
                  disabled={busy}
                  placeholder="Nombre del destinatario"
                  list="recipient-names"
                  onChange={(e) => {
                    const value = e.target.value;
                    setRecipientName(value);
                    const matches = recipients.filter(
                      (item) =>
                        item.name &&
                        item.name.toLocaleLowerCase() ===
                          value.trim().toLocaleLowerCase(),
                    );
                    if (matches.length === 1) setTo(matches[0].email);
                  }}
                />
              </label>
              <datalist id="recipient-names">
                {recipients
                  .filter((item) => item.name)
                  .map((item) => (
                    <option key={item.email} value={item.name}>
                      {item.email}
                    </option>
                  ))}
              </datalist>
            </div>
            <div className="panes">
              <section className="card draft-card">
                <div className="card-head">
                  <h2>
                    <PenLine size={15} /> Your draft
                  </h2>
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() => setDraft(EXAMPLE)}
                  >
                    Try an example <ArrowUpRight size={12} />
                  </button>
                </div>
                <textarea
                  aria-label="Your draft"
                  value={draft}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void run();
                    }
                  }}
                  placeholder={
                    "Start with what you want to say.\n\nDon’t worry about the wording — we’ll take care of that."
                  }
                  spellCheck
                />
                <div className="card-foot">
                  <span className="hint">{draft.length} characters</span>
                  {busy ? (
                    <button
                      className="btn secondary"
                      onClick={() => abortRef.current?.abort()}
                    >
                      Stop generation
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={!draft.trim() || status !== "ready"}
                      onClick={() => run()}
                    >
                      <Sparkles size={14} /> Polish email{" "}
                      <span className="key-hint">Ctrl ↵</span>
                    </button>
                  )}
                </div>
              </section>
              <section className="card result-card">
                <div className="card-head">
                  <h2>
                    <Sparkles size={15} /> Polished version{" "}
                    <span className="result-indicator">
                      {busy ? "WRITING" : complete ? "READY" : "OUTPUT"}
                    </span>
                  </h2>
                  {complete && !busy && (
                    <button
                      className="link"
                      onClick={() =>
                        copy(`Subject: ${subject}\n\n${body}`, "Email")
                      }
                    >
                      <Copy size={13} /> Copy email
                    </button>
                  )}
                </div>
                {busy || body ? (
                  <>
                    <div className="subject-edit">
                      <label htmlFor="subject">SUBJECT</label>
                      <input
                        id="subject"
                        value={subject}
                        disabled={busy}
                        onChange={(e) => {
                          setSubject(e.target.value);
                          setFeedbackReady(false);
                          setFbState("idle");
                        }}
                        placeholder="Subject line"
                      />
                      <button
                        className="link"
                        disabled={busy || !subject}
                        onClick={() => copy(subject, "Subject")}
                      >
                        Copy
                      </button>
                    </div>
                    <textarea
                      className="result-text"
                      aria-label="Polished email body"
                      value={body}
                      disabled={busy}
                      onChange={(e) => {
                        setBody(e.target.value);
                        setFeedbackReady(false);
                        setFbState("idle");
                      }}
                      placeholder="Writing your email…"
                    />
                    {busy && (
                      <p className="generation-status" role="status">
                        Polishing locally… The first run may take a minute.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="empty-output">
                    <div className="empty-illustration" aria-hidden="true">
                      <div className="paper-back" />
                      <div className="paper-front">
                        <MailCheck size={27} strokeWidth={1.2} />
                        <span />
                        <span />
                        <span />
                      </div>
                      <span className="empty-spark">
                        <Sparkles size={15} />
                      </span>
                    </div>
                    <h3>A little polish. A lot more clarity.</h3>
                    <p>
                      Your refined email will appear here.
                      <br />
                      Same meaning, better delivery.
                    </p>
                  </div>
                )}
                {!complete && !busy && (
                  <div className="output-foot">
                    <ShieldCheck size={13} /> Your words stay on your device
                  </div>
                )}
                {complete && !busy && (
                  <div className="refine">
                    <span className="field-label">Make it</span>
                    {(["Shorter", "Warmer", "More direct"] as const).map(
                      (label) => (
                        <button
                          className="chip"
                          key={label}
                          disabled={status !== "ready"}
                          onClick={() => run(label)}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </section>
            </div>
            {complete && !busy && (
              <section
                className="inline-send"
                aria-label="Open polished email in Gmail"
              >
                <div className="inline-send-title">
                  <Send size={15} />
                  <h3>Want to mail it?</h3>
                </div>
                <div className="gmail-compose-actions">
                  <label className="sr-only" htmlFor="recipient">
                    Recipient (optional)
                  </label>
                  <input
                    id="recipient"
                    className="recipient-input"
                    type="text"
                    autoComplete="off"
                    list="recent-recipients"
                    placeholder="Recipient email (optional)"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                  <datalist id="recent-recipients">
                    {recipients.map((recipient) => (
                      <option key={recipient.email} value={recipient.email}>
                        {recipient.name || recipient.email}
                      </option>
                    ))}
                  </datalist>
                  {gmailLink.url ? (
                    <a
                      className="btn primary"
                      href={gmailLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={openGmail}
                    >
                      <Mail size={14} /> Open in Gmail{" "}
                      <ArrowUpRight size={13} />
                    </a>
                  ) : (
                    <button className="btn primary" disabled>
                      <Mail size={14} /> Open in Gmail
                    </button>
                  )}
                </div>
                {recipients.length > 0 && (
                  <div className="recent-recipients">
                    <span className="field-label">Recent</span>
                    {recipients.map((recipient) => (
                      <span
                        className="recipient-shortcut"
                        key={recipient.email}
                      >
                        <button
                          type="button"
                          title={recipient.email}
                          onClick={() => {
                            setTo(recipient.email);
                            setRecipientName(recipient.name);
                          }}
                        >
                          {recipient.name || recipient.email}
                        </button>
                        <button
                          className="remove-recipient"
                          type="button"
                          aria-label={"Forget " + recipient.email}
                          onClick={() =>
                            setRecipients((items) =>
                              items.filter(
                                (item) => item.email !== recipient.email,
                              ),
                            )
                          }
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <button className="link" onClick={() => setRecipients([])}>
                      Clear recipients
                    </button>
                  </div>
                )}
                <p className="hint gmail-compose-hint">
                  {gmailLink.error ||
                    "Subject and message are filled in. Choose a contact and send in Gmail."}
                </p>
                {recipients.length > 0 && (
                  <p className="hint recipient-note">
                    Saved on this device when you open a Gmail draft.
                  </p>
                )}
                {recipientStorageError && (
                  <p className="warning">{recipientStorageError}</p>
                )}
              </section>
            )}

            {complete && !busy && (
              <>
                <section className="review-tools">
                  <div className="section-title">
                    <h2>
                      <ShieldCheck size={15} /> Review the details
                    </h2>
                    <button
                      className="link"
                      aria-expanded={showDiff}
                      onClick={() => setShowDiff((x) => !x)}
                    >
                      {showDiff ? "Hide changes" : "Show highlighted changes"}
                    </button>
                  </div>
                  <p className="hint">
                    Check names, dates, amounts and links before sending.
                    Automatic checks are approximate.
                  </p>
                  {(recipientName.trim() !== generatedNames.recipient ||
                    senderName.trim() !== generatedNames.sender) && (
                    <p className="warning">
                      Cambiaste el destinatario o la firma. Vuelve a pulir para
                      aplicar los nuevos nombres al correo.
                    </p>
                  )}
                  {draft !== source && (
                    <p className="warning">
                      Your draft has changed since this result. Polish it again
                      to include those edits.
                    </p>
                  )}
                  {warnings.length > 0 && (
                    <ul className="warnings">
                      {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {showDiff && (
                    <div className="diff">
                      <p className="hint">
                        Original draft → current body · <ins>added</ins> /{" "}
                        <del>removed</del>
                      </p>
                      {changes.map((part, i) =>
                        part.type === "added" ? (
                          <ins key={i}>{part.text}</ins>
                        ) : part.type === "removed" ? (
                          <del key={i}>{part.text}</del>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </div>
                  )}
                </section>
                {feedbackReady && (
                  <section
                    className="feedback"
                    id="response-feedback"
                    aria-label="Feedback del correo"
                  >
                    <div className="fb-row">
                      <strong>¿Qué te pareció el correo?</strong>
                      <div
                        className="rating"
                        role="group"
                        aria-label="Rate the response from 1 to 5"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            disabled={fbState === "sending"}
                            className={rating === n ? "on" : ""}
                            aria-label={`${n} out of 5`}
                            aria-pressed={rating === n}
                            onClick={() => {
                              setRating(n);
                              setFbState("idle");
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <span className="hint">1 Poor · 5 Excellent</span>
                    </div>
                    <div className="feedback-form" hidden={!rating}>
                      <label className="sr-only" htmlFor="feedback">
                        Optional feedback
                      </label>
                      <textarea
                        id="feedback"
                        className="fb-text"
                        value={comment}
                        disabled={fbState === "sending"}
                        onChange={(e) => {
                          setComment(e.target.value);
                          setFbState("idle");
                        }}
                        placeholder="What worked? What could be better? (optional)"
                        rows={2}
                      />
                      <div className="fb-row">
                        <button
                          className="btn secondary"
                          disabled={
                            !rating ||
                            fbState === "sending" ||
                            fbState === "sent"
                          }
                          onClick={sendFeedback}
                        >
                          {fbState === "sent"
                            ? "Feedback saved ✓"
                            : fbState === "sending"
                              ? "Saving…"
                              : "Save feedback"}
                        </button>
                        {fbState === "error" && (
                          <span className="error">
                            Could not save feedback. Try again with the app
                            server running.
                          </span>
                        )}
                        <span className="hint">
                          Saved locally with this draft and result.
                        </span>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
          <aside
            className="sidebar"
            id="workspace-panel"
            aria-label="Email history"
            hidden={!panel}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPanel(null);
            }}
          >
            <div className="panel-heading">
              <span>
                <History size={16} /> Your history
              </span>
              <button
                className="icon-button"
                aria-label="Close panel"

                onClick={() => setPanel(null)}
              >
                <X size={17} />
              </button>
            </div>
            <section className="history-panel" hidden={panel !== "history"}>
              <div className="section-title">
                <h2>Recent emails</h2>
                <span className="badge">{history.length}/20</span>
              </div>
              <label className="history-toggle">
                <input
                  type="checkbox"
                  checked={historyEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setHistoryEnabled(enabled);
                    try {
                      localStorage.setItem(
                        "mail-polish-save-history",
                        String(enabled),
                      );
                    } catch {
                      setHistoryError("History preference could not be saved.");
                    }
                  }}
                />
                Save history on this device
              </label>
              <p className="hint">
                Stored in this browser. Feedback is stored in the project's data
                folder.
              </p>
              {historyError && <p className="error">{historyError}</p>}
              {!history.length && (
                <p className="history-empty">
                  Your next polished email will appear here.
                </p>
              )}
              <div className="history-list">
                {history.map((entry) => (
                  <div className="history-entry" key={entry.id}>
                    <button disabled={busy} onClick={() => restore(entry)}>
                      <strong>{entry.subject || "Untitled email"}</strong>
                      <span>
                        {new Date(entry.date).toLocaleDateString()} ·{" "}
                        {entry.setting}
                      </span>
                    </button>
                    <button
                      className="delete-entry"
                      aria-label={`Delete ${entry.subject || "email"}`}
                      onClick={() =>
                        setHistory((items) =>
                          items.filter((x) => x.id !== entry.id),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {history.length > 0 && (
                <button
                  className="link clear-history"
                  onClick={() => setHistory([])}
                >
                  Clear history
                </button>
              )}
              {complete && !busy && historyEnabled && (
                <button
                  className="link save-current"

                  onClick={() => {
                    saveEntry({
                      id: crypto.randomUUID(),
                      date: new Date().toISOString(),
                      draft: source,
                      recipientName: generatedNames.recipient,
                      senderName: generatedNames.sender,
                      recipientEmail: to,
                      subject,
                      body,
                      setting,
                      tone,
                    });
                    setNotice("Current edits saved to history.");
                  }}
                >
                  <Save size={13} /> Save current edits
                </button>
              )}
            </section>
          </aside>
        </div>
        <footer>
          <span>
            <ShieldCheck size={13} /> Thoughtful emails. Private by design.
          </span>
          <span>
            On-device AI <span className="footer-dot">·</span> {MODEL}
          </span>
        </footer>
      </main>
    </div>
  );
}
