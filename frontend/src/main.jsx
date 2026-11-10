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
    title: "A message finds your inbox.",
    short: "Receive",
    text: "Someone writes to support@yourdomain.com. Their email arrives in that inbox, ready for you or your AI helper.",
    icon: Inbox,
  },
  {
    title: "Your AI checks what you shared.",
    short: "Understand",
    text: "Share your services, prices and answers to common questions. Your AI uses that information to help with incoming mail.",
    icon: BookOpen,
  },
  {
    title: "Simple questions get a reply.",
    short: "Respond",
    text: "Turn on automatic replies for questions your saved information can answer. Or keep the AI reply as a draft to check and send yourself.",
    icon: Sparkles,
  },
  {
    title: "You take over when it matters.",
    short: "Hand over",
    text: "Requests that need your judgment, or an answer the AI cannot find, are set aside for you to review.",
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
      aria-label="Example of an AI reply using information you provided"
    >
      <div className="signal-grid" aria-hidden="true" />
      <div className="signal-coordinate mono">ONE EMAIL / AN EXAMPLE</div>
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
          <span className="mono">FOUND IN YOUR GUIDE</span>
          <b>Service guide · section 02</b>
        </div>
        <Check size={14} />
      </div>
      <div className="signal-card signal-answer">
        <div className="answer-top">
          <Sparkles size={16} />
          <span className="mono">ANSWER FROM YOUR GUIDE</span>
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
          <i className="tiny-dot" /> YOUR INFORMATION → A REPLY
        </span>
        <span>YOU STAY IN CHARGE</span>
      </div>
    </div>
  );
}

const addressExamples = [
  { name: "support", purpose: "Help & questions" },
  { name: "sales", purpose: "New business" },
  { name: "contact", purpose: "A simple hello" },
  { name: "yourname", purpose: "Your own name" },
];

function AddressBuilder() {
  const [name, setName] = useState("support");
  const addressName = name.trim().toLowerCase();
  // Match the real mailbox endpoint. This preview only renders text locally.
  const valid =
    /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(addressName) &&
    !addressName.includes("..");
  const invalid = addressName.length > 0 && !valid;

  return (
    <section
      className="address-section section-space"
      id="your-address"
      aria-labelledby="address-title"
    >
      <Reveal className="section-heading">
        <div>
          <p className="eyebrow">
            <span className="tiny-dot" /> 01 / MAKE IT YOURS
          </p>
          <h2 id="address-title">
            Your domain.
            <br />
            <span>Choose the name before @.</span>
          </h2>
        </div>
        <p>
          For your business, your projects or just you.
          <br />
          Try an address below. No signup needed to explore.
        </p>
      </Reveal>
      <Reveal className="address-workspace">
        <div className="address-builder">
          <div className="panel-ruler mono">
            <span>YOUR NEXT EMAIL ADDRESS</span>
            <Mail size={16} aria-hidden="true" />
          </div>
          <label className="address-label" htmlFor="address-name">
            What would you like before the @?
          </label>
          <div className={`address-input-wrap ${invalid ? "has-error" : ""}`}>
            <input
              id="address-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={
                invalid ? "address-help address-error" : "address-help"
              }
              aria-invalid={invalid}
              placeholder="yourname"
            />
            <span aria-hidden="true">@yourdomain.com</span>
          </div>
          <p className="address-help" id="address-help">
            Choose 1–64 letters or numbers. Dots, +, _ and - can go in the
            middle. Start and end with a letter or number; use no spaces or
            double dots.
          </p>
          <div className="address-examples" aria-label="Try an example name">
            {addressExamples.map((example) => (
              <button
                type="button"
                key={example.name}
                onClick={() => setName(example.name)}
                aria-pressed={addressName === example.name}
              >
                <span>
                  {example.name}
                  <ArrowUpRight size={13} aria-hidden="true" />
                </span>
                <small>{example.purpose}</small>
              </button>
            ))}
          </div>
          <div className="address-preview">
            <div className="address-preview-icon" aria-hidden="true">
              <Inbox size={23} />
            </div>
            <div>
              <span className="mono">
                {valid
                  ? "THIS COULD BE YOURS"
                  : "YOUR ADDRESS WILL LOOK LIKE THIS"}
              </span>
              <output
                htmlFor="address-name"
                aria-live="polite"
                aria-label="Example email address"
              >
                <strong>{valid ? addressName : "yourname"}</strong>
                <span>@yourdomain.com</span>
              </output>
            </div>
          </div>
          <p className="address-feedback" id="address-error" role="status">
            {invalid
              ? "That name needs a small change. Follow the naming guide above to see your address."
              : "Just a preview. Nothing is created, saved or sent."}
          </p>
        </div>
        <div className="address-guide">
          <span className="outlined-label mono">
            ONE DOMAIN / SEPARATE INBOXES
          </span>
          <h3>
            A name for every
            <br />
            kind of conversation.
          </h3>
          <p>
            Create support@, sales@, contact@ or your own name on a domain you
            own. Each address gets its own inbox inside your OpenMail account.
          </p>
          <ol className="address-steps">
            <li>
              <span className="mono">01</span>
              <div>
                <h4>Connect your domain</h4>
                <p>Use a domain you own, such as yourdomain.com.</p>
              </div>
            </li>
            <li>
              <span className="mono">02</span>
              <div>
                <h4>Add its email settings</h4>
                <p>
                  OpenMail shows the records to add at your domain provider,
                  then checks them.
                </p>
              </div>
            </li>
            <li>
              <span className="mono">03</span>
              <div>
                <h4>Choose a name and start</h4>
                <p>
                  Once the domain is verified, create an available address and
                  use its inbox.
                </p>
              </div>
            </li>
          </ol>
          <a className="om-button solid" href="/app.html">
            Set up a real address
            <ArrowUpRight size={17} />
          </a>
          <p className="address-limit">
            Add up to 20 new addresses per account each day. These are separate
            inboxes, not forwarding aliases.
          </p>
        </div>
      </Reveal>
    </section>
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
            <span className="mono">AN EXAMPLE</span>
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
                    Service guide.pdf
                    <small>Information from your document</small>
                  </span>
                  <Check size={15} />
                </div>
                <div>
                  <BookOpen size={20} />
                  <span>
                    About your business
                    <small>What you do and how you help</small>
                  </span>
                  <Check size={15} />
                </div>
                <div>
                  <FileText size={20} />
                  <span>
                    Frequently asked questions
                    <small>Answers you have saved</small>
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
                <Sparkles size={13} /> An answer from your own guide
              </span>
              <h3>
                Useful. Specific.
                <br />
                Based on your words.
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
                <Check size={14} /> Sent automatically only when you turn it on
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <span className="scene-badge amber">
                <Users size={13} /> Needs your help
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
                  <b>A decision for you to make.</b>
                  <p>
                    Your AI leaves this message for you to review. It does not
                    send a reply on its own.
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
        <span>EXAMPLE COMPANY / SAMPLE MESSAGES</span>
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
            <span className="tiny-dot" /> 02 / MEET YOUR AI HELPER
          </p>
          <h2 id="journey-title">
            Your inbox gets a hand.
            <br />
            <span>You keep the final say.</span>
          </h2>
        </div>
        <p>
          Here is how a simple question gets answered.
          <br />
          You choose when your AI can reply for you.
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
            <span className="tiny-dot" /> 04 / A LITTLE HELP WITH YOUR MAIL
          </p>
          <h2 id="system-title">
            Less busywork.
            <br />
            <span>More time for you.</span>
          </h2>
        </div>
        <p>
          Give your AI the details. Try it out.
          <br />
          Decide what it can do, and see how it is doing.
        </p>
      </Reveal>
      <div className="capability-grid">
        <Reveal className="capability capability-main">
          <div className="panel-ruler mono">
            <span>01 / YOUR AI TEAM</span>
            <Users size={16} />
          </div>
          <h3>
            Different questions.
            <br />
            The right helper.
          </h3>
          <p>
            Set up AI helpers for support, sales, billing and careers. Choose
            which information each one can use to answer questions.
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
            FOUR HELPERS / YOU ARE IN CHARGE
          </span>
        </Reveal>
        <Reveal className="capability">
          <div className="panel-ruler mono">
            <span>02 / WHAT YOUR AI KNOWS</span>
            <BookOpen size={16} />
          </div>
          <h3>
            Your business.
            <br />
            In its own words.
          </h3>
          <p>
            Add your services, prices, FAQs and documents. Your AI can use this
            information and show you where an answer came from.
          </p>
          <div className="file-types mono">
            {["PDF", "DOCX", "TXT", "MD", "CSV"].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <span className="mono capability-bottom">
            YOUR SAVED INFORMATION / READY TO USE
          </span>
        </Reveal>
        <Reveal className="capability">
          <div className="panel-ruler mono">
            <span>03 / TEST YOUR AI</span>
            <Sparkles size={16} />
          </div>
          <h3>
            Ask the difficult
            <br />
            questions first.
          </h3>
          <p>
            Try a sample email before switching on automatic replies. Check its
            answer, the information it used and whether it needs your help.
          </p>
          <div className="test-lines">
            <span>
              <i />A simple question<b>REPLY</b>
            </span>
            <span>
              <i />
              Missing information<b>ASK YOU</b>
            </span>
          </div>
          <span className="mono capability-bottom">
            PRACTICE FIRST / NO EMAIL SENT
          </span>
        </Reveal>
        <Reveal className="capability capability-workflow">
          <div className="panel-ruler mono">
            <span>04 / MAIL RULES</span>
            <GitBranch size={16} />
          </div>
          <h3>You decide what happens next.</h3>
          <p>
            Make rules for incoming mail: choose an AI helper, prepare a draft,
            reply using checked information or leave the message for you.
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
              Next step
            </span>
          </div>
          <span className="mono capability-bottom">YOUR MAIL / YOUR RULES</span>
        </Reveal>
        <Reveal className="capability capability-trust">
          <div className="panel-ruler mono">
            <span>05 / RESULTS</span>
            <ShieldCheck size={16} />
          </div>
          <h3>
            See what happened.
            <br />
            Keep improving your setup.
          </h3>
          <p>
            See what your AI answered and what it left for you. Mark helpful
            replies, record corrections and keep track of questions you
            resolved.
          </p>
          <div className="trust-visual" aria-hidden="true">
            {[26, 42, 36, 60, 48, 72, 66, 85, 77, 94, 83, 99].map((x, i) => (
              <i key={i} style={{ height: `${x}%` }} />
            ))}
          </div>
          <span className="mono capability-bottom">
            SEE THE REPLIES / ADD YOUR FEEDBACK
          </span>
        </Reveal>
      </div>
    </section>
  );
}

const faqs = [
  [
    "Can I choose any name for my email address?",
    "Yes—choose an available, valid name before @ on a domain you own. For example, support@yourdomain.com, sales@yourdomain.com, contact@yourdomain.com or yourname@yourdomain.com. Names can use 1–64 letters, numbers, dots, plus signs, underscores or hyphens. Start and end with a letter or number, and avoid spaces or double dots.",
  ],
  [
    "Do I need my own domain?",
    "Yes. Your domain is the part after @, such as yourdomain.com. OpenMail shows the email settings to add in your domain provider’s account, then checks them. These settings are called DNS records. Changing where mail is delivered can affect an existing email service. To try OpenMail separately, you can use a subdomain such as mail.yourdomain.com first.",
  ],
  [
    "Are these separate inboxes or forwarding aliases?",
    "Each address you create has its own inbox in your OpenMail account. You switch between them in the app. They are not forwarding aliases that send everything to another email address, and they do not create separate user accounts for teammates.",
  ],
  [
    "How many addresses can I create?",
    "You can create up to 20 new addresses per account each day. OpenMail currently has no fixed total-address cap, but email, storage and AI usage limits still apply. It is not an unlimited email service.",
  ],
  [
    "Will the AI send email without me?",
    "Only after you turn on automatic replies for that inbox. It can answer supported questions even when your browser is closed. It checks your saved information, leaves sensitive or unsupported requests for you, and limits how often it replies. You can leave automatic replies off and review AI drafts yourself instead.",
  ],
  [
    "What does the AI see?",
    "When you use AI, the relevant email text and saved business information are sent to our AI provider, currently Groq, to prepare an answer. When you add a document, the app reads its text in your browser and saves that text; this feature does not upload the original file. Only add information you are comfortable having processed this way.",
  ],
  [
    "Is the preview connected to my account?",
    "No. The address builder and app tour use examples only. The tour shows sample Northline Studio messages and prepared AI answers. It sends no email, calls no AI service and does not read your inbox. Open the mailbox app to set up real addresses and use your account.",
  ],
  [
    "Can I run my own copy of OpenMail?",
    "The code is available on GitHub. Running your own copy still needs hosting, a database, email and AI services, plus a domain you own. Those services have their own setup requirements and usage limits.",
  ],
  [
    "What should I know before using it?",
    "AI can make mistakes, even when it sounds sure. Keep your saved information accurate, try sample questions and review its replies. The app does not currently send email attachments or connect mail rules to outside business tools. Adding documents for your AI is a separate feature.",
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
          <a href="#your-address" onClick={() => setMenu(false)}>
            Your email address
          </a>
          <a href="#preview" onClick={() => setMenu(false)}>
            Try the app
          </a>
          <a href="#system" onClick={() => setMenu(false)}>
            Your AI helper
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
                <span className="tiny-dot" /> YOUR OWN EMAIL. AI WHEN YOU WANT
                IT.
              </p>
              <h1 id="hero-title">
                Your email.
                <br />
                Your name.
                <br />
                <span>AI on hand.</span>
              </h1>
              <p className="hero-description">
                Create <strong>support@yourdomain.com</strong>, sales@ or an
                address with your own name. Keep each inbox separate, with AI
                replies when you choose.
              </p>
              <div className="hero-actions">
                <a className="om-button solid" href="/app.html">
                  {signedIn ? "Back to your mailbox" : "Set up your email"}
                  <ArrowUpRight size={18} />
                </a>
                <a className="om-button text-button" href="#your-address">
                  Try your address
                  <ArrowDownRight size={17} />
                </a>
              </div>
              <span className="hero-note mono">
                CHOOSE THE NAME / BRING YOUR DOMAIN
              </span>
            </div>
            <div className="hero-visual-wrap">
              <SignalVisual paused={paused || reduce} />
              <button
                className="motion-toggle"
                disabled={reduce}
                onClick={() => setPaused(!paused)}
                aria-label={
                  reduce
                    ? "Animation is off to match your device settings"
                    : paused
                      ? "Play ambient animation"
                      : "Pause ambient animation"
                }
              >
                {paused && !reduce ? <Play size={12} /> : <Pause size={12} />}
                <span className="mono">
                  {reduce
                    ? "MOTION OFF"
                    : paused
                      ? "PLAY MOTION"
                      : "PAUSE MOTION"}
                </span>
              </button>
            </div>
          </div>
          <div className="hero-bottom mono">
            <span>
              <span className="tiny-dot" /> EMAIL THAT FEELS LIKE YOURS
            </span>
            <span className="hero-bottom-center">
              YOUR NAME <i>→</i> YOUR DOMAIN <i>→</i> YOUR INBOX
            </span>
            <a href="#your-address">
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
          <span>Email with your own name</span>
          <i />
          <span>AI that uses your information</span>
          <i />
          <span>You stay in control</span>
        </div>
        <AddressBuilder />
        <Journey />
        <section
          className="preview-section section-space"
          id="preview"
          aria-labelledby="preview-title"
        >
          <Reveal className="section-heading">
            <div>
              <p className="eyebrow">
                <span className="tiny-dot" /> 03 / TAKE A LOOK INSIDE
              </p>
              <h2 id="preview-title">
                A little less reading.
                <br />
                <span>A little more trying.</span>
              </h2>
            </div>
            <div className="preview-intro">
              <span className="outlined-label mono">TRY IT / SAMPLE INBOX</span>
              <p>
                Open an email. See an AI reply. Try a question.
                <br />
                Get a feel for OpenMail before you sign up.
              </p>
            </div>
          </Reveal>
          <PreviewBoundary>
            <ProductDemo />
          </PreviewBoundary>
          <div className="preview-caption">
            <p>
              Example company. Sample messages. No email is sent.
              <br />
              To use real email, open the app and connect your own domain.
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
              <span className="tiny-dot" /> 05 / GOOD TO KNOW
            </p>
            <h2 id="faq-title">
              Clear from
              <br />
              <span>the beginning.</span>
            </h2>
            <p>
              A few answers before you start.
              <br />
              No technical background needed to explore.
            </p>
            <a
              className="source-link"
              href="https://github.com/Piyush70007/openmail-site"
              target="_blank"
              rel="noreferrer"
            >
              <CodeXml size={17} /> Explore the source{" "}
              <ArrowUpRight size={15} />
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
            <span className="tiny-dot" /> OPENMAIL / YOUR NEXT ADDRESS
          </p>
          <h2>
            Make it your address.
            <br />
            <span>Make room for you.</span>
          </h2>
          <div>
            <p>
              Start with your domain.
              <br />
              Choose a name. Let your inbox help.
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
        <span className="mono">YOUR EMAIL / YOUR CHOICE</span>
        <a href="#top">
          Back to top <ArrowUpRight size={14} />
        </a>
        <p>© {new Date().getFullYear()} OpenMail</p>
      </footer>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")).render(<Landing />);
