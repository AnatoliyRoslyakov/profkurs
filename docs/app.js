import { adultInterest, choices, generalInterests, interestGroups, isAdultBand } from "./options.js?v=2";

const stages = [
  ["Отправная точка", "Чем вы сейчас занимаетесь?", "По вашим ответам подберём три профессии и покажем, как можно сочетать ваши интересы."],
  ["Интересы", "Что вам интересно делать?", "Откройте интересные сферы. Можно отметить до четырёх занятий из разных сфер или вписать своё."],
  ["Сильная сторона", "Что у вас получается лучше всего?", "Вспомните, с чем к вам чаще всего обращаются за помощью."],
  ["Рабочий день", "Каким вы видите свой рабочий день?", "Представьте обычный вторник. Где хочется его провести и в какой момент вы почувствуете, что вам там хорошо?"],
  ["Темп обучения", "Сколько времени у вас есть?", "Выберите нагрузку, которую сможете вписать в обычную неделю."],
  ["Глубина освоения", "Насколько глубоко хотите погрузиться?", "Укажите комфортную сложность и то, к чему хотите прийти."]
];
const stageFields = [
  ["status"], ["interests"], ["strength"], ["location", "atmosphere", "workStyle"], ["hoursPerWeek", "months", "effort"], ["complexity", "immersion"]
];
const prompts = {
  status: "Выберите, чем вы сейчас занимаетесь.", interests: "Отметьте хотя бы одно занятие или впишите своё.",
  strength: "Выберите свою сильную сторону.", workStyle: "Выберите подходящий формат работы.",
  location: "Выберите, где вы хотите работать.", atmosphere: "Выберите близкую вам обстановку.",
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
    status: null, occupation: null, ageBand: null, interests: [], otherInterest: null, strength: null, workStyle: null, location: null, atmosphere: null,
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
  const match = /^route1_([0-2])_(\d{1,2})$/.exec(value || "");
  if (!match || touched || !generalInterests[Number(match[2])]) return;
  profile.status = choices.status[Number(match[1])];
  profile.interests = [generalInterests[Number(match[2])]];
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

function interestField() {
  const field = el("fieldset", "field interest-field");
  field.dataset.field = "interests";
  field.append(el("legend", "sr-only", stages[1][1]));
  const selected = el("div", "chosen-interests");
  const count = el("p", "selection-count");
  count.setAttribute("aria-live", "polite");
  const controls = new Map();

  function update() {
    const picked = profile.interests;
    count.textContent = `Выбрано ${picked.length} из 4`;
    selected.replaceChildren();
    for (const [value, input] of controls) {
      input.checked = picked.includes(value);
      input.disabled = picked.length >= 4 && !input.checked;
    }
    for (const value of picked) {
      const remove = el("button", "picked", value + " ×");
      remove.type = "button";
      remove.setAttribute("aria-label", "Убрать «" + value + "»");
      remove.onclick = () => { toggle(value, false); count.focus(); };
      selected.append(remove);
    }
  }
  function toggle(value, checked) {
    profile.interests = profile.interests.filter(item => item !== value);
    if (checked && profile.interests.length < 4) profile.interests.push(value);
    touched = true;
    clearFeedback();
    update();
    refreshDial();
    haptic();
  }
  count.tabIndex = -1;
  field.append(count, selected);
  const groups = { ...interestGroups, "Пока выбираю сферу": generalInterests };
  for (const [name, values] of Object.entries(groups)) {
    const group = el("details", "interest-group");
    const summary = el("summary", "", name);
    const options = el("div", "interest-chips");
    group.append(summary, options);
    for (const value of values) {
      if (value === adultInterest && !isAdultBand(profile.ageBand)) {
        if (profile.ageBand === null) {
          const ageLink = el("button", "age-link", "Указать возраст для направлений 18+");
          ageLink.type = "button";
          ageLink.onclick = () => { detailsOpen = true; navigate(0); };
          options.append(ageLink);
        }
        continue;
      }
      const row = el("label", "interest-chip");
      const input = el("input");
      input.type = "checkbox";
      input.value = value;
      input.name = "interests";
      input.onchange = () => toggle(value, input.checked);
      controls.set(value, input);
      row.append(input, el("span", "", value));
      options.append(row);
    }
    field.append(group);
  }
  const free = el("label", "free-interest", "Своё занятие");
  const input = el("input");
  input.type = "text";
  input.maxLength = 100;
  input.value = profile.otherInterest || "";
  input.placeholder = "Например, делать витражи";
  input.oninput = () => { touched = true; profile.otherInterest = input.value.trim() || null; clearFeedback(); };
  free.append(input);
  field.append(free);
  update();
  return field;
}

function makeField(key, title = "", segments = false) {
  const field = el("fieldset", "field");
  field.dataset.field = key;
  field.append(el("legend", title ? "" : "sr-only", title || stages[step][1]));
  const options = el("div", segments ? "segments" : "options");
  field.append(options);
  choices[key].forEach((value, index) => {
    const row = el("label", segments ? "segment" : "option" + (key === "status" ? " status-option" : ""));
    const input = el("input");
    input.type = "radio";
    input.name = key;
    input.value = String(value);
    input.checked = profile[key] === value;
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
      profile[key] = value;
      if (key === "complexity") field.querySelector(".scale-caption").textContent = complexityLabels[index];
      clearFeedback();
      refreshDial();
      haptic();
    });
    options.append(row);
  });
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
  select.addEventListener("change", () => {
    touched = true;
    profile.ageBand = select.value || null;
    if (!isAdultBand(profile.ageBand)) profile.interests = profile.interests.filter(value => value !== adultInterest);
  });
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
      return (!answer.length && !profile.otherInterest) || answer.length > 4 || new Set(answer).size !== answer.length || answer.some(value => !choices.interests.includes(value));
    }
    return !choices[key].includes(answer);
  });
}

function feedback(key) {
  clearFeedback();
  const error = el("p", "feedback", prompts[key]);
  error.setAttribute("role", "alert");
  const group = panel.querySelector(`[data-field="${key}"]`);
  const enclosure = group.closest("details");
  if (enclosure) enclosure.open = true;
  group.append(error);
  (group.querySelector("summary") || group.querySelector("input"))?.focus();
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

function workPreferences() {
  const section = el("div", "work-preferences");
  const questions = [
    ["location", "Где вы хотите работать?"],
    ["atmosphere", "Как выглядит ваш удачный день?"],
    ["workStyle", "Как вам удобнее решать задачи?"]
  ];
  const firstEmpty = questions.find(([key]) => !profile[key])?.[0] || "location";
  questions.forEach(([key, title]) => {
    const block = el("details", "work-question");
    const summary = el("summary");
    const answer = el("span", "work-answer", profile[key] || "");
    summary.append(el("strong", "", title), answer);
    block.append(summary, makeField(key, title));
    block.querySelector("legend").classList.add("sr-only");
    block.open = key === firstEmpty;
    block.addEventListener("change", () => {
      answer.textContent = profile[key];
      const following = block.nextElementSibling;
      if (following) {
        block.open = false;
        following.open = true;
        following.querySelector("summary").focus();
      }
    });
    section.append(block);
  });
  return section;
}

function renderForm() {
  heading(panel, stages[step][1], stages[step][2]);
  const form = el("form");
  if (step === 0) form.append(makeField("status"), optionalDetails());
  else if (step === 1) form.append(interestField());
  else if (step === 2) form.append(makeField("strength"));
  else if (step === 3) form.append(workPreferences());
  else if (step === 4) {
    form.append(makeField("hoursPerWeek", "Часов в неделю", true), makeField("months", "Месяцев на обучение", true), makeField("effort", "В каком темпе?"));
  } else {
    form.append(makeField("complexity", "Сложность задач", true), makeField("immersion", "Цель обучения"));
    form.append(el("p", "scale-caption", "По кнопке «Подобрать профессии» ваши ответы получит DeepSeek."));
  }
  const actions = el("div", step ? "actions" : "actions solo");
  if (step) actions.append(button("Назад", back, "secondary", "back"));
  const next = el("button", "action", step === stages.length - 1 ? "Подобрать профессии" : "Дальше");
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
    heading(panel, "Подбираем профессии", "ИИ сопоставляет ваши интересы, сильную сторону и планы на обучение.");
    actions.append(button("Вернуться к ответам", back, "secondary", "back"));
  } else if (page === "error") {
    heading(panel, "Подбор пока не завершён", failure);
    actions.append(button("К ответам", back, "secondary", "back"), button("Повторить", submitProfile));
  } else {
    heading(panel, "Какие профессии вам подходят");
    result.directions.forEach((route, index) => {
      const card = el("details", "career-route");
      card.open = index === 0;
      const summary = el("summary");
      summary.append(el("span", "", route.profession));
      card.append(summary, el("p", "route-why", route.why), el("h3", "", "Как выглядит рабочий день"),
        el("p", "", route.environment), el("h3", "", "Специализации"));
      const branches = el("ul", "route-branches");
      for (const branch of route.branches) branches.append(el("li", "", branch));
      const start = el("div", "first-step");
      start.append(el("h3", "", "С чего можно начать"), el("p", "", route.firstStep));
      card.append(branches, start);
      panel.append(card);
    });
    const mix = el("section", "result-block");
    mix.append(el("h2", "", "Как совместить интересы"), el("p", "", result.connection));
    panel.append(mix);
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
  const hasText = value => typeof value === "string" && value.trim().length > 0;
  return hasText(data?.connection) && Array.isArray(data.directions) && data.directions.length === 3
    && data.directions.every(route => route && [route.profession, route.why, route.environment, route.firstStep].every(hasText)
      && Array.isArray(route.branches) && route.branches.length >= 2 && route.branches.every(hasText));
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
      body: JSON.stringify({ version: 2, profile }), signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer"
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
