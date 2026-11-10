const $ = (selector) => document.querySelector(selector);
const authView = $("#authView");
const mailView = $("#mailView");
const sessionLoading = $("#sessionLoading");
const authForm = $("#authForm");
const authMessage = $("#authMessage");
const setupNotice = $("#setupNotice");
const liveList = $("#liveMessageList");
const domainsPanel = $("#domainsPanel");
const inboxPane = $("#inboxPane");
const messageDetail = $("#messageDetail");
const composeDialog = $("#composeDialog");
const aiPanel = $("#aiPanel");

let systemStatus = { authReady: false, mailReady: false, authMissing: [], mailMissing: [] };
let authMode = "login";
let domains = [];
let mailboxes = [];
let selectedMailbox = null;
let selectedView = "inbox";
let currentMessages = [];
let currentMessage = null;
let visibleMessageIds = [];
let selectedMessageIds = new Set();
let categoryCounts = { all: 0, primary: 0, social: 0, promotions: 0, updates: 0, spam: 0, starred: 0, drafts: 0, unread: 0, aiSent: 0, needsReview: 0 };
let toastTimer;
let sentSort = "newest";
let composeRequestId = null;
let composeDraftId = null;
let aiProviderConfigured = false;
let aiProfileEnabled = false;
let aiAutomaticEnabled = false;
let aiMailReady = false;
let aiRepresentatives = [];
let aiWorkflows = [];
let selectedAITab = "training";
let aiPanelLoadPromise = null;
let aiPanelLoadMailbox = null;
let aiSetupLoadVersion = 0;
const workspaceSections = { inbox: "Inbox", representative: "AI replies", knowledge: "What your AI knows", training: "Test your AI", team: "Your AI team", workflows: "Mail rules", trust: "Results" };

function syncWorkspaceNavigation(view) {
  document.querySelectorAll("button[data-workspace-view]").forEach((button) => {
    const active = button.dataset.workspaceView === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#mobileWorkspaceCurrent").textContent = workspaceSections[view] || "Domains & mailboxes";
}

function closeNavigationMenu(selector) {
  const menu = $(selector);
  if (!menu.open) return;
  if (menu.contains(document.activeElement)) menu.querySelector("summary").focus({ preventScroll: true });
  menu.open = false;
}

function renderAIWorkspaceView(view, load = true) {
  aiPanel.dataset.workspaceView = view;
  $(".ai-workspace").hidden = view !== "knowledge";
  $(".ai-automation-card").hidden = view !== "representative";
  for (const selector of [".ai-panel-title", ".ai-safety-notice", ".ai-data-disclosure"]) {
    $(selector).hidden = !["knowledge", "representative"].includes(view);
  }
  $(".ai-setup-nav").hidden = true;
  $("#aiToolsTitle").hidden = true;
  $("#aiPanelTitle").textContent = workspaceSections[view];
  $(".ai-panel-title > p").textContent = view === "knowledge"
    ? "Give your AI clear company facts, useful answers, and documents it can learn from."
    : "Choose who answers for this mailbox and whether it may send checked replies automatically.";
  setAIView(({ training: "training", team: "representatives", workflows: "workflows", trust: "trust" })[view] || null, load);
  syncWorkspaceNavigation(view);
  aiPanel.scrollTop = 0;
}

function navigateWorkspace(view) {
  if (!Object.hasOwn(workspaceSections, view)) return;
  closeNavigationMenu(".mobile-workspace-menu");
  if (view === "inbox") { openInbox(); return; }
  const entering = aiPanel.hidden;
  const mailboxId = selectedMailbox ? selectedMailbox.id : null;
  domainsPanel.hidden = true;
  inboxPane.hidden = true;
  messageDetail.hidden = true;
  aiPanel.hidden = false;
  $("#refreshMessages").disabled = true;
  $("#mobileMailNav").hidden = true;
  $("#currentViewHeading").textContent = workspaceSections[view];
  $("#currentMailboxHeading").textContent = selectedMailbox ? selectedMailbox.address.toUpperCase() : "AI SETUP";
  for (const selector of ["#composeButton", "#headingCompose", "#mobileComposeButton"]) $(selector).disabled = true;
  // Switching tools keeps the mounted forms and their unsaved edits intact.
  const needsLoad = (entering && !aiPanelLoadPromise) || aiPanelLoadMailbox !== mailboxId;
  renderAIWorkspaceView(view, !needsLoad && !aiPanelLoadPromise);
  if (needsLoad) {
    aiPanelLoadMailbox = mailboxId;
    document.dispatchEvent(new Event("openmail:ai-panel-open"));
    const loading = loadAISetup();
    aiPanelLoadPromise = loading;
    loading.finally(() => { if (aiPanelLoadPromise === loading) aiPanelLoadPromise = null; });
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function setStatus(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
}

function toast(message) {
  const node = $("#appToast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 3400);
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 3 | 8)).toString(16);
  });
}

function initials(value) {
  const name = String(value || "OM").split(/[@\s<>]+/).filter(Boolean);
  if (name.length > 1 && !String(value).includes("@")) return (name[0][0] + name[1][0]).toUpperCase();
  return name[0].slice(0, 2).toUpperCase();
}

function extractAddress(value) {
  const raw = String(value || "").trim();
  const bracketed = raw.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  return bracketed ? bracketed[1] : raw;
}

function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

const inboxCategoryNames = { primary: "Primary", social: "Social", promotions: "Promotions", updates: "Updates" };

function categorizeMessage(message) {
  if (message.folder === "spam") return "spam";
  if (Object.prototype.hasOwnProperty.call(inboxCategoryNames, message.category)) return message.category;
  const sender = String(message.from_address || "").toLowerCase();
  const address = (sender.match(/[^\s<>@]+@[^\s<>@]+/) || [sender])[0];
  const domain = (address.split("@").pop() || "").replace(/[>\s].*$/, "");
  const content = [message.subject, message.preview, message.text_body].join(" ").slice(0, 12000).toLocaleLowerCase();
  const socialDomains = ["facebook.com", "facebookmail.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "reddit.com", "discord.com", "slack.com", "pinterest.com", "snapchat.com", "youtube.com", "twitch.tv", "whatsapp.com", "telegram.org", "threads.net"];
  const socialSource = socialDomains.some((item) => domain === item || domain.endsWith(`.${item}`));
  const socialActivity = /\b(new follower|started following|followed you|friend request|connection request|mentioned you|tagged you|liked your|commented on your|replied to your|new message from|sent you a message|invited you to|shared a post|posted in your|joined your group|reacted to your)\b/i.test(content);
  const transactional = /\b(order confirmation|receipt|invoice|payment (?:received|confirmed|failed)|charged your|refund (?:issued|processed)|shipping confirmation|order shipped|out for delivery|delivery update|tracking number|password reset|verification code|security alert|sign-in code|login code|reservation confirmed|booking confirmation|appointment reminder|subscription renewal|statement is ready|bill is ready|account update|support ticket|confirm your email|email address confirmed)\b/i.test(content);
  const promotional = /\b(sale|discount|coupon|promo code|limited.time offer|special offer|shop now|free shipping|\d{1,2}% off|save \d{1,2}%|new collection|flash sale|clearance|exclusive offer|newsletter)\b/i.test(content)
    || /^(offers?|deals?|promotions?|newsletter|marketing|campaigns?)\b/i.test(address.split("@")[0] || "");

  if ((socialSource && !transactional) || socialActivity) return "social";
  if (transactional) return "updates";
  if (promotional) return "promotions";
  return "primary";
}

function renderCategoryCounts() {
  const targets = {
    primary: ["primaryCount", "primaryTabCount"],
    social: ["socialCount", "socialTabCount"],
    promotions: ["promotionsCount", "promotionsTabCount"],
    updates: ["updatesCount", "updatesTabCount"],
    spam: ["spamCount", "spamTabCount"],
    starred: ["starredCount"],
    drafts: ["draftsCount"],
    aiSent: ["aiSentCount"],
    needsReview: ["aiHandoffCount"]
  };
  Object.entries(targets).forEach(([view, ids]) => ids.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = String(categoryCounts[view] || 0).padStart(2, "0");
  }));
  $("#allTabCount").textContent = String(categoryCounts.all).padStart(2, "0");
  $("#inboxCount").textContent = categoryCounts.unread ? String(categoryCounts.unread).padStart(2, "0") : "—";
  $("#workspaceInboxCount").textContent = categoryCounts.unread ? String(categoryCounts.unread) : "";
}

function showAuth(message = "") {
  sessionLoading.hidden = true;
  authView.hidden = false;
  mailView.hidden = true;
  setStatus(authMessage, message);
}

function showMail() {
  sessionLoading.hidden = true;
  authView.hidden = true;
  mailView.hidden = false;
}

function setTopbarState(message) {
  $("#topbarState").textContent = message;
  $("#topbarStateChrome").textContent = message;
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === "login";
  $("#signInTab").classList.toggle("active", login);
  $("#signUpTab").classList.toggle("active", !login);
  $("#signInTab").setAttribute("aria-selected", String(login));
  $("#signUpTab").setAttribute("aria-selected", String(!login));
  $("#authSubmit").innerHTML = login ? 'Sign in <span aria-hidden="true">↗</span>' : 'Create account <span aria-hidden="true">↗</span>';
  $("#passwordHint").textContent = login
    ? "Use your OpenMail account email and password."
    : "Use at least 12 characters. You’ll confirm your email before signing in.";
  authForm.elements.password.autocomplete = login ? "current-password" : "new-password";
  setStatus(authMessage, "");
}

async function loadInitialState() {
  try {
    let confirmationUser = null;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (accessToken || refreshToken) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      if (accessToken && refreshToken) {
        const confirmed = await api("/api/auth/callback", {
          method: "POST",
          body: { accessToken, refreshToken, expiresIn: fragment.get("expires_in") }
        });
        confirmationUser = confirmed.user;
      } else {
        throw new Error(fragment.get("error_description") || "Email confirmation did not complete. Sign in again.");
      }
    }
    systemStatus = await api("/api/status");
    setTopbarState(systemStatus.mailReady ? "MAIL SERVICES READY" : "MAIL SETUP REQUIRED");
    if (systemStatus.authReady) {
      if (confirmationUser) {
        await loadDashboard(confirmationUser);
        return;
      }
      const session = await api("/api/auth/session");
      if (session.signedIn) {
        await loadDashboard(session.user);
        return;
      }
    } else {
      setupNotice.hidden = false;
      $("#missingConfig").textContent = systemStatus.authMissing.join(" · ");
      authForm.querySelectorAll("input,button").forEach((item) => { item.disabled = true; });
    }
    if (systemStatus.authReady && !systemStatus.mailReady) {
      setupNotice.hidden = false;
      $("#setupNotice b").textContent = "Email delivery is not fully connected yet.";
      $("#setupNotice p").textContent = "You can sign in, but domains and mailboxes become available after the mail transport is configured.";
      $("#missingConfig").textContent = systemStatus.mailMissing.join(" · ");
    }
    showAuth();
  } catch (error) {
    showAuth();
    setupNotice.hidden = false;
    if (error.message && !/failed \(\d+\)/.test(error.message)) {
      $("#setupNotice b").textContent = "Email confirmation needs attention.";
      $("#setupNotice p").textContent = error.message;
      $("#missingConfig").textContent = "Sign in again after confirming your email.";
      $("#setupNotice").classList.add("confirmation-error");
    } else {
      $("#setupNotice b").textContent = "OpenMail’s server is not reachable.";
      $("#setupNotice p").textContent = "Open this page from the deployed OpenMail site or run the project with Vercel’s local server.";
      $("#missingConfig").textContent = "API unavailable";
      authForm.querySelectorAll("input,button").forEach((item) => { item.disabled = true; });
    }
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#authSubmit");
  const form = new FormData(authForm);
  button.disabled = true;
  setStatus(authMessage, authMode === "login" ? "Signing in…" : "Creating your account…");
  try {
    const result = await api("/api/auth", {
      method: "POST", body: { action: authMode, email: form.get("email"), password: form.get("password") }
    });
    if (result.signedIn || authMode === "login") {
      const session = await api("/api/auth/session");
      await loadDashboard(session.user || { email: form.get("email") });
    } else {
      setAuthMode("login");
      setStatus(authMessage, result.message || "Check your email to confirm your account, then sign in.");
    }
  } catch (error) { setStatus(authMessage, error.message, true); }
  finally { button.disabled = !systemStatus.authReady; }
});

$("#signInTab").addEventListener("click", () => setAuthMode("login"));
$("#signUpTab").addEventListener("click", () => setAuthMode("signup"));

async function loadDashboard(user) {
  const email = user && user.email || "Your account";
  $("#accountEmail").textContent = email;
  $("#accountInitials").textContent = initials(email);
  setTopbarState(systemStatus.mailReady ? "SIGNED IN / PRIVATE SPACE" : "SIGNED IN / SETUP REQUIRED");
  $("#mailServiceNotice").hidden = systemStatus.mailReady;
  $("#mailMissingConfig").textContent = systemStatus.mailMissing.join(" · ");
  try {
    await loadDomainsAndMailboxes();
    try {
      const result = await api("/api/ai/representatives");
      aiRepresentatives = result.representatives || [];
      renderMessages();
    } catch {}
  } catch (error) {
    toast(error.message);
    openDomains();
  }
  showMail();
  refreshAICapability();
}

async function loadDomainsAndMailboxes() {
  const [domainData, mailboxData] = await Promise.all([api("/api/domains"), api("/api/mailboxes")]);
  domains = domainData.domains || [];
  mailboxes = mailboxData.mailboxes || [];
  renderDomains();
  renderMailboxChoices();
  if (!domains.length || !mailboxes.length) {
    openDomains();
    return;
  }
  domainsPanel.hidden = true;
  aiPanel.hidden = true;
  inboxPane.hidden = false;
  messageDetail.hidden = true;
  $("#mobileMailNav").hidden = false;
  $("#composeButton").disabled = !systemStatus.mailReady;
  $("#headingCompose").disabled = !systemStatus.mailReady;
  $("#mobileComposeButton").disabled = !systemStatus.mailReady;
  const prior = selectedMailbox && mailboxes.find((item) => item.id === selectedMailbox.id);
  const chosen = prior || mailboxes[0];
  selectedMailbox = chosen;
  $("#mailboxPicker").value = chosen.id;
  $("#mobileMailboxPicker").value = chosen.id;
  $("#currentMailboxHeading").textContent = chosen.address.toUpperCase();
  await loadMessages();
}

function openDomains() {
  syncWorkspaceNavigation(null);
  domainsPanel.hidden = false;
  aiPanel.hidden = true;
  $("#refreshMessages").disabled = false;
  inboxPane.hidden = true;
  messageDetail.hidden = true;
  $("#mobileMailNav").hidden = true;
  $("#myAIButton").classList.remove("active");
  $("#mobileMyAIButton").classList.remove("active");
  $("#currentViewHeading").textContent = "Domains & mailboxes";
  $("#currentMailboxHeading").textContent = "SETUP";
  $("#composeButton").disabled = true;
  $("#headingCompose").disabled = true;
  $("#mobileComposeButton").disabled = true;
  $("#domainForm").querySelector("button[type=submit]").disabled = !systemStatus.mailReady;
  $("#mailboxForm").querySelector("button[type=submit]").disabled = !systemStatus.mailReady || !verifiedDomainsReady();
  renderDomains();
}

function openInbox() {
  selectedView = "inbox";
  syncViewControls();
  domainsPanel.hidden = true;
  aiPanel.hidden = true;
  $("#refreshMessages").disabled = false;
  $("#mobileMailNav").hidden = false;
  inboxPane.hidden = false;
  messageDetail.hidden = true;
  $("#composeButton").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#headingCompose").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#mobileComposeButton").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#currentMailboxHeading").textContent = selectedMailbox ? selectedMailbox.address.toUpperCase() : "INBOX";
  loadMessages().catch((error) => toast(error.message));
}

function makeButton(label, className, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

function syncAIDraftButton() {
  const button = $("#aiDraftButton");
  if (!button) return;
  button.hidden = !currentMessage || currentMessage.direction !== "inbound" || ["spam", "trash"].includes(currentMessage.folder) || !aiProviderConfigured || !aiProfileEnabled;
}

function updateAISafetyNotice() {
  const title = $("#aiSafetyTitle");
  const copy = $("#aiSafetyCopy");
  if (!title || !copy) return;
  if (!aiProviderConfigured) {
    title.textContent = "Groq is not connected on this deployment yet.";
    copy.textContent = "The site owner needs to connect the AI service. Your inbox and normal mail actions still work.";
  } else if (!aiProfileEnabled) {
    title.textContent = "Groq is connected. AI drafts are off until you opt in.";
    copy.textContent = "When enabled, selected inbound messages and approved company knowledge can go to Groq. Automatic replies also require a separate opt-in for each mailbox.";
  } else {
    title.textContent = aiAutomaticEnabled ? `Automatic replies are on for ${selectedMailbox ? selectedMailbox.address : "this mailbox"}.` : "AI representative is on. Automatic replies remain off for this mailbox.";
    copy.textContent = aiAutomaticEnabled
      ? "Eligible incoming message text for this mailbox is processed by Groq. OpenMail sends a reply only when exact approved company evidence passes safety checks. Sensitive or uncertain messages go to Needs your help. Turn this off any time in My AI."
      : "AI drafts are available when you open a message and click Generate. Automatic sending is off until you explicitly enable it for a verified mailbox in My AI.";
  }
  syncAIDraftButton();
}

async function refreshAICapability() {
  try {
    const result = await api("/api/ai/profile");
    aiProviderConfigured = Boolean(result.provider && result.provider.configured);
    aiProfileEnabled = Boolean(result.profile && result.profile.enabled);
    aiMailReady = Boolean(result.mailReady);
    updateAISafetyNotice();
  } catch {
    aiProviderConfigured = false;
    aiProfileEnabled = false;
    syncAIDraftButton();
  }
}

function openAIPanel() {
  navigateWorkspace("representative");
}

function renderAIKnowledge(entries) {
  const root = $("#aiKnowledgeList");
  root.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "ai-empty-note";
    empty.textContent = "No knowledge notes yet. Add a verified answer or policy above.";
    root.append(empty);
    return;
  }
  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "ai-knowledge-entry";
    const heading = document.createElement("div");
    heading.className = "ai-knowledge-entry-head";
    const title = document.createElement("b");
    title.textContent = entry.title;
    const type = document.createElement("span");
    type.textContent = String(entry.entry_type || "faq").replaceAll("_", " ").toUpperCase();
    const scope = document.createElement("span");
    if (entry.representative_id) {
      const rep = aiRepresentatives.find((item) => item.id === entry.representative_id);
      scope.textContent = rep ? rep.display_name.toUpperCase() : "REPRESENTATIVE ONLY";
    } else {
      scope.textContent = "SHARED";
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-button ai-delete-entry";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove knowledge note ${entry.title}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove “${entry.title}” from your AI knowledge?`)) return;
      remove.disabled = true;
      try {
        await api(`/api/ai/knowledge?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
        await loadAIKnowledge();
        toast("Knowledge note removed.");
      } catch (error) { toast(error.message); remove.disabled = false; }
    });
    heading.append(title, type, scope, remove);
    const content = document.createElement("p");
    content.textContent = entry.content;
    card.append(heading, content);
    root.append(card);
  });
}

async function loadAIKnowledge() {
  const result = await api("/api/ai/knowledge");
  renderAIKnowledge(result.entries || []);
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function fillRepresentativeSelect(select, { includeShared = false, selected = "" } = {}) {
  if (!select) return;
  select.replaceChildren();
  if (includeShared) appendOption(select, "", "Shared with all representatives");
  const enabled = aiRepresentatives.filter((item) => item.enabled);
  if (!enabled.length && !includeShared) appendOption(select, "", "No enabled representatives");
  enabled.forEach((item) => appendOption(select, item.id, `${item.display_name} · ${item.kind}`));
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
  else if (!includeShared && enabled.length) select.value = enabled[0].id;
}

function renderAIRepresentatives() {
  const root = $("#aiRepresentativesList");
  if (!root) return;
  root.replaceChildren();
  if (!aiRepresentatives.length) {
    const note = document.createElement("p");
    note.className = "ai-empty-note error";
    note.textContent = "Your AI team could not load. Try refreshing. If it still fails, ask the site owner to check the AI setup.";
    root.append(note);
    return;
  }
  const mailboxSetting = window.openmailMailboxSetting || {};
  const mailboxRep = mailboxSetting.representative_id || "";
  for (const rep of aiRepresentatives) {
    const card = document.createElement("article");
    card.className = "ai-representative-row";
    const info = document.createElement("div");
    info.className = "ai-representative-copy";
    const title = document.createElement("b");
    title.textContent = rep.kind[0].toUpperCase() + rep.kind.slice(1);
    const description = document.createElement("small");
    description.textContent = {
      support: "Product questions and general help",
      sales: "Service questions and qualified leads",
      billing: "Billing requests routed for careful review",
      careers: "Hiring questions routed for careful review"
    }[rep.kind] || "Separate AI representative";
    info.append(title, description);
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 80;
    name.value = rep.display_name;
    name.setAttribute("aria-label", `${title.textContent} representative display name`);
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "ai-representative-enabled";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = Boolean(rep.enabled);
    enabled.setAttribute("aria-label", `Enable ${title.textContent} representative`);
    const enabledText = document.createElement("span");
    enabledText.textContent = "Enabled";
    enabledLabel.append(enabled, enabledText);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "button button-outline";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      const displayName = name.value.trim();
      if (!displayName) return toast("Enter a name for this representative.");
      if (!enabled.checked && mailboxRep === rep.id && aiAutomaticEnabled) {
        return toast("Turn off automatic replies or assign another representative before disabling this one.");
      }
      save.disabled = true;
      try {
        const result = await api("/api/ai/representatives", {
          method: "PATCH", body: { id: rep.id, displayName, enabled: enabled.checked }
        });
        aiRepresentatives = aiRepresentatives.map((item) => item.id === rep.id ? result.representative : item);
        renderAIRepresentatives();
        refreshRepresentativeSelects(mailboxRep);
        toast(`${title.textContent} representative saved.`);
      } catch (error) { toast(error.message); save.disabled = false; }
    });
    card.append(info, name, enabledLabel, save);
    root.append(card);
  }
  refreshRepresentativeSelects(mailboxRep);
}

function refreshRepresentativeSelects(mailboxRepresentativeId = "") {
  fillRepresentativeSelect($("#aiKnowledgeRepresentative"), { includeShared: true });
  fillRepresentativeSelect($("#aiDocumentRepresentative"), { includeShared: true });
  fillRepresentativeSelect($("#aiSimulatorRepresentative"));
  fillRepresentativeSelect($("#aiWorkflowRepresentative"));
  fillRepresentativeSelect($("#aiMailboxRepresentative"), { selected: mailboxRepresentativeId });
  $("#saveMailboxRepresentative").disabled = !selectedMailbox || !aiRepresentatives.some((item) => item.id === $("#aiMailboxRepresentative").value && item.enabled);
}

function setAIView(view, load = true) {
  selectedAITab = view;
  document.querySelectorAll("[data-ai-tab]").forEach((button) => {
    const active = button.dataset.aiTab === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-ai-view]").forEach((panel) => { panel.hidden = panel.dataset.aiView !== view; });
  if (load && view === "workflows") loadAIWorkflows();
  if (load && view === "trust") loadAITrust();
}

// Charts describe saved results only; confidence is never treated as accuracy.
function insightCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0;
}

function insightPercent(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function insightRate(part, total) {
  return insightCount(total) > 0 ? insightPercent(insightCount(part) / insightCount(total) * 100) : null;
}

function insightNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function insightGauge({ title, percent, detail, note, threshold = null, tone = "mint" }) {
  const value = insightPercent(percent);
  const thresholdValue = insightPercent(threshold);
  const valueText = value == null ? "—" : `${Number(value.toFixed(1))}%`;
  const card = insightNode("section", `insight-card insight-gauge-card insight-tone-${tone}`);
  card.append(insightNode("h4", "insight-title", title));
  const figure = insightNode("div", "insight-gauge");
  figure.setAttribute("role", "img");
  figure.setAttribute("aria-label", `${title}: ${value == null ? "no data yet" : valueText}. ${detail}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 240 150");
  svg.setAttribute("aria-hidden", "true");
  const arc = (className) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M20 120 A100 100 0 0 1 220 120");
    path.setAttribute("pathLength", "100");
    path.setAttribute("class", className);
    svg.append(path);
    return path;
  };
  arc("insight-gauge-track");
  if (value != null && value > 0) arc("insight-gauge-fill").setAttribute("stroke-dasharray", `${value} 100`);
  if (thresholdValue != null) {
    const angle = Math.PI * thresholdValue / 100;
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "line");
    marker.setAttribute("x1", String(120 - 88 * Math.cos(angle)));
    marker.setAttribute("y1", String(120 - 88 * Math.sin(angle)));
    marker.setAttribute("x2", String(120 - 112 * Math.cos(angle)));
    marker.setAttribute("y2", String(120 - 112 * Math.sin(angle)));
    marker.setAttribute("class", "insight-gauge-marker");
    svg.append(marker);
  }
  const valueNode = insightNode("strong", "insight-gauge-value", valueText);
  valueNode.setAttribute("aria-hidden", "true");
  const scale = insightNode("div", "insight-gauge-scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(insightNode("span", "", "0%"), insightNode("span", "", "100%"));
  figure.append(svg, valueNode, scale);
  card.append(figure, insightNode("p", "insight-detail", detail), insightNode("p", "insight-note", note));
  return card;
}

function insightBars(title, description, items, emptyText = "No recorded activity yet.") {
  const card = insightNode("section", "insight-card insight-bars-card");
  card.append(insightNode("h4", "insight-title", title), insightNode("p", "insight-note", description));
  const maximum = Math.max(0, ...items.map((item) => insightCount(item.value)));
  const list = insightNode("ul", "insight-bars");
  for (const item of items) {
    const count = insightCount(item.value);
    const row = insightNode("li", `insight-bar-row insight-tone-${item.tone || "mint"}`);
    const label = insightNode("div", "insight-bar-label");
    label.append(insightNode("span", "", item.label), insightNode("b", "", count.toLocaleString()));
    const track = insightNode("div", "insight-bar-track");
    track.setAttribute("aria-hidden", "true");
    const fill = insightNode("span", "insight-bar-fill");
    fill.style.width = `${maximum ? count / maximum * 100 : 0}%`;
    track.append(fill);
    row.append(label, track);
    list.append(row);
  }
  card.append(list);
  if (!maximum) card.append(insightNode("p", "insight-empty", emptyText));
  else card.append(insightNode("p", "insight-axis", `Shared scale: 0–${maximum.toLocaleString()} recorded events`));
  return card;
}

function renderSimulationHistory(runs) {
  const root = $("#aiSimulatorHistory");
  root.replaceChildren();
  const passed = runs.filter((run) => run.passed === true).length;
  const overview = insightNode("div", "insight-test-overview");
  overview.append(insightGauge({
    title: "Test pass rate", percent: insightRate(passed, runs.length),
    detail: runs.length ? `${passed} of ${runs.length} saved tests passed` : "Run your first test to see a result",
    note: "Based on the latest 20 saved tests across your account. A pass means the expected result and required checks matched."
  }));
  overview.append(insightBars("How your tests went", "These are practice tests, not emails sent to customers.", [
    { label: "Matched the expected result", value: passed },
    { label: "Needs a closer look", value: runs.length - passed, tone: "amber" }
  ], "Try a question your saved company information can answer, then one that should go to a person."));
  root.append(overview);
  if (!runs.length) {
    const note = document.createElement("p"); note.className = "ai-empty-note";
    note.textContent = "No saved tests yet. Your first result will appear here."; root.append(note); return;
  }
  const history = insightNode("div", "insight-test-history");
  for (const run of runs) {
    const row = document.createElement("article"); row.className = "ai-metric-row";
    const label = document.createElement("b"); label.textContent = run.test_name;
    const result = document.createElement("span");
    result.className = run.passed ? "ai-result-pass" : "ai-result-review";
    result.textContent = `${run.passed ? "Passed" : "Check result"} · ${run.actual_decision === "auto_reply" ? "Answer from saved facts" : "Asked a person"}`;
    const date = document.createElement("small"); date.textContent = displayTime(run.created_at);
    row.append(label, result, date); history.append(row);
  }
  root.append(history);
}

function renderSimulationResult(result) {
  const root = $("#aiSimulatorResult"); root.replaceChildren();
  const evaluation = result.evaluation;
  const heading = document.createElement("b");
  heading.className = evaluation.passed ? "ai-result-pass" : "ai-result-review";
  heading.textContent = evaluation.passed ? "Your test passed" : "Take a closer look at this result";
  const decision = document.createElement("p");
  const answers = evaluation.actual === "auto_reply";
  decision.textContent = `${answers ? "The AI would answer using your saved information." : "The AI would ask a person to help."} ${evaluation.reason || ""}`;
  const confidence = evaluation.confidence == null ? null : insightPercent(Number(evaluation.confidence) * 100);
  const minimum = evaluation.minimumAutoReplyConfidence == null ? null : insightPercent(Number(evaluation.minimumAutoReplyConfidence) * 100);
  root.append(heading, decision, insightGauge({
    title: "AI confidence", percent: confidence, threshold: minimum, tone: "blue",
    detail: confidence == null ? "The AI did not report a confidence score" : "How sure the AI says it is",
    note: `This does not guarantee a correct answer.${minimum == null ? "" : ` The marker shows the ${Number(minimum.toFixed(1))}% minimum for an automatic answer.`}`
  }));
  const checks = insightNode("ul", "insight-checks");
  const checkRows = [
    ["Expected result", evaluation.expected === evaluation.actual ? "Matched" : "Did not match", evaluation.expected === evaluation.actual],
    ["Saved source checked", answers ? (evaluation.evidenceVerified ? "Verified" : "Not verified") : "Not needed for a handover", !answers || evaluation.evidenceVerified],
    ["Confidence check", answers ? (evaluation.confidencePassed ? "Passed" : "Below the minimum") : "Not needed for a handover", !answers || evaluation.confidencePassed]
  ];
  for (const [label, value, passed] of checkRows) {
    const check = insightNode("li", "");
    check.append(insightNode("span", "", label), insightNode("b", passed ? "ai-result-pass" : "ai-result-review", value));
    checks.append(check);
  }
  root.append(checks);
  if (result.answer) {
    const answer = document.createElement("p"); answer.className = "ai-simulation-answer"; answer.textContent = result.answer; root.append(answer);
  }
  const citationsTitle = document.createElement("b"); citationsTitle.textContent = "Saved information used for this answer"; root.append(citationsTitle);
  if (!result.citations || !result.citations.length) {
    const none = document.createElement("p"); none.className = "ai-empty-note"; none.textContent = "No saved source was used for an automatic answer. A person needs to review this message."; root.append(none);
  } else for (const citation of result.citations) {
    const citationNode = document.createElement("blockquote");
    const source = document.createElement("b"); source.textContent = citation.title;
    const quote = document.createElement("p"); quote.textContent = citation.quote;
    citationNode.append(source, quote); root.append(citationNode);
  }
}

async function loadAISimulator() {
  try {
    const result = await api("/api/ai/simulator");
    if (result.representatives) { aiRepresentatives = result.representatives; renderAIRepresentatives(); }
    renderSimulationHistory(result.runs || []);
  } catch (error) {
    const root = $("#aiSimulatorHistory"); root.replaceChildren();
    const note = document.createElement("p"); note.className = "ai-empty-note error"; note.textContent = error.message; root.append(note);
  }
}

async function loadAIWorkflows() {
  const root = $("#aiWorkflowList"); root.replaceChildren();
  if (!selectedMailbox) { const note = document.createElement("p"); note.className = "ai-empty-note"; note.textContent = "Choose a mailbox before setting up workflows."; root.append(note); return; }
  try {
    const result = await api(`/api/ai/workflows?mailboxId=${encodeURIComponent(selectedMailbox.id)}`);
    aiWorkflows = result.workflows || [];
    if (!aiWorkflows.length) { const note = document.createElement("p"); note.className = "ai-empty-note"; note.textContent = "No mail rules yet. Your saved automatic-reply setting still applies to this mailbox."; root.append(note); return; }
    for (const workflow of aiWorkflows) {
      const row = document.createElement("article"); row.className = "ai-workflow-row";
      const details = document.createElement("div");
      const name = document.createElement("b"); name.textContent = workflow.name;
      const rep = aiRepresentatives.find((item) => item.id === workflow.representative_id);
      const description = document.createElement("small");
      description.textContent = `${workflow.enabled ? "Enabled" : "Off"} · ${workflow.trigger_mode === "all_inbound" ? "all incoming mail" : workflow.match_terms.join(", ")} · ${workflow.action.replaceAll("_", " ")}${rep ? ` · ${rep.display_name}` : ""}`;
      details.append(name, description);
      const actions = document.createElement("div"); actions.className = "ai-row-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "quiet-button"; edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        $("#aiWorkflowId").value = workflow.id; $("#aiWorkflowName").value = workflow.name;
        $("#aiWorkflowTrigger").value = workflow.trigger_mode; $("#aiWorkflowTerms").value = (workflow.match_terms || []).join(", ");
        $("#aiWorkflowAction").value = workflow.action; $("#aiWorkflowRepresentative").value = workflow.representative_id || "";
        $("#aiWorkflowPriority").value = workflow.priority; $("#aiWorkflowEnabled").checked = Boolean(workflow.enabled);
        setAIWorkflowFields(); $("#aiWorkflowName").focus();
      });
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "quiet-button"; toggle.textContent = workflow.enabled ? "Turn off" : "Turn on";
      toggle.addEventListener("click", async () => {
        if (!workflow.enabled && workflow.action === "verified_reply" && !window.confirm("Turn on this verified-reply rule? It can send only if automatic replies are separately enabled for this mailbox; each message still must pass OpenMail’s source and safety checks.")) return;
        toggle.disabled = true;
        try {
          if (workflow.enabled) await api(`/api/ai/workflows?mailboxId=${encodeURIComponent(selectedMailbox.id)}&id=${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
          else await api("/api/ai/workflows", { method: "POST", body: workflowPayload(workflow, true) });
          await loadAIWorkflows(); toast(workflow.enabled ? "Workflow turned off." : "Workflow turned on.");
        } catch (error) { toast(error.message); toggle.disabled = false; }
      });
      actions.append(edit, toggle); row.append(details, actions); root.append(row);
    }
  } catch (error) { const note = document.createElement("p"); note.className = "ai-empty-note error"; note.textContent = error.message; root.append(note); }
}

function workflowPayload(existing = null, enabledOverride = null) {
  const triggerMode = existing ? existing.trigger_mode : $("#aiWorkflowTrigger").value;
  const termsText = existing ? (existing.match_terms || []).join(", ") : $("#aiWorkflowTerms").value;
  return {
    ...(existing ? { id: existing.id } : {}), mailboxId: selectedMailbox && selectedMailbox.id,
    name: existing ? existing.name : $("#aiWorkflowName").value.trim(), triggerMode,
    matchTerms: triggerMode === "all_inbound" ? [] : [...new Set(termsText.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))],
    action: existing ? existing.action : $("#aiWorkflowAction").value,
    representativeId: existing ? existing.representative_id : $("#aiWorkflowRepresentative").value,
    priority: Number(existing ? existing.priority : $("#aiWorkflowPriority").value),
    enabled: enabledOverride == null ? $("#aiWorkflowEnabled").checked : enabledOverride
  };
}

function setAIWorkflowFields() {
  const everyMessage = $("#aiWorkflowTrigger").value === "all_inbound";
  $("#aiWorkflowTerms").disabled = everyMessage;
  if (everyMessage) $("#aiWorkflowTerms").value = "";
  const action = $("#aiWorkflowAction").value;
  const needsRepresentative = action !== "human_review";
  $("#aiWorkflowRepField").hidden = !needsRepresentative;
}

function renderTrustMetrics(result, metrics) {
  const totals = result.summary && result.summary.totals || {};
  const correct = insightCount(totals.markedCorrect);
  const corrections = insightCount(totals.corrections);
  const rated = correct + corrections;
  const cases = insightCount(totals.simulatorCases);
  const passed = insightCount(totals.simulatorPassed);
  const days = insightCount(result.days) || 30;
  const scope = insightNode("p", "insight-scope", `Last ${days} days · Real saved results. Mail activity follows the selected mailbox; practice tests cover your whole account.`);
  metrics.append(scope);
  metrics.append(insightGauge({
    title: "Answers marked correct", percent: insightRate(correct, rated),
    detail: rated ? `${correct} correct out of ${rated} reviewed answers` : "No answers rated yet",
    note: "Based only on answers you marked Correct or Needs correction. Review an answer below to add feedback."
  }));
  metrics.append(insightGauge({
    title: "Test pass rate", percent: insightRate(passed, cases), tone: "blue",
    detail: cases ? `${passed} of ${cases} practice tests passed` : "No practice tests in this period",
    note: "Account-wide tests in this period. A pass means the expected result and required checks matched; it is not a guarantee for future emails."
  }));
  const snapshot = insightNode("section", "insight-card insight-snapshot");
  snapshot.append(insightNode("h4", "insight-title", "At a glance"));
  const stats = insightNode("dl", "insight-stats");
  for (const [label, value] of [["Replies sent automatically", totals.automaticReplies], ["Messages needing a person", totals.escalations], ["Marked resolved by you", totals.successfulResolutions], ["Drafts made by mail rules", totals.workflowDrafts]]) {
    const stat = insightNode("div", "");
    stat.append(insightNode("dt", "", label), insightNode("dd", "", insightCount(value).toLocaleString()));
    stats.append(stat);
  }
  snapshot.append(stats);
  metrics.append(snapshot);
  const comparisons = insightNode("div", "insight-comparisons");
  comparisons.append(insightBars("Recorded outcomes", "Counts can overlap: a reply can later be corrected or marked resolved. These are not percentages of all mail.", [
    { label: "Automatic replies", value: totals.automaticReplies },
    { label: "Needed a person", value: totals.escalations, tone: "amber" },
    { label: "Marked correct", value: correct },
    { label: "Needed a correction", value: corrections, tone: "rose" },
    { label: "Marked resolved", value: totals.successfulResolutions, tone: "blue" },
    { label: "Drafts from mail rules", value: totals.workflowDrafts, tone: "violet" },
    { label: "Routed by mail rules", value: totals.workflowRoutes, tone: "blue" }
  ], "Results appear after your AI handles mail. Automatic replies stay under your existing mailbox settings."));
  const team = result.summary && result.summary.byRepresentative || [];
  const teamItems = team.flatMap((rep) => [
    { label: `${rep.name} · replies`, value: rep.automaticReplies },
    { label: `${rep.name} · needed a person`, value: rep.escalations, tone: "amber" }
  ]);
  comparisons.append(insightBars("Your AI team", "Compare recorded automatic replies and handovers for each team member. All bars use the same count scale.", teamItems,
    "No team activity in this period. Assign an enabled team member to a mailbox to get started."));
  metrics.append(comparisons);
}

function trustDecisionLabel(status) {
  return { auto_sent: "Reply sent", human_review: "Needs a person", draft_created: "Draft ready", workflow_applied: "Mail rule applied", failed: "Could not complete", ignored: "No reply needed", processing: "In progress" }[status] || "Other decision";
}

function renderTrustRecent(items, recent) {
  if (!items.length) {
    recent.append(insightNode("p", "ai-empty-note", "No AI decisions in this period. When your AI handles mail, you can review its answers here."));
    return;
  }
  const controls = insightNode("div", "insight-filters");
  const searchLabel = insightNode("label", "", "Search these decisions");
  const search = insightNode("input", "");
  search.type = "search";
  search.placeholder = "Search subject or reason";
  search.maxLength = 200;
  searchLabel.append(search);
  const filterLabel = insightNode("label", "", "Show");
  const filter = insightNode("select", "");
  for (const [value, label] of [["all", "All decisions"], ...[...new Set(items.map((item) => item.status))].map((status) => [status, trustDecisionLabel(status)])]) {
    const option = insightNode("option", "", label);
    option.value = value;
    filter.append(option);
  }
  filterLabel.append(filter);
  controls.append(searchLabel, filterLabel);
  const count = insightNode("p", "insight-note");
  count.setAttribute("role", "status");
  const rows = insightNode("div", "insight-decision-list");
  recent.append(controls, count, rows);
  const render = () => {
    rows.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase();
    const matching = items.filter((item) => (filter.value === "all" || item.status === filter.value) && `${item.subject || ""} ${item.reason || ""}`.toLocaleLowerCase().includes(term));
    count.textContent = `${matching.length} of ${items.length} loaded decisions · latest 30 available in this period. Search and filters apply to this list only.`;
    if (!matching.length) rows.append(insightNode("p", "ai-empty-note", "No decisions match. Clear the search or choose All decisions."));
    for (const item of matching) {
      const row = insightNode("article", "ai-trust-row");
      const detail = insightNode("div", "insight-decision-copy");
      const status = insightNode("span", `insight-status ${item.status === "auto_sent" ? "insight-status-sent" : ""}`, trustDecisionLabel(item.status));
      const title = insightNode("b", "", item.subject || "(no subject)");
      const summary = insightNode("small", "", `${item.reason || "No additional reason"} · ${displayTime(item.createdAt)}`);
      detail.append(status, title, summary);
      const feedback = insightNode("div", "ai-row-actions");
      const existingFeedback = item.feedback && item.feedback.event_type;
      const answerCanBeRated = ["auto_sent", "draft_created"].includes(item.status);
      const canBeLabeled = ["human_review", "failed", "workflow_applied"].includes(item.status);
      const choices = answerCanBeRated
        ? [["correct", "Correct"], ["correction", "Needs correction"], ["resolved", "Resolved"], ["escalated", "Needs a person"]]
        : canBeLabeled ? [["resolved", "Resolved"], ["escalated", "Needs a person"]] : [];
      if (existingFeedback) {
        const labels = { feedback_correct: "Correct", feedback_correction: "Needs correction", feedback_resolved: "Resolved", feedback_escalated: "Needs a person" };
        feedback.append(insightNode("small", "", `You marked: ${labels[existingFeedback] || "Feedback saved"}`));
      }
      for (const [outcome, label] of choices) {
        const button = insightNode("button", "quiet-button", label);
        button.type = "button";
        button.disabled = Boolean(existingFeedback);
        button.setAttribute("aria-label", `${label} for ${item.subject || "this AI decision"}`);
        button.addEventListener("click", async () => {
          let correctionNote = "";
          if (outcome === "correction") { correctionNote = window.prompt("What needs correcting? This note is saved only for your account.") || ""; if (!correctionNote.trim()) return; }
          button.disabled = true;
          try { await api("/api/ai/trust", { method: "POST", body: { messageId: item.messageId, outcome, correctionNote } }); await loadAITrust(); toast("Feedback saved."); }
          catch (error) { toast(error.message); button.disabled = false; }
        });
        feedback.append(button);
      }
      row.append(detail, feedback);
      rows.append(row);
    }
  };
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
  render();
}

async function loadAITrust() {
  const metrics = $("#aiTrustMetrics"); const recent = $("#aiTrustRecent");
  metrics.replaceChildren(); recent.replaceChildren();
  try {
    const days = $("#aiTrustDays").value || "30";
    const query = new URLSearchParams({ days }); if (selectedMailbox) query.set("mailboxId", selectedMailbox.id);
    const result = await api(`/api/ai/trust?${query}`);
    renderTrustMetrics(result, metrics);
    renderTrustRecent(result.recent || [], recent);
  } catch (error) { const note = document.createElement("p"); note.className = "ai-empty-note error"; note.textContent = error.message; metrics.append(note); }
}

async function loadAISetup() {
  const version = ++aiSetupLoadVersion;
  const mailboxId = selectedMailbox ? selectedMailbox.id : null;
  const isCurrent = () => version === aiSetupLoadVersion && mailboxId === (selectedMailbox ? selectedMailbox.id : null);
  $("#aiWorkspaceLoadNotice").hidden = true;
  $("#aiProfileStatus").classList.remove("error");
  $("#aiKnowledgeStatus").classList.remove("error");
  $("#aiProfileStatus").textContent = "Loading saved information…";
  $("#aiKnowledgeStatus").textContent = "";
  try {
    const [profileResult, knowledgeResult, mailboxResult] = await Promise.all([
      api("/api/ai/profile"),
      api("/api/ai/knowledge"),
      mailboxId ? api(`/api/ai/mailbox-settings?mailboxId=${encodeURIComponent(mailboxId)}`) : Promise.resolve(null)
    ]);
    const representativeResult = await api("/api/ai/representatives" + (mailboxId ? "?mailboxId=" + encodeURIComponent(mailboxId) : "")).catch((error) => ({ error }));
    if (!isCurrent()) return;
    aiRepresentatives = representativeResult.representatives || [];
    window.openmailMailboxSetting = mailboxResult && mailboxResult.settings || representativeResult.mailboxSetting || null;
    renderAIRepresentatives();
    refreshRepresentativeSelects(window.openmailMailboxSetting && window.openmailMailboxSetting.representative_id || "");
    const profile = profileResult.profile || {};
    aiProviderConfigured = Boolean(profileResult.provider && profileResult.provider.configured);
    aiProfileEnabled = Boolean(profile.enabled);
    aiMailReady = Boolean(profileResult.mailReady);
    $("#aiCompanyName").value = profile.company_name || "";
    $("#aiCompanyDescription").value = profile.company_description || "";
    $("#aiProductsServices").value = profile.products_services || "";
    $("#aiPricing").value = profile.pricing || "";
    $("#aiBusinessHours").value = profile.business_hours || "";
    $("#aiPolicies").value = profile.policies || "";
    $("#aiEnableDrafts").checked = aiProfileEnabled;
    aiAutomaticEnabled = Boolean(mailboxResult && mailboxResult.settings && mailboxResult.settings.auto_reply_enabled);
    $("#aiAutoMailboxLabel").textContent = selectedMailbox
      ? `Selected mailbox: ${selectedMailbox.address}`
      : "Choose an active mailbox before configuring automatic replies.";
    $("#aiAutomaticReplies").checked = aiAutomaticEnabled;
    const assignedRepId = mailboxResult && mailboxResult.settings && mailboxResult.settings.representative_id || "";
    const assignedRepEnabled = aiRepresentatives.some((item) => item.id === assignedRepId && item.enabled);
    const canEnableAuto = Boolean(selectedMailbox && aiProfileEnabled && aiProviderConfigured && aiMailReady && mailboxResult && mailboxResult.domainVerified && assignedRepEnabled);
    $("#aiAutomaticReplies").disabled = !selectedMailbox || (!canEnableAuto && !aiAutomaticEnabled);
    $("#saveAIReplyMode").disabled = !selectedMailbox;
    const autoStatus = $("#aiAutoReplyStatus");
    autoStatus.classList.remove("error");
    autoStatus.textContent = aiAutomaticEnabled
      ? "Automatic replies are enabled for this mailbox."
      : !selectedMailbox ? "Choose a mailbox first."
        : !aiProviderConfigured ? "Groq is not connected on this deployment."
          : !aiMailReady ? "Mail sending is not ready."
            : !mailboxResult.domainVerified ? "Verify this mailbox’s domain before enabling."
              : !assignedRepEnabled ? "Assign an enabled representative to this mailbox first."
                : !aiProfileEnabled ? "Enable and save the AI representative first."
                : "Automatic replies are off.";
    updateAISafetyNotice();
    $("#aiProfileStatus").textContent = profile.updated_at ? `Saved ${displayTime(profile.updated_at)}.` : "Not saved yet.";
    renderAIKnowledge(knowledgeResult.entries || []);
    if (representativeResult.error) {
      const status = $("#aiRepresentativeStatus");
      status.textContent = "Apply the phases 2–5 database migration to enable these tools.";
      status.classList.add("error");
    }
    loadAISimulator();
    if (selectedAITab === "workflows") loadAIWorkflows();
    if (selectedAITab === "trust") loadAITrust();
  } catch (error) {
    if (!isCurrent()) return;
    aiPanelLoadMailbox = undefined;
    $("#aiWorkspaceLoadNotice").hidden = false;
    $("#aiWorkspaceLoadStatus").textContent = `We couldn’t load your AI workspace. ${error.message}`;
    $("#aiProfileStatus").textContent = error.message;
    $("#aiProfileStatus").classList.add("error");
    $("#aiKnowledgeList").replaceChildren();
    const unavailable = document.createElement("p");
    unavailable.className = "ai-empty-note error";
    unavailable.textContent = error.message;
    $("#aiKnowledgeList").append(unavailable);
  }
}

$("#aiProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#aiProfileStatus").classList.remove("error");
  $("#aiProfileStatus").textContent = "Saving company profile…";
  try {
    await api("/api/ai/profile", {
      method: "PATCH",
      body: {
        companyName: $("#aiCompanyName").value,
        companyDescription: $("#aiCompanyDescription").value,
        productsServices: $("#aiProductsServices").value,
        pricing: $("#aiPricing").value,
        businessHours: $("#aiBusinessHours").value,
        policies: $("#aiPolicies").value,
        enabled: $("#aiEnableDrafts").checked
      }
    });
    aiProfileEnabled = $("#aiEnableDrafts").checked;
    if (!aiProfileEnabled) {
      aiAutomaticEnabled = false;
      $("#aiAutomaticReplies").checked = false;
      $("#aiAutomaticReplies").disabled = true;
    }
    updateAISafetyNotice();
    loadAISetup();
    $("#aiProfileStatus").textContent = "Company profile saved to your account.";
    toast("Company profile saved.");
  } catch (error) {
    $("#aiProfileStatus").textContent = error.message;
    $("#aiProfileStatus").classList.add("error");
  } finally { button.disabled = false; }
});

$("#saveAIReplyMode").addEventListener("click", async () => {
  if (!selectedMailbox) return toast("Choose a mailbox first.");
  const checkbox = $("#aiAutomaticReplies");
  const enabled = checkbox.checked;
  if (enabled && !aiAutomaticEnabled) {
    const accepted = window.confirm(
      `Allow OpenMail to automatically send supported AI replies from ${selectedMailbox.address}? Sensitive or uncertain messages will be held for your review. You can turn this off here at any time.`
    );
    if (!accepted) { checkbox.checked = aiAutomaticEnabled; return; }
  }
  const button = $("#saveAIReplyMode");
  const status = $("#aiAutoReplyStatus");
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = enabled ? "Saving automatic reply setting…" : "Turning automatic replies off…";
  try {
    const result = await api("/api/ai/mailbox-settings", {
      method: "PATCH",
      body: { mailboxId: selectedMailbox.id, representativeId: $("#aiMailboxRepresentative").value, enabled, confirmAutomaticSending: enabled }
    });
    aiAutomaticEnabled = Boolean(result.settings && result.settings.auto_reply_enabled);
    checkbox.checked = aiAutomaticEnabled;
    status.textContent = aiAutomaticEnabled ? "Automatic replies enabled for this mailbox." : "Automatic replies are off.";
    updateAISafetyNotice();
    toast(aiAutomaticEnabled ? "Automatic replies enabled." : "Automatic replies turned off.");
  } catch (error) {
    checkbox.checked = aiAutomaticEnabled;
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    button.disabled = !selectedMailbox;
  }
});

$("#aiKnowledgeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#aiKnowledgeStatus").classList.remove("error");
  $("#aiKnowledgeStatus").textContent = "Saving approved information…";
  try {
    await api("/api/ai/knowledge", {
      method: "POST",
      body: {
        title: $("#aiKnowledgeTitleInput").value,
        type: $("#aiKnowledgeType").value,
        content: $("#aiKnowledgeContent").value,
        representativeId: $("#aiKnowledgeRepresentative").value || null
      }
    });
    $("#aiKnowledgeForm").reset();
    $("#aiKnowledgeStatus").textContent = "Saved to your account.";
    await loadAIKnowledge();
    toast("Knowledge note saved.");
  } catch (error) {
    $("#aiKnowledgeStatus").textContent = error.message;
    $("#aiKnowledgeStatus").classList.add("error");
  } finally { button.disabled = false; }
});

document.querySelectorAll("button[data-workspace-view]").forEach((button) => button.addEventListener("click", () => navigateWorkspace(button.dataset.workspaceView)));
$("#retryAISetup").addEventListener("click", () => navigateWorkspace(aiPanel.dataset.workspaceView));
document.addEventListener("click", (event) => {
  for (const selector of [".mobile-workspace-menu", ".mail-folder-menu"]) {
    if (!$(selector).contains(event.target)) closeNavigationMenu(selector);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNavigationMenu(".mobile-workspace-menu");
    closeNavigationMenu(".mail-folder-menu");
  }
});
$("#mobileMyAIButton").addEventListener("click", openAIPanel);
$("#domainsMyAIButton").addEventListener("click", openAIPanel);
$("#aiBackToInbox").addEventListener("click", () => {
  if (selectedMailbox) openInbox();
  else openDomains();
});

document.querySelectorAll("[data-ai-tab]").forEach((button) => button.addEventListener("click", () => setAIView(button.dataset.aiTab)));
document.querySelectorAll("[data-ai-open]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  navigateWorkspace(link.dataset.aiOpen === "representatives" ? "team" : link.dataset.aiOpen);
}));

$("#saveMailboxRepresentative").addEventListener("click", async () => {
  if (!selectedMailbox) return toast("Choose a mailbox first.");
  const representativeId = $("#aiMailboxRepresentative").value;
  if (!aiRepresentatives.some((item) => item.id === representativeId && item.enabled)) return toast("Choose an enabled representative.");
  const previousRepresentativeId = window.openmailMailboxSetting && window.openmailMailboxSetting.representative_id;
  if (aiAutomaticEnabled && representativeId !== previousRepresentativeId && !window.confirm("Change the AI representative that handles automatically processed mail for " + selectedMailbox.address + "?")) return;
  const button = $("#saveMailboxRepresentative");
  button.disabled = true;
  setStatus($("#aiRepresentativeStatus"), "Saving mailbox assignment…");
  try {
    const result = await api("/api/ai/mailbox-settings", {
      method: "PATCH", body: { mailboxId: selectedMailbox.id, representativeId, enabled: aiAutomaticEnabled, confirmAutomaticSending: aiAutomaticEnabled }
    });
    window.openmailMailboxSetting = result.settings;
    setStatus($("#aiRepresentativeStatus"), "Mailbox assignment saved.");
    await loadAISetup();
  } catch (error) { setStatus($("#aiRepresentativeStatus"), error.message, true); }
  finally { button.disabled = !selectedMailbox || !aiRepresentatives.some((item) => item.id === $("#aiMailboxRepresentative").value && item.enabled); }
});

$("#aiSimulatorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  setStatus($("#aiSimulatorStatus"), "Running the synthetic test through Groq…");
  try {
    const result = await api("/api/ai/simulator", { method: "POST", body: {
      testName: $("#aiSimulatorName").value, representativeId: $("#aiSimulatorRepresentative").value,
      subject: $("#aiSimulatorSubject").value, emailText: $("#aiSimulatorEmail").value,
      expectedDecision: $("#aiSimulatorExpected").value
    }});
    renderSimulationResult(result);
    setStatus($("#aiSimulatorStatus"), result.evaluation.passed ? "Test passed." : "Test completed; review the result and citations.");
    await loadAISimulator();
  } catch (error) { setStatus($("#aiSimulatorStatus"), error.message, true); }
  finally { button.disabled = false; }
});

$("#aiWorkflowTrigger").addEventListener("change", setAIWorkflowFields);
$("#aiWorkflowAction").addEventListener("change", setAIWorkflowFields);
$("#aiWorkflowForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedMailbox) return setStatus($("#aiWorkflowStatus"), "Choose a mailbox first.", true);
  const action = $("#aiWorkflowAction").value;
  const enabled = $("#aiWorkflowEnabled").checked;
  if (enabled && action === "verified_reply" && !window.confirm("Enable this rule to attempt verified AI replies? OpenMail will still send only if automatic replies are separately enabled for this mailbox, the message is safe, and approved sources support the complete reply.")) return;
  const button = event.submitter;
  button.disabled = true;
  setStatus($("#aiWorkflowStatus"), "Saving workflow…");
  try {
    const payload = workflowPayload();
    payload.id = $("#aiWorkflowId").value || undefined;
    const result = await api("/api/ai/workflows", { method: "POST", body: payload });
    $("#aiWorkflowId").value = result.workflow.id;
    setStatus($("#aiWorkflowStatus"), "Workflow saved.");
    await loadAIWorkflows();
    toast("Workflow saved.");
  } catch (error) { setStatus($("#aiWorkflowStatus"), error.message, true); }
  finally { button.disabled = false; }
});

$("#refreshAITrust").addEventListener("click", loadAITrust);
$("#aiTrustDays").addEventListener("change", loadAITrust);
$("#aiWorkflowAction").dispatchEvent(new Event("change"));
$("#aiWorkflowTrigger").dispatchEvent(new Event("change"));

function renderDomains() {
  const root = $("#domainList");
  root.replaceChildren();
  $("#domainEmpty").hidden = domains.length > 0;
  $("#domainCount").textContent = `${domains.length} ${domains.length === 1 ? "domain" : "domains"}`;
  const picker = $("#domainPicker");
  picker.replaceChildren();
  const verifiedDomains = domains.filter((item) => item.status === "verified");
  if (!verifiedDomains.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = domains.length ? "Verify a domain first" : "Connect a domain first";
    picker.append(option);
    picker.disabled = true;
    $("#mailboxForm").querySelector("button[type=submit]").disabled = true;
  } else {
    picker.disabled = false;
    $("#mailboxForm").querySelector("button[type=submit]").disabled = !systemStatus.mailReady;
    verifiedDomains.forEach((domain) => {
      const option = document.createElement("option");
      option.value = domain.id;
      option.textContent = domain.domain_name;
      picker.append(option);
    });
  }
  domains.forEach((domain) => {
    const row = document.createElement("article");
    row.className = "domain-row";
    const top = document.createElement("div");
    top.className = "domain-row-top";
    const name = document.createElement("div");
    name.className = "domain-name";
    name.textContent = domain.domain_name;
    const status = document.createElement("span");
    const isVerified = domain.status === "verified";
    status.className = `domain-status ${isVerified ? "verified" : "pending"}`;
    status.textContent = domain.status || "pending";
    name.append(status);
    const actions = document.createElement("div");
    actions.className = "domain-row-actions";
    const verify = makeButton(isVerified ? "Refresh DNS status" : "Check DNS records", "", async () => {
      verify.disabled = true;
      verify.textContent = "Checking…";
      try {
        const result = await api(`/api/domains/${encodeURIComponent(domain.id)}/verify`, { method: "POST", body: {} });
        domains = domains.map((item) => item.id === domain.id ? result.domain : item);
        renderDomains();
        toast(result.domain.status === "verified" ? "Domain records are verified." : "Records are not verified yet. DNS changes can take time to appear.");
      } catch (error) { verify.disabled = false; verify.textContent = "Try verification again"; toast(error.message); }
    });
    actions.append(verify);
    top.append(name, actions);
    row.append(top);
    const related = mailboxes.filter((item) => item.domain_id === domain.id);
    if (related.length) {
      const chips = document.createElement("div");
      chips.className = "domain-addresses";
      related.forEach((mailbox) => {
        const chip = document.createElement("span");
        chip.className = "domain-address-chip";
        chip.textContent = mailbox.address;
        chips.append(chip);
      });
      row.append(chips);
    }
    const details = document.createElement("details");
    details.className = "dns-details";
    const summary = document.createElement("summary");
    summary.textContent = "DNS records supplied by the mail provider";
    details.append(summary);
    const records = Array.isArray(domain.dns_records) ? domain.dns_records : [];
    if (records.length) {
      const table = document.createElement("table");
      table.className = "dns-table";
      const header = document.createElement("tr");
      ["TYPE", "NAME / HOST", "VALUE", "PRIORITY"].forEach((label) => { const th = document.createElement("th"); th.textContent = label; header.append(th); });
      const thead = document.createElement("thead"); thead.append(header); table.append(thead);
      const tbody = document.createElement("tbody");
      records.forEach((record) => {
        const tr = document.createElement("tr");
        [record.type || record.record || "—", record.name || "@", record.value || "—", record.priority ?? "—"].forEach((value) => { const td = document.createElement("td"); td.textContent = String(value); tr.append(td); });
        tbody.append(tr);
      });
      table.append(tbody);
      details.append(table);
      const note = document.createElement("p");
      note.className = "dns-note";
      note.textContent = "These are the settings your domain provider needs to connect this address to OpenMail. Nothing has been changed yet. Review each record with your domain provider before approving it.";
      details.append(note);
    } else {
      const note = document.createElement("p");
      note.className = "dns-note";
      note.textContent = "The provider has not returned DNS records yet. Try refreshing the domain status.";
      details.append(note);
    }
    row.append(details);
    root.append(row);
  });
}

function renderMailboxChoices() {
  [$("#mailboxPicker"), $("#mobileMailboxPicker")].forEach((picker) => {
    picker.replaceChildren();
    mailboxes.forEach((mailbox) => {
      const option = document.createElement("option");
      option.value = mailbox.id;
      option.textContent = mailbox.address;
      picker.append(option);
    });
    picker.disabled = mailboxes.length === 0;
  });
}

$("#domainForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#domainInput");
  const button = event.submitter;
  button.disabled = true;
  setStatus($("#domainMessage"), "Checking whether this domain already receives email…");
  try {
    const check = await api(`/api/domains?check=${encodeURIComponent(input.value)}`);
    if (check.existingMailRoute === true) {
      const routes = check.mx.map((item) => `${item.host} (priority ${item.priority})`).join("\n");
      const proceed = window.confirm(
        `This domain already has an email route:\n\n${routes}\n\nOpenMail will not change it. To receive mail here, a domain owner may later need to approve a new mail route, which could affect the current inbox. Continue and prepare the OpenMail setup?`
      );
      if (!proceed) {
        setStatus($("#domainMessage"), "No settings were changed. Ask the domain owner to review the current email service first.");
        return;
      }
    } else if (check.existingMailRoute === false) {
      setStatus($("#domainMessage"), "No MX mail route was found. Preparing the OpenMail setup…");
    } else {
      const proceed = window.confirm(
        "OpenMail could not check this domain's current mail route. This step will not change DNS, but adding the later mail settings may affect an existing inbox. Continue to prepare setup instructions?"
      );
      if (!proceed) {
        setStatus($("#domainMessage"), "No settings were changed. Check with the domain owner before continuing.");
        return;
      }
    }
    const result = await api("/api/domains", { method: "POST", body: { domain: input.value } });
    domains.unshift(result.domain);
    input.value = "";
    renderDomains();
    setStatus($("#domainMessage"), "OpenMail has not changed your settings. Review the setup with your domain provider before approving it.");
  } catch (error) { setStatus($("#domainMessage"), error.message, true); }
  finally { button.disabled = false; }
});

$("#mailboxForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  setStatus($("#mailboxMessage"), "Creating mailbox…");
  try {
    const result = await api("/api/mailboxes", {
      method: "POST", body: { localPart: $("#localPartInput").value, domainId: $("#domainPicker").value }
    });
    mailboxes.unshift(result.mailbox);
    renderMailboxChoices();
    $("#mailboxPicker").value = result.mailbox.id;
    $("#mobileMailboxPicker").value = result.mailbox.id;
    selectedMailbox = result.mailbox;
    $("#localPartInput").value = "";
    renderDomains();
    setStatus($("#mailboxMessage"), `${result.mailbox.address} is ready in OpenMail.`);
    setTopbarState("SIGNED IN / PRIVATE SPACE");
    setTimeout(openInbox, 550);
  } catch (error) { setStatus($("#mailboxMessage"), error.message, true); }
  finally { button.disabled = verifiedDomainsReady() ? false : true; }
});

function verifiedDomainsReady() { return domains.some((item) => item.status === "verified"); }

async function selectMailbox(id) {
  selectedMailbox = mailboxes.find((item) => item.id === id) || null;
  if (!selectedMailbox) return;
  selectedMessageIds.clear();
  categoryCounts = { all: 0, primary: 0, social: 0, promotions: 0, updates: 0, spam: 0, starred: 0, drafts: 0, unread: 0, aiSent: 0, needsReview: 0 };
  renderCategoryCounts();
  $("#mailboxPicker").value = selectedMailbox.id;
  $("#mobileMailboxPicker").value = selectedMailbox.id;
  selectedView = "inbox";
  syncViewControls();
  openInbox();
}

$("#mailboxPicker").addEventListener("change", () => selectMailbox($("#mailboxPicker").value));
$("#mobileMailboxPicker").addEventListener("change", () => selectMailbox($("#mobileMailboxPicker").value));

function syncViewControls() {
  syncWorkspaceNavigation("inbox");
  document.querySelectorAll(".mail-side-link[data-view], .mobile-folder-scroll [data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === selectedView));
  $("#myAIButton").classList.remove("active");
  $("#mobileMyAIButton").classList.remove("active");
  document.querySelectorAll(".mail-tab[data-view]").forEach((item) => {
    const active = item.dataset.view === selectedView;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
}

function updateSelectionControls() {
  const selectedCount = selectedMessageIds.size;
  const selectedVisibleCount = visibleMessageIds.filter((id) => selectedMessageIds.has(id)).length;
  const selectAll = $("#selectAll");
  $("#mailActionbar").hidden = selectedCount === 0;
  $("#selectionSummary").textContent = `${selectedCount} selected`;
  selectAll.checked = visibleMessageIds.length > 0 && selectedVisibleCount === visibleMessageIds.length;
  selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleMessageIds.length;
  selectAll.disabled = visibleMessageIds.length === 0;
  $("#bulkArchive").textContent = selectedView === "archive" ? "Move to inbox" : "Archive";
  $("#bulkSpam").textContent = selectedView === "spam" ? "Move to inbox" : "Mark spam";
  $("#bulkTrash").textContent = selectedView === "trash" ? "Restore" : "Move to trash";
}

async function bulkMoveMessages(target) {
  const ids = [...selectedMessageIds];
  if (!ids.length || !selectedMailbox) return;
  try {
    await api("/api/messages", { method: "PATCH", body: { action: target, mailboxId: selectedMailbox.id, ids } });
    selectedMessageIds.clear();
    await loadMessages();
    toast(target === "inbox" ? "Messages moved to Inbox." : `Messages moved to ${target}.`);
  } catch (error) { toast(error.message); }
}

async function loadMessages() {
  if (!selectedMailbox || domainsPanel.hidden === false) return;
  const mailboxId = selectedMailbox.id;
  const requestedView = selectedView;
  const sourceView = Object.prototype.hasOwnProperty.call(inboxCategoryNames, selectedView) ? "inbox" : selectedView;
  const params = new URLSearchParams({ mailboxId: selectedMailbox.id, view: sourceView });
  const [result, starredResult, draftsResult, aiSentResult, needsReviewResult] = await Promise.all([
    api(`/api/messages?${params}`),
    sourceView === "starred" ? Promise.resolve(null) : api(`/api/messages?${new URLSearchParams({ mailboxId: selectedMailbox.id, view: "starred" })}`),
    sourceView === "drafts" ? Promise.resolve(null) : api(`/api/messages?${new URLSearchParams({ mailboxId: selectedMailbox.id, view: "drafts" })}`),
    sourceView === "ai_sent" ? Promise.resolve(null) : api(`/api/messages?${new URLSearchParams({ mailboxId: selectedMailbox.id, view: "ai_sent" })}`),
    sourceView === "needs_review" ? Promise.resolve(null) : api(`/api/messages?${new URLSearchParams({ mailboxId: selectedMailbox.id, view: "needs_review" })}`)
  ]);
  if (!selectedMailbox || selectedMailbox.id !== mailboxId || selectedView !== requestedView || !aiPanel.hidden || !domainsPanel.hidden) return;
  currentMessages = result.messages || [];
  categoryCounts.starred = sourceView === "starred" ? currentMessages.length : ((starredResult && starredResult.messages) || []).length;
  categoryCounts.drafts = sourceView === "drafts" ? currentMessages.length : ((draftsResult && draftsResult.messages) || []).length;
  categoryCounts.aiSent = sourceView === "ai_sent" ? currentMessages.length : ((aiSentResult && aiSentResult.messages) || []).length;
  categoryCounts.needsReview = sourceView === "needs_review" ? currentMessages.length : ((needsReviewResult && needsReviewResult.messages) || []).length;
  if (sourceView === "inbox") {
    categoryCounts.all = currentMessages.length;
    categoryCounts.unread = currentMessages.filter((item) => !item.read_at && item.direction === "inbound").length;
    for (const view of Object.keys(inboxCategoryNames)) categoryCounts[view] = currentMessages.filter((item) => categorizeMessage(item) === view).length;
  } else if (sourceView === "spam") {
    categoryCounts.spam = currentMessages.length;
  }
  $("#currentMailboxHeading").textContent = selectedMailbox.address.toUpperCase();
  const viewLabels = { inbox: "All mail", ...inboxCategoryNames, sent: "Sent", ai_sent: "AI replies", needs_review: "Needs your help", archive: "Archive", spam: "Spam", trash: "Trash", starred: "Starred", drafts: "Drafts" };
  $("#currentViewHeading").textContent = viewLabels[selectedView] || "All mail";
  $("#folderMenuCurrent").textContent = viewLabels[selectedView] || "All mail";
  renderCategoryCounts();
  renderMessages();
}

function renderMessages() {
  liveList.replaceChildren();
  const query = $("#messageSearch").value.trim().toLocaleLowerCase();
  const viewMessages = Object.prototype.hasOwnProperty.call(inboxCategoryNames, selectedView)
    ? currentMessages.filter((message) => categorizeMessage(message) === selectedView)
    : selectedView === "starred"
      ? currentMessages.filter((message) => message.starred && message.folder !== "trash")
      : selectedView === "drafts"
        ? currentMessages.filter((message) => message.folder === "drafts")
        : selectedView === "ai_sent"
          ? currentMessages.filter((message) => message.ai_auto_sent && message.status === "sent")
          : selectedView === "needs_review"
            ? currentMessages.filter((message) => message.ai_handoff_status === "pending")
        : currentMessages;
  const visibleMessages = query ? viewMessages.filter((message) => [
    message.from_address, ...(message.to_addresses || []), message.subject, message.preview, message.text_body
  ].join(" ").toLocaleLowerCase().includes(query)) : viewMessages;
  visibleMessageIds = visibleMessages.map((message) => message.id);
  $("#messageSummary").textContent = query
    ? `${visibleMessages.length} ${visibleMessages.length === 1 ? "match" : "matches"}`
    : visibleMessages.length ? `1–${visibleMessages.length} of ${visibleMessages.length}` : "0 messages";
  const tones = ["sand", "violet", "sage", "blue", "amber", "teal", "rose"];
  visibleMessages.forEach((message, index) => {
    const senderLabel = message.folder === "drafts" ? ((message.to_addresses || []).join(", ") || "Draft") : message.direction === "outbound" ? (message.to_addresses || []).join(", ") : message.from_address;
    const sender = senderLabel || "Unknown sender";
    const title = message.subject || "(no subject)";
    const row = document.createElement("article");
    row.className = `message-row${!message.read_at && message.direction === "inbound" ? " unread" : ""}`;
    row.tabIndex = 0;
    row.dataset.messageId = message.id;
    row.setAttribute("aria-label", `Open email from ${sender}: ${title}`);
    row.classList.toggle("selected", selectedMessageIds.has(message.id));

    const selection = document.createElement("label");
    selection.className = "message-check";
    selection.title = "Select this message";
    selection.setAttribute("aria-label", `Select ${title}`);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedMessageIds.has(message.id);
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      if (checkbox.checked) selectedMessageIds.add(message.id);
      else selectedMessageIds.delete(message.id);
      row.classList.toggle("selected", checkbox.checked);
      updateSelectionControls();
    });
    const checkboxMark = document.createElement("span");
    selection.append(checkbox, checkboxMark);

    const avatar = document.createElement("span");
    avatar.className = `sender-avatar tone-${tones[index % tones.length]}`;
    avatar.textContent = initials(sender);
    avatar.setAttribute("aria-hidden", "true");

    const senderWrap = document.createElement("span");
    senderWrap.className = "message-meta";
    const senderName = document.createElement("span");
    senderName.className = "message-sender";
    senderName.textContent = sender;
    const category = document.createElement("span");
    category.className = "category-label";
    category.textContent = message.folder === "drafts" ? "Draft"
      : message.folder === "spam" ? "Spam"
      : message.folder === "archive" ? "Archive"
      : message.folder === "trash" ? "Trash"
      : message.ai_auto_sent && message.status === "sent" ? "AI Sent"
      : message.ai_handoff_status === "pending" ? "Needs your help"
      : selectedView === "sent" ? "Sent"
      : inboxCategoryNames[categorizeMessage(message)] || "Inbox";
    senderWrap.append(senderName, category);
    if (message.ai_representative_id) {
      const representative = aiRepresentatives.find((item) => item.id === message.ai_representative_id);
      const assignment = document.createElement("span");
      assignment.className = "category-label ai-assignment-label";
      assignment.textContent = representative ? "AI · " + representative.display_name : "AI assigned";
      assignment.title = message.ai_workflow_id ? "Assigned by a mailbox workflow" : "Assigned to an AI representative";
      senderWrap.append(assignment);
    }

    const subject = document.createElement("span");
    subject.className = "message-subject";
    subject.textContent = title;
    const preview = document.createElement("span");
    preview.className = "message-preview";
    preview.textContent = `— ${message.preview || message.text_body || ""}`;
    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = displayTime(message.created_at);
    time.dateTime = message.created_at || "";
    const star = document.createElement("button");
    star.type = "button";
    star.className = `star-button${message.starred ? " starred" : ""}`;
    star.textContent = "★";
    star.setAttribute("aria-label", `${message.starred ? "Unstar" : "Star"} ${title}`);
    star.setAttribute("aria-pressed", String(Boolean(message.starred)));
    star.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const result = await api(`/api/messages/${encodeURIComponent(message.id)}`, {
          method: "PATCH", body: { action: "star", starred: !message.starred }
        });
        message.starred = result.message.starred;
        if (currentMessage && currentMessage.id === message.id) {
          currentMessage.starred = message.starred;
          $("#detailStar").textContent = message.starred ? "★ Starred" : "☆ Star";
        }
        await loadMessages();
      } catch (error) { toast(error.message); }
    });

    row.append(selection, avatar, senderWrap, subject, preview, time, star);
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input, label")) return;
      if (message.folder === "drafts") openCompose({ draft: message });
      else openMessage(message);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        if (message.folder === "drafts") openCompose({ draft: message });
        else openMessage(message);
      }
    });
    liveList.append(row);
  });
  const empty = visibleMessages.length === 0;
  $("#emptyMail").hidden = !empty;
  if (empty) {
    const labels = {
      inbox: ["Your inbox is clear.", "New mail sent to this address will appear here."],
      primary: ["No primary messages yet.", "Personal conversations that do not match another category appear here."],
      social: ["No social messages yet.", "Notifications from social and community services appear here."],
      promotions: ["No promotions yet.", "Offers and marketing messages appear here."],
      updates: ["No updates yet.", "Receipts, account notices and other transactional messages appear here."],
      sent: ["Nothing sent yet.", "Messages you send from this mailbox appear here."],
      archive: ["Nothing archived.", "Archive a message to move it here."],
      starred: ["Nothing starred yet.", "Star a message to keep it easy to find here."],
      drafts: ["No drafts yet.", "Messages you save while composing appear here."],
      ai_sent: ["No automatic replies sent yet.", "Replies that pass the safety checks will appear here."],
      needs_review: ["No messages need review.", "Sensitive or uncertain requests are held here when automatic replies are enabled."],
      spam: ["No spam.", "Messages you mark as spam appear here."],
      trash: ["Nothing in the trash.", "Deleted messages will appear here."]
    };
    $("#emptyTitle").textContent = query ? "No messages found" : labels[selectedView][0];
    $("#emptyCopy").textContent = query ? "Try a different sender, subject or phrase." : labels[selectedView][1];
  }
  updateSelectionControls();
}

async function openMessage(message) {
  currentMessage = message;
  if (!message.read_at && message.direction === "inbound") {
    try {
      const result = await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: "PATCH", body: { action: "read" } });
      message.read_at = result.message.read_at;
    } catch (error) { toast(error.message); }
  }
  inboxPane.hidden = true;
  aiPanel.hidden = true;
  messageDetail.hidden = false;
  $("#detailSubject").textContent = message.subject || "(no subject)";
  const from = message.direction === "outbound" ? `You <${message.from_address}>` : message.from_address;
  $("#detailFrom").textContent = from || "Unknown sender";
  $("#detailTo").textContent = message.direction === "outbound" ? `To: ${(message.to_addresses || []).join(", ")}` : `To: ${selectedMailbox.address}`;
  $("#detailAvatar").textContent = initials(from);
  $("#detailTime").textContent = new Date(message.created_at).toLocaleString();
  $("#detailBody").textContent = message.text_body || "(This message has no plain text body.)";
  const assignedRepresentative = aiRepresentatives.find((item) => item.id === message.ai_representative_id);
  $("#aiAssignmentNote").hidden = !message.ai_representative_id;
  $("#aiAssignmentNote").textContent = message.ai_representative_id
    ? "Assigned to " + (assignedRepresentative ? assignedRepresentative.display_name : "an AI representative") + (message.ai_workflow_id ? " by a mailbox workflow." : ".")
    : "";
  const attachments = Array.isArray(message.attachment_metadata) ? message.attachment_metadata : [];
  $("#attachmentNote").hidden = attachments.length === 0;
  $("#attachmentNote").textContent = attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} received. Attachment downloads are not available in this first build.` : "";
  $("#detailStar").textContent = message.starred ? "★ Starred" : "☆ Star";
  $("#detailArchive").textContent = message.folder === "archive" ? "Move to inbox ↗" : "Archive ↗";
  $("#detailSpam").textContent = message.folder === "spam" ? "Move to inbox" : "Mark spam";
  $("#detailTrash").textContent = message.folder === "trash" ? "Move to inbox" : "Move to trash";
  $("#aiHandoffBanner").hidden = message.ai_handoff_status !== "pending";
  $("#aiHandoffReason").textContent = message.ai_handoff_status === "pending" ? (message.ai_handoff_reason || "A person should review and reply to this message.") : "";
  $("#resolveHandoffButton").disabled = message.ai_handoff_status !== "pending";
  $("#aiSentBanner").hidden = !message.ai_auto_sent || message.status !== "sent";
  $("#replyButton").hidden = message.direction !== "inbound";
  syncAIDraftButton();
  await loadMessages().catch(() => {});
  messageDetail.hidden = false;
  inboxPane.hidden = true;
}

$("#backToList").addEventListener("click", () => { currentMessage = null; messageDetail.hidden = true; inboxPane.hidden = false; });
async function moveCurrentMessage(target) {
  if (!currentMessage) return;
  try {
    await api(`/api/messages/${encodeURIComponent(currentMessage.id)}`, { method: "PATCH", body: { action: target } });
    currentMessage = null;
    messageDetail.hidden = true;
    inboxPane.hidden = false;
    await loadMessages();
    toast(target === "inbox" ? "Message moved to Inbox." : `Message moved to ${target}.`);
  } catch (error) { toast(error.message); }
}

$("#detailArchive").addEventListener("click", () => moveCurrentMessage(currentMessage && currentMessage.folder === "archive" ? "inbox" : "archive"));
$("#detailSpam").addEventListener("click", () => moveCurrentMessage(currentMessage && currentMessage.folder === "spam" ? "inbox" : "spam"));
$("#detailTrash").addEventListener("click", () => moveCurrentMessage(currentMessage && currentMessage.folder === "trash" ? "inbox" : "trash"));
$("#detailStar").addEventListener("click", async () => {
  if (!currentMessage) return;
  try {
    const result = await api(`/api/messages/${encodeURIComponent(currentMessage.id)}`, { method: "PATCH", body: { action: "star", starred: !currentMessage.starred } });
    currentMessage.starred = result.message.starred;
    $("#detailStar").textContent = currentMessage.starred ? "★ Starred" : "☆ Star";
    await loadMessages();
    messageDetail.hidden = false;
    inboxPane.hidden = true;
  } catch (error) { toast(error.message); }
});

$("#resolveHandoffButton").addEventListener("click", async () => {
  if (!currentMessage || currentMessage.ai_handoff_status !== "pending") return;
  const button = $("#resolveHandoffButton");
  button.disabled = true;
  try {
    await api(`/api/messages/${encodeURIComponent(currentMessage.id)}`, { method: "PATCH", body: { action: "resolveHandoff" } });
    currentMessage.ai_handoff_status = "resolved";
    $("#aiHandoffBanner").hidden = true;
    await loadMessages();
    toast("Handoff marked as reviewed.");
  } catch (error) { toast(error.message); button.disabled = false; }
});

function openCompose({ to = "", subject = "", text = "", draft = null, aiDraft = false } = {}) {
  if (!selectedMailbox) return toast("Create or choose a mailbox first.");
  composeDraftId = draft ? draft.id : null;
  composeRequestId = draft && draft.client_request_id ? draft.client_request_id : makeId();
  $("#composeFromLabel").textContent = selectedMailbox.address;
  $("#composeModeLabel").textContent = draft ? "DRAFT" : "NEW MESSAGE";
  $("#composeTitle").textContent = draft ? "Edit draft" : "Compose";
  $("#composeTo").value = draft ? (draft.to_addresses || []).join(", ") : to;
  $("#composeSubject").value = draft ? (draft.subject || "") : subject;
  $("#composeBody").value = draft ? (draft.text_body || "") : text;
  $("#aiDraftReviewNotice").hidden = !aiDraft;
  $("#composeStatus").textContent = aiDraft ? "AI draft created. Review it before sending." : draft ? "This draft is saved to your account." : "Plain text email · up to 10 recipients";
  composeDialog.showModal();
  setTimeout(() => $("#composeTo").focus(), 30);
}

async function saveCurrentDraft({ close = true, saveEmpty = true } = {}) {
  if (!selectedMailbox) return toast("Choose a mailbox before saving a draft.");
  const to = $("#composeTo").value;
  const subject = $("#composeSubject").value;
  const text = $("#composeBody").value;
  if (!saveEmpty && !composeDraftId && !to.trim() && !subject.trim() && !text.trim()) {
    if (close) composeDialog.close();
    return;
  }
  const button = $("#saveDraftButton");
  button.disabled = true;
  $("#composeStatus").textContent = "Saving draft…";
  try {
    const result = composeDraftId
      ? await api(`/api/messages/${encodeURIComponent(composeDraftId)}`, { method: "PATCH", body: { action: "draft", to, subject, text } })
      : await api("/api/messages", { method: "POST", body: { action: "saveDraft", mailboxId: selectedMailbox.id, to, subject, text, requestId: composeRequestId } });
    composeDraftId = result.message.id;
    composeRequestId = result.message.client_request_id || composeRequestId;
    if (close) composeDialog.close();
    toast("Draft saved to your account.");
    if (selectedView === "drafts") await loadMessages();
    else {
      const countResult = await api(`/api/messages?${new URLSearchParams({ mailboxId: selectedMailbox.id, view: "drafts" })}`);
      categoryCounts.drafts = (countResult.messages || []).length;
      renderCategoryCounts();
    }
  } catch (error) {
    $("#composeStatus").textContent = error.message;
  } finally { button.disabled = false; }
}

$("#composeButton").addEventListener("click", () => openCompose());
$("#headingCompose").addEventListener("click", () => openCompose());
$("#mobileComposeButton").addEventListener("click", () => openCompose());
$("#emptyCompose").addEventListener("click", () => openCompose());
$("#closeCompose").addEventListener("click", () => saveCurrentDraft({ close: true, saveEmpty: false }));
$("#saveDraftButton").addEventListener("click", () => saveCurrentDraft({ close: true, saveEmpty: true }));
composeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  saveCurrentDraft({ close: true, saveEmpty: false });
});
$("#replyButton").addEventListener("click", () => {
  if (!currentMessage) return;
  openCompose({ to: extractAddress(currentMessage.from_address), subject: /^re:/i.test(currentMessage.subject || "") ? currentMessage.subject : `Re: ${currentMessage.subject || ""}` });
});

$("#aiDraftButton").addEventListener("click", async () => {
  if (!currentMessage || !selectedMailbox) return;
  const message = currentMessage;
  const button = $("#aiDraftButton");
  button.disabled = true;
  button.textContent = "Generating draft…";
  try {
    const result = await api(`/api/messages/${encodeURIComponent(message.id)}`, {
      method: "PATCH",
      body: { action: "aiDraft", mailboxId: selectedMailbox.id }
    });
    if (currentMessage !== message || messageDetail.hidden) {
      toast("The draft was generated, but this message is no longer open. Open it again to generate a new draft.");
      return;
    }
    openCompose({
      to: extractAddress(message.from_address),
      subject: /^re:/i.test(message.subject || "") ? message.subject : `Re: ${message.subject || ""}`,
      text: result.draft,
      aiDraft: true
    });
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.innerHTML = "Generate AI draft <span>✧</span>";
  }
});

$("#composeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#sendMessageButton");
  button.disabled = true;
  $("#composeStatus").textContent = "Sending…";
  try {
    const result = await api("/api/messages/send", {
      method: "POST",
      body: {
        mailboxId: selectedMailbox.id,
        to: $("#composeTo").value,
        subject: $("#composeSubject").value,
        text: $("#composeBody").value,
        requestId: composeRequestId,
        draftId: composeDraftId || undefined
      }
    });
    composeDialog.close();
    composeRequestId = null;
    composeDraftId = null;
    toast(result.message && result.message.status === "sent" ? "Message sent." : "Message accepted by the mail service.");
    if (selectedView === "sent" || selectedView === "drafts") await loadMessages();
  } catch (error) { $("#composeStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelectorAll(".mail-side-link[data-view], .mail-tab[data-view], .mobile-folder-scroll [data-view]").forEach((button) => button.addEventListener("click", () => {
  closeNavigationMenu(".mail-folder-menu");
  selectedMessageIds.clear();
  selectedView = button.dataset.view;
  syncViewControls();
  domainsPanel.hidden = true;
  aiPanel.hidden = true;
  $("#refreshMessages").disabled = false;
  $("#mobileMailNav").hidden = false;
  messageDetail.hidden = true;
  inboxPane.hidden = false;
  $("#composeButton").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#headingCompose").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#mobileComposeButton").disabled = !selectedMailbox || !systemStatus.mailReady;
  loadMessages().catch((error) => toast(error.message));
}));

$("#selectAll").addEventListener("change", () => {
  visibleMessageIds.forEach((id) => {
    if ($("#selectAll").checked) selectedMessageIds.add(id);
    else selectedMessageIds.delete(id);
  });
  visibleMessageIds.forEach((id) => {
    const checkbox = liveList.querySelector(`[data-message-id="${CSS.escape(id)}"] .message-check input`);
    const row = liveList.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (checkbox) checkbox.checked = selectedMessageIds.has(id);
    if (row) row.classList.toggle("selected", selectedMessageIds.has(id));
  });
  updateSelectionControls();
});
$("#bulkArchive").addEventListener("click", () => bulkMoveMessages(selectedView === "archive" ? "inbox" : "archive"));
$("#bulkSpam").addEventListener("click", () => bulkMoveMessages(selectedView === "spam" ? "inbox" : "spam"));
$("#bulkTrash").addEventListener("click", () => bulkMoveMessages(selectedView === "trash" ? "inbox" : "trash"));
$("#clearSelection").addEventListener("click", () => {
  selectedMessageIds.clear();
  renderMessages();
});
$("#messageSearch").addEventListener("input", () => {
  selectedMessageIds.clear();
  renderMessages();
});
$("#mobileManageDomain").addEventListener("click", openDomains);

$("#refreshMessages").addEventListener("click", async () => {
  try { await loadDomainsAndMailboxes(); toast("Mailbox refreshed."); }
  catch (error) { toast(error.message); }
});
$("#sortMessages").addEventListener("click", () => {
  sentSort = sentSort === "newest" ? "oldest" : "newest";
  currentMessages.reverse();
  renderMessages();
  $("#sortMessages").innerHTML = sentSort === "newest" ? 'Newest first <span>⌄</span>' : 'Oldest first <span>⌃</span>';
});
$("#manageDomainButton").addEventListener("click", openDomains);
$("#backToInbox").addEventListener("click", () => {
  if (selectedMailbox) openInbox();
  else openDomains();
});

$("#signOutButton").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); }
  catch {}
  mailView.hidden = true;
  authForm.reset();
  setAuthMode("login");
  setTopbarState("PRIVATE MAIL SPACE");
  showAuth("You are signed out.");
});

loadInitialState();
