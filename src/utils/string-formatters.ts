/**
 * Formats a number as a pluralised string.
 *
 * @param value - The number to format
 * @param singular - The singular form of the word
 * @param plural - The plural form of the word (optional)
 * @returns The formatted pluralised string
 */
export const formatPlural = (value: number, singular: string, plural?: string): string =>
  `${value} ${value === 1 ? singular : (plural ?? `${singular}s`)}`;
