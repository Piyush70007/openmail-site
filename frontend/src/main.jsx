import React, { Component, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  CodeXml,
  Inbox,
  Mail,
  Menu,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import ProductDemo from "./ProductDemo.jsx";
import "./landing.css";

const stages = [
  {
    title: "It starts with your address.",
    short: "Receive",
    text: "A customer writes to your domain. Their message arrives in the right mailbox, ready for you or your representative.",
    icon: Inbox,
  },
  {
    title: "Context before a response.",
    short: "Understand",
    text: "Company facts, FAQs and extracted document text give your representative something concrete to work with.",
    icon: BookOpen,
  },
  {
    title: "An answer with a source.",
    short: "Respond",
    text: "Routine questions can get a source-backed reply when you enable automation. You can also keep responses as editable drafts.",
    icon: Sparkles,
  },
  {
    title: "Knowing when to step back.",
    short: "Hand over",
    text: "Sensitive requests and questions without supporting knowledge come back to a person. Every handover stays visible.",
    icon: ShieldCheck,
  },
];

function Brand({ footer = false }) {
  return (
    <a
      className={`om-brand ${footer ? "om-brand-footer" : ""}`}
      href="#top"
      aria-label="OpenMail home"
    >
      <img src="/favicon.svg" alt="" width="32" height="32" />
      <span>
        openmail<span>.</span>
      </span>
    </a>
  );
}

function Reveal({ children, className = "" }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function SignalVisual({ paused }) {
  return (
    <div
      className={`signal-visual ${paused ? "motion-paused" : ""}`}
      aria-label="Illustration of an incoming message becoming a source-backed reply"
    >
      <div className="signal-grid" aria-hidden="true" />
      <div className="signal-coordinate mono">MESSAGE PATH / ILLUSTRATION</div>
      <svg
        className="signal-orbit"
        viewBox="0 0 600 590"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="orbGlow">
            <stop stopColor="#8fe8d6" stopOpacity=".14" />
            <stop offset="1" stopColor="#8fe8d6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="orbitStroke">
            <stop stopColor="#a5e8d8" stopOpacity=".05" />
            <stop offset=".52" stopColor="#a5e8d8" stopOpacity=".55" />
            <stop offset="1" stopColor="#a5e8d8" stopOpacity=".05" />
          </linearGradient>
        </defs>
        <circle cx="300" cy="270" r="250" fill="url(#orbGlow)" />
        <g className="orbital-lines" stroke="url(#orbitStroke)">
          <ellipse
            cx="300"
            cy="270"
            rx="246"
            ry="115"
            transform="rotate(-32 300 270)"
          />
          <ellipse
            cx="300"
            cy="270"
            rx="246"
            ry="115"
            transform="rotate(32 300 270)"
          />
          <ellipse
            cx="300"
            cy="270"
            rx="246"
            ry="115"
            transform="rotate(90 300 270)"
          />
          <circle cx="300" cy="270" r="185" strokeDasharray="2 8" />
        </g>
        <path
          id="orbitPath"
          d="M 87,393 A 246,115 -32 1,1 513,147 A 246,115 -32 1,1 87,393"
          stroke="none"
        />
        <g className="orbit-particle">
          <circle cx="0" cy="0" r="4" fill="#c1ffed" />
        </g>
        <path
          d="M300 44V496M68 270H533"
          stroke="#a5e8d8"
          strokeOpacity=".06"
          strokeDasharray="3 7"
        />
        <g stroke="#9ecfc4" strokeOpacity=".5">
          <path d="M98 80v12m-6-6h12M504 427v12m-6-6h12" />
        </g>
      </svg>
      <div className="signal-card signal-incoming">
        <span className="signal-icon">
          <Mail size={17} />
        </span>
        <div>
          <span className="mono">INCOMING / SUPPORT</span>
          <b>“What’s included in the setup?”</b>
        </div>
        <span className="tiny-dot" />
      </div>
      <div className="signal-core">
        <div className="core-plane plane-back" />
        <div className="core-plane plane-middle" />
        <div className="core-plane plane-front">
          <img src="/favicon.svg" width="66" height="66" alt="" />
          <span className="mono">OPENMAIL / AI</span>
        </div>
      </div>
      <div className="signal-card signal-knowledge">
        <FileText size={16} />
        <div>
          <span className="mono">KNOWLEDGE MATCH</span>
          <b>Service guide · section 02</b>
        </div>
        <Check size={14} />
      </div>
      <div className="signal-card signal-answer">
        <div className="answer-top">
          <Sparkles size={16} />
          <span className="mono">SOURCE-BACKED REPLY</span>
          <span className="signal-tag">READY</span>
        </div>
        <p>
          “Setup includes a discovery call,
          <br />
          configuration and a handover guide.”
        </p>
        <div className="answer-rule">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="signal-bottom mono">
        <span>
          <i className="tiny-dot" /> CONTEXT → RESPONSE
        </span>
        <span>HUMAN CONTROL / ALWAYS</span>
      </div>
    </div>
  );
}

function JourneyPanel({ step, onStep }) {
  const Icon = stages[step].icon;
  return (
    <div className="journey-panel">
      <div className="panel-ruler mono">
        <span>FOLLOW ONE MESSAGE</span>
        <span>0{step + 1} / 04</span>
      </div>
      <div className="journey-rail" aria-label="Message journey stages">
        {stages.map((stage, i) => (
          <React.Fragment key={stage.short}>
            <button
              type="button"
              onClick={() => onStep(i)}
              aria-label={`Show stage ${i + 1}: ${stage.short}`}
              aria-pressed={i === step}
              className={i <= step ? "lit" : ""}
            >
              <stage.icon size={17} />
            </button>
            {i < 3 && (
              <i className={i < step ? "lit" : ""} aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="journey-scene"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          <div className="scene-title">
            <Icon size={19} />
            <span>{stages[step].short}</span>
            <span className="mono">SAMPLE SCENARIO</span>
          </div>
          {step === 0 && (
            <>
              <div className="scene-address mono">
                TO / SUPPORT@NORTHLINE.EXAMPLE
              </div>
              <div className="scene-email">
                <span className="person-avatar">AC</span>
                <div>
                  <b>Alex Chen</b>
                  <span>New project enquiry</span>
                </div>
                <span className="mono">JUST NOW</span>
              </div>
              <h3>
                A quick question
                <br />
                before we begin.
              </h3>
              <p>Hi Northline, what’s included in your project setup?</p>
              <div className="scene-foot">
                <span className="tiny-dot" /> Delivered to Support inbox
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h3>
                Good answers start
                <br />
                with what you know.
              </h3>
              <div className="knowledge-stack">
                <div>
                  <FileText size={20} />
                  <span>
                    Service guide.pdf<small>Extracted document text</small>
                  </span>
                  <Check size={15} />
                </div>
                <div>
                  <BookOpen size={20} />
                  <span>
                    Company profile<small>Services, tone and boundaries</small>
                  </span>
                  <Check size={15} />
                </div>
                <div>
                  <FileText size={20} />
                  <span>
                    Frequently asked questions
                    <small>Approved knowledge note</small>
                  </span>
                  <Check size={15} />
                </div>
              </div>
              <div className="source-quote">
                “Setup includes a discovery call, configuration and a handover
                guide.”<span className="mono">SERVICE GUIDE / SECTION 02</span>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <span className="scene-badge">
                <Sparkles size={13} /> Reply with supporting evidence
              </span>
              <h3>
                Useful. Specific.
                <br />
                Grounded in your words.
              </h3>
              <div className="reply-paper">
                <p>
                  Thanks for reaching out. Setup includes a discovery call,
                  configuration and a handover guide.
                </p>
                <p>Please reply if you have another question.</p>
                <span className="mono">
                  <FileText size={13} /> SERVICE GUIDE · SECTION 02
                </span>
              </div>
              <div className="scene-foot">
                <Check size={14} /> Automatic replies require mailbox opt-in
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <span className="scene-badge amber">
                <Users size={13} /> Human review
              </span>
              <h3>
                Some decisions
                <br />
                belong to you.
              </h3>
              <div className="review-request">
                “Can you approve a refund and change our billing details?”
              </div>
              <div className="review-reason">
                <ShieldCheck size={20} />
                <div>
                  <b>A sensitive financial request.</b>
                  <p>
                    The representative hands it over for human review. No
                    automatic reply is sent.
                  </p>
                </div>
              </div>
              <div className="scene-foot amber">
                <span className="tiny-dot" /> Waiting for a person
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="journey-panel-bottom mono">
        <span>FICTIONAL COMPANY / ILLUSTRATIVE FLOW</span>
        <span>OM—02</span>
      </div>
    </div>
  );
}

function Journey() {
  const ref = useRef(null);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 20%", "end 85%"],
  });
  useMotionValueEvent(scrollYProgress, "change", (value) =>
    setStep(Math.min(3, Math.floor(Math.max(0, value) * 4))),
  );
  return (
    <section
      className="journey-section section-space"
      id="how-it-works"
      aria-labelledby="journey-title"
    >
      <Reveal className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="tiny-dot" /> 01 / THE MESSAGE JOURNEY
          </p>
          <h2 id="journey-title">
            A little more intelligence.
            <br />
            <span>A lot more space.</span>
          </h2>
        </div>
        <p>
          From the first hello to the next step.
          <br />
          See what happens behind your inbox.
        </p>
      </Reveal>
      <div className="journey-layout" ref={ref}>
        <div className="journey-steps">
          {stages.map((stage, i) => (
            <article
              key={stage.short}
              className={`journey-step ${i === step ? "current" : ""}`}
            >
              <div className="step-number mono">
                0{i + 1} <span>{stage.short}</span>
              </div>
              <h3>{stage.title}</h3>
              <p>{stage.text}</p>
              <span className="step-mark" aria-hidden="true">
                <stage.icon size={22} />
              </span>
            </article>
          ))}
        </div>
        <div className="journey-sticky">
          <JourneyPanel step={step} onStep={setStep} />
        </div>
      </div>
    </section>
  );
}

function SystemSection() {
  return (
    <section
      className="system-section section-space"
      id="system"
      aria-labelledby="system-title"
    >
      <Reveal className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="tiny-dot" /> 03 / BUILT TO WORK TOGETHER
          </p>
          <h2 id="system-title">
            One inbox.
            <br />
            <span>A considered system.</span>
          </h2>
        </div>
        <p>
          Five connected tools around your mail.
          <br />
          Each with a clear role. Each under your control.
        </p>
      </Reveal>
      <div className="capability-grid">
        <Reveal className="capability capability-main">
          <div className="panel-ruler mono">
            <span>01 / REPRESENTATIVES</span>
            <Users size={16} />
          </div>
          <h3>
            The right context.
            <br />
            For the right conversation.
          </h3>
          <p>
            Separate support, sales, billing and careers. Give each role
            relevant knowledge and decide where it can help.
          </p>
          <div className="role-network">
            <div className="role-core">
              <img src="/favicon.svg" alt="" width="38" height="38" />
            </div>
            {["Support", "Sales", "Billing", "Careers"].map((role, i) => (
              <span className={`role-pill role-${i}`} key={role}>
                <i className="tiny-dot" />
                {role}
              </span>
            ))}
          </div>
          <span className="mono capability-bottom">
            FOUR ROLES / SHARED OVERSIGHT
          </span>
        </Reveal>
        <Reveal className="capability">
          <div className="panel-ruler mono">
            <span>02 / KNOWLEDGE</span>
            <BookOpen size={16} />
          </div>
          <h3>
            Your business.
            <br />
            In its own words.
          </h3>
          <p>
            Add company facts, notes and document text. Replies can point back
            to the sources you supplied.
          </p>
          <div className="file-types mono">
            {["PDF", "DOCX", "TXT", "MD", "CSV"].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <span className="mono capability-bottom">
            TEXT EXTRACTION / NO MODEL TRAINING
          </span>
        </Reveal>
        <Reveal className="capability">
          <div className="panel-ruler mono">
            <span>03 / TRAINING SIMULATOR</span>
            <Sparkles size={16} />
          </div>
          <h3>
            Ask the difficult
            <br />
            questions first.
          </h3>
          <p>
            Try sample emails, inspect source quotes and review confidence
            before you turn on automatic replies.
          </p>
          <div className="test-lines">
            <span>
              <i />
              Routine enquiry<b>REPLY</b>
            </span>
            <span>
              <i />
              Unsupported request<b>REVIEW</b>
            </span>
          </div>
          <span className="mono capability-bottom">
            EVALUATION / NO EMAIL SENT
          </span>
        </Reveal>
        <Reveal className="capability capability-workflow">
          <div className="panel-ruler mono">
            <span>04 / WORKFLOWS</span>
            <GitBranch size={16} />
          </div>
          <h3>A path for the repeatable parts.</h3>
          <p>
            Set mail rules to route, prepare a draft, send a verified reply or
            request human review.
          </p>
          <div className="workflow-mini">
            <span>
              <Mail size={17} />
              Message
            </span>
            <ArrowRight size={15} />
            <span>
              <GitBranch size={17} />
              Your rule
            </span>
            <ArrowRight size={15} />
            <span>
              <ShieldCheck size={17} />
              Approved action
            </span>
          </div>
          <span className="mono capability-bottom">BUILT-IN MAIL ACTIONS</span>
        </Reveal>
        <Reveal className="capability capability-trust">
          <div className="panel-ruler mono">
            <span>05 / TRUST DASHBOARD</span>
            <ShieldCheck size={16} />
          </div>
          <h3>
            See what happened.
            <br />
            Make the next answer better.
          </h3>
          <p>
            Review replies and handovers. Record corrections, resolutions and
            feedback in one place.
          </p>
          <div className="trust-visual" aria-hidden="true">
            {[26, 42, 36, 60, 48, 72, 66, 85, 77, 94, 83, 99].map((x, i) => (
              <i key={i} style={{ height: `${x}%` }} />
            ))}
          </div>
          <span className="mono capability-bottom">
            VISIBLE DECISIONS / OWNER FEEDBACK
          </span>
        </Reveal>
      </div>
    </section>
  );
}

const faqs = [
  [
    "Do I need my own domain?",
    "Yes. Connect a domain you control and verify its email DNS records before creating addresses. Changing MX records can move incoming mail away from an existing provider, so a separate subdomain is a good way to try OpenMail first.",
  ],
  [
    "Will the AI send email without me?",
    "Only when you explicitly enable automatic replies for a mailbox. Eligible incoming mail is processed on the server, even with the browser closed. Source checks, sensitive-request rules, quotas and sender cooldowns still apply. You can keep automation off and work with editable drafts instead.",
  ],
  [
    "What data goes to the AI provider?",
    "For enabled AI processing, relevant email text and saved company knowledge are sent to the configured provider, currently Groq. Document text is extracted in the browser; original document files are not uploaded by that feature. Do not add information you do not want processed.",
  ],
  [
    "Is the preview connected to my account?",
    "No. The interactive preview uses fictional Northline Studio messages and fixed illustrative AI results. It sends no email, calls no AI model and does not read your mailbox. Open the mailbox app to use your real account.",
  ],
  [
    "Is OpenMail unlimited or fully self-hosted?",
    "No. The current hosted service relies on email, database and AI providers, and their usage limits apply. The application source is on GitHub. Running your own deployment still requires configured services and a verified domain.",
  ],
  [
    "What should I know before using it?",
    "AI can make mistakes. Confidence is a model signal, not a guarantee. Review your knowledge, test representative scenarios and check the trust dashboard. External business-tool integrations and email attachment sending are not available in the current app.",
  ],
];

class PreviewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="preview-fallback">
        <h3>The preview couldn’t load.</h3>
        <p>Your real mailbox is still available.</p>
        <a className="om-button solid" href="/app.html">
          Open mailbox <ArrowUpRight size={16} />
        </a>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Landing() {
  const [menu, setMenu] = useState(false);
  const menuButton = useRef(null);
  const [signedIn, setSignedIn] = useState(false);
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const { scrollYProgress } = useScroll();
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);
  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menu]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSignedIn(data?.signedIn === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const appLabel = signedIn ? "Open your mailbox" : "Open mailbox";
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <motion.div
        className="reading-progress"
        style={{ scaleX }}
        aria-hidden="true"
      />
      <header className="om-header" id="top">
        <Brand />
        <nav
          id="primary-navigation"
          className={menu ? "om-nav is-open" : "om-nav"}
          aria-label="Main navigation"
        >
          <a href="#how-it-works" onClick={() => setMenu(false)}>
            How it works
          </a>
          <a href="#preview" onClick={() => setMenu(false)}>
            Explore the app
          </a>
          <a href="#system" onClick={() => setMenu(false)}>
            The system
          </a>
          <a
            href="https://github.com/Piyush70007/openmail-site"
            target="_blank"
            rel="noreferrer"
            aria-label="OpenMail source on GitHub"
          >
            <CodeXml size={16} />
            <span className="mobile-git-label">Source code</span>
          </a>
        </nav>
        <a className="header-cta" href="/app.html">
          {appLabel}
          <ArrowUpRight size={16} />
        </a>
        <button
          className="nav-toggle"
          ref={menuButton}
          aria-controls="primary-navigation"
          aria-label={menu ? "Close navigation" : "Open navigation"}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
      </header>
      <main id="main">
        <section className="hero-shell" aria-labelledby="hero-title">
          <div className="hero-main">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="tiny-dot" /> CUSTOM-DOMAIN EMAIL. CONSIDERED
                AI.
              </p>
              <h1 id="hero-title">
                Your inbox,
                <br />
                with a mind
                <br />
                <span>of its own.</span>
              </h1>
              <p className="hero-description">
                Your address. Your knowledge. A representative that handles the
                routine—and knows when to hand over.
              </p>
              <div className="hero-actions">
                <a className="om-button solid" href="/app.html">
                  {signedIn
                    ? "Back to your mailbox"
                    : "Make room for better mail"}
                  <ArrowUpRight size={18} />
                </a>
                <a className="om-button text-button" href="#preview">
                  Take a look inside
                  <ArrowDownRight size={17} />
                </a>
              </div>
              <span className="hero-note mono">
                YOUR DOMAIN / YOUR DECISIONS
              </span>
            </div>
            <div className="hero-visual-wrap">
              <SignalVisual paused={paused || reduce} />
              <button
                className="motion-toggle"
                onClick={() => setPaused(!paused)}
                aria-label={
                  paused ? "Play ambient animation" : "Pause ambient animation"
                }
              >
                {paused ? <Play size={12} /> : <Pause size={12} />}
                <span className="mono">
                  {paused ? "PLAY MOTION" : "PAUSE MOTION"}
                </span>
              </button>
            </div>
          </div>
          <div className="hero-bottom mono">
            <span>
              <span className="tiny-dot" /> BUILT AROUND THE MESSAGE
            </span>
            <span className="hero-bottom-center">
              RECEIVE <i>→</i> UNDERSTAND <i>→</i> RESPOND
            </span>
            <a href="#how-it-works">
              SCROLL TO EXPLORE <ArrowDown size={14} />
            </a>
          </div>
        </section>
        <div className="intro-strip">
          <p>
            Mail that feels like yours.
            <br />
            <span>Help that knows your business.</span>
          </p>
          <span>Custom-domain inboxes</span>
          <i />
          <span>Knowledge-backed replies</span>
          <i />
          <span>Human handover</span>
        </div>
        <Journey />
        <section
          className="preview-section section-space"
          id="preview"
          aria-labelledby="preview-title"
        >
          <Reveal className="section-heading">
            <div>
              <p className="eyebrow">
                <span className="tiny-dot" /> 02 / LOOK INSIDE
              </p>
              <h2 id="preview-title">
                Less imagining.
                <br />
                <span>More exploring.</span>
              </h2>
            </div>
            <div className="preview-intro">
              <span className="outlined-label mono">
                INTERACTIVE PRODUCT PREVIEW
              </span>
              <p>
                Open a message. Inspect a reply. Try a scenario.
                <br />
                Meet the tools that are now in OpenMail.
              </p>
            </div>
          </Reveal>
          <PreviewBoundary>
            <ProductDemo />
          </PreviewBoundary>
          <div className="preview-caption">
            <p>
              Fictional company. Sample messages. No email is sent.
              <br />
              The real app uses your account, domain and configured services.
            </p>
            <a href="/app.html">
              Open the real mailbox <ArrowUpRight size={16} />
            </a>
          </div>
        </section>
        <SystemSection />
        <section
          className="faq-section section-space"
          id="details"
          aria-labelledby="faq-title"
        >
          <Reveal className="faq-heading">
            <p className="eyebrow">
              <span className="tiny-dot" /> 04 / A FEW USEFUL DETAILS
            </p>
            <h2 id="faq-title">
              Clear from
              <br />
              <span>the beginning.</span>
            </h2>
            <p>
              What it does. What it needs.
              <br />
              What stays in your hands.
            </p>
            <a
              className="source-link"
              href="https://github.com/Piyush70007/openmail-site"
              target="_blank"
              rel="noreferrer"
            >
              <CodeXml size={17} /> Explore the source <ArrowUpRight size={15} />
            </a>
          </Reveal>
          <div className="faq-list">
            {faqs.map(([q, a], i) => (
              <details key={q}>
                <summary>
                  <span className="mono">0{i + 1}</span>
                  {q}
                  <ChevronDown size={18} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <Reveal className="closing-panel">
          <p className="eyebrow">
            <span className="tiny-dot" /> OPENMAIL / ROOM TO THINK
          </p>
          <h2>
            Let the routine flow.
            <br />
            <span>Keep the human part.</span>
          </h2>
          <div>
            <p>
              Start with your domain.
              <br />
              Build from what you know.
            </p>
            <a className="om-button solid" href="/app.html">
              {appLabel}
              <ArrowUpRight size={18} />
            </a>
          </div>
          <div className="closing-orbits" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </Reveal>
      </main>
      <footer className="om-footer">
        <Brand footer />
        <span className="mono">DOMAIN MAIL / HUMAN OVERSIGHT</span>
        <a href="#top">
          Back to top <ArrowUpRight size={14} />
        </a>
        <p>© {new Date().getFullYear()} OpenMail</p>
      </footer>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")).render(<Landing />);
