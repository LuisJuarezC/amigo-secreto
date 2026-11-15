"use strict";

const byId = (id) => document.getElementById(id);
const setup = byId("setup");
const namesInput = byId("names");
const namesError = byId("names-error");
const formError = byId("form-error");
const budgetInput = byId("budget");
const dateInput = byId("delivery-date");
const placeInput = byId("place");
const exclusionsPanel = byId("exclusions");
const pairList = byId("pairs");
const addPairButton = byId("add-pair");
const resumeButton = byId("resume-draw");
const resultList = byId("result-list");
const revealButton = byId("reveal");
const copyDialog = byId("copy-dialog");

const version = 1;
const resultPrefix = "#resultado=";
const sitePath = location.pathname.replace(/\/index\.html$/, "/");
const storageKey = "amigo-secreto:" + version + ":" + sitePath;
const soles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "UTC" });

let savedDraw = null;
let storageFailed = false;
let openedResult = null;

function nameKey(name) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-PE");
}

function readNames() {
  const names = new Map();
  const duplicates = new Set();
  for (const line of namesInput.value.split(/\r\n?|\n/)) {
    const name = line.trim();
    if (!name) continue;
    const key = nameKey(name);
    if (names.has(key)) {
      duplicates.add(names.get(key));
    } else {
      names.set(key, name);
    }
  }
  return { names, duplicates };
}

function peopleLabel(count) {
  return count + (count === 1 ? " persona" : " personas");
}

function updateSelect(select, names, value = select.value) {
  select.replaceChildren(new Option("Elige una persona", ""));
  for (const [key, name] of names) {
    select.add(new Option(name, key));
  }
  if (value && !names.has(value)) {
    select.add(new Option(value + " (fuera de la lista)", value));
    select.setAttribute("aria-invalid", "true");
  } else {
    select.removeAttribute("aria-invalid");
  }
  select.value = value;
}

function showNamesError(message) {
  namesError.textContent = message;
  namesError.hidden = !message;
  if (message) {
    namesInput.setAttribute("aria-invalid", "true");
  } else {
    namesInput.removeAttribute("aria-invalid");
  }
}

function updateParticipants() {
  const { names, duplicates } = readNames();
  byId("participant-count").textContent = peopleLabel(names.size);
  const message = duplicates.size
    ? "Diferencia los nombres repetidos con un apellido o apodo (" + [...duplicates].join(", ") + ")."
    : "";
  showNamesError(message);
  addPairButton.disabled = names.size < 2;
  byId("pair-hint").hidden = names.size >= 2;
  for (const select of pairList.querySelectorAll("select")) {
    updateSelect(select, names);
  }
  return { names, duplicates };
}

function labelPairs() {
  for (const [index, pair] of Array.from(pairList.children).entries()) {
    const number = index + 1;
    pair.querySelector(".first-person").setAttribute("aria-label", "Primera persona de la exclusión " + number);
    pair.querySelector(".second-person").setAttribute("aria-label", "Segunda persona de la exclusión " + number);
    pair.querySelector("button").setAttribute("aria-label", "Quitar exclusión " + number);
  }
}

function addPair(names, first = "", second = "") {
  const pair = byId("pair-template").content.firstElementChild.cloneNode(true);
  const firstSelect = pair.querySelector(".first-person");
  updateSelect(firstSelect, names, first);
  updateSelect(pair.querySelector(".second-person"), names, second);
  pair.querySelector("button").addEventListener("click", () => {
    const nextControl = pair.nextElementSibling?.querySelector("select") ?? addPairButton;
    pair.remove();
    labelPairs();
    clearFormError();
    (nextControl.disabled ? exclusionsPanel.querySelector("summary") : nextControl).focus();
  });
  pairList.append(pair);
  labelPairs();
  return firstSelect;
}

function showFormError(message, field) {
  formError.textContent = message;
  formError.hidden = false;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

function clearFormError() {
  formError.hidden = true;
}

function readExclusions(names) {
  const exclusions = [];
  for (const pair of pairList.children) {
    const [first, second] = pair.querySelectorAll("select");
    const unavailable = [first, second].find((select) => !names.has(select.value));
    if (unavailable || first.value === second.value) {
      exclusionsPanel.open = true;
      showFormError("Elige dos personas distintas de la lista en cada exclusión o quita ese par.", unavailable ?? second);
      return null;
    }
    exclusions.push([first.value, second.value]);
  }
  return exclusions;
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readEventDetails() {
  const enteredBudget = budgetInput.value.trim();
  const budget = enteredBudget ? Number(enteredBudget.replace(",", ".")) : null;
  if (enteredBudget && (!/^\d+(?:[.,]\d{1,2})?$/.test(enteredBudget) || !Number.isFinite(budget))) {
    showFormError("Escribe un presupuesto válido en soles, por ejemplo 50.00.", budgetInput);
    return null;
  }
  const date = dateInput.value;
  if (dateInput.validity.badInput || (date && !isDate(date))) {
    showFormError("Selecciona una fecha válida para la entrega.", dateInput);
    return null;
  }
  return { budget, date, place: placeInput.value.trim() };
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function assignRecipients(keys, exclusions) {
  const indices = Array.from(keys.keys());
  const indexOf = new Map(keys.map((key, index) => [key, index]));
  const blocked = indices.map((index) => new Set([index]));
  for (const [first, second] of exclusions) {
    const left = indexOf.get(first);
    const right = indexOf.get(second);
    blocked[left].add(right);
    blocked[right].add(left);
  }

  // Primero se prueban permutaciones al azar. Si las exclusiones son
  // numerosas, la búsqueda siguiente encuentra una solución si existe.
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const recipients = shuffle(indices.slice());
    if (recipients.every((receiver, giver) => !blocked[giver].has(receiver))) {
      return recipients;
    }
  }

  const choices = blocked.map((excluded) => shuffle(indices.filter((index) => !excluded.has(index))));
  const recipients = Array(keys.length).fill(-1);
  const givers = Array(keys.length).fill(-1);
  for (const start of shuffle(indices.slice())) {
    const queue = [start];
    const sourceFor = Array(keys.length).fill(-1);
    let freeRecipient = -1;

    // Sigue las asignaciones existentes hasta llegar a un destinatario libre.
    for (let cursor = 0; cursor < queue.length && freeRecipient === -1; cursor += 1) {
      const giver = queue[cursor];
      for (const receiver of choices[giver]) {
        if (sourceFor[receiver] !== -1) continue;
        sourceFor[receiver] = giver;
        if (givers[receiver] === -1) {
          freeRecipient = receiver;
          break;
        }
        queue.push(givers[receiver]);
      }
    }

    if (freeRecipient === -1) return null;
    while (freeRecipient !== -1) {
      const giver = sourceFor[freeRecipient];
      const previous = recipients[giver];
      recipients[giver] = freeRecipient;
      givers[freeRecipient] = giver;
      freeRecipient = previous;
    }
  }
  return recipients;
}

function validName(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDetails(details) {
  return details !== null && typeof details === "object"
    && (details.budget === null || (Number.isFinite(details.budget) && details.budget >= 0))
    && (details.date === "" || isDate(details.date))
    && typeof details.place === "string";
}

function readSavedDraw() {
  try {
    const draw = JSON.parse(localStorage.getItem(storageKey));
    if (draw?.version !== version || !validDetails(draw.details)
      || !Array.isArray(draw.assignments) || draw.assignments.length < 2
      || !draw.assignments.every((assignment) => validName(assignment?.giver) && validName(assignment?.receiver))
      || !Array.isArray(draw.exclusions)
      || !draw.exclusions.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(validName))) {
      return null;
    }
    return draw;
  } catch {
    return null;
  }
}

function saveDraw(draw) {
  savedDraw = draw;
  try {
    localStorage.setItem(storageKey, JSON.stringify(draw));
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}

function resultLink(assignment, details) {
  // Un enlace lleva una sola asignación en el fragmento de la URL.
  const data = JSON.stringify({ version, ...assignment, details });
  const bytes = new TextEncoder().encode(data);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const link = new URL(location.href);
  link.search = "";
  link.hash = resultPrefix + encoded;
  return link.href;
}

function readResult(fragment) {
  if (!fragment.startsWith(resultPrefix)) return null;
  const encoded = fragment.slice(resultPrefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return result?.version === version && validName(result.giver) && validName(result.receiver)
      && nameKey(result.giver) !== nameKey(result.receiver) && validDetails(result.details)
      ? result
      : null;
  } catch {
    return null;
  }
}

async function copyMessage(message, button, name) {
  try {
    await navigator.clipboard.writeText(message);
  } catch {
    if (typeof copyDialog.showModal !== "function") {
      window.prompt("Copia este mensaje para WhatsApp.", message);
      return;
    }
    const box = copyDialog.querySelector("textarea");
    box.value = message;
    if (!copyDialog.open) copyDialog.showModal();
    box.focus();
    box.select();
    return;
  }
  button.textContent = "Mensaje copiado";
  const announcement = byId("announcement");
  announcement.textContent = "Mensaje copiado para " + name + ".";
  window.setTimeout(() => { button.textContent = "Copiar mensaje"; }, 1800);
}

function renderSavedDraw(moveFocus = false) {
  const fragment = document.createDocumentFragment();
  for (const assignment of savedDraw.assignments) {
    const row = byId("result-template").content.firstElementChild.cloneNode(true);
    const name = assignment.giver;
    const link = resultLink(assignment, savedDraw.details);
    row.querySelector(".result-name").textContent = name;
    const open = row.querySelector("a");
    open.href = link;
    open.setAttribute("aria-label", "Abrir enlace de " + name);
    const button = row.querySelector("button");
    button.setAttribute("aria-label", "Copiar mensaje de " + name);
    const message = [
      "¡Hola, " + name + "!",
      "Ya está listo el sorteo de Amigo secreto. Abre tu enlace para ver a quién le regalarás.",
      link,
    ].join("\n");
    button.addEventListener("click", () => copyMessage(message, button, name));
    fragment.append(row);
  }
  resultList.replaceChildren(fragment);
  byId("results-count").textContent = peopleLabel(savedDraw.assignments.length);
  byId("storage-notice").hidden = !storageFailed;
  setup.hidden = true;
  byId("results").hidden = false;
  if (moveFocus) byId("results-title").focus();
}

function generateDraw(event) {
  event.preventDefault();
  clearFormError();
  const { names, duplicates } = updateParticipants();
  if (duplicates.size || names.size < 2) {
    if (!duplicates.size) showNamesError("Agrega al menos dos participantes para realizar el sorteo.");
    namesInput.focus();
    return;
  }
  const details = readEventDetails();
  if (!details) return;
  const exclusions = readExclusions(names);
  if (!exclusions) return;

  const recipients = assignRecipients([...names.keys()], exclusions);
  if (!recipients) {
    exclusionsPanel.open = true;
    showFormError("Con estas exclusiones no hay un sorteo posible. Quita o ajusta un par e inténtalo de nuevo.");
    return;
  }
  if ((savedDraw || readSavedDraw()) && !window.confirm(
    "Este sorteo reemplazará al que está guardado en este navegador. Los enlaces que ya compartiste seguirán mostrando las asignaciones anteriores.",
  )) return;

  const people = [...names.values()];
  const assignments = people.map((giver, index) => ({ giver, receiver: people[recipients[index]] }));
  saveDraw({ version, assignments, details, exclusions });
  renderSavedDraw(true);
}

function prepareAnotherDraw() {
  namesInput.value = savedDraw.assignments.map(({ giver }) => giver).join("\n");
  const { budget, date, place } = savedDraw.details;
  budgetInput.value = budget ?? "";
  dateInput.value = date;
  placeInput.value = place;
  pairList.replaceChildren();
  const { names } = updateParticipants();
  for (const [first, second] of savedDraw.exclusions) addPair(names, first, second);
  exclusionsPanel.open = savedDraw.exclusions.length > 0;
  clearFormError();
  resumeButton.hidden = false;
  byId("results").hidden = true;
  setup.hidden = false;
  namesInput.focus();
}

function renderEventFacts(details) {
  const facts = [
    ["Presupuesto", details.budget === null ? "" : soles.format(details.budget)],
    ["Fecha", details.date ? dateFormat.format(new Date(details.date + "T00:00:00Z")) : ""],
    ["Lugar", details.place],
  ];
  const list = byId("event-facts");
  const fragment = document.createDocumentFragment();
  for (const [label, value] of facts) {
    if (!value) continue;
    const fact = document.createElement("div");
    fact.className = "fact";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    fact.append(term, description);
    fragment.append(fact);
  }
  list.replaceChildren(fragment);
  list.hidden = list.children.length === 0;
}

function showPage() {
  const fragment = location.hash;
  const isIndividual = Boolean(fragment);
  openedResult = isIndividual ? readResult(fragment) : null;
  document.body.classList.toggle("viewing-result", isIndividual);
  byId("hero").hidden = isIndividual;
  byId("organizer").hidden = isIndividual;
  byId("participant").hidden = !openedResult;
  byId("invalid-link").hidden = !isIndividual || Boolean(openedResult);

  if (isIndividual) {
    if (openedResult) {
      byId("greeting").textContent = "Hola, " + openedResult.giver;
      byId("recipient-name").textContent = "";
      byId("event-facts").replaceChildren();
      byId("assignment").hidden = true;
      revealButton.hidden = false;
    }
    return;
  }

  byId("local-notice").hidden = location.protocol !== "file:";
  savedDraw = savedDraw ?? readSavedDraw();
  if (savedDraw) {
    renderSavedDraw();
  } else {
    updateParticipants();
  }
}

setup.addEventListener("submit", generateDraw);
setup.addEventListener("input", (event) => {
  clearFormError();
  event.target.removeAttribute("aria-invalid");
  if (event.target === namesInput) updateParticipants();
});
addPairButton.addEventListener("click", () => {
  addPair(readNames().names).focus();
});
byId("new-draw").addEventListener("click", prepareAnotherDraw);
resumeButton.addEventListener("click", () => renderSavedDraw(true));
revealButton.addEventListener("click", () => {
  const name = byId("recipient-name");
  name.textContent = openedResult.receiver;
  renderEventFacts(openedResult.details);
  byId("assignment").hidden = false;
  revealButton.hidden = true;
  name.focus();
});
window.addEventListener("hashchange", showPage);
showPage();
