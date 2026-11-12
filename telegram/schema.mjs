import { choices, generalInterests, interestGroups, routeRanks } from "../docs/options.js";

const sectors = ["Пропустить", "Строительство и ремонт", "Производство и техника", "Медиа и дизайн", "IT и данные", "Торговля и бизнес", "Образование", "Здоровье и спорт", "Гостеприимство", "Другая сфера"];
export const questions = [
  ["status", "Чем вы сейчас занимаетесь?", choices.status],
  ["occupation", "В какой сфере у вас есть опыт?", sectors],
  ["ageBand", "Ваш возраст?", [...choices.ageBand, "Пропустить"]],
  ["interests", "Что вам интересно делать?", []],
  ["strength", "Что у вас получается?", choices.strength],
  ["location", "Где хотите работать?", choices.location],
  ["atmosphere", "Как выглядит ваш удачный день?", choices.atmosphere],
  ["workStyle", "Как удобнее решать задачи?", choices.workStyle],
  ["hoursPerWeek", "Сколько часов в неделю на обучение?", choices.hoursPerWeek],
  ["months", "Сколько месяцев готовы учиться?", choices.months],
  ["effort", "Какой темп вам подходит?", choices.effort],
  ["complexity", "Какая сложность вам интересна?", ["1 · Простые задачи", "2 · Небольшой вызов", "3 · Разобраться в теме", "4 · Искать решения", "5 · Открытые задачи"]],
  ["immersion", "Насколько хотите погрузиться?", choices.immersion]
];
export const sectorsOfInterest = Object.entries({ ...interestGroups, "Пока выбираю сферу": generalInterests });
const stages = ["Отправная точка","Интересы","Сильная сторона","Рабочий день","Темп обучения","Глубина освоения"];
export const cardPublicData = JSON.stringify({titles:questions.map(q=>q[1]), stages, intro:"Первая ближе всего к вашим ответам. В двух других пригодятся ваши навыки."});
export function questionOptions(index) {
  return index === 3 ? sectorsOfInterest.map(([name])=>name) : questions[index]?.[2];
}

export function decodeAnswers(values, selected) {
  if (values.length !== questions.length || !/^[0-9a-z]+$/.test(values) || !/^[0-9a-z]{1,2}(\.[0-9a-z]{1,2}){0,3}$/.test(selected)) return null;
  const profile = { otherInterest: null };
  for (const [index, [key,, options]] of questions.entries()) {
    if (key === "interests") continue;
    const n = parseInt(values[index], 36);
    if (n >= options.length) return null;
    if (key === "occupation") profile.occupation = n === 0 ? null : sectors[n];
    else if (key === "ageBand") profile.ageBand = choices.ageBand[n] ?? null;
    else profile[key] = choices[key][n];
  }
  profile.interests = selected.split(".").map(n => choices.interests[parseInt(n, 36)]);
  return profile.interests.every(Boolean) && new Set(profile.interests).size === profile.interests.length ? profile : null;
}

export function cardHtml(template) {
  return template.replace(/^[ \t]+/gm, "").replace("__RANKS__", JSON.stringify(routeRanks))
    .replace("__OPTIONS__", JSON.stringify(Object.fromEntries([0,2,8,9].map(i=>[i,questionOptions(i)]))));
}
