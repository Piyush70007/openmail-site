const $ = (selector) => document.querySelector(selector);
const authView = $("#authView");
const mailView = $("#mailView");
const authForm = $("#authForm");
const authMessage = $("#authMessage");
const setupNotice = $("#setupNotice");
const liveList = $("#liveMessageList");
const domainsPanel = $("#domainsPanel");
const inboxPane = $("#inboxPane");
const messageDetail = $("#messageDetail");
const composeDialog = $("#composeDialog");

let systemStatus = { authReady: false, mailReady: false, authMissing: [], mailMissing: [] };
let authMode = "login";
let domains = [];
let mailboxes = [];
let selectedMailbox = null;
let selectedView = "inbox";
let currentMessages = [];
let currentMessage = null;
let toastTimer;
let sentSort = "newest";
let composeRequestId = null;

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

function showAuth(message = "") {
  authView.hidden = false;
  mailView.hidden = true;
  setStatus(authMessage, message);
}

function showMail() {
  authView.hidden = true;
  mailView.hidden = false;
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
    $("#topbarState").textContent = systemStatus.mailReady ? "MAIL SERVICES READY" : "MAIL SETUP REQUIRED";
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
  } catch (error) {
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
    const result = await api(`/api/auth/${authMode === "login" ? "login" : "signup"}`, {
      method: "POST", body: { email: form.get("email"), password: form.get("password") }
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
  showMail();
  const email = user && user.email || "Your account";
  $("#accountEmail").textContent = email;
  $("#accountInitials").textContent = initials(email);
  $("#topbarState").textContent = systemStatus.mailReady ? "SIGNED IN / PRIVATE SPACE" : "SIGNED IN / SETUP REQUIRED";
  $("#mailServiceNotice").hidden = systemStatus.mailReady;
  $("#mailMissingConfig").textContent = systemStatus.mailMissing.join(" · ");
  try {
    await loadDomainsAndMailboxes();
  } catch (error) {
    toast(error.message);
    openDomains();
  }
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
  inboxPane.hidden = false;
  messageDetail.hidden = true;
  $("#composeButton").disabled = !systemStatus.mailReady;
  $("#headingCompose").disabled = !systemStatus.mailReady;
  $(".sidebar-signal").innerHTML = `<i></i>${systemStatus.mailReady ? "CONNECTED" : "SETUP REQUIRED"}`;
  const prior = selectedMailbox && mailboxes.find((item) => item.id === selectedMailbox.id);
  const chosen = prior || mailboxes[0];
  selectedMailbox = chosen;
  $("#mailboxPicker").value = chosen.id;
  $("#currentMailboxHeading").textContent = chosen.address.toUpperCase();
  await loadMessages();
}

function openDomains() {
  domainsPanel.hidden = false;
  inboxPane.hidden = true;
  messageDetail.hidden = true;
  $("#currentViewHeading").textContent = "Domains & mailboxes";
  $("#currentMailboxHeading").textContent = "SETUP";
  $("#composeButton").disabled = true;
  $("#headingCompose").disabled = true;
  $("#domainForm").querySelector("button[type=submit]").disabled = !systemStatus.mailReady;
  $("#mailboxForm").querySelector("button[type=submit]").disabled = !systemStatus.mailReady || !verifiedDomainsReady();
  renderDomains();
}

function openInbox() {
  domainsPanel.hidden = true;
  inboxPane.hidden = false;
  messageDetail.hidden = true;
  $("#composeButton").disabled = !selectedMailbox || !systemStatus.mailReady;
  $("#headingCompose").disabled = !selectedMailbox || !systemStatus.mailReady;
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
      ["TYPE", "NAME", "VALUE"].forEach((label) => { const th = document.createElement("th"); th.textContent = label; header.append(th); });
      const thead = document.createElement("thead"); thead.append(header); table.append(thead);
      const tbody = document.createElement("tbody");
      records.forEach((record) => {
        const tr = document.createElement("tr");
        [record.type || record.record || "—", record.name || "@", record.value || "—"].forEach((value) => { const td = document.createElement("td"); td.textContent = String(value); tr.append(td); });
        tbody.append(tr);
      });
      table.append(tbody);
      details.append(table);
      const note = document.createElement("p");
      note.className = "dns-note";
      note.textContent = "Copy these records to your DNS provider yourself. Changing MX records may move delivery away from an existing email host.";
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
  const picker = $("#mailboxPicker");
  picker.replaceChildren();
  mailboxes.forEach((mailbox) => {
    const option = document.createElement("option");
    option.value = mailbox.id;
    option.textContent = mailbox.address;
    picker.append(option);
  });
  picker.disabled = mailboxes.length === 0;
}

$("#domainForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#domainInput");
  const button = event.submitter;
  button.disabled = true;
  setStatus($("#domainMessage"), "Requesting domain records…");
  try {
    const result = await api("/api/domains", { method: "POST", body: { domain: input.value } });
    domains.unshift(result.domain);
    input.value = "";
    renderDomains();
    setStatus($("#domainMessage"), "Domain added. Review the records below and add them with your DNS provider.");
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
    selectedMailbox = result.mailbox;
    $("#localPartInput").value = "";
    renderDomains();
    setStatus($("#mailboxMessage"), `${result.mailbox.address} is ready in OpenMail.`);
    $("#topbarState").textContent = "SIGNED IN / PRIVATE SPACE";
    setTimeout(openInbox, 550);
  } catch (error) { setStatus($("#mailboxMessage"), error.message, true); }
  finally { button.disabled = verifiedDomainsReady() ? false : true; }
});

function verifiedDomainsReady() { return domains.some((item) => item.status === "verified"); }

$("#mailboxPicker").addEventListener("change", async () => {
  selectedMailbox = mailboxes.find((item) => item.id === $("#mailboxPicker").value) || null;
  selectedView = "inbox";
  document.querySelectorAll(".mail-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === "inbox"));
  if (selectedMailbox) openInbox();
});

async function loadMessages() {
  if (!selectedMailbox || domainsPanel.hidden === false) return;
  const params = new URLSearchParams({ mailboxId: selectedMailbox.id, view: selectedView });
  const result = await api(`/api/messages?${params}`);
  currentMessages = result.messages || [];
  $("#currentMailboxHeading").textContent = selectedMailbox.address.toUpperCase();
  $("#currentViewHeading").textContent = selectedView[0].toUpperCase() + selectedView.slice(1);
  $("#messageSummary").textContent = `${currentMessages.length} ${currentMessages.length === 1 ? "message" : "messages"}`;
  const unread = currentMessages.filter((item) => !item.read_at && item.direction === "inbound").length;
  $("#inboxCount").textContent = selectedView === "inbox" && unread ? String(unread).padStart(2, "0") : "—";
  renderMessages();
}

function renderMessages() {
  liveList.replaceChildren();
  currentMessages.forEach((message) => {
    const label = message.direction === "outbound" ? (message.to_addresses || []).join(", ") : message.from_address;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `live-row${!message.read_at && message.direction === "inbound" ? " unread" : ""}`;
    row.dataset.messageId = message.id;
    const avatar = document.createElement("span"); avatar.className = "live-avatar"; avatar.textContent = initials(label);
    const senderWrap = document.createElement("span"); senderWrap.className = "live-meta";
    const sender = document.createElement("span"); sender.className = "live-sender"; sender.textContent = label || "Unknown sender";
    senderWrap.append(sender);
    const subjectWrap = document.createElement("span"); subjectWrap.className = "live-meta";
    const subject = document.createElement("span"); subject.className = "live-subject"; subject.textContent = message.subject || "(no subject)";
    const preview = document.createElement("span"); preview.className = "live-preview"; preview.textContent = message.preview || "";
    subjectWrap.append(subject, preview);
    const time = document.createElement("time"); time.className = "live-time"; time.textContent = displayTime(message.created_at); time.dateTime = message.created_at || "";
    row.append(avatar, senderWrap, subjectWrap, time);
    row.addEventListener("click", () => openMessage(message));
    liveList.append(row);
  });
  const empty = currentMessages.length === 0;
  $("#emptyMail").hidden = !empty;
  if (empty) {
    const labels = { inbox: ["Your inbox is clear.", "New mail sent to this address will appear here."], sent: ["Nothing sent yet.", "Messages you send from this mailbox appear here."], archive: ["Nothing archived.", "Archive a message to move it here."], spam: ["No spam.", "Messages marked as spam will appear here."], trash: ["Nothing in the trash.", "Deleted messages will appear here."] };
    $("#emptyTitle").textContent = labels[selectedView][0];
    $("#emptyCopy").textContent = labels[selectedView][1];
  }
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
  messageDetail.hidden = false;
  $("#detailSubject").textContent = message.subject || "(no subject)";
  const from = message.direction === "outbound" ? `You <${message.from_address}>` : message.from_address;
  $("#detailFrom").textContent = from || "Unknown sender";
  $("#detailTo").textContent = message.direction === "outbound" ? `To: ${(message.to_addresses || []).join(", ")}` : `To: ${selectedMailbox.address}`;
  $("#detailAvatar").textContent = initials(from);
  $("#detailTime").textContent = new Date(message.created_at).toLocaleString();
  $("#detailBody").textContent = message.text_body || "(This message has no plain text body.)";
  const attachments = Array.isArray(message.attachment_metadata) ? message.attachment_metadata : [];
  $("#attachmentNote").hidden = attachments.length === 0;
  $("#attachmentNote").textContent = attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} received. Attachment downloads are not available in this first build.` : "";
  $("#detailStar").textContent = message.starred ? "★ Starred" : "☆ Star";
  $("#detailArchive").textContent = message.folder === "archive" ? "Move to inbox ↗" : "Archive ↗";
  $("#detailSpam").textContent = message.folder === "spam" ? "Move to inbox" : "Mark spam";
  $("#detailTrash").textContent = message.folder === "trash" ? "Move to inbox" : "Move to trash";
  $("#replyButton").hidden = message.direction !== "inbound";
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

function openCompose({ to = "", subject = "" } = {}) {
  if (!selectedMailbox) return toast("Create or choose a mailbox first.");
  composeRequestId = makeId();
  $("#composeFromLabel").textContent = selectedMailbox.address;
  $("#composeTo").value = to;
  $("#composeSubject").value = subject;
  $("#composeBody").value = "";
  $("#composeStatus").textContent = "Plain text email · up to 10 recipients";
  composeDialog.showModal();
  setTimeout(() => $("#composeTo").focus(), 30);
}

$("#composeButton").addEventListener("click", () => openCompose());
$("#headingCompose").addEventListener("click", () => openCompose());
$("#emptyCompose").addEventListener("click", () => openCompose());
$("#closeCompose").addEventListener("click", () => composeDialog.close());
$("#replyButton").addEventListener("click", () => {
  if (!currentMessage) return;
  openCompose({ to: extractAddress(currentMessage.from_address), subject: /^re:/i.test(currentMessage.subject || "") ? currentMessage.subject : `Re: ${currentMessage.subject || ""}` });
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
        requestId: composeRequestId
      }
    });
    composeDialog.close();
    composeRequestId = null;
    toast(result.message && result.message.status === "sent" ? "Message sent." : "Message accepted by the mail service.");
    if (selectedView === "sent") await loadMessages();
  } catch (error) { $("#composeStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelectorAll(".mail-nav-item").forEach((button) => button.addEventListener("click", () => {
  selectedView = button.dataset.view;
  document.querySelectorAll(".mail-nav-item").forEach((item) => item.classList.toggle("active", item === button));
  messageDetail.hidden = true;
  inboxPane.hidden = false;
  loadMessages().catch((error) => toast(error.message));
}));

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
  $("#topbarState").textContent = "PRIVATE MAIL SPACE";
  showAuth("You are signed out.");
});

loadInitialState();
