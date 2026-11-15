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
const giftTools = byId("gift-tools");
const giftResponse = byId("gift-response");
const giftForm = byId("gift-form");

const version = 1;
const resultPrefix = "#resultado=";
const giftInvitePrefix = "#sugerir=";
const giftReplyPrefix = "#ideas=";
const sitePath = location.pathname.replace(/\/index\.html$/, "/");
const storageKey = "amigo-secreto:" + version + ":" + sitePath;
const draftKey = storageKey + ":borrador";
const soles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "UTC" });

let savedDraw = null;
let storageFailed = false;
let openedResult = null;
let organizerReady = false;
let draftActive = false;
let draftGifts = new Map();
let inviteBudget = null;

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
    rememberDraft();
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

function parseAmount(raw) {
  const text = raw.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(",", "."));
  return Number.isFinite(amount) ? amount : null;
}

function readEventDetails() {
  const budget = parseAmount(budgetInput.value);
  if (budgetInput.value.trim() && budget === null) {
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
    && (details.budget === null || validBudget(details.budget))
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

function makeLink(prefix, data) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version, ...data }));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const link = new URL(location.href);
  link.search = "";
  link.hash = prefix + encoded;
  return link.href;
}

function readLink(fragment, prefix) {
  if (!fragment.startsWith(prefix)) return null;
  const encoded = fragment.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return data?.version === version ? data : null;
  } catch {
    return null;
  }
}

function readResult(fragment) {
  const result = readLink(fragment, resultPrefix);
  return validName(result?.giver) && validName(result.receiver)
    && nameKey(result.giver) !== nameKey(result.receiver) && validDetails(result.details)
    ? result
    : null;
}

async function copyText(text, button, feedback, announcement = feedback) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (typeof copyDialog.showModal !== "function") {
      window.prompt("Copia este texto para WhatsApp.", text);
      return;
    }
    const box = copyDialog.querySelector("textarea");
    box.value = text;
    if (!copyDialog.open) copyDialog.showModal();
    box.focus();
    box.select();
    return;
  }
  button.dataset.copyLabel ??= button.textContent;
  button.textContent = feedback;
  byId("announcement").textContent = announcement;
  window.setTimeout(() => { button.textContent = button.dataset.copyLabel; }, 1800);
}

function validBudget(value) {
  return Number.isFinite(value) && value >= 0;
}

function validGiftIdeas(ideas, budget) {
  return validBudget(budget) && Array.isArray(ideas) && ideas.length === 3
    && ideas.every((idea) => validName(idea?.name) && idea.name.length <= 120
      && validBudget(idea.price) && idea.price <= budget)
    && new Set(ideas.map((idea) => nameKey(idea.name))).size === 3;
}

function storedGifts(entries) {
  const gifts = Array.isArray(entries) ? entries : [];
  return new Map(gifts.filter((entry) => Array.isArray(entry) && validName(entry[0])
    && validGiftIdeas(entry[1], Number.MAX_VALUE)));
}

function readGiftReply(hash) {
  const reply = readLink(hash, giftReplyPrefix);
  return validName(reply?.name) && validGiftIdeas(reply.ideas, reply.budget) ? reply : null;
}

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey));
  } catch {
    return null;
  }
}

function latestDraftGifts() {
  return new Map([...draftGifts, ...storedGifts(readDraft()?.gifts)]);
}

function rememberDraft(newGift) {
  if (!draftActive || setup.hidden) return true;
  draftGifts = latestDraftGifts();
  if (newGift) draftGifts.set(...newGift);
  const pairs = Array.from(pairList.children, (pair) =>
    Array.from(pair.querySelectorAll("select"), (select) => select.value));
  const draft = {
    names: namesInput.value,
    budget: budgetInput.value,
    date: dateInput.value,
    place: placeInput.value,
    pairs,
    gifts: [...draftGifts],
  };
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function restoreDraft() {
  const draft = readDraft();
  if (typeof draft?.names !== "string") return false;
  namesInput.value = draft.names;
  budgetInput.value = typeof draft.budget === "string" ? draft.budget : "";
  dateInput.value = typeof draft.date === "string" ? draft.date : "";
  placeInput.value = typeof draft.place === "string" ? draft.place : "";
  draftGifts = storedGifts(draft.gifts);
  const { names } = updateParticipants();
  for (const pair of Array.isArray(draft.pairs) ? draft.pairs : []) {
    if (Array.isArray(pair) && pair.length === 2 && pair.every((value) => typeof value === "string")) {
      addPair(names, ...pair);
    }
  }
  exclusionsPanel.open = pairList.children.length > 0;
  resumeButton.hidden = !savedDraw;
  draftActive = true;
  return true;
}

function giftContext() {
  if (setup.hidden && savedDraw) {
    const names = new Map(savedDraw.assignments.map(({ giver }) => [nameKey(giver), giver]));
    return { names, budget: savedDraw.details.budget, gifts: storedGifts(savedDraw.gifts) };
  }
  return { names: readNames().names, budget: parseAmount(budgetInput.value), gifts: draftGifts };
}

function updateGiftCount() {
  const { names, budget, gifts } = giftContext();
  const count = [...names.keys()].filter((name) => validGiftIdeas(gifts.get(name), budget)).length;
  byId("gift-count").textContent = names.size ? count + " de " + names.size + " con ideas" : "Opcionales";
}

function showGiftStatus(message, isError = false) {
  const status = byId("gift-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
  status.hidden = !message;
}

function copyGiftInvitation(button) {
  const { budget } = giftContext();
  if (!validBudget(budget)) {
    showGiftStatus("Indica un presupuesto válido para preparar el enlace general.", true);
    if (!setup.hidden) budgetInput.focus();
    return;
  }
  draftActive = true;
  const stored = rememberDraft();
  showGiftStatus(stored
    ? "Comparte el enlace con el grupo. Las respuestas te llegarán por WhatsApp."
    : "El borrador queda abierto en esta pestaña. El navegador impidió guardarlo.");
  copyText(makeLink(giftInvitePrefix, { budget }), button, "Enlace copiado");
}

function registerGifts() {
  const hash = giftResponse.value.match(/#ideas=[A-Za-z0-9_-]+/)?.[0] ?? "";
  const reply = readGiftReply(hash);
  if (!reply) {
    showGiftStatus("Pega el mensaje completo o el enlace de respuesta de la persona.", true);
    giftResponse.focus();
    return;
  }

  const inResults = setup.hidden;
  if (inResults && !storageFailed) savedDraw = readSavedDraw() ?? savedDraw;
  const { names, budget, gifts } = giftContext();
  const key = nameKey(reply.name);
  const participant = names.get(key);
  if (!participant) {
    showGiftStatus("Agrega «" + reply.name + "» a la lista de participantes o revisa el nombre de la respuesta.", true);
    return;
  }
  if (!validGiftIdeas(reply.ideas, budget)) {
    showGiftStatus("Las tres opciones deben estar dentro del presupuesto actual del sorteo.", true);
    return;
  }

  let message = "Sugerencias de " + participant + " registradas.";
  if (inResults) {
    gifts.set(key, reply.ideas);
    saveDraw({ ...savedDraw, gifts: [...gifts] });
    renderSavedDraw();
    message += " Si ya enviaste el enlace a quien le regala, vuelve a copiarlo y compártelo.";
  } else {
    draftActive = true;
    if (!rememberDraft([key, reply.ideas])) message += " Conserva esta pestaña abierta para mantenerlas.";
    updateGiftCount();
  }
  giftResponse.value = "";
  showGiftStatus(message);
}

function shareGiftIdeas(event) {
  event.preventDefault();
  const error = byId("gift-form-error");
  const name = byId("gift-name").value.trim();
  const ideas = [1, 2, 3].map((index) => ({
    name: byId("gift-" + index).value.trim(),
    price: parseAmount(byId("price-" + index).value),
  }));
  if (!validName(name) || !validGiftIdeas(ideas, inviteBudget)) {
    error.textContent = !validName(name)
      ? "Escribe el nombre o apodo con el que apareces en el sorteo."
      : "Escribe tres regalos diferentes y un precio válido para cada uno, hasta "
        + soles.format(inviteBudget) + " por regalo.";
    error.hidden = false;
    return;
  }
  error.hidden = true;

  const link = makeLink(giftReplyPrefix, { name, budget: inviteBudget, ideas });
  const message = [
    "Hola, soy " + name + ". Estas son mis ideas para el Amigo secreto.",
    ...ideas.map((idea) => "• " + idea.name + " (" + soles.format(idea.price) + ")"),
    "",
    "Enlace para registrar mis sugerencias",
    link,
  ].join("\n");
  copyText(message, giftForm.querySelector("button"), "Respuesta copiada");
}

function renderGiftIdeas(ideas, budget) {
  const list = byId("recipient-gift-list");
  list.replaceChildren();
  byId("recipient-gifts").hidden = !validGiftIdeas(ideas, budget);
  if (byId("recipient-gifts").hidden) return;
  for (const idea of ideas) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = idea.name;
    const price = document.createElement("span");
    price.textContent = soles.format(idea.price);
    item.append(name, price);
    list.append(item);
  }
}

function renderSavedDraw(moveFocus = false) {
  const fragment = document.createDocumentFragment();
  const gifts = storedGifts(savedDraw.gifts);
  for (const assignment of savedDraw.assignments) {
    const row = byId("result-template").content.firstElementChild.cloneNode(true);
    const name = assignment.giver;
    // El enlace solo lleva la asignación y las ideas de esa persona.
    const data = { ...assignment, details: savedDraw.details };
    const ideas = gifts.get(nameKey(assignment.receiver));
    if (validGiftIdeas(ideas, savedDraw.details.budget)) data.gifts = ideas;
    const link = makeLink(resultPrefix, data);
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
    button.addEventListener("click", () =>
      copyText(message, button, "Mensaje copiado", "Mensaje copiado para " + name + "."));
    fragment.append(row);
  }
  resultList.replaceChildren(fragment);
  byId("results-count").textContent = peopleLabel(savedDraw.assignments.length);
  byId("storage-notice").hidden = !storageFailed;
  setup.hidden = true;
  byId("results").hidden = false;
  if (giftTools.parentElement === setup) byId("new-draw").before(giftTools);
  updateGiftCount();
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
  const gifts = [...latestDraftGifts()].filter(([name, ideas]) =>
    names.has(name) && validGiftIdeas(ideas, details.budget));
  saveDraw({ version, assignments, details, exclusions, gifts });
  if (draftActive && !storageFailed) {
    draftActive = false;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // El sorteo ya se guardó. Algunos navegadores restringen localStorage.
    }
  }
  showGiftStatus("");
  renderSavedDraw(true);
}

function prepareAnotherDraw() {
  if (!draftActive) {
    namesInput.value = savedDraw.assignments.map(({ giver }) => giver).join("\n");
    const { budget, date, place } = savedDraw.details;
    budgetInput.value = budget ?? "";
    dateInput.value = date;
    placeInput.value = place;
    draftGifts = storedGifts(savedDraw.gifts);
    pairList.replaceChildren();
    const { names } = updateParticipants();
    for (const [first, second] of savedDraw.exclusions) addPair(names, first, second);
    exclusionsPanel.open = savedDraw.exclusions.length > 0;
  }
  clearFormError();
  showGiftStatus("");
  resumeButton.hidden = false;
  byId("results").hidden = true;
  setup.hidden = false;
  formError.before(giftTools);
  updateGiftCount();
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
  openedResult = readResult(fragment);
  const invitation = readLink(fragment, giftInvitePrefix);
  inviteBudget = validBudget(invitation?.budget) ? invitation.budget : null;
  const reply = readGiftReply(fragment);
  const organizerMode = !fragment || Boolean(reply);
  document.body.classList.toggle("viewing-result", !organizerMode);
  byId("hero").hidden = !organizerMode;
  byId("organizer").hidden = !organizerMode;
  byId("participant").hidden = !openedResult;
  byId("gift-invitation").hidden = inviteBudget === null;
  byId("invalid-link").hidden = organizerMode || Boolean(openedResult) || inviteBudget !== null;

  if (!organizerMode) {
    if (openedResult) {
      byId("greeting").textContent = "Hola, " + openedResult.giver;
      byId("recipient-name").textContent = "";
      byId("event-facts").replaceChildren();
      renderGiftIdeas(null, null);
      byId("assignment").hidden = true;
      revealButton.hidden = false;
    }
    if (inviteBudget !== null) {
      giftForm.reset();
      byId("gift-form-error").hidden = true;
      byId("gift-invitation-budget").textContent = "Hasta " + soles.format(inviteBudget) + " por opción";
    }
    return;
  }

  byId("local-notice").hidden = location.protocol !== "file:";
  if (!organizerReady) {
    organizerReady = true;
    savedDraw = readSavedDraw();
    if (!restoreDraft()) {
      if (savedDraw) renderSavedDraw();
      else updateParticipants();
    }
  }
  updateGiftCount();
  if (reply) {
    giftResponse.value = location.href;
    history.replaceState(null, "", location.pathname + location.search);
    giftTools.open = true;
    showGiftStatus("Pulsa «Registrar sugerencias» para guardar la respuesta de " + reply.name + ".");
    giftResponse.focus();
  }
}

setup.addEventListener("submit", generateDraw);
setup.addEventListener("input", (event) => {
  if (giftTools.contains(event.target)) return;
  clearFormError();
  event.target.removeAttribute("aria-invalid");
  if (event.target === namesInput) updateParticipants();
  if (event.target === namesInput || event.target === budgetInput) updateGiftCount();
  rememberDraft();
});
addPairButton.addEventListener("click", () => {
  addPair(readNames().names).focus();
  rememberDraft();
});
byId("copy-gift-link").addEventListener("click", (event) => copyGiftInvitation(event.currentTarget));
byId("register-gifts").addEventListener("click", registerGifts);
giftForm.addEventListener("submit", shareGiftIdeas);
giftForm.addEventListener("input", () => { byId("gift-form-error").hidden = true; });
byId("new-draw").addEventListener("click", prepareAnotherDraw);
resumeButton.addEventListener("click", () => renderSavedDraw(true));
revealButton.addEventListener("click", () => {
  const name = byId("recipient-name");
  name.textContent = openedResult.receiver;
  renderEventFacts(openedResult.details);
  renderGiftIdeas(openedResult.gifts, openedResult.details.budget);
  byId("assignment").hidden = false;
  revealButton.hidden = true;
  name.focus();
});
window.addEventListener("hashchange", showPage);
window.addEventListener("storage", (event) => {
  if (!organizerReady || byId("organizer").hidden) return;
  if (event.key === draftKey && event.newValue && draftActive && !setup.hidden) {
    draftGifts = latestDraftGifts();
    updateGiftCount();
  }
  if (event.key === storageKey && event.newValue && setup.hidden && !storageFailed) {
    savedDraw = readSavedDraw() ?? savedDraw;
    renderSavedDraw();
  }
});
showPage();
