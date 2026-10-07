// Numbers and counted nouns, the same everywhere: "1,284", "1 patient", "12 patients".
const numbers = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 6 });
const plurals = new Intl.PluralRules("en-MY");

/** A number with thousands separators; up to six decimals, so 0.1 + 0.2 reads "0.3" and a measured "3.14" stays. */
export const formatNumber = (n: number) => numbers.format(n);

/** "1 patient", "1,284 patients"; `other` defaults to `one` + "s". */
export const countOf = (n: number, one: string, other = `${one}s`) => `${formatNumber(n)} ${plurals.select(n) === "one" ? one : other}`;
