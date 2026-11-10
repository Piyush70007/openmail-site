import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Mail,
  Bot,
  BookOpen,
  FlaskConical,
  UsersRound,
  GitBranch,
  ShieldCheck,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  X,
  Star,
  Archive,
  Check,
  ArrowRight,
  FileText,
  CheckCircle2,
  RotateCcw,
  Pencil,
  Circle,
} from "lucide-react";
import {
  sampleMessages,
  sampleSources,
  sampleRepresentatives,
  sampleWorkflows,
  scenarios,
  SAMPLE_COMPANY,
} from "./demo-data";
import "./demo.css";

const VIEWS = [
  { id: "inbox", title: "Inbox", icon: Mail },
  { id: "representative", title: "AI representative", icon: Bot },
  { id: "knowledge", title: "Company knowledge", icon: BookOpen },
  { id: "training", title: "Training simulator", icon: FlaskConical },
  { id: "team", title: "Representatives", icon: UsersRound },
  { id: "workflows", title: "Workflows", icon: GitBranch },
  { id: "trust", title: "Trust dashboard", icon: ShieldCheck },
];
const CATEGORIES = [
  ["all", "All mail"],
  ["primary", "Primary"],
  ["social", "Social"],
  ["promotions", "Promotions"],
  ["updates", "Updates"],
  ["spam", "Spam"],
];

function Status({ children, warning = false }) {
  return (
    <span className={`demo-status${warning ? " demo-status-warning" : ""}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

function Avatar({ initials, color = "mint", size = "" }) {
  return (
    <span
      className={`demo-avatar demo-avatar-${color}${size ? ` demo-avatar-${size}` : ""}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function SectionIntro({ eyebrow, title, children, right }) {
  return (
    <div className="demo-section-intro">
      <div>
        <p className="demo-eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {children && <p className="demo-description">{children}</p>}
      </div>
      {right}
    </div>
  );
}

function SourceLink({ onClick, label = "Studio handbook · Studio hours" }) {
  return (
    <button className="demo-source-link" onClick={onClick}>
      <FileText size={14} />
      <span>{label}</span>
      <ArrowUpRight size={14} />
    </button>
  );
}

function ReplyExample({ scenario, openKnowledge, compact = false }) {
  const approved = scenario.decision === "auto_reply";
  return (
    <div
      className={`demo-reply-example${compact ? " demo-reply-compact" : ""}`}
    >
      <div className="demo-message-label">
        <Avatar initials="MC" color="sand" />
        <div>
          <strong>Incoming question</strong>
          <span>Fictional customer · to Northline Studio</span>
        </div>
      </div>
      <div className="demo-incoming-bubble">{scenario.question}</div>
      <div className="demo-flow-divider">
        <span />
        <ArrowRight size={14} />
        <span />
      </div>
      <div className={`demo-answer ${approved ? "" : "demo-answer-review"}`}>
        <div className="demo-answer-label">
          {approved ? <Bot size={17} /> : <UsersRound size={17} />}
          <strong>
            {approved ? "A grounded reply" : "A thoughtful handover"}
          </strong>
          <Status warning={!approved}>
            {approved ? "Verified source" : "Needs a person"}
          </Status>
        </div>
        {approved ? (
          <>
            <p>Thanks for reaching out. {scenario.quote}</p>
            <p className="demo-answer-signoff">
              Please reply if you have another question.
            </p>
            <SourceLink onClick={openKnowledge} label={scenario.sourceTitle} />
          </>
        ) : (
          <>
            <p>{scenario.reason}</p>
            <div className="demo-review-note">
              <ShieldCheck size={15} />
              No automatic reply is sent for this example.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InboxView({
  messages,
  setMessages,
  category,
  setCategory,
  search,
  setSearch,
  selected,
  setSelected,
  openKnowledge,
  openRepresentative,
  drafts,
  onCompose,
  notify,
}) {
  const visible = useMemo(
    () =>
      messages.filter((message) => {
        const matchesCategory =
          category === "archive"
            ? message.archived
            : category === "starred"
              ? message.starred && !message.archived
              : !message.archived &&
                (category === "all"
                  ? message.category !== "spam"
                  : message.category === category);
        return (
          matchesCategory &&
          `${message.sender} ${message.subject} ${message.body}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      }),
    [messages, category, search],
  );
  const message = messages.find((item) => item.id === selected);
  const visibleDrafts = drafts.filter((draft) =>
    `${draft.to} ${draft.subject} ${draft.body}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const countFor = (key) =>
    messages.filter(
      (item) =>
        !item.archived &&
        (key === "all" ? item.category !== "spam" : item.category === key),
    ).length;
  const toggleStar = (id) =>
    setMessages((items) =>
      items.map((item) =>
        item.id === id ? { ...item, starred: !item.starred } : item,
      ),
    );
  const archive = (id) => {
    const restoring = messages.find((item) => item.id === id)?.archived;
    setMessages((items) =>
      items.map((item) =>
        item.id === id ? { ...item, archived: !item.archived } : item,
      ),
    );
    setSelected(null);
    notify(
      restoring
        ? "Sample message moved back to the inbox."
        : "Sample message archived. Find it in Archive.",
    );
  };
  const openMessage = (id) => {
    setSelected(id);
    setMessages((items) =>
      items.map((item) => (item.id === id ? { ...item, unread: false } : item)),
    );
  };

  return (
    <div className="demo-inbox">
      <div className="demo-inbox-heading">
        <div className="demo-breadcrumb">
          <span>support@northline.example.test</span>
          <b>/</b>
          <strong>
            {category === "archive"
              ? "Archive"
              : category === "starred"
                ? "Starred"
                : category === "drafts"
                  ? "Drafts"
                  : "Inbox"}
          </strong>
        </div>
        <label className="demo-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search sample mail"
            placeholder="Search sample mail"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected(null);
            }}
          />
        </label>
      </div>
      <div className="demo-inbox-tabs" aria-label="Sample inbox categories">
        {CATEGORIES.map(([key, title]) => (
          <button
            key={key}
            className={category === key ? "is-active" : ""}
            aria-pressed={category === key}
            onClick={() => {
              setCategory(key);
              setSelected(null);
            }}
          >
            {title}
            <span>{String(countFor(key)).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
      <div className="demo-inbox-tools">
        <div>
          <button
            className={category === "starred" ? "is-active" : ""}
            onClick={() => {
              setCategory("starred");
              setSelected(null);
            }}
            aria-pressed={category === "starred"}
          >
            <Star size={14} />
            Starred
          </button>
          <button
            className={category === "archive" ? "is-active" : ""}
            onClick={() => {
              setCategory("archive");
              setSelected(null);
            }}
            aria-pressed={category === "archive"}
          >
            <Archive size={14} />
            Archive
          </button>
          <button
            className={category === "drafts" ? "is-active" : ""}
            onClick={() => {
              setCategory("drafts");
              setSelected(null);
            }}
            aria-pressed={category === "drafts"}
          >
            <Pencil size={14} />
            Drafts {drafts.length > 0 && <span>{drafts.length}</span>}
          </button>
        </div>
        <span>
          {category === "drafts"
            ? `${visibleDrafts.length} sample draft${visibleDrafts.length === 1 ? "" : "s"}`
            : `${visible.length} message${visible.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {message ? (
        <article className="demo-open-message">
          <div className="demo-message-actions">
            <button
              className="demo-text-button"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={15} />
              Back to mail
            </button>
            <div>
              <button
                className="demo-icon-button"
                onClick={() => toggleStar(message.id)}
                aria-label={
                  message.starred
                    ? "Unstar sample message"
                    : "Star sample message"
                }
                aria-pressed={message.starred}
              >
                <Star
                  size={17}
                  fill={message.starred ? "currentColor" : "none"}
                />
              </button>
              <button
                className="demo-text-button"
                onClick={() => archive(message.id)}
              >
                <Archive size={15} />
                {message.archived ? "Restore" : "Archive"}
              </button>
            </div>
          </div>
          <h3>{message.subject}</h3>
          <div className="demo-message-label">
            <Avatar initials={message.initials} color={message.color} />
            <div>
              <strong>
                {message.sender} <span>&lt;{message.address}&gt;</span>
              </strong>
              <span>to support@northline.example.test</span>
            </div>
            <time>{message.time}</time>
          </div>
          <p className="demo-message-body">{message.body}</p>
          {message.ai === "answered" && (
            <div className="demo-inline-answer">
              <Status>AI reply example</Status>
              <p>Thanks for reaching out. {scenarios[0].quote}</p>
              <SourceLink onClick={openKnowledge} />
              <button className="demo-text-button" onClick={openRepresentative}>
                See how the answer was checked <ArrowRight size={14} />
              </button>
            </div>
          )}
          {message.ai === "review" && (
            <div className="demo-inline-answer demo-inline-review">
              <Status warning>Human review</Status>
              <p>
                This is an account-specific refund request. The representative
                hands it to a person without sending a reply.
              </p>
            </div>
          )}
        </article>
      ) : category === "drafts" ? (
        <div className="demo-draft-list">
          {visibleDrafts.length ? (
            visibleDrafts.map((draft) => (
              <article key={draft.id}>
                <Pencil size={18} />
                <div>
                  <strong>{draft.subject || "(No subject)"}</strong>
                  <span>To: {draft.to || "Not added"}</span>
                  <p>{draft.body || "Empty sample draft"}</p>
                </div>
                <span className="demo-small-tag">Unsent sample</span>
              </article>
            ))
          ) : (
            <div className="demo-empty">
              <Pencil size={28} />
              <h4>
                {search
                  ? "No matching sample drafts."
                  : "A little room for a first draft."}
              </h4>
              <p>
                {search
                  ? "Try another search, or compose a new sample."
                  : "Try Compose to save a sample draft here."}
              </p>
              <button
                className="demo-button demo-button-light"
                onClick={onCompose}
              >
                <Plus size={15} />
                Compose a sample
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="demo-message-list">
          {visible.length ? (
            visible.map((item) => (
              <div
                className={`demo-mail-row${item.unread ? " demo-mail-unread" : ""}`}
                key={item.id}
              >
                <button
                  className={`demo-mail-star${item.starred ? " is-starred" : ""}`}
                  onClick={() => toggleStar(item.id)}
                  aria-label={`${item.starred ? "Unstar" : "Star"} ${item.subject}`}
                  aria-pressed={item.starred}
                >
                  <Star
                    size={15}
                    fill={item.starred ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="demo-mail-open"
                  onClick={() => openMessage(item.id)}
                  aria-label={`Open message from ${item.sender}: ${item.subject}`}
                >
                  <Avatar initials={item.initials} color={item.color} />
                  <span className="demo-mail-sender">{item.sender}</span>
                  <span className="demo-mail-copy">
                    <strong>{item.subject}</strong>
                    <span>{item.preview}</span>
                  </span>
                  {item.ai && (
                    <span
                      className={`demo-mail-badge${item.ai === "review" ? " demo-mail-badge-review" : ""}`}
                    >
                      {item.ai === "review" ? "Review" : "AI reply"}
                    </span>
                  )}
                  <time>{item.time}</time>
                </button>
              </div>
            ))
          ) : (
            <div className="demo-empty">
              <Mail size={28} />
              <h4>
                {search ? "No matching sample messages." : "A clear space."}
              </h4>
              <p>
                {search
                  ? "Try “studio”, “invoice”, or a sender’s name."
                  : category === "archive"
                    ? "Archive a message to see it here."
                    : category === "starred"
                      ? "Star a message to keep it close."
                      : "There are no sample messages in this view."}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="demo-inbox-bottom">
        <span>
          <i />
          Fictional messages. Real interactions.
        </span>
        <span>Nothing is sent or saved to your account.</span>
      </div>
    </div>
  );
}

function RepresentativeView({ openKnowledge }) {
  const [scenarioId, setScenarioId] = useState("known");
  const scenario = scenarios.find((item) => item.id === scenarioId);
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="AI REPRESENTATIVE"
        title="Know the answer. Know the boundary."
        right={<Status>Illustrative example</Status>}
      >
        A useful reply starts with your company’s facts. Everything else
        deserves a thoughtful handover.
      </SectionIntro>
      <div className="demo-case-switch" aria-label="Reply examples">
        {scenarios.slice(0, 2).map((item) => (
          <button
            key={item.id}
            className={scenarioId === item.id ? "is-active" : ""}
            aria-pressed={scenarioId === item.id}
            onClick={() => setScenarioId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="demo-representative-grid">
        <ReplyExample scenario={scenario} openKnowledge={openKnowledge} />
        <aside className="demo-decision-sidebar">
          <p className="demo-eyebrow">BEFORE A REPLY LEAVES</p>
          <div className="demo-check-stack">
            {scenario.checks.map((check, i) => (
              <div key={check}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{check}</p>
                <Check size={14} />
              </div>
            ))}
          </div>
          <div className="demo-decision-summary">
            <ShieldCheck size={24} />
            <h4>{scenario.outcome}</h4>
            <p>
              {scenario.decision === "auto_reply"
                ? "Only the approved source passage becomes the answer in this example."
                : "The team keeps control when a decision needs a person."}
            </p>
          </div>
          <p className="demo-footnote">
            This tour uses a fixed example. It does not call an AI provider or
            send email.
          </p>
        </aside>
      </div>
    </div>
  );
}

function KnowledgeView({ sourceId, setSourceId }) {
  const source =
    sampleSources.find((item) => item.id === sourceId) || sampleSources[0];
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="COMPANY KNOWLEDGE"
        title="A source of truth. In your words."
        right={<span className="demo-small-tag">3 sample sources</span>}
      >
        Approved facts give every representative something concrete to work
        from.
      </SectionIntro>
      <div className="demo-knowledge-layout">
        <div className="demo-source-list" aria-label="Sample company sources">
          {sampleSources.map((item) => (
            <button
              key={item.id}
              className={source.id === item.id ? "is-active" : ""}
              aria-pressed={source.id === item.id}
              onClick={() => setSourceId(item.id)}
            >
              <FileText size={21} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.file}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          <div className="demo-knowledge-note">
            <ShieldCheck size={18} />
            <p>
              Fictional documents, provided for this tour. No upload or account
              is needed.
            </p>
          </div>
        </div>
        <article className="demo-document">
          <div className="demo-document-meta">
            <span>{source.kind}</span>
            <span>{source.updated}</span>
          </div>
          <h4>{source.title}</h4>
          <p className="demo-document-byline">
            NORTHLINE STUDIO / SAMPLE KNOWLEDGE
          </p>
          {source.sections.map((section, index) => (
            <section
              key={section.heading}
              className={
                source.id === "hours" && index === 0 ? "demo-cited-section" : ""
              }
            >
              <h5>{section.heading}</h5>
              <p>{section.text}</p>
              {source.id === "hours" && index === 0 && (
                <span className="demo-citation-marker">
                  <CheckCircle2 size={12} />
                  Cited in the studio-hours example
                </span>
              )}
            </section>
          ))}
          <div className="demo-document-footer">
            <span>Approved sample content</span>
            <BookOpen size={16} />
          </div>
        </article>
      </div>
    </div>
  );
}

function TrainingView({ openKnowledge }) {
  const [scenarioId, setScenarioId] = useState("known");
  const [resultId, setResultId] = useState(null);
  const scenario = scenarios.find((item) => item.id === scenarioId);
  const result = scenarios.find((item) => item.id === resultId);
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="TRAINING SIMULATOR"
        title="Try the question before the real conversation."
      >
        Explore three fixed test cases. These results explain the checks; they
        are not live-model evaluations.
      </SectionIntro>
      <div className="demo-training-grid">
        <section className="demo-training-input">
          <p className="demo-eyebrow">01 / CHOOSE A TEST</p>
          <div className="demo-scenario-options">
            {scenarios.map((item) => (
              <button
                key={item.id}
                className={scenarioId === item.id ? "is-active" : ""}
                aria-pressed={scenarioId === item.id}
                onClick={() => {
                  setScenarioId(item.id);
                  setResultId(null);
                }}
              >
                <span className="demo-radio">
                  {scenarioId === item.id && <i />}
                </span>
                <span>{item.label}</span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
          <div className="demo-test-email">
            <span>Sample incoming email</span>
            <h4>{scenario.subject}</h4>
            <p>{scenario.question}</p>
          </div>
          <button
            className="demo-button demo-button-light"
            onClick={() => setResultId(scenarioId)}
          >
            <FlaskConical size={16} />
            {resultId ? "Show example again" : "Show example result"}
            <ArrowRight size={15} />
          </button>
          <p className="demo-footnote">
            Deterministic preview · no API request · no email sent
          </p>
        </section>
        <section className="demo-training-result" aria-live="polite">
          <p className="demo-eyebrow">02 / INSPECT THE DECISION</p>
          {result ? (
            <>
              <div className="demo-result-heading">
                {result.decision === "auto_reply" ? (
                  <CheckCircle2 size={30} />
                ) : (
                  <UsersRound size={30} />
                )}
                <div>
                  <h4>{result.outcome}</h4>
                  <span>Expected behavior for this sample</span>
                </div>
              </div>
              <p>{result.reason}</p>
              <ul className="demo-result-checks">
                {result.checks.map((item) => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
              {result.quote && (
                <blockquote>
                  <p>“{result.quote}”</p>
                  <SourceLink
                    onClick={openKnowledge}
                    label={result.sourceTitle}
                  />
                </blockquote>
              )}
              {result.confidence && (
                <div className="demo-confidence">
                  <div>
                    <span>Illustrative model confidence</span>
                    <strong>{result.confidence}</strong>
                  </div>
                  <div className="demo-confidence-track">
                    <i style={{ width: "94%" }} />
                  </div>
                  <p>
                    A model’s self-estimate is not a calibrated probability.
                    Exact source evidence is also required.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="demo-result-empty">
              <div>
                <FlaskConical size={26} />
                <span />
                <ShieldCheck size={26} />
              </div>
              <h4>Make the reasoning visible.</h4>
              <p>
                Choose a question and inspect the example outcome, source
                evidence, and handover boundary.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TeamView() {
  const [selectedId, setSelectedId] = useState("support");
  const person = sampleRepresentatives.find((item) => item.id === selectedId);
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="MULTIPLE REPRESENTATIVES"
        title="Different roles. One shared standard."
      >
        Give each representative a clear purpose, relevant knowledge, and
        explicit limits.
      </SectionIntro>
      <div className="demo-team-select" aria-label="Sample representatives">
        {sampleRepresentatives.map((item) => (
          <button
            key={item.id}
            className={selectedId === item.id ? "is-active" : ""}
            aria-pressed={selectedId === item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <Avatar
              initials={item.name.slice(0, 2).toUpperCase()}
              color={item.color}
            />
            <span>{item.name}</span>
            <i />
          </button>
        ))}
      </div>
      <div className="demo-rep-profile">
        <div className="demo-rep-identity">
          <Avatar
            initials={person.name.slice(0, 2).toUpperCase()}
            color={person.color}
            size="large"
          />
          <p className="demo-eyebrow">
            NORTHLINE / {person.name.toUpperCase()}
          </p>
          <h4>{person.role}</h4>
          <p>{person.description}</p>
          <div className="demo-sample-question">
            <span>A question for this representative</span>
            <q>{person.sample}</q>
          </div>
        </div>
        <div className="demo-rep-details">
          <section>
            <p className="demo-eyebrow">APPROVED KNOWLEDGE</p>
            {person.sources.map((name) => (
              <div className="demo-rep-source" key={name}>
                <FileText size={16} />
                <span>{name}</span>
                <Check size={14} />
              </div>
            ))}
          </section>
          <section>
            <p className="demo-eyebrow">HUMAN BOUNDARY</p>
            <div className="demo-boundary">
              <ShieldCheck size={20} />
              <p>{person.boundary}</p>
            </div>
          </section>
          <span className="demo-small-tag">
            Fictional representative configuration
          </span>
        </div>
      </div>
    </div>
  );
}

function WorkflowsView() {
  const [rules, setRules] = useState(sampleWorkflows);
  const [selectedId, setSelectedId] = useState("w1");
  const selected = rules.find((item) => item.id === selectedId);
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="WORKFLOWS"
        title="Clear rules for what happens next."
      >
        Explore the built-in actions: route, draft, verified reply, or human
        handover.
      </SectionIntro>
      <div className="demo-workflow-layout">
        <div className="demo-rule-list">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={selectedId === rule.id ? "is-active" : ""}
            >
              <button
                className="demo-rule-select"
                onClick={() => setSelectedId(rule.id)}
                aria-pressed={selectedId === rule.id}
              >
                <GitBranch size={16} />
                <span>
                  <strong>{rule.name}</strong>
                  <small>{rule.action}</small>
                </span>
              </button>
              <button
                className={`demo-toggle${rule.enabled ? " is-on" : ""}`}
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`${rule.enabled ? "Disable" : "Enable"} sample rule: ${rule.name}`}
                onClick={() =>
                  setRules((items) =>
                    items.map((item) =>
                      item.id === rule.id
                        ? { ...item, enabled: !item.enabled }
                        : item,
                    ),
                  )
                }
              >
                <i />
              </button>
            </div>
          ))}
          <p className="demo-footnote">
            These switches affect this preview only.
          </p>
        </div>
        <section className="demo-workflow-canvas">
          <div className="demo-workflow-meta">
            <span>SAMPLE RULE / {selected.id.slice(1).padStart(2, "0")}</span>
            <Status warning={!selected.enabled}>
              {selected.enabled ? "Enabled in preview" : "Paused in preview"}
            </Status>
          </div>
          <div
            className={`demo-flow-nodes${!selected.enabled ? " is-paused" : ""}`}
          >
            <div className="demo-flow-node">
              <span className="demo-node-icon">
                <Mail size={18} />
              </span>
              <div>
                <small>WHEN A MESSAGE ARRIVES</small>
                <strong>{selected.trigger}</strong>
              </div>
            </div>
            <div className="demo-node-connector">
              <span />
              <ArrowRight size={13} />
            </div>
            <div className="demo-flow-node demo-flow-node-action">
              <span className="demo-node-icon">
                {selected.type === "human_review" ? (
                  <UsersRound size={18} />
                ) : selected.type === "create_draft" ? (
                  <Pencil size={18} />
                ) : selected.type === "verified_reply" ? (
                  <ShieldCheck size={18} />
                ) : (
                  <Bot size={18} />
                )}
              </span>
              <div>
                <small>{selected.representative.toUpperCase()}</small>
                <strong>{selected.action}</strong>
              </div>
            </div>
          </div>
          <p className="demo-flow-explanation">
            {selected.enabled
              ? selected.note
              : "This sample rule is paused. Enable it to preview its action."}
          </p>
          <div className="demo-workflow-safety">
            <ShieldCheck size={15} />
            <span>
              Workflow rules do not override evidence checks or the
              automatic-reply opt-in.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function TrustView() {
  const [filter, setFilter] = useState("all");
  const events = [
    {
      name: "Studio hours",
      agent: "Support",
      outcome: "Verified reply",
      type: "answered",
      evidence: "Studio handbook",
      time: "10:42",
      icon: CheckCircle2,
    },
    {
      name: "Invoice refund",
      agent: "Billing",
      outcome: "Human review",
      type: "review",
      evidence: "Account-specific request",
      time: "09:38",
      icon: UsersRound,
    },
    {
      name: "A new brand project",
      agent: "Sales",
      outcome: "Draft created",
      type: "draft",
      evidence: "What we make",
      time: "Yesterday",
      icon: Pencil,
    },
    {
      name: "Delivery commitment",
      agent: "Support",
      outcome: "Human review",
      type: "review",
      evidence: "No approved commitment",
      time: "Yesterday",
      icon: UsersRound,
    },
  ];
  return (
    <div className="demo-page">
      <SectionIntro
        eyebrow="TRUST DASHBOARD"
        title="Every decision leaves a trail."
        right={<span className="demo-small-tag">Illustrative data</span>}
      >
        See what was answered, what was handed over, and which source supported
        the reply.
      </SectionIntro>
      <div className="demo-metrics">
        <div>
          <span>Sample conversations</span>
          <strong>
            36<span>total</span>
          </strong>
        </div>
        <div>
          <span>Verified replies</span>
          <strong>
            24<span>with evidence</span>
          </strong>
        </div>
        <div>
          <span>Human handovers</span>
          <strong>
            07<span>kept in control</span>
          </strong>
        </div>
        <div>
          <span>Drafts prepared</span>
          <strong>
            05<span>awaiting a person</span>
          </strong>
        </div>
      </div>
      <div
        className="demo-outcome-chart"
        aria-label="Illustrative distribution: 24 verified replies, 7 human handovers, 5 drafts"
      >
        <span className="demo-chart-answered" style={{ flex: 24 }} />
        <span className="demo-chart-review" style={{ flex: 7 }} />
        <span className="demo-chart-draft" style={{ flex: 5 }} />
      </div>
      <div className="demo-audit-heading">
        <h4>Recent sample decisions</h4>
        <div className="demo-case-switch" aria-label="Filter sample decisions">
          {[
            ["all", "All"],
            ["answered", "Replies"],
            ["review", "Handovers"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "is-active" : ""}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="demo-audit-list">
        {events
          .filter((event) => filter === "all" || event.type === filter)
          .map((event) => (
            <article key={event.name}>
              <span className={`demo-audit-icon demo-audit-${event.type}`}>
                <event.icon size={16} />
              </span>
              <div>
                <strong>{event.name}</strong>
                <span>{event.agent} representative</span>
              </div>
              <div className="demo-audit-evidence">
                <strong>{event.outcome}</strong>
                <span>{event.evidence}</span>
              </div>
              <time>{event.time}</time>
            </article>
          ))}
      </div>
      <p className="demo-footnote demo-trust-note">
        <ShieldCheck size={14} />
        Sample metrics explain the interface. They are not measured production
        results or an accuracy claim.
      </p>
    </div>
  );
}

function ComposeDialog({ onClose, onSave }) {
  const dialogRef = useRef(null);
  const id = useId();
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      className="demo-compose-dialog"
      ref={dialogRef}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <div className="demo-compose-heading">
          <div>
            <p className="demo-eyebrow">LOCAL PREVIEW</p>
            <h3 id={`${id}-title`}>A new thought.</h3>
          </div>
          <button
            type="button"
            className="demo-icon-button"
            onClick={onClose}
            aria-label="Close sample draft"
          >
            <X size={19} />
          </button>
        </div>
        <label>
          <span>To</span>
          <input
            autoFocus
            type="text"
            value={draft.to}
            maxLength={254}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            placeholder="someone@example.test"
          />
        </label>
        <label>
          <span>Subject</span>
          <input
            type="text"
            value={draft.subject}
            maxLength={200}
            onChange={(event) =>
              setDraft({ ...draft, subject: event.target.value })
            }
            placeholder="A small idea…"
          />
        </label>
        <label className="demo-compose-body">
          <span className="demo-sr-only">Sample draft message</span>
          <textarea
            value={draft.body}
            maxLength={5000}
            onChange={(event) =>
              setDraft({ ...draft, body: event.target.value })
            }
            placeholder="Write a sample message."
          />
        </label>
        <div className="demo-compose-footer">
          <p>
            Saved in this preview only.
            <br />
            No email will be sent.
          </p>
          <button className="demo-button demo-button-light" type="submit">
            <Pencil size={15} />
            Save sample draft
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function ProductDemo() {
  const [view, setView] = useState("inbox");
  const [messages, setMessages] = useState(() =>
    sampleMessages.map((item) => ({ ...item })),
  );
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [sourceId, setSourceId] = useState("hours");
  const [drafts, setDrafts] = useState([]);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState("");
  const composeButtonRef = useRef(null);
  const composeReturnFocusRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const currentView = VIEWS.find((item) => item.id === view);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (composing || !composeReturnFocusRef.current) return;
    // Restore after the dialog has unmounted and the browser has removed its
    // modal focus restriction. The sidebar button survives animated view changes.
    const frame = window.requestAnimationFrame(() => {
      const previous = composeReturnFocusRef.current;
      const target = previous?.isConnected
        ? previous
        : composeButtonRef.current;
      composeReturnFocusRef.current = null;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composing]);
  const openComposer = (event) => {
    composeReturnFocusRef.current =
      event?.currentTarget || composeButtonRef.current;
    setComposing(true);
  };
  const navigate = (id) => {
    setView(id);
    setNotice("");
  };
  const openKnowledge = () => {
    setSourceId("hours");
    navigate("knowledge");
  };
  const reset = () => {
    setMessages(sampleMessages.map((item) => ({ ...item })));
    setDrafts([]);
    setCategory("all");
    setSelected(null);
    setSearch("");
    setView("inbox");
    setNotice("Sample inbox reset. No account data was changed.");
  };
  return (
    <div
      className="demo-window"
      aria-label="Interactive OpenMail product preview"
    >
      <div className="demo-window-bar">
        <div className="demo-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>
          OPENMAIL <b>/</b> A LITTLE ROOM TO EXPLORE
        </span>
        <span className="demo-window-preview">
          <i />
          INTERACTIVE PREVIEW
        </span>
      </div>
      <div className="demo-app-shell">
        <aside className="demo-sidebar">
          <div className="demo-workspace-brand">
            <img
              className="demo-brand-icon"
              src="/favicon.svg"
              width="24"
              height="24"
              alt=""
            />
            <span>
              openmail<span>.</span>
            </span>
          </div>
          <button
            className="demo-compose-button"
            ref={composeButtonRef}
            onClick={openComposer}
          >
            <Plus size={18} />
            <span>Compose</span>
            <span className="demo-compose-shortcut">sample</span>
          </button>
          <p className="demo-sidebar-label">YOUR WORKSPACE</p>
          <nav className="demo-view-nav" aria-label="Product preview views">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                className={view === item.id ? "is-active" : ""}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={16} />
                <span>{item.title}</span>
                {item.id === "inbox" && (
                  <small>
                    {
                      messages.filter(
                        (message) => message.unread && !message.archived,
                      ).length
                    }
                  </small>
                )}
                {item.id === "representative" && <i />}
              </button>
            ))}
          </nav>
          <div className="demo-sidebar-bottom">
            <div className="demo-preview-disclosure">
              <Circle size={12} />
              <span>
                A sample workspace.
                <br />
                Explore without signing in.
              </span>
            </div>
            <div className="demo-company">
              <Avatar initials="NS" size="small" />
              <div>
                <strong>{SAMPLE_COMPANY}</strong>
                <span>FICTIONAL COMPANY</span>
              </div>
            </div>
          </div>
        </aside>
        <div className="demo-main">
          <div className="demo-workspace-top">
            <div>
              <span className="demo-breadcrumb-muted">Workspace</span>
              <span>/</span>
              <strong>{currentView.title}</strong>
            </div>
            <button
              className="demo-reset"
              onClick={reset}
              title="Reset the sample inbox"
            >
              <RotateCcw size={13} />
              <span>Reset inbox</span>
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="demo-view"
              key={view}
              initial={reducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
              transition={{ duration: 0.16 }}
            >
              {view === "inbox" && (
                <InboxView
                  {...{
                    messages,
                    setMessages,
                    category,
                    setCategory,
                    search,
                    setSearch,
                    selected,
                    setSelected,
                    drafts,
                    openKnowledge,
                  }}
                  openRepresentative={() => navigate("representative")}
                  onCompose={openComposer}
                  notify={setNotice}
                />
              )}
              {view === "representative" && (
                <RepresentativeView openKnowledge={openKnowledge} />
              )}
              {view === "knowledge" && (
                <KnowledgeView sourceId={sourceId} setSourceId={setSourceId} />
              )}
              {view === "training" && (
                <TrainingView openKnowledge={openKnowledge} />
              )}
              {view === "team" && <TeamView />}
              {view === "workflows" && <WorkflowsView />}
              {view === "trust" && <TrustView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="demo-footer">
        <span>
          <i />
          Everything here is a fictional, local preview.
        </span>
        <a href="/app.html">
          Open your own workspace <ArrowUpRight size={14} />
        </a>
      </div>
      <div
        className={`demo-notice${notice ? " is-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice && (
          <>
            <CheckCircle2 size={15} />
            <span>{notice}</span>
          </>
        )}
      </div>
      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onSave={(draft) => {
            setDrafts((items) => [
              ...items,
              { ...draft, id: `draft-${items.length + 1}` },
            ]);
            setComposing(false);
            setView("inbox");
            setCategory("drafts");
            setSelected(null);
            setNotice("Sample draft saved here. Nothing was sent.");
          }}
        />
      )}
    </div>
  );
}
