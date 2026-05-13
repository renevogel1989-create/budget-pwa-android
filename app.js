const DB_NAME = "budget-pwa-v1";
const STORE = "vault";
const enc = new TextEncoder();
const dec = new TextDecoder();
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const today = new Date();
let db;
let key;
let vault = emptyVault();

const $ = (selector) => document.querySelector(selector);
const monthInput = $("#monthInput");
monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
$("#actualForm [name=date]").valueAsDate = today;

function emptyVault() {
  return { incomes: [], obligations: [], actuals: [], updatedAt: null };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function record(name, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, value === undefined ? "readonly" : "readwrite");
    const request = value === undefined ? tx.objectStore(STORE).get(name) : tx.objectStore(STORE).put(value, name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(passphrase, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function saveVault() {
  vault.updatedAt = new Date().toISOString();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(vault)));
  await record("payload", { iv: bytesToBase64(iv), data: bytesToBase64(data) });
}

async function unlock(passphrase) {
  let meta = await record("meta");
  if (!meta) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(passphrase, salt);
    await record("meta", { salt: bytesToBase64(salt), createdAt: new Date().toISOString() });
    vault = emptyVault();
    await saveVault();
    return;
  }
  key = await derive(passphrase, base64ToBytes(meta.salt));
  const payload = await record("payload");
  if (!payload) {
    vault = emptyVault();
    await saveVault();
    return;
  }
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  vault = JSON.parse(dec.decode(plain));
}

async function init() {
  db = await openDb();
  $("#unlockTitle").textContent = (await record("meta")) ? "Tresor entsperren" : "Tresor einrichten";
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

$("#unlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#unlockMessage").textContent = "";
  try {
    await unlock($("#passphrase").value);
    $("#passphrase").value = "";
    $("#lockView").classList.add("hidden");
    $("#dashboardView").classList.remove("hidden");
    render();
  } catch {
    $("#unlockMessage").textContent = "Passwort passt nicht oder der Tresor ist beschaedigt.";
  }
});

$("#lockButton").addEventListener("click", () => {
  key = null;
  vault = emptyVault();
  $("#dashboardView").classList.add("hidden");
  $("#lockView").classList.remove("hidden");
});

function monthInfo() {
  const [year, month] = monthInput.value.split("-").map(Number);
  return { year, month: month - 1, days: new Date(year, month, 0).getDate() };
}

function safeDay(day) {
  return Math.max(1, Math.min(Number(day) || 1, monthInfo().days));
}

function isCurrentMonth() {
  const selected = monthInfo();
  return selected.year === today.getFullYear() && selected.month === today.getMonth();
}

function sameMonth(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const selected = monthInfo();
  return date.getFullYear() === selected.year && date.getMonth() === selected.month;
}

function model() {
  const events = [
    ...vault.incomes.map((item) => ({ day: safeDay(item.day), amount: Number(item.amount), type: "income" })),
    ...vault.obligations.map((item) => ({ day: safeDay(item.day), amount: -Number(item.amount), type: "fixed" })),
    ...vault.actuals.filter((item) => sameMonth(item.date)).map((item) => ({ day: new Date(`${item.date}T00:00:00`).getDate(), amount: -Number(item.amount), type: "actual" }))
  ].sort((a, b) => a.day - b.day);
  let balance = 0;
  const daily = [];
  for (let day = 1; day <= monthInfo().days; day += 1) {
    for (const item of events.filter((event) => event.day === day)) balance += item.amount;
    daily.push({ day, balance });
  }
  return { events, daily };
}

function render() {
  const data = model();
  const income = vault.incomes.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixed = vault.obligations.reduce((sum, item) => sum + Number(item.amount), 0);
  const actuals = data.events.filter((item) => item.type === "actual").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const currentDay = isCurrentMonth() ? today.getDate() : monthInfo().days;
  const open = data.events.filter((item) => item.amount < 0 && item.day >= currentDay).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const forecast = income - fixed - actuals;
  $("#incomeTotal").textContent = euro.format(income);
  $("#fixedTotal").textContent = euro.format(fixed);
  $("#openTotal").textContent = euro.format(open);
  $("#forecastTotal").textContent = euro.format(forecast);
  $("#forecastTotal").className = forecast < 0 ? "danger" : "";
  $("#riskText").textContent = forecast < 0 ? `Voraussichtlich fehlen ${euro.format(Math.abs(forecast))}.` : `Voraussichtlicher Puffer: ${euro.format(forecast)}.`;
  $("#todayText").textContent = `Tag ${currentDay}`;
  renderDueList();
  draw(data.daily);
}

function renderDueList() {
  const list = $("#dueList");
  const items = [...vault.obligations].sort((a, b) => safeDay(a.day) - safeDay(b.day));
  if (!items.length) {
    list.innerHTML = `<p class="message">Noch keine Verpflichtungen erfasst.</p>`;
    return;
  }
  list.innerHTML = items.map((item) => `<div class="due-item"><strong>${safeDay(item.day)}</strong><div><div>${escapeHtml(item.name)}</div><small>${escapeHtml(item.category || "Fixkosten")} - Restwert ${euro.format(Number(item.remaining) || 0)}${item.end ? ` - Ende ${escapeHtml(item.end)}` : ""}</small></div><span>${euro.format(Number(item.amount) || 0)}</span><button data-delete="${item.id}" type="button">Loeschen</button></div>`).join("");
}

function draw(points) {
  const canvas = $("#chart");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 760;
  const height = 260;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const pad = 32;
  const values = points.map((point) => point.balance);
  const min = Math.min(0, ...values);
  const max = Math.max(100, ...values);
  const span = max - min || 1;
  const x = (day) => pad + ((day - 1) / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (value) => height - pad - ((value - min) / span) * (height - pad * 2);
  ctx.strokeStyle = "#d9e0d8";
  ctx.beginPath();
  ctx.moveTo(pad, y(0));
  ctx.lineTo(width - pad, y(0));
  ctx.stroke();
  ctx.strokeStyle = "#27634b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(x(point.day), y(point.balance)) : ctx.moveTo(x(point.day), y(point.balance)));
  ctx.stroke();
  if (isCurrentMonth()) {
    ctx.strokeStyle = "#2e6486";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x(today.getDate()), pad);
    ctx.lineTo(x(today.getDate()), height - pad);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

async function add(collection, item) {
  vault[collection].push({ id: id(), ...item });
  await saveVault();
  render();
}

$("#incomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await add("incomes", formObject(event.currentTarget));
  event.currentTarget.reset();
});

$("#actualForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await add("actuals", formObject(event.currentTarget));
  event.currentTarget.reset();
  $("#actualForm [name=date]").valueAsDate = today;
});

$("#obligationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await add("obligations", formObject(event.currentTarget));
  event.currentTarget.reset();
});

$("#dueList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  vault.obligations = vault.obligations.filter((item) => item.id !== button.dataset.delete);
  await saveVault();
  render();
});

$("#importForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#fileInput").files[0];
  if (!file) return;
  try {
    const rows = await parseImportFile(file);
    const mapped = rows.map(mapRow).filter((item) => item.name && Number(item.amount));
    vault.obligations.push(...mapped.map((item) => ({ id: id(), ...item })));
    await saveVault();
    $("#importMessage").textContent = `${mapped.length} Verpflichtungen importiert.`;
    event.currentTarget.reset();
    render();
  } catch (error) {
    $("#importMessage").textContent = error.message;
  }
});

$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

async function parseImportFile(file) {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    if (!window.XLSX) throw new Error("XLSX-Bibliothek nicht geladen. Bitte online starten oder als CSV exportieren.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  }
  return parseCsv(await file.text());
}

function parseCsv(text) {
  const delimiter = text.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() || "", delimiter);
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header, splitCsvLine(line, delimiter)[index] || ""])));
}

function splitCsvLine(line, delimiter) {
  const values = [];
  let value = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += char;
  }
  values.push(value.trim());
  return values;
}

function normalize(value) {
  return String(value || "").toLowerCase().replaceAll("\u00e4", "ae").replaceAll("\u00f6", "oe").replaceAll("\u00fc", "ue").replaceAll("\u00df", "ss").replace(/[\s_.-]/g, "");
}

function mapRow(row) {
  const fields = {};
  for (const [raw, value] of Object.entries(row)) {
    const key = normalize(raw);
    if (["name", "vertrag", "beschreibung", "anbieter", "leasing"].includes(key)) fields.name = value;
    if (["betrag", "rate", "monatsrate", "kosten", "zahlung"].includes(key)) fields.amount = amount(value);
    if (["faelligkeit", "faelligam", "tag", "abbuchung", "abbuchungstag"].includes(key)) fields.day = parseInt(value, 10) || 1;
    if (["kategorie", "bereich", "gruppe"].includes(key)) fields.category = value;
    if (["typ", "art", "vertragsart"].includes(key)) fields.kind = value;
    if (["restwert", "restschuld", "offen", "saldo"].includes(key)) fields.remaining = amount(value);
    if (["ende", "laufzeitende", "vertragsende", "enddatum"].includes(key)) fields.end = String(value || "").slice(0, 10);
  }
  return { name: String(fields.name || "").trim(), amount: Number(fields.amount) || 0, day: Math.max(1, Math.min(Number(fields.day) || 1, 31)), category: String(fields.category || "Fixkosten").trim(), kind: String(fields.kind || "Vertrag").trim(), remaining: Number(fields.remaining) || 0, end: fields.end || "" };
}

function amount(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

monthInput.addEventListener("change", render);
window.addEventListener("resize", () => draw(model().daily));
init();
