export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const canonicalizeEmail = (value: string) => {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.indexOf('@');
  if (atIndex < 1) return normalized;

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') {
    return normalized;
  }

  const withoutTag = local.split('+')[0] ?? local;
  return `${withoutTag.replace(/\./g, '')}@gmail.com`;
};

export const emailCandidates = (value: string) => {
  const normalized = normalizeEmail(value);
  const canonical = canonicalizeEmail(normalized);
  return canonical === normalized ? [normalized] : [normalized, canonical];
};
