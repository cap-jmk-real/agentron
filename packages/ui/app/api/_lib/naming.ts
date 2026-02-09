const ADJECTIVES = [
  "Swift", "Clever", "Bold", "Calm", "Eager", "Fancy", "Gentle", "Happy", "Ivory", "Jolly",
  "Keen", "Lucky", "Mighty", "Noble", "Odd", "Proud", "Quick", "Rapid", "Silent", "Tidy",
  "Urban", "Vivid", "Wise", "Young", "Zesty", "Alive", "Brave", "Cool", "Daring", "Echo"
];

const ANIMALS = [
  "Fox", "Owl", "Wolf", "Bear", "Hawk", "Lynx", "Falcon", "Otter", "Raven", "Stag",
  "Moth", "Deer", "Crow", "Dove", "Pike", "Crab", "Newt", "Seal", "Wren", "Kite",
  "Lion", "Cobra", "Panda", "Tiger", "Eagle", "Shark", "Whale", "Mouse", "Horse", "Goat"
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random number 1–9999 to reduce accidental duplicate names */
function randomSuffix(): number {
  return Math.floor(Math.random() * 9999) + 1;
}

/** Default agent name when user does not provide one: e.g. "Swift Fox 42", "Clever Owl 7" */
export function randomAgentName(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${randomSuffix()}`;
}

/** Default workflow name when user does not provide one: e.g. "Steady workflow 12", "Quick workflow 3" */
export function randomWorkflowName(): string {
  return `${pick(ADJECTIVES)} workflow ${randomSuffix()}`;
}
