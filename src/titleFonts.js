export const DEFAULT_TITLE_FONT = "londrina-shadow";

export const TITLE_FONT_OPTIONS = [
  {
    value: "londrina-shadow",
    label: "Londrina Shadow",
  },
  {
    value: "freckle-face",
    label: "Freckle Face",
  },
  {
    value: "bungee-shade",
    label: "Bungee Shade",
  },
  {
    value: "monoton",
    label: "Monoton",
  },
  {
    value: "rubik-puddles",
    label: "Rubik Puddles",
  },
  {
    value: "fascinate-inline",
    label: "Fascinate Inline",
  },
  {
    value: "rye",
    label: "Rye",
  },
  {
    value: "barrio",
    label: "Barrio",
  },
];

const TITLE_FONT_VALUES = new Set(TITLE_FONT_OPTIONS.map((option) => option.value));

export const normalizeTitleFont = (value) =>
  TITLE_FONT_VALUES.has(value) ? value : DEFAULT_TITLE_FONT;

export const getEventTitleClassName = (value, extraClassName = "") => {
  const normalizedFont = normalizeTitleFont(value);

  return ["event-title", `event-title--${normalizedFont}`, extraClassName]
    .filter(Boolean)
    .join(" ");
};