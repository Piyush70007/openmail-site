const messages = [
  {
    id: "m1", category: "primary", sender: "Maya Chen", address: "maya@fieldnotes.example", initials: "MC",
    subject: "A small idea for the weekend", preview: "I found a quiet place by the water that feels like your kind of afternoon…", time: "10:42 AM",
    color: "linear-gradient(135deg,#aa806a,#704c47)", unread: true, starred: false,
    body: "There’s a little place by the water that I think you’d love. No plans needed — just coffee, a long walk, and an afternoon without a schedule.\n\nWould Saturday work?\n\nMaya"
  },
  {
    id: "m2", category: "primary", sender: "Eli at Forming", address: "eli@forming.example", initials: "FO",
    subject: "The first cut is ready", preview: "The new direction is coming together. I left three notes in the shared doc…", time: "9:18 AM",
    color: "linear-gradient(135deg,#806fac,#393a66)", unread: true, starred: true,
    body: "Hey — the first cut is ready. The new direction is coming together, and I left three notes in the shared doc for when you have a moment.\n\nNothing urgent. Looking forward to your thoughts.\n\nEli"
  },
  {
    id: "m3", category: "primary", sender: "Jules Rivera", address: "jules@slowhours.example", initials: "JR",
    subject: "Re: Sunday plans", preview: "Perfect. I’ll bring the book I mentioned and meet you near the entrance…", time: "Yesterday",
    color: "linear-gradient(135deg,#789b81,#435c48)", unread: false, starred: false,
    body: "Perfect. I’ll bring the book I mentioned and meet you near the entrance around eleven. If the weather turns, we can find somewhere inside.\n\nSee you Sunday,\nJules"
  },
  {
    id: "m4", category: "social", sender: "Orbit Social", address: "hello@orbit-social.example", initials: "OS",
    subject: "Your circle had a busy week", preview: "A few people you follow shared something new this week…", time: "Yesterday",
    color: "linear-gradient(135deg,#6e8ead,#3d5e78)", unread: true, starred: false,
    body: "A few people in your circle shared something new this week. Take a look whenever you’re ready.\n\nThis is a fictional sample notification for the OpenMail inbox preview."
  },
  {
    id: "m5", category: "promotions", sender: "Field Supply", address: "studio@fieldsupply.example", initials: "FS",
    subject: "A little room for your next idea", preview: "New tools for a slower, more considered kind of making…", time: "Tue",
    color: "linear-gradient(135deg,#ba9162,#74533e)", unread: false, starred: false,
    body: "New tools for a slower, more considered kind of making. We put a small collection together for your next idea.\n\nA fictional product note, included to demonstrate the Promotions view."
  },
  {
    id: "m6", category: "updates", sender: "Northline", address: "updates@northline.example", initials: "N",
    subject: "Your monthly account note", preview: "A short summary is ready to review. Nothing needs your attention right now…", time: "Mon",
    color: "linear-gradient(135deg,#567e7a,#34514e)", unread: false, starred: false,
    body: "Your monthly account note is ready. Nothing needs your attention right now.\n\nThis is a fictional service update for the OpenMail preview."
  },
  {
    id: "m7", category: "spam", sender: "Prize Centre", address: "rewards@unusual-prize.example", initials: "!",
    subject: "You have been selected today", preview: "Claim a reward you never entered to win…", time: "Mon",
    color: "linear-gradient(135deg,#876a72,#513d47)", unread: true, starred: false,
    body: "You have been selected to receive a completely unexpected reward.\n\nThis fictional message is shown in Spam to demonstrate how a separate spam view could look. The preview does not detect or filter real mail."
  }
];

const viewNames = { all: "All mail", primary: "Primary", social: "Social", promotions: "Promotions", updates: "Updates", spam: "Spam" };
let activeView = "all";
let unreadFirst = false;
let toastTimeout;
const selectedMessages = new Set();
const list = document.getElementById("messageList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("mailSearch");
const dialog = document.getElementById("messageDialog");

function visibleMessages() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filtered = messages.filter((message) => {
    const inView = activeView === "all" ? message.category !== "spam" : message.category === activeView;
    const matches = !query || [message.sender, message.address, message.subject, message.preview, message.category].some((part) => part.toLocaleLowerCase().includes(query));
    return inView && matches;
  });
  return filtered.sort((a, b) => unreadFirst ? Number(b.unread) - Number(a.unread) : messages.indexOf(a) - messages.indexOf(b));
}

function renderMessages() {
  const filtered = visibleMessages();
  list.innerHTML = filtered.map((message) => `
    <article class="message-row${message.unread ? " unread" : ""}${selectedMessages.has(message.id) ? " selected" : ""}" tabindex="0" data-message-id="${message.id}" aria-label="Open email from ${message.sender}: ${message.subject}">
      <label class="message-check" aria-label="Select ${message.subject}"><input type="checkbox" data-select="${message.id}" ${selectedMessages.has(message.id) ? "checked" : ""} /><span></span></label>
      <span class="sender-avatar" style="background:${message.color}" aria-hidden="true">${message.initials}</span>
      <span class="message-meta"><span class="message-sender">${message.sender}</span><span class="category-label">${viewNames[message.category]}</span></span>
      <span class="message-subject">${message.subject}</span>
      <span class="message-preview">— ${message.preview}</span>
      <time class="message-time">${message.time}</time>
      <button class="star-button${message.starred ? " starred" : ""}" data-star="${message.id}" aria-label="${message.starred ? "Unstar" : "Star"} ${message.subject}" aria-pressed="${message.starred}">★</button>
    </article>`).join("");
  emptyState.hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
  document.getElementById("listCount").textContent = filtered.length ? `1–${filtered.length} of ${filtered.length}` : "0 results";
  const allCount = messages.filter((message) => message.category !== "spam").length.toString().padStart(2, "0");
  document.getElementById("allCount").textContent = allCount;
  const selectAll = document.getElementById("selectAll");
  selectAll.checked = filtered.length > 0 && filtered.every((message) => selectedMessages.has(message.id));
  selectAll.indeterminate = filtered.some((message) => selectedMessages.has(message.id)) && !selectAll.checked;
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

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function openMessage(id) {
  const message = messages.find((item) => item.id === id);
  if (!message) return;
  message.unread = false;
  renderMessages();
  document.getElementById("dialogContent").innerHTML = `
    <p class="dialog-eyebrow">${viewNames[message.category].toUpperCase()} / SAMPLE MESSAGE</p>
    <h2 class="dialog-title" id="dialogTitle">${message.subject}</h2>
    <p class="dialog-text"><b>${message.sender}</b> &lt;${message.address}&gt;</p>
    <p class="dialog-text">${message.body.replaceAll("\n", "<br />")}</p>
    <div class="dialog-meta">FICTIONAL CONTENT / LOCAL PREVIEW ONLY</div>`;
  dialog.showModal();
}

function openCompose() {
  document.getElementById("dialogContent").innerHTML = `
    <p class="dialog-eyebrow">OPENMAIL / COMPOSE PREVIEW</p>
    <h2 class="dialog-title" id="dialogTitle">Write a message</h2>
    <form class="compose-form" id="composeForm">
      <label>TO<input type="email" placeholder="name@example.com" autocomplete="off" /></label>
      <label>SUBJECT<input type="text" placeholder="A thoughtful subject" /></label>
      <label>MESSAGE<textarea placeholder="Write something here…"></textarea></label>
      <button type="submit">Preview send <span aria-hidden="true">↗</span></button>
    </form>
    <p class="dialog-disclaimer">This front-end preview cannot send email. Text is not saved and will be cleared when you close this window.</p>`;
  dialog.showModal();
  document.getElementById("composeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    dialog.close();
    showToast("Preview only — no email was sent or saved.");
  });
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => chooseView(button.dataset.view)));
searchInput.addEventListener("input", renderMessages);
document.getElementById("composeButton").addEventListener("click", openCompose);
document.getElementById("refreshButton").addEventListener("click", () => {
  messages.forEach((message) => { message.unread = ["m1", "m2", "m4", "m7"].includes(message.id); message.starred = message.id === "m2"; });
  selectedMessages.clear();
  searchInput.value = "";
  unreadFirst = false;
  document.getElementById("unreadFilter").innerHTML = "Newest first <span>⌄</span>";
  chooseView("all");
  showToast("Sample inbox reset.");
});
document.getElementById("settingsButton").addEventListener("click", () => showToast("Settings are planned. This is a local preview."));
document.getElementById("unreadFilter").addEventListener("click", (event) => {
  unreadFirst = !unreadFirst;
  event.currentTarget.innerHTML = unreadFirst ? "Unread first <span>⌄</span>" : "Newest first <span>⌄</span>";
  renderMessages();
});
document.getElementById("selectAll").addEventListener("change", (event) => {
  visibleMessages().forEach((message) => event.target.checked ? selectedMessages.add(message.id) : selectedMessages.delete(message.id));
  renderMessages();
});
list.addEventListener("click", (event) => {
  const starButton = event.target.closest("[data-star]");
  if (starButton) {
    event.stopPropagation();
    const message = messages.find((item) => item.id === starButton.dataset.star);
    message.starred = !message.starred;
    renderMessages();
    return;
  }
  const checkbox = event.target.closest("[data-select]");
  if (checkbox) {
    event.stopPropagation();
    const id = checkbox.dataset.select;
    checkbox.checked ? selectedMessages.add(id) : selectedMessages.delete(id);
    checkbox.closest(".message-row").classList.toggle("selected", checkbox.checked);
    const filtered = visibleMessages();
    const selectAll = document.getElementById("selectAll");
    selectAll.checked = filtered.length > 0 && filtered.every((message) => selectedMessages.has(message.id));
    selectAll.indeterminate = filtered.some((message) => selectedMessages.has(message.id)) && !selectAll.checked;
    return;
  }
  const row = event.target.closest("[data-message-id]");
  if (row) openMessage(row.dataset.messageId);
});
list.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".message-row")) {
    event.preventDefault();
    openMessage(event.target.dataset.messageId);
  }
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
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    openCompose();
  }
});

const progress = document.getElementById("scrollProgress");
let progressTicking = false;
window.addEventListener("scroll", () => {
  if (progressTicking) return;
  progressTicking = true;
  requestAnimationFrame(() => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0}%`;
    progressTicking = false;
  });
}, { passive: true });

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
let orbWidth = 0, orbHeight = 0, orbFrame = 0, pointerX = 0, pointerY = 0, pointerTargetX = 0, pointerTargetY = 0;
function resizeOrb() {
  const bounds = orbCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  orbWidth = bounds.width; orbHeight = bounds.height;
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
    ctx.strokeStyle = `rgba(105, 224, 208, ${Math.min(.19, ((p.depth + q.depth) / 2 - .25) * .21)})`;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  projected.forEach((point) => {
    const radius = .45 + point.depth * .78;
    const alpha = .16 + point.depth * .58;
    ctx.fillStyle = `rgba(${point.depth > .72 ? "176, 255, 234" : "93, 209, 195"}, ${alpha})`;
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
  });
  const orbitAngle = time * .00035;
  for (let trail = 6; trail > 0; trail--) {
    const angle = orbitAngle - trail * .075;
    const trailX = cx + Math.cos(angle) * size * .94;
    const trailY = cy + Math.sin(angle) * size * .31;
    ctx.fillStyle = `rgba(132, 241, 218, ${(1 - trail / 7) * .48})`;
    ctx.beginPath(); ctx.arc(trailX, trailY, .7 + (1 - trail / 7) * .6, 0, Math.PI * 2); ctx.fill();
  }
  const pulseX = cx + Math.cos(orbitAngle) * size * .94;
  const pulseY = cy + Math.sin(orbitAngle) * size * .31;
  const pulse = ctx.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, 7);
  pulse.addColorStop(0, "rgba(199,255,239,.9)"); pulse.addColorStop(1, "rgba(116,238,211,0)");
  ctx.fillStyle = pulse; ctx.beginPath(); ctx.arc(pulseX, pulseY, 7, 0, Math.PI * 2); ctx.fill();
}
function animateOrb(time) {
  pointerX += (pointerTargetX - pointerX) * .035;
  pointerY += (pointerTargetY - pointerY) * .035;
  orbStage.style.setProperty("--pointer-x", `${pointerX * 10}px`);
  orbStage.style.setProperty("--pointer-y", `${pointerY * 10}px`);
  drawOrb(time);
  if (!reducedMotion) orbFrame = requestAnimationFrame(animateOrb);
}
new ResizeObserver(resizeOrb).observe(orbCanvas);
if (!reducedMotion) {
  orbStage.addEventListener("pointermove", (event) => {
    const bounds = orbStage.getBoundingClientRect();
    pointerTargetX = ((event.clientX - bounds.left) / bounds.width - .5) * 2;
    pointerTargetY = ((event.clientY - bounds.top) / bounds.height - .5) * 2;
  });
  orbStage.addEventListener("pointerleave", () => { pointerTargetX = 0; pointerTargetY = 0; });
  orbFrame = requestAnimationFrame(animateOrb);
}

const stackWrap = document.getElementById("stackWrap");
if (stackWrap && window.matchMedia("(hover: hover)").matches && !reducedMotion) {
  stackWrap.addEventListener("pointermove", (event) => {
    const bounds = stackWrap.getBoundingClientRect();
    stackWrap.style.setProperty("--stack-tilt-y", `${((event.clientX - bounds.left) / bounds.width - .5) * 7}deg`);
    stackWrap.style.setProperty("--stack-tilt-x", `${((event.clientY - bounds.top) / bounds.height - .5) * -3}deg`);
  });
  stackWrap.addEventListener("pointerleave", () => {
    stackWrap.style.setProperty("--stack-tilt-x", "0deg");
    stackWrap.style.setProperty("--stack-tilt-y", "0deg");
  });
}

renderMessages();
window.addEventListener("resize", () => { if (reducedMotion) resizeOrb(); }, { passive: true });
