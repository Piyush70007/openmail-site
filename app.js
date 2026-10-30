const sampleMessages = [
  {
    id: "m1", category: "primary", folder: "inbox", sender: "Maya Chen", address: "maya@fieldnotes.example", initials: "MC", tone: "sand",
    subject: "A small idea for the weekend", preview: "I found a quiet place by the water that feels like your kind of afternoon…", time: "10:42 AM",
    createdAt: 7, unread: true, starred: false,
    body: "There’s a little place by the water that I think you’d love. No plans needed — just coffee, a long walk, and an afternoon without a schedule.\n\nWould Saturday work?\n\nMaya"
  },
  {
    id: "m2", category: "primary", folder: "inbox", sender: "Eli at Forming", address: "eli@forming.example", initials: "FO", tone: "violet",
    subject: "The first cut is ready", preview: "The new direction is coming together. I left three notes in the shared doc…", time: "9:18 AM",
    createdAt: 6, unread: true, starred: true,
    body: "Hey — the first cut is ready. The new direction is coming together, and I left three notes in the shared doc for when you have a moment.\n\nNothing urgent. Looking forward to your thoughts.\n\nEli"
  },
  {
    id: "m3", category: "primary", folder: "inbox", sender: "Jules Rivera", address: "jules@slowhours.example", initials: "JR", tone: "sage",
    subject: "Re: Sunday plans", preview: "Perfect. I’ll bring the book I mentioned and meet you near the entrance…", time: "Yesterday",
    createdAt: 5, unread: false, starred: false,
    body: "Perfect. I’ll bring the book I mentioned and meet you near the entrance around eleven. If the weather turns, we can find somewhere inside.\n\nSee you Sunday,\nJules"
  },
  {
    id: "m4", category: "social", folder: "inbox", sender: "Orbit Social", address: "hello@orbit-social.example", initials: "OS", tone: "blue",
    subject: "Your circle had a busy week", preview: "A few people you follow shared something new this week…", time: "Yesterday",
    createdAt: 4, unread: true, starred: false,
    body: "A few people in your circle shared something new this week. Take a look whenever you’re ready.\n\nThis is a fictional sample notification for the OpenMail inbox preview."
  },
  {
    id: "m5", category: "promotions", folder: "inbox", sender: "Field Supply", address: "studio@fieldsupply.example", initials: "FS", tone: "amber",
    subject: "A little room for your next idea", preview: "New tools for a slower, more considered kind of making…", time: "Tue",
    createdAt: 3, unread: false, starred: false,
    body: "New tools for a slower, more considered kind of making. We put a small collection together for your next idea.\n\nA fictional product note, included to demonstrate the Promotions view."
  },
  {
    id: "m6", category: "updates", folder: "inbox", sender: "Northline", address: "updates@northline.example", initials: "N", tone: "teal",
    subject: "Your monthly account note", preview: "A short summary is ready to review. Nothing needs your attention right now…", time: "Mon",
    createdAt: 2, unread: false, starred: false,
    body: "Your monthly account note is ready. Nothing needs your attention right now.\n\nThis is a fictional service update for the OpenMail preview."
  },
  {
    id: "m7", category: "spam", folder: "spam", sender: "Prize Centre", address: "rewards@unusual-prize.example", initials: "!", tone: "rose",
    subject: "You have been selected today", preview: "Claim a reward you never entered to win…", time: "Mon",
    createdAt: 1, unread: true, starred: false,
    body: "You have been selected to receive a completely unexpected reward.\n\nThis fictional message is shown in Spam to demonstrate how a separate spam view could look. The preview does not detect or filter real mail."
  }
];

const storageKey = "openmail-browser-demo-v2";
const viewNames = {
  all: "All mail", primary: "Primary", social: "Social", promotions: "Promotions",
  updates: "Updates", spam: "Spam", starred: "Starred", sent: "Sent",
  drafts: "Drafts", archive: "Archive", trash: "Trash"
};
const categoryViews = ["all", "primary", "social", "promotions", "updates", "spam"];
const cloneSamples = () => JSON.parse(JSON.stringify(sampleMessages));

function loadDemoState() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (saved && Array.isArray(saved.messages) && Array.isArray(saved.sent) && Array.isArray(saved.drafts)) {
      return {
        messages: saved.messages,
        sent: saved.sent,
        drafts: saved.drafts,
        preferences: { compact: Boolean(saved.preferences && saved.preferences.compact) }
      };
    }
  } catch {}
  return { messages: cloneSamples(), sent: [], drafts: [], preferences: { compact: false } };
}

let state = loadDemoState();
let messages = state.messages;
let sentMessages = state.sent;
let drafts = state.drafts;
let preferences = state.preferences;
let activeView = "all";
let unreadFirst = false;
let toastTimeout;
let draftTimer;
let currentDraftId = null;
let currentMessageId = null;
let dialogMode = null;
let storageWarningShown = false;
const selectedMessages = new Set();
const list = document.getElementById("messageList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("mailSearch");
const dialog = document.getElementById("messageDialog");
const dialogContent = document.getElementById("dialogContent");
const mailApp = document.getElementById("mailApp");

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function makeId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function persistState() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ messages, sent: sentMessages, drafts, preferences }));
    return true;
  } catch {
    if (!storageWarningShown) {
      storageWarningShown = true;
      showToast("Browser storage is unavailable. Demo changes will last for this visit.");
    }
    return false;
  }
}

function findRecord(id) {
  return messages.find((item) => item.id === id)
    || sentMessages.find((item) => item.id === id)
    || drafts.find((item) => item.id === id);
}

function getViewItems() {
  let items;
  if (activeView === "all") {
    items = messages.filter((message) => message.folder === "inbox" && message.category !== "spam");
  } else if (categoryViews.includes(activeView) && activeView !== "spam") {
    items = messages.filter((message) => message.folder === "inbox" && message.category === activeView);
  } else if (activeView === "spam") {
    items = messages.filter((message) => message.folder === "spam");
  } else if (activeView === "starred") {
    items = messages.filter((message) => message.folder !== "trash" && message.starred);
  } else if (activeView === "sent") {
    items = sentMessages.map((item) => Object.assign({}, item, { kind: "sent" }));
  } else if (activeView === "drafts") {
    items = drafts.map((item) => Object.assign({}, item, { kind: "draft" }));
  } else if (activeView === "archive" || activeView === "trash") {
    items = messages.filter((message) => message.folder === activeView);
  } else {
    items = [];
  }

  const query = searchInput.value.trim().toLocaleLowerCase();
  if (query) {
    items = items.filter((item) => [
      item.sender, item.address, item.to, item.subject, item.preview, item.body,
      item.category, item.folder, item.kind
    ].join(" ").toLocaleLowerCase().includes(query));
  }
  if (unreadFirst) {
    items = items.slice().sort((a, b) => Number(Boolean(b.unread)) - Number(Boolean(a.unread)));
  }
  return items;
}

function updateCounts() {
  const inboxItems = messages.filter((message) => message.folder === "inbox");
  const counts = {
    all: inboxItems.filter((message) => message.category !== "spam").length,
    primary: inboxItems.filter((message) => message.category === "primary").length,
    social: inboxItems.filter((message) => message.category === "social").length,
    promotions: inboxItems.filter((message) => message.category === "promotions").length,
    updates: inboxItems.filter((message) => message.category === "updates").length,
    spam: messages.filter((message) => message.folder === "spam").length,
    starred: messages.filter((message) => message.folder !== "trash" && message.starred).length,
    sent: sentMessages.length,
    drafts: drafts.length,
    archive: messages.filter((message) => message.folder === "archive").length,
    trash: messages.filter((message) => message.folder === "trash").length
  };
  const countTargets = {
    all: ["allCount", "allTabCount"],
    primary: ["primaryCount", "primaryTabCount"],
    social: ["socialCount", "socialTabCount"],
    promotions: ["promotionsCount", "promotionsTabCount"],
    updates: ["updatesCount", "updatesTabCount"],
    spam: ["spamCount", "spamTabCount"],
    sent: ["sentCount"],
    drafts: ["draftCount"],
    trash: ["trashCount"]
  };
  Object.entries(countTargets).forEach(([view, ids]) => ids.forEach((id) => {
    const target = document.getElementById(id);
    if (target) target.textContent = String(counts[view]).padStart(2, "0");
  }));
}

function updateActionbar(items) {
  const visibleIds = new Set(items.filter((item) => !item.kind || item.kind === "message").map((item) => item.id));
  [...selectedMessages].forEach((id) => { if (!visibleIds.has(id)) selectedMessages.delete(id); });
  const selected = messages.filter((message) => selectedMessages.has(message.id));
  const actionbar = document.getElementById("mailActionbar");
  actionbar.hidden = selected.length === 0;
  document.getElementById("selectionSummary").textContent = selected.length + " selected";
  document.getElementById("markReadAction").textContent = selected.length && selected.every((message) => !message.unread) ? "Mark unread" : "Mark read";
  document.getElementById("archiveAction").textContent = ["spam", "archive", "trash"].includes(activeView) ? "Move to inbox" : "Archive";
  document.getElementById("spamAction").hidden = activeView === "spam";
  document.getElementById("trashAction").hidden = activeView === "trash";
  const selectAll = document.getElementById("selectAll");
  const selectable = items.filter((item) => !item.kind || item.kind === "message");
  selectAll.disabled = selectable.length === 0;
  selectAll.checked = selectable.length > 0 && selectable.every((message) => selectedMessages.has(message.id));
  selectAll.indeterminate = selectable.some((message) => selectedMessages.has(message.id)) && !selectAll.checked;
}

function renderMessages() {
  const items = getViewItems();
  list.innerHTML = items.map((item) => {
    const kind = item.kind || "message";
    const title = item.subject || "Untitled draft";
    const sender = kind === "draft" ? (item.to ? "Draft · " + item.to : "Draft") : (item.sender || "You");
    const categoryLabel = kind === "draft" ? "Draft" : kind === "sent" ? "Sent" : (viewNames[item.category] || viewNames[item.folder] || "Inbox");
    const preview = item.preview || item.body || "No message text yet.";
    const tone = ["sand", "violet", "sage", "blue", "amber", "teal", "rose", "self", "draft"].includes(item.tone) ? item.tone : "teal";
    const selectable = kind === "message";
    const checked = selectedMessages.has(item.id);
    const rowLabel = kind === "draft"
      ? "Open draft " + title
      : "Open email from " + sender + ": " + title;
    const checkbox = selectable
      ? '<label class="message-check" aria-label="Select ' + escapeHtml(title) + '"><input type="checkbox" data-select="' + escapeHtml(item.id) + '"' + (checked ? " checked" : "") + ' /><span></span></label>'
      : '<span class="message-check-spacer" aria-hidden="true"></span>';
    const star = kind === "draft" ? ""
      : '<button class="star-button' + (item.starred ? " starred" : "") + '" data-star="' + escapeHtml(item.id) + '" aria-label="' + (item.starred ? "Unstar " : "Star ") + escapeHtml(title) + '" aria-pressed="' + Boolean(item.starred) + '">★</button>';
    return '<article class="message-row ' + (item.unread ? "unread " : "") + (checked ? "selected " : "") + (kind === "draft" ? "draft-row " : "") + '" tabindex="0" data-message-id="' + escapeHtml(item.id) + '" data-message-kind="' + kind + '" aria-label="' + escapeHtml(rowLabel) + '">' +
      checkbox +
      '<span class="sender-avatar tone-' + tone + '" aria-hidden="true">' + escapeHtml(item.initials || (kind === "draft" ? "D" : "OM")) + '</span>' +
      '<span class="message-meta"><span class="message-sender">' + escapeHtml(sender) + '</span><span class="category-label">' + escapeHtml(categoryLabel) + '</span></span>' +
      '<span class="message-subject">' + escapeHtml(title) + '</span>' +
      '<span class="message-preview">— ' + escapeHtml(preview) + '</span>' +
      '<time class="message-time">' + escapeHtml(item.time || formatTime(item.updatedAt || item.createdAt || Date.now())) + '</time>' +
      star +
      '</article>';
  }).join("");
  list.hidden = items.length === 0;
  emptyState.hidden = items.length > 0;
  const emptyTitle = emptyState.querySelector("b");
  const emptyCopy = emptyState.querySelector("p");
  if (searchInput.value.trim()) {
    emptyTitle.textContent = "No messages found";
    emptyCopy.textContent = "Try a different search or choose another view.";
  } else {
    emptyTitle.textContent = activeView === "drafts" ? "No drafts yet" : activeView === "sent" ? "Nothing sent in this preview" : "This view is clear";
    emptyCopy.textContent = activeView === "trash" ? "Deleted demo messages can be restored from the selection menu." : "Messages you move here will appear in this browser preview.";
  }
  document.getElementById("listCount").textContent = items.length
    ? "1–" + items.length + " of " + items.length
    : "0 messages";
  updateCounts();
  updateActionbar(items);
}

function chooseView(view) {
  if (!viewNames[view]) return;
  activeView = view;
  selectedMessages.clear();
  document.getElementById("currentViewLabel").textContent = viewNames[view];
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", String(active));
  });
  renderMessages();
}

function openDialog() {
  if (!dialog.open) dialog.showModal();
}

function openMessage(id, kind) {
  if (kind === "draft") {
    openCompose(id);
    return;
  }
  const message = findRecord(id);
  if (!message) return;
  currentMessageId = id;
  dialogMode = "message";
  if (message.unread) {
    message.unread = false;
    persistState();
    renderMessages();
  }
  const category = message.category ? (viewNames[message.category] || "Inbox").toUpperCase() : "SENT";
  const sender = kind === "sent" ? "You" : message.sender;
  const address = kind === "sent" ? ("To: " + (message.to || "")) : message.address;
  const actions = kind === "sent" ? "" :
    '<div class="dialog-actions">' +
      '<button type="button" data-message-action="reply">Reply</button>' +
      '<button type="button" data-message-action="unread">Mark unread</button>' +
      '<button type="button" data-message-action="archive">Archive</button>' +
      '<button type="button" data-message-action="spam">Move to spam</button>' +
      '<button type="button" data-message-action="trash">Move to trash</button>' +
    '</div>';
  dialogContent.innerHTML =
    '<p class="dialog-eyebrow">' + escapeHtml(category) + ' / SAMPLE MESSAGE</p>' +
    '<h2 class="dialog-title" id="dialogTitle">' + escapeHtml(message.subject || "Untitled") + '</h2>' +
    '<p class="dialog-text"><b>' + escapeHtml(sender) + '</b> &lt;' + escapeHtml(address || "sample address") + '&gt;</p>' +
    '<p class="dialog-text message-body">' + escapeHtml(message.body || "(No message text.)").replace(/\n/g, "<br />") + '</p>' +
    actions +
    '<div class="dialog-meta">FICTIONAL CONTENT / LOCAL BROWSER PREVIEW</div>';
  openDialog();
}

function readComposeFields() {
  return {
    to: document.getElementById("composeTo").value.trim(),
    subject: document.getElementById("composeSubject").value.trim(),
    body: document.getElementById("composeBody").value.trim()
  };
}

function saveCurrentDraft() {
  const form = document.getElementById("composeForm");
  if (!form) return null;
  const fields = readComposeFields();
  if (!currentDraftId && !fields.to && !fields.subject && !fields.body) return null;
  let draft = drafts.find((item) => item.id === currentDraftId);
  if (!draft) {
    draft = { id: makeId("draft"), tone: "draft", kind: "draft", createdAt: Date.now() };
    currentDraftId = draft.id;
    drafts.unshift(draft);
  }
  Object.assign(draft, fields, {
    kind: "draft",
    sender: "Draft",
    initials: "D",
    preview: fields.body.slice(0, 100) || "No message text yet.",
    updatedAt: Date.now(),
    time: formatTime(Date.now()),
    unread: false,
    starred: false
  });
  persistState();
  updateCounts();
  return draft;
}

function openCompose(draftId, reply) {
  const draft = drafts.find((item) => item.id === draftId);
  currentDraftId = draft ? draft.id : null;
  currentMessageId = null;
  dialogMode = "compose";
  const to = reply ? reply.to : (draft ? draft.to : "");
  const subject = reply ? reply.subject : (draft ? draft.subject : "");
  const body = reply ? reply.body : (draft ? draft.body : "");
  dialogContent.innerHTML =
    '<p class="dialog-eyebrow">OPENMAIL / COMPOSE PREVIEW</p>' +
    '<h2 class="dialog-title" id="dialogTitle">' + (draft ? "Edit draft" : reply ? "Write a reply" : "Write a message") + '</h2>' +
    '<form class="compose-form" id="composeForm">' +
      '<label>TO<input id="composeTo" type="email" value="' + escapeHtml(to) + '" placeholder="name@example.com" autocomplete="off" required /></label>' +
      '<label>SUBJECT<input id="composeSubject" type="text" value="' + escapeHtml(subject) + '" placeholder="A thoughtful subject" /></label>' +
      '<label>MESSAGE<textarea id="composeBody" placeholder="Write something here…">' + escapeHtml(body) + '</textarea></label>' +
      '<div class="compose-actions">' +
        (draft ? '<button class="secondary-button" type="button" id="deleteDraftButton">Delete draft</button>' : "") +
        '<button class="secondary-button" type="button" id="saveDraftButton">Save draft</button>' +
        '<button type="submit">Preview send <span aria-hidden="true">↗</span></button>' +
      '</div>' +
    '</form>' +
    '<p class="dialog-disclaimer">Demo only. Saving stores a draft in this browser. Preview send adds it to the local Sent view; it does not deliver email.</p>';
  const form = document.getElementById("composeForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = readComposeFields();
    const now = Date.now();
    sentMessages.unshift({
      id: makeId("sent"), kind: "sent", category: "sent", tone: "self", initials: "YO",
      sender: "You", address: "you@preview.example", to: fields.to,
      subject: fields.subject || "(No subject)", body: fields.body,
      preview: fields.body.slice(0, 100) || "(No message text)",
      time: "Today · " + formatTime(now), createdAt: now, unread: false, starred: false
    });
    if (currentDraftId) drafts = drafts.filter((item) => item.id !== currentDraftId);
    clearTimeout(draftTimer);
    currentDraftId = null;
    dialogMode = "sent-preview";
    persistState();
    dialog.close();
    chooseView("sent");
    showToast("Added to Sent in this browser. No email was delivered.");
  });
  form.addEventListener("input", () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveCurrentDraft, 600);
  });
  document.getElementById("saveDraftButton").addEventListener("click", () => {
    clearTimeout(draftTimer);
    const saved = saveCurrentDraft();
    if (!saved) {
      showToast("Add a recipient, subject, or message before saving a draft.");
      return;
    }
    currentDraftId = null;
    dialogMode = "saved-draft";
    dialog.close();
    chooseView("drafts");
    showToast("Draft saved in this browser.");
  });
  const deleteDraftButton = document.getElementById("deleteDraftButton");
  if (deleteDraftButton) deleteDraftButton.addEventListener("click", () => {
    drafts = drafts.filter((item) => item.id !== currentDraftId);
    currentDraftId = null;
    dialogMode = "deleted-draft";
    persistState();
    dialog.close();
    chooseView("drafts");
    showToast("Draft removed from this browser.");
  });
  openDialog();
  document.getElementById("composeTo").focus();
}

function moveMessage(id, destination) {
  const message = messages.find((item) => item.id === id);
  if (!message) return;
  if (destination === "inbox" && message.category === "spam") message.category = "primary";
  message.folder = destination;
  persistState();
  renderMessages();
}

function applyBulkAction(action) {
  const selected = messages.filter((message) => selectedMessages.has(message.id));
  if (!selected.length) return;
  if (action === "mark") {
    const markUnread = selected.every((message) => !message.unread);
    selected.forEach((message) => { message.unread = markUnread; });
  } else if (action === "archive") {
    const destination = ["spam", "archive", "trash"].includes(activeView) ? "inbox" : "archive";
    selected.forEach((message) => {
      if (destination === "inbox" && message.category === "spam") message.category = "primary";
      message.folder = destination;
    });
  } else if (action === "spam") {
    selected.forEach((message) => { message.folder = activeView === "spam" ? "inbox" : "spam"; });
  } else if (action === "trash") {
    selected.forEach((message) => { message.folder = "trash"; });
  }
  const count = selected.length;
  selectedMessages.clear();
  persistState();
  renderMessages();
  const names = { mark: "Selection updated", archive: "Messages moved", spam: "Spam view updated", trash: "Moved to Trash" };
  showToast(count + " " + (names[action] || "messages updated") + " in this browser.");
}

function openSettings() {
  dialogMode = "settings";
  dialogContent.innerHTML =
    '<p class="dialog-eyebrow">OPENMAIL / PREVIEW PREFERENCES</p>' +
    '<h2 class="dialog-title" id="dialogTitle">Make the demo yours.</h2>' +
    '<label class="settings-option"><input id="compactRows" type="checkbox"' + (preferences.compact ? " checked" : "") + ' /><span><b>Compact message rows</b><small>Fit more sample messages into the inbox.</small></span></label>' +
    '<p class="dialog-disclaimer">Preferences and demo changes are stored in this browser only.</p>' +
    '<button class="settings-reset" type="button" id="resetSampleData">Reset sample data</button>';
  document.getElementById("compactRows").addEventListener("change", (event) => {
    preferences.compact = event.target.checked;
    mailApp.classList.toggle("is-compact", preferences.compact);
    persistState();
  });
  document.getElementById("resetSampleData").addEventListener("click", resetPreview);
  openDialog();
}

function resetPreview() {
  messages = cloneSamples();
  sentMessages = [];
  drafts = [];
  preferences = { compact: false };
  selectedMessages.clear();
  searchInput.value = "";
  unreadFirst = false;
  mailApp.classList.remove("is-compact");
  document.getElementById("unreadFilter").innerHTML = "Newest first <span>⌄</span>";
  try { window.localStorage.removeItem(storageKey); } catch {}
  persistState();
  dialogMode = "reset";
  dialog.close();
  chooseView("all");
  showToast("Sample inbox restored.");
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => chooseView(button.dataset.view)));
searchInput.addEventListener("input", () => {
  selectedMessages.clear();
  renderMessages();
});
document.getElementById("composeButton").addEventListener("click", () => openCompose());
document.getElementById("mobileComposeButton").addEventListener("click", () => openCompose());
document.getElementById("refreshButton").addEventListener("click", () => {
  renderMessages();
  showToast("Preview refreshed. Your browser demo is saved.");
});
document.getElementById("settingsButton").addEventListener("click", openSettings);
document.getElementById("unreadFilter").addEventListener("click", (event) => {
  unreadFirst = !unreadFirst;
  event.currentTarget.innerHTML = unreadFirst ? "Unread first <span>⌄</span>" : "Newest first <span>⌄</span>";
  renderMessages();
});
document.getElementById("selectAll").addEventListener("change", (event) => {
  getViewItems().filter((item) => !item.kind || item.kind === "message").forEach((message) => {
    if (event.target.checked) selectedMessages.add(message.id);
    else selectedMessages.delete(message.id);
  });
  renderMessages();
});
document.getElementById("markReadAction").addEventListener("click", () => applyBulkAction("mark"));
document.getElementById("archiveAction").addEventListener("click", () => applyBulkAction("archive"));
document.getElementById("spamAction").addEventListener("click", () => applyBulkAction("spam"));
document.getElementById("trashAction").addEventListener("click", () => applyBulkAction("trash"));
document.getElementById("clearSelection").addEventListener("click", () => {
  selectedMessages.clear();
  renderMessages();
});

list.addEventListener("click", (event) => {
  const starButton = event.target.closest("[data-star]");
  if (starButton) {
    event.stopPropagation();
    const message = findRecord(starButton.dataset.star);
    if (message) {
      message.starred = !message.starred;
      persistState();
      renderMessages();
    }
    return;
  }
  const row = event.target.closest("[data-message-id]");
  if (row && !event.target.closest("input, label, button")) {
    openMessage(row.dataset.messageId, row.dataset.messageKind);
  }
});
list.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-select]");
  if (!checkbox) return;
  if (checkbox.checked) selectedMessages.add(checkbox.dataset.select);
  else selectedMessages.delete(checkbox.dataset.select);
  renderMessages();
});
list.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".message-row")) {
    event.preventDefault();
    openMessage(event.target.dataset.messageId, event.target.dataset.messageKind);
  }
});

dialogContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-message-action]");
  if (!button || !currentMessageId) return;
  const action = button.dataset.messageAction;
  const message = findRecord(currentMessageId);
  if (!message) return;
  if (action === "reply") {
    const replySubject = /^re:/i.test(message.subject || "") ? message.subject : "Re: " + (message.subject || "");
    openCompose(null, { to: message.address || message.to || "", subject: replySubject, body: "" });
    return;
  }
  if (action === "unread") {
    message.unread = true;
    persistState();
    dialogMode = "message-action";
    dialog.close();
    renderMessages();
    showToast("Marked unread in this browser.");
    return;
  }
  const destination = action === "archive" ? "archive" : action === "spam" ? "spam" : action === "trash" ? "trash" : null;
  if (destination) {
    moveMessage(currentMessageId, destination);
    dialogMode = "message-action";
    dialog.close();
  }
});

dialog.addEventListener("close", () => {
  if (dialogMode === "compose") {
    clearTimeout(draftTimer);
    const saved = saveCurrentDraft();
    if (saved) showToast("Draft saved in this browser.");
  }
  dialogMode = null;
  currentDraftId = null;
  currentMessageId = null;
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

const menuToggle = document.getElementById("menuToggle");
const primaryNav = document.getElementById("primaryNav");
menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  primaryNav.classList.toggle("open", !isOpen);
});
primaryNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  primaryNav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
}));
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  } else if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  } else if (!dialog.open && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c"
      && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    openCompose();
  }
});

document.body.classList.add("motion-ready");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }), { threshold: .12 });
  document.querySelectorAll(".reveal:not(.is-visible)").forEach((element) => revealObserver.observe(element));
} else {
  document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
}

const flowNodes = [...document.querySelectorAll(".flow-node")];
if (flowNodes.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  let activeNode = 0;
  setInterval(() => {
    flowNodes[activeNode].classList.remove("active");
    activeNode = (activeNode + 1) % flowNodes.length;
    flowNodes[activeNode].classList.add("active");
  }, 2200);
}

const progress = document.getElementById("scrollProgress");
let progressTicking = false;
window.addEventListener("scroll", () => {
  if (progressTicking) return;
  progressTicking = true;
  requestAnimationFrame(() => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0) + "%";
    progressTicking = false;
  });
}, { passive: true });

const orbCanvas = document.getElementById("signalOrb");
const orbStage = document.getElementById("orbStage");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const orbContext = orbCanvas.getContext("2d", { alpha: true });
const pointCount = 186;
const points = Array.from({ length: pointCount }, (_, index) => {
  const y = 1 - (index / (pointCount - 1)) * 2;
  const radius = Math.sqrt(1 - y * y) * (.91 + .11 * Math.sin(index * 2.399));
  const theta = Math.PI * (3 - Math.sqrt(5)) * index;
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
});
const edges = [];
for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
  const dx = points[a].x - points[b].x, dy = points[a].y - points[b].y, dz = points[a].z - points[b].z;
  if (dx * dx + dy * dy + dz * dz < .09 && (a + b) % 3 !== 0) edges.push([a, b]);
}
let orbWidth = 0, orbHeight = 0, pointerX = 0, pointerY = 0, pointerTargetX = 0, pointerTargetY = 0;
function resizeOrb() {
  const bounds = orbCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  orbWidth = bounds.width;
  orbHeight = bounds.height;
  orbCanvas.width = Math.round(orbWidth * dpr);
  orbCanvas.height = Math.round(orbHeight * dpr);
  orbContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (reducedMotion) drawOrb(0);
}
function drawOrb(time) {
  if (!orbWidth || !orbHeight) return;
  const ctx = orbContext;
  ctx.clearRect(0, 0, orbWidth, orbHeight);
  const size = Math.min(orbWidth, orbHeight) * .39;
  const cx = orbWidth * .5, cy = orbHeight * .5;
  const rotation = reducedMotion ? .18 : time * .00016 + .18 + pointerX * .07;
  const tilt = -.18 + pointerY * .045;
  const projected = points.map((point) => {
    const x = point.x * Math.cos(rotation) - point.z * Math.sin(rotation);
    const rotatedZ = point.x * Math.sin(rotation) + point.z * Math.cos(rotation);
    const y = point.y * Math.cos(tilt) - rotatedZ * Math.sin(tilt);
    const z = point.y * Math.sin(tilt) + rotatedZ * Math.cos(tilt);
    const perspective = 1.1 + (z + 1) * .11;
    return { x: cx + x * size * perspective, y: cy + y * size * perspective, z, depth: (z + 1) / 2 };
  });
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.12);
  glow.addColorStop(0, "rgba(50, 185, 171, .12)");
  glow.addColorStop(.48, "rgba(34, 126, 124, .055)");
  glow.addColorStop(1, "rgba(10, 22, 23, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, size * 1.12, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = .55;
  for (const [a, b] of edges) {
    const p = projected[a], q = projected[b];
    if (p.depth + q.depth < .94) continue;
    ctx.strokeStyle = "rgba(105, 224, 208, " + Math.min(.19, ((p.depth + q.depth) / 2 - .25) * .21) + ")";
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  projected.forEach((point) => {
    const dotRadius = .45 + point.depth * .78;
    const alpha = .16 + point.depth * .58;
    ctx.fillStyle = "rgba(" + (point.depth > .72 ? "176, 255, 234" : "93, 209, 195") + ", " + alpha + ")";
    ctx.beginPath(); ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2); ctx.fill();
  });
  const orbitAngle = time * .00035;
  for (let trail = 6; trail > 0; trail--) {
    const angle = orbitAngle - trail * .075;
    const trailX = cx + Math.cos(angle) * size * .94;
    const trailY = cy + Math.sin(angle) * size * .31;
    ctx.fillStyle = "rgba(132, 241, 218, " + ((1 - trail / 7) * .48) + ")";
    ctx.beginPath(); ctx.arc(trailX, trailY, .7 + (1 - trail / 7) * .6, 0, Math.PI * 2); ctx.fill();
  }
  const pulseX = cx + Math.cos(orbitAngle) * size * .94;
  const pulseY = cy + Math.sin(orbitAngle) * size * .31;
  const pulse = ctx.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, 7);
  pulse.addColorStop(0, "rgba(199,255,239,.9)");
  pulse.addColorStop(1, "rgba(116,238,211,0)");
  ctx.fillStyle = pulse;
  ctx.beginPath(); ctx.arc(pulseX, pulseY, 7, 0, Math.PI * 2); ctx.fill();
}
function animateOrb(time) {
  pointerX += (pointerTargetX - pointerX) * .035;
  pointerY += (pointerTargetY - pointerY) * .035;
  orbStage.style.setProperty("--pointer-x", (pointerX * 10) + "px");
  orbStage.style.setProperty("--pointer-y", (pointerY * 10) + "px");
  drawOrb(time);
  if (!reducedMotion) requestAnimationFrame(animateOrb);
}
if ("ResizeObserver" in window) new ResizeObserver(resizeOrb).observe(orbCanvas);
else window.addEventListener("resize", resizeOrb, { passive: true });
if (!reducedMotion) {
  orbStage.addEventListener("pointermove", (event) => {
    const bounds = orbStage.getBoundingClientRect();
    pointerTargetX = ((event.clientX - bounds.left) / bounds.width - .5) * 2;
    pointerTargetY = ((event.clientY - bounds.top) / bounds.height - .5) * 2;
  });
  orbStage.addEventListener("pointerleave", () => { pointerTargetX = 0; pointerTargetY = 0; });
  requestAnimationFrame(animateOrb);
}

const stackWrap = document.getElementById("stackWrap");
if (stackWrap && window.matchMedia("(hover: hover)").matches && !reducedMotion) {
  stackWrap.addEventListener("pointermove", (event) => {
    const bounds = stackWrap.getBoundingClientRect();
    stackWrap.style.setProperty("--stack-tilt-y", (((event.clientX - bounds.left) / bounds.width - .5) * 7) + "deg");
    stackWrap.style.setProperty("--stack-tilt-x", (((event.clientY - bounds.top) / bounds.height - .5) * -3) + "deg");
  });
  stackWrap.addEventListener("pointerleave", () => {
    stackWrap.style.setProperty("--stack-tilt-x", "0deg");
    stackWrap.style.setProperty("--stack-tilt-y", "0deg");
  });
}

mailApp.classList.toggle("is-compact", preferences.compact);
renderMessages();

async function updateMailboxCallsToAction() {
  const links = document.querySelectorAll('a[href="app.html"]');
  if (!links.length) return;
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const session = await response.json();
    if (!session.signedIn) return;
    links.forEach((link) => {
      const label = [...link.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (label) label.textContent = "Open your mailbox ";
      link.setAttribute("aria-label", "Open your mailbox");
    });
  } catch {}
}

updateMailboxCallsToAction();
