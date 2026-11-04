import * as pdfjs from "./vendor/pdf.min.mjs";

const form = document.querySelector("#aiDocumentForm");
const fileInput = document.querySelector("#aiDocumentFile");
const status = document.querySelector("#aiDocumentStatus");
const list = document.querySelector("#aiDocumentList");
const maxFileBytes = 5 * 1024 * 1024;
const maxTextChars = 40000;
const documentTypes = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function setStatus(message, isError = false) {
  status.textContent = message || "";
  status.classList.toggle("error", Boolean(isError));
}

function typeForFile(file) {
  const name = String(file && file.name || "");
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return documentTypes[extension] ? { extension, mimeType: documentTypes[extension] } : null;
}

async function readPdf(file) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: 0,
    verbosity: 0
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 50) throw new Error("PDFs are limited to 50 pages.");
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      pages.push(content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" "));
      if (pages.join("\n").length > maxTextChars) throw new Error("This document extracts to more than 40,000 characters. Split it into smaller documents.");
    }
    return pages.join("\n\n").trim();
  } finally {
    await task.destroy();
  }
}

async function extractText(file, info) {
  if (info.extension === ".pdf") return readPdf(file);
  if (info.extension === ".docx") {
    if (!window.mammoth || typeof window.mammoth.extractRawText !== "function") {
      throw new Error("The Word document reader did not load. Refresh the page and try again.");
    }
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = String(result.value || "").trim();
    if (text.length > maxTextChars) throw new Error("This document extracts to more than 40,000 characters. Split it into smaller documents.");
    return text;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).trim();
  if (text.length > maxTextChars) throw new Error("This document contains more than 40,000 characters. Split it into smaller documents.");
  return text;
}

function renderDocuments(documents) {
  list.replaceChildren();
  if (!documents.length) {
    const empty = document.createElement("p");
    empty.className = "ai-empty-note";
    empty.textContent = "No company documents uploaded yet.";
    list.append(empty);
    return;
  }
  for (const item of documents) {
    const row = document.createElement("article");
    row.className = "ai-document-entry";
    const details = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = item.file_name;
    const meta = document.createElement("small");
    meta.textContent = `${String(item.mime_type || "Document").replace("application/", "").replace("vnd.openxmlformats-officedocument.wordprocessingml.document", "Word")} · added ${new Date(item.created_at).toLocaleDateString()}`;
    details.append(title, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-button ai-delete-entry";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove document ${item.file_name}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove “${item.file_name}” and its extracted text from your AI knowledge?`)) return;
      remove.disabled = true;
      try {
        await api(`/api/ai/documents?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await loadDocuments();
        setStatus("Document removed.");
      } catch (error) {
        setStatus(error.message, true);
        remove.disabled = false;
      }
    });
    row.append(details, remove);
    list.append(row);
  }
}

async function loadDocuments() {
  try {
    const result = await api("/api/ai/documents");
    renderDocuments(result.documents || []);
  } catch (error) {
    list.replaceChildren();
    const message = document.createElement("p");
    message.className = "ai-empty-note error";
    message.textContent = error.message;
    list.append(message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files && fileInput.files[0];
  if (!file) return setStatus("Choose a document first.", true);
  if (file.size <= 0 || file.size > maxFileBytes) return setStatus("Choose a non-empty file up to 5 MB.", true);
  const info = typeForFile(file);
  if (!info) return setStatus("Choose a PDF, DOCX, TXT, Markdown, or CSV file.", true);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  fileInput.disabled = true;
  setStatus("Reading the document in this browser…");
  try {
    const extractedText = await extractText(file, info);
    if (!extractedText) throw new Error("No readable text was found. Scanned-image PDFs need OCR, which is not included.");
    await api("/api/ai/documents", {
      method: "POST",
      body: { fileName: file.name, mimeType: info.mimeType, extractedText }
    });
    fileInput.value = "";
    setStatus("Extracted text saved to your OpenMail account.");
    await loadDocuments();
  } catch (error) {
    setStatus(error.message || "The document could not be read.", true);
  } finally {
    button.disabled = false;
    fileInput.disabled = false;
  }
});

document.addEventListener("openmail:ai-panel-open", loadDocuments);
