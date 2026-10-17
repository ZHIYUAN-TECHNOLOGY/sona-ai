/**
 * A Malaysian mobile number in the form the SMS code goes to (+60 then 9 or 10 digits), from however
 * it was typed: with or without the leading 0, spaces, dashes or the country code.
 * ponytail: Malaysia only; a country picker comes with the first patient from elsewhere.
 */
export function toE164(typed: string) {
  let digits = typed.replace(/\D/g, "");
  if (digits.startsWith("60")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^1\d{8,9}$/.test(digits) ? `+60${digits}` : undefined;
}

/** The six-digit code as typed or pasted, digits only. */
export const codeDigits = (typed: string) => typed.replace(/\D/g, "").slice(0, 6);
