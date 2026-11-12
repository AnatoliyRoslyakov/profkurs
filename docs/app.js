import { choices } from "./options.js";

const stages = [
  ["Отправная точка", "Чем вы сейчас занимаетесь?", "По вашим ответам ИИ предложит профессию и подскажет, с чего начать."],
  ["Интересы", "Что вам интересно делать?", "Выберите от одного до трёх занятий, к которым вас тянет."],
  ["Сильная сторона", "Что у вас получается лучше всего?", "Вспомните, с чем к вам чаще всего обращаются за помощью."],
  ["Формат работы", "Как вам удобнее работать?", "Представьте, что вам предстоит решить новую задачу."],
  ["Темп обучения", "Сколько времени у вас есть?", "Выберите нагрузку, которую сможете вписать в обычную неделю."],
  ["Глубина освоения", "Насколько глубоко хотите погрузиться?", "Укажите комфортную сложность и то, к чему хотите прийти."]
];
const stageFields = [
  ["status"], ["interests"], ["strength"], ["workStyle"], ["hoursPerWeek", "months", "effort"], ["complexity", "immersion"]
];
const prompts = {
  status: "Выберите, чем вы сейчас занимаетесь.", interests: "Выберите от одного до трёх занятий.",
  strength: "Выберите свою сильную сторону.", workStyle: "Выберите подходящий формат работы.",
  hoursPerWeek: "Выберите число часов в неделю.", months: "Выберите срок обучения.",
  effort: "Выберите комфортную нагрузку.", complexity: "Выберите сложность задач.", immersion: "Выберите цель обучения."
};
const complexityLabels = ["Простые задачи с понятными шагами", "Знакомые задачи с небольшим вызовом", "Задачи, в которых нужно разобраться", "Сложные задачи с поиском решения", "Открытые задачи с высокой неопределённостью"];
const positions = [[50,8],[86.4,29],[86.4,71],[50,92],[13.6,71],[13.6,29]];
const panel = document.getElementById("panel");
const dial = document.querySelector(".dial");
const stations = document.getElementById("stations");
const themeButton = document.getElementById("theme");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function blankProfile() {
  return {
    status: null, occupation: null, ageBand: null, interests: [], strength: null, workStyle: null,
    hoursPerWeek: null, months: null, effort: null, complexity: null, immersion: null
  };
}

let profile = blankProfile();
let step = 0;
let furthest = 0;
let page = "form";
let result = null;
let failure = "";
let pending = null;
let telegram = null;
let themeOverride = null;
let touched = false;
let detailsOpen = false;

function el(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content !== undefined) item.textContent = content;
  return item;
}

function button(text, onClick, kind = "", direction = "") {
  const item = el("button", "action" + (kind ? " " + kind : ""), text);
  item.type = "button";
  item.addEventListener("click", onClick);
  if (direction) {
    const icon = el("span", direction === "back" ? "arrow back" : "arrow");
    icon.setAttribute("aria-hidden", "true");
    if (direction === "back") item.prepend(icon);
    else item.append(icon);
  }
  return item;
}

function applyTheme() {
  const fallback = systemTheme.matches ? "dark" : "light";
  const embedded = telegram && (telegram.initData || (telegram.platform && telegram.platform !== "unknown"));
  const theme = themeOverride || (embedded && telegram.colorScheme) || fallback;
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
  const styles = getComputedStyle(document.documentElement);
  const color = styles.getPropertyValue("--paper").trim();
  document.querySelector('meta[name="theme-color"]').content = color;
  if (telegram?.isVersionAtLeast?.("6.9")) telegram.setHeaderColor?.(styles.getPropertyValue("--surface").trim());
  if (telegram?.isVersionAtLeast?.("6.1")) telegram.setBackgroundColor?.(color);
}

themeButton.addEventListener("click", () => {
  themeOverride = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
});
systemTheme.addEventListener?.("change", applyTheme);

function applyStartParam(value) {
  const match = /^route1_([0-2])_([0-5])$/.exec(value || "");
  if (!match || touched) return;
  profile.status = choices.status[Number(match[1])];
  profile.interests = [choices.interests[Number(match[2])]];
}

function back() {
  if (page !== "form") {
    if (pending) pending.abort();
    pending = null;
    navigate(stages.length - 1);
  } else if (step > 0) {
    navigate(step - 1);
  }
}

function attachTelegram() {
  const sdk = window.Telegram?.WebApp;
  if (!sdk || telegram) return;
  telegram = sdk;
  if (sdk.initDataUnsafe?.start_param) applyStartParam(sdk.initDataUnsafe.start_param);
  sdk.onEvent?.("themeChanged", applyTheme);
  if (sdk.isVersionAtLeast?.("6.1")) sdk.BackButton?.onClick(back);
  if (sdk.initData) sdk.expand?.();
  applyTheme();
  render();
  sdk.ready?.();
}

function haptic() {
  if (telegram?.isVersionAtLeast?.("6.1")) telegram.HapticFeedback?.selectionChanged();
}

function navigate(next) {
  touched = true;
  page = "form";
  step = next;
  furthest = Math.max(furthest, next);
  render(true);
}

function restart() {
  profile = blankProfile();
  result = null;
  failure = "";
  furthest = 0;
  detailsOpen = false;
  navigate(0);
}

function refreshDial() {
  const current = page === "form" ? step : stages.length - 1;
  const adjustment = page === "form" ? stageFields[step].reduce((sum, key) => {
    const answer = profile[key];
    if (Array.isArray(answer)) return sum + answer.length * 2;
    return sum + Math.max(0, choices[key].indexOf(answer) + 1);
  }, 0) : 0;
  dial.style.setProperty("--bearing", (current * 60 + Math.min(8, adjustment)) + "deg");
}

function updateChart() {
  document.getElementById("stage-count").textContent = page === "form" ? `Шаг ${step + 1} из ${stages.length}` : "Маршрут пройден";
  const suffix = { loading: "Подбор профессии", error: "Ваши ответы", result: "Рекомендация" };
  document.getElementById("stage-name").textContent = page === "form" ? stages[step][0] : suffix[page];
  document.getElementById("chart-footnote").textContent = "К пройденному шагу можно вернуться по номеру";
  stations.replaceChildren();
  stages.forEach(([name], index) => {
    const node = el("button", "station", String(index + 1));
    node.type = "button";
    node.style.setProperty("--x", positions[index][0] + "%");
    node.style.setProperty("--y", positions[index][1] + "%");
    node.title = `Шаг ${index + 1}. ${name}`;
    node.setAttribute("aria-label", node.title);
    node.disabled = index > furthest || page === "loading";
    if (page === "form" && index === step) node.setAttribute("aria-current", "step");
    node.addEventListener("click", () => navigate(index));
    stations.append(node);
  });
  refreshDial();
  if (telegram?.isVersionAtLeast?.("6.1")) {
    if (page === "form" && step === 0) telegram.BackButton?.hide();
    else telegram.BackButton?.show();
  }
}

function heading(parent, title, intro) {
  const h1 = el("h1", "", title);
  h1.id = "question";
  h1.tabIndex = -1;
  parent.append(h1);
  if (intro) parent.append(el("p", "intro", intro));
}

function updateInterests(field) {
  const count = profile.interests.length;
  field.querySelector(".selection-count").textContent = `Выбрано ${count} из 3`;
  field.querySelectorAll("input").forEach(input => { input.disabled = count === 3 && !input.checked; });
}

function makeField(key, title = "", segments = false) {
  const field = el("fieldset", "field");
  field.dataset.field = key;
  field.append(el("legend", title ? "" : "sr-only", title || stages[step][1]));
  const options = el("div", segments ? "segments" : "options");
  field.append(options);
  const multi = key === "interests";
  choices[key].forEach((value, index) => {
    const row = el("label", segments ? "segment" : "option" + (key === "status" ? " status-option" : ""));
    const input = el("input");
    input.type = multi ? "checkbox" : "radio";
    input.name = key;
    input.value = String(value);
    input.checked = multi ? profile.interests.includes(value) : profile[key] === value;
    row.append(input);
    if (key === "status") {
      const icon = el("span", "option-art art-" + ["work", "study", "explore"][index]);
      icon.setAttribute("aria-hidden", "true");
      icon.append(el("i"));
      row.append(icon);
    }
    row.append(el("span", segments ? "" : "option-text", String(value)));
    if (!segments) row.append(el("span", "indicator"));
    input.addEventListener("change", () => {
      touched = true;
      if (multi) {
        profile.interests = Array.from(options.querySelectorAll("input:checked"), item => item.value).slice(0, 3);
        updateInterests(field);
      } else profile[key] = value;
      if (key === "complexity") field.querySelector(".scale-caption").textContent = complexityLabels[index];
      clearFeedback();
      refreshDial();
      haptic();
    });
    options.append(row);
  });
  if (multi) {
    const count = el("p", "selection-count");
    count.setAttribute("aria-live", "polite");
    field.append(count);
    updateInterests(field);
  }
  if (key === "complexity") {
    const caption = el("p", "scale-caption", complexityLabels[profile.complexity - 1] || "От простых задач (1) до сложных и открытых (5).");
    caption.setAttribute("aria-live", "polite");
    field.append(caption);
  }
  return field;
}

function optionalDetails() {
  const details = el("details", "more");
  details.open = detailsOpen;
  details.addEventListener("toggle", () => { detailsOpen = details.open; });
  const body = el("div", "details-body");
  const job = el("label", "", "Текущее или прошлое занятие");
  const input = el("input");
  input.type = "text";
  input.maxLength = 80;
  input.placeholder = "Например, бариста";
  input.value = profile.occupation || "";
  input.addEventListener("input", () => {
    touched = true;
    profile.occupation = input.value.trim().slice(0, 80) || null;
  });
  job.append(input);
  const age = el("label", "", "Возраст");
  const select = el("select");
  const empty = el("option", "", "Не указывать");
  empty.value = "";
  select.append(empty);
  choices.ageBand.forEach(item => select.append(el("option", "", item)));
  select.value = profile.ageBand || "";
  select.addEventListener("change", () => { touched = true; profile.ageBand = select.value || null; });
  age.append(select);
  body.append(job, age);
  details.append(el("summary", "", "Занятие и возраст — по желанию"), body);
  return details;
}

function clearFeedback() {
  panel.querySelector(".feedback")?.remove();
}

function firstInvalid(index) {
  return stageFields[index].find(key => {
    const answer = profile[key];
    if (key === "interests") {
      return answer.length < 1 || answer.length > 3 || new Set(answer).size !== answer.length || answer.some(value => !choices.interests.includes(value));
    }
    return !choices[key].includes(answer);
  });
}

function feedback(key) {
  clearFeedback();
  const error = el("p", "feedback", prompts[key]);
  error.setAttribute("role", "alert");
  const group = panel.querySelector(`[data-field="${key}"]`);
  group.append(error);
  group.querySelector("input")?.focus();
}

function advance() {
  if (page !== "form" || pending) return;
  const invalid = firstInvalid(step);
  if (invalid) { feedback(invalid); return; }
  if (step < stages.length - 1) {
    navigate(step + 1);
    return;
  }
  submitProfile();
}

function renderForm() {
  heading(panel, stages[step][1], stages[step][2]);
  const form = el("form");
  if (step === 0) form.append(makeField("status"), optionalDetails());
  else if (step < 4) form.append(makeField(stageFields[step][0]));
  else if (step === 4) {
    form.append(makeField("hoursPerWeek", "Часов в неделю", true), makeField("months", "Месяцев на обучение", true), makeField("effort", "В каком темпе?"));
  } else {
    form.append(makeField("complexity", "Сложность задач", true), makeField("immersion", "Цель обучения"));
    form.append(el("p", "scale-caption", "По кнопке «Подобрать профессию» ваши ответы получит DeepSeek."));
  }
  const actions = el("div", step ? "actions" : "actions solo");
  if (step) actions.append(button("Назад", back, "secondary", "back"));
  const next = el("button", "action", step === stages.length - 1 ? "Подобрать профессию" : "Дальше");
  next.type = "submit";
  const arrow = el("span", "arrow");
  arrow.setAttribute("aria-hidden", "true");
  next.append(arrow);
  actions.append(next);
  form.append(actions);
  form.addEventListener("submit", event => { event.preventDefault(); advance(); });
  panel.append(form);
}

function renderOutcome() {
  const actions = el("div", "actions");
  if (page === "loading") {
    panel.append(el("span", "spinner"));
    heading(panel, "Подбираем профессию", "ИИ сопоставляет ваши интересы, сильную сторону и планы на обучение.");
    actions.append(button("Вернуться к ответам", back, "secondary", "back"));
  } else if (page === "error") {
    heading(panel, "Подбор пока не завершён", failure);
    actions.append(button("К ответам", back, "secondary", "back"), button("Повторить", submitProfile));
  } else {
    panel.append(el("p", "result-label", "Ваша профессия по ответам"));
    heading(panel, result.profession);
    const why = el("section", "result-block");
    why.append(el("h2", "", "Почему вам подходит"), el("p", "", result.why));
    const first = el("section", "result-block first-step");
    first.append(el("h2", "", "Первый шаг"), el("p", "", result.firstStep));
    panel.append(why, first);
    actions.append(button("Изменить ответы", () => navigate(0)), button("Начать заново", restart, "secondary"));
  }
  panel.append(actions);
}

function render(focus = false) {
  updateChart();
  panel.replaceChildren();
  if (page === "form") renderForm();
  else renderOutcome();
  if (focus) {
    document.getElementById("question").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function endpoint() {
  if (typeof window.CAREER_API !== "string" || !window.CAREER_API.trim()) return null;
  try {
    const url = new URL(window.CAREER_API.trim(), location.href);
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return url.href;
  } catch { /* Present the configuration error in the form. */ }
  return null;
}

function responseIsValid(data) {
  return data && ["profession", "why", "firstStep"].every(key =>
    typeof data[key] === "string" && data[key].trim().length > 0 && data[key].length <= 12000
  );
}

function showFailure(message) {
  failure = message;
  page = "error";
  render(true);
}

async function submitProfile() {
  if (pending || page === "loading") return;
  for (let index = 0; index < stages.length; index++) {
    const invalid = firstInvalid(index);
    if (invalid) { navigate(index); feedback(invalid); return; }
  }
  const url = endpoint();
  if (!url) { showFailure("Сервис рекомендаций ещё не подключён. Ваши ответы останутся здесь, пока анкета открыта."); return; }
  if (navigator.onLine === false) { showFailure("Нет соединения с интернетом. Подключитесь к сети и нажмите «Повторить»."); return; }
  const controller = new AbortController();
  pending = controller;
  page = "loading";
  render(true);
  const timeout = window.setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ version: 1, profile }), signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer"
    });
    if (pending !== controller) return;
    if (!response.ok) {
      let message = "Сервис временно недоступен. Ваши ответы сохранены в этой анкете. Попробуйте ещё раз.";
      if (response.status === 429) message = "Сейчас много запросов. Подождите немного и нажмите «Повторить».";
      if (response.status === 400 || response.status === 422) message = "Сервис не смог принять анкету. Вернитесь к ответам и проверьте их.";
      showFailure(message);
      return;
    }
    let data;
    try { data = await response.json(); } catch (error) {
      if (controller.signal.aborted) throw error;
      data = null;
    }
    if (pending !== controller) return;
    if (!responseIsValid(data)) { showFailure("Сервис вернул неполную рекомендацию. Повторите подбор с теми же ответами."); return; }
    result = data;
    page = "result";
    render(true);
  } catch {
    if (pending !== controller) return;
    const message = controller.signal.aborted ? "Сервис долго не отвечает. Повторите подбор с теми же ответами." : "Не удалось связаться с сервисом. Проверьте интернет и нажмите «Повторить».";
    showFailure(message);
  } finally {
    window.clearTimeout(timeout);
    if (pending === controller) pending = null;
  }
}

const query = new URLSearchParams(location.search);
applyStartParam(query.get("tgWebAppStartParam") || query.get("startapp"));
applyTheme();
render();
document.querySelector('script[src*="telegram-web-app.js"]').addEventListener("load", attachTelegram);
attachTelegram();
