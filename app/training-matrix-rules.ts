const normalized = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

export const canonicalAircraft = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");

export const typeSpecificTraining = (name: string) =>
  /асп.*суш|кпк.*тип|квалификац.*провер|тренаж.*кабин|тренажер/.test(normalized(name));
