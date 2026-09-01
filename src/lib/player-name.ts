export const normalizePlayerName = (value: string) =>
  value.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');

export const normalizePlayerNameKey = (value: string) =>
  normalizePlayerName(value).toLocaleLowerCase();

export const normalizePlayerKey = (value: string) =>
  normalizePlayerNameKey(value).replace(/[^a-z0-9]/g, '');
