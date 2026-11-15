import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  CornerDownLeft,
  Hand,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import golden from "../../evals/retrieval_golden.json";
import { createEngine, verifyQuote } from "./playground-engine.mjs";
import { AUTO_REPLY_MIN_CONFIDENCE, samples } from "./playground-samples.mjs";

const STEP_DELAY = 520;
const TYPE_DELAY = 28;
const AUTOPLAY_PAUSE = 3600;
const EMPTY_RUN = { steps: [], outcome: null };

// Turn one email into the list of checks the playground reveals one by one.
function buildRun(engine, text) {
  const result = engine.analyze(text);
  const sample = samples.find((item) => item.text === text);
  const steps = [];
  if (result.risk) {
    steps.push({ key: "safety", icon: ShieldCheck, name: "Safety check", state: "stop", detail: result.risk });
    return { steps, outcome: "handover", reason: "Sensitive requests always go to a person. No AI answer is attempted." };
  }
  steps.push({ key: "safety", icon: ShieldCheck, name: "Safety check", state: "pass", detail: "Nothing sensitive. Carry on." });
  if (!result.matches.length) {
    steps.push({ key: "search", icon: Search, name: "Search your documents", state: "stop", detail: `Searched ${result.searched} passages. Nothing is about this.` });
    return { steps, outcome: "handover", reason: "With nothing to quote, the AI does not answer. The email waits for you." };
  }
  steps.push({ key: "search", icon: Search, name: "Search your documents", state: "pass", detail: `Ranked ${result.searched} passages in ${result.documents} documents. Best matches:`, matches: result.matches });
  if (!sample) return { steps, outcome: "open" };
  const source = sample.quote ? verifyQuote(result.matches, sample.quote) : null;
  if (!source) {
    steps.push({ key: "quote", icon: Quote, name: "Quote a source", state: "stop", detail: sample.reason || "No passage answers this word for word." });
    steps.push({ key: "gate", icon: Sparkles, name: "Confidence", state: "stop", detail: `${sample.confidence.toFixed(2)} is below the ${AUTO_REPLY_MIN_CONFIDENCE.toFixed(2)} needed to reply.` });
    return { steps, outcome: "handover", reason: "The email is set aside for you, with the reason attached." };
  }
  steps.push({ key: "quote", icon: Quote, name: "Quote a source", state: "pass", detail: `Found word for word in ${source.title}, section ${source.section}.`, quote: sample.quote });
  steps.push({ key: "gate", icon: Sparkles, name: "Confidence", state: "pass", detail: `${sample.confidence.toFixed(2)} clears the ${AUTO_REPLY_MIN_CONFIDENCE.toFixed(2)} needed to reply.` });
  return { steps, outcome: "reply", reply: sample.quote, source };
}

export default function AiPlayground() {
  const engine = useMemo(() => createEngine(golden.documents), []);
  const reduce = useReducedMotion();
  const [text, setText] = useState(samples[0].text);
  const [asked, setAsked] = useState(samples[0].text);
  const [run, setRun] = useState(() => buildRun(engine, samples[0].text));
  const [shown, setShown] = useState(reduce ? 99 : 0);
  // Until the visitor touches it, the playground types and runs the samples by itself.
  const [auto, setAuto] = useState(!reduce);
  const [typing, setTyping] = useState(null);
  const sampleIndex = useRef(0);
  // Autoplay only runs while the console is on screen, so nothing moves once the visitor scrolls past it.
  const root = useRef(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const done = Boolean(run.outcome) && shown > run.steps.length;

  // Reveal the checks one at a time, then the outcome.
  useEffect(() => {
    if (!run.outcome || shown > run.steps.length) return undefined;
    if (reduce) {
      setShown(99);
      return undefined;
    }
    const timer = setTimeout(() => setShown((count) => count + 1), shown === 0 ? 250 : STEP_DELAY);
    return () => clearTimeout(timer);
  }, [shown, run, reduce]);

  // Autoplay: after a finished run, type the next sample.
  useEffect(() => {
    if (!auto || !onScreen || !done || typing) return undefined;
    const timer = setTimeout(() => {
      sampleIndex.current = (sampleIndex.current + 1) % samples.length;
      setRun(EMPTY_RUN);
      setShown(0);
      setText("");
      setTyping({ target: samples[sampleIndex.current].text, length: 0 });
    }, AUTOPLAY_PAUSE);
    return () => clearTimeout(timer);
  }, [auto, onScreen, done, typing]);

  useEffect(() => {
    if (!typing || !onScreen) return undefined;
    const timer = setTimeout(() => {
      if (typing.length >= typing.target.length) {
        setTyping(null);
        start(typing.target);
        return;
      }
      setText(typing.target.slice(0, typing.length + 1));
      setTyping({ ...typing, length: typing.length + 1 });
    }, typing.length >= typing.target.length ? 380 : TYPE_DELAY);
    return () => clearTimeout(timer);
  }, [typing, onScreen]);

  function start(question) {
    setText(question);
    setAsked(question);
    setRun(buildRun(engine, question));
    setShown(reduce ? 99 : 0);
  }
  const takeOver = () => {
    setAuto(false);
    setTyping(null);
  };
  const ask = (value) => {
    takeOver();
    const question = value.trim();
    if (question) start(question);
  };

  return (
    <div className={`playground${typing ? " is-typing" : ""}`} id="playground" ref={root}>
      <div className="playground-bar mono">
        <span className="playground-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>OPENMAIL AI / LIVE IN YOUR BROWSER</span>
        <span className="playground-mode">
          <span className="tiny-dot" /> {auto ? "PLAYING SAMPLES" : "YOUR TURN"}
        </span>
      </div>
      <div className="playground-body">
        <div className="playground-left">
          <form
            className="playground-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask(text);
            }}
          >
            <label htmlFor="playground-input">A customer emails support@northline.example</label>
            <div className="playground-input">
              <input
                id="playground-input"
                value={text}
                maxLength={200}
                autoComplete="off"
                placeholder="Type a customer question"
                onFocus={takeOver}
                onChange={(event) => {
                  takeOver();
                  setText(event.target.value);
                }}
              />
              <button type="submit" aria-label="Run the AI checks on this email">
                Ask <CornerDownLeft size={14} />
              </button>
            </div>
            <div className="playground-samples" role="group" aria-label="Sample emails">
              {samples.map((sample) => (
                <button
                  type="button"
                  key={sample.label}
                  aria-pressed={asked === sample.text && !typing}
                  onClick={() => ask(sample.text)}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </form>
          <div className="playground-result" aria-live="polite">
            {!done && (
              <div className="playground-outcome is-waiting">
                <p className="mono">
                  <span className="playground-spinner" aria-hidden="true" />{" "}
                  {typing ? "A NEW EMAIL IS ARRIVING" : "CHECKING THE EMAIL"}
                </p>
                <p>Every check has to pass before anything is sent.</p>
              </div>
            )}
            {done && run.outcome === "reply" && (
              <div className="playground-outcome is-reply">
                <p className="mono">
                  <Check size={13} /> REPLY SENT AUTOMATICALLY
                </p>
                <p>
                  Thanks for reaching out. {run.reply} Please reply if you have another question.
                </p>
                <small>
                  Built only from the checked quote. Source: {run.source.title}, section {run.source.section}.
                </small>
              </div>
            )}
            {done && run.outcome === "handover" && (
              <div className="playground-outcome is-handover">
                <p className="mono">
                  <Hand size={13} /> HELD FOR YOU
                </p>
                <p>{run.reason}</p>
              </div>
            )}
            {done && run.outcome === "open" && (
              <div className="playground-outcome is-open">
                <p className="mono">
                  <Sparkles size={13} /> NEXT: THE AI READS THESE PASSAGES
                </p>
                <p>
                  It may only answer by quoting them word for word. If it cannot, the email waits for you. Pick
                  a sample to watch a full answer.
                </p>
                <a href="/app.html">
                  Use your own documents <ArrowUpRight size={14} />
                </a>
              </div>
            )}
          </div>
          <p className="playground-note">
            The safety check, search and quote check run live on what you type. The AI's answer is shown for
            the sample emails only. No email is sent.
          </p>
        </div>
        <ol className="playground-steps" aria-live="polite">
          {run.steps.slice(0, shown).map(({ key, icon: Icon, name, state, detail, matches, quote }) => (
            <li key={`${asked}-${key}`} className={`is-${state}`}>
              <span className="playground-step-icon" aria-hidden="true">
                <Icon size={15} />
              </span>
              <div>
                <p className="playground-step-name">
                  {name}
                  <b className="mono">{state === "pass" ? "PASSED" : "STOPPED"}</b>
                </p>
                <p className="playground-step-detail">{detail}</p>
                {matches && (
                  <ul className="playground-matches">
                    {matches.map((match) => (
                      <li key={`${match.title}-${match.section}`}>
                        <span>
                          {match.title} <em>§{match.section}</em>
                        </span>
                        <i>
                          <i style={{ width: `${Math.round(match.relative * 100)}%` }} />
                        </i>
                      </li>
                    ))}
                  </ul>
                )}
                {quote && <blockquote>“{quote}”</blockquote>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
