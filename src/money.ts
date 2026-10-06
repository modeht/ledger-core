// Money is always a whole number of fils (the smallest unit of a currency).
// No float ever holds an amount, and text is read digit by digit.

export type Currency = 'AED' | 'BHD';

// How many digits follow the decimal point, and how many fils make one whole unit.
export const CURRENCIES: Record<Currency, { decimals: number; perMajor: number }> = {
  AED: { decimals: 2, perMajor: 100 },
  BHD: { decimals: 3, perMajor: 1000 },
};

// A Minor is a whole number of fils. The brand stops a plain number from being passed by mistake.
export type Minor = number & { readonly __minor: unique symbol };

export function minor(n: number): Minor {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`not a whole number of fils: ${String(n)}`);
  }
  // Turn -0 into 0 so the two never print differently.
  return (n === 0 ? 0 : n) as Minor;
}

const AMOUNT_TEXT = /^(-?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?$/;

// Reads an amount such as "1,200.00" and gives back the fils (120000 for AED).
export function fromText(c: Currency, text: string): Minor {
  const match = AMOUNT_TEXT.exec(text);
  if (match === null) {
    throw new Error(`not an amount: ${JSON.stringify(text)}`);
  }
  const sign = match[1] ?? '';
  const whole = (match[2] ?? '').replaceAll(',', '');
  const fraction = match[3] ?? '';
  const { decimals } = CURRENCIES[c];
  if (fraction.length > decimals) {
    throw new Error(`too many decimals for ${c}: ${JSON.stringify(text)}`);
  }
  const digits = whole + fraction.padEnd(decimals, '0');
  const value = BigInt(digits);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`amount too large: ${JSON.stringify(text)}`);
  }
  // The value is a safe whole number, so reading its digits as an integer is exact.
  const n = Number.parseInt(value.toString(), 10);
  return minor(sign === '-' ? -n : n);
}

// Puts a comma between every group of three digits: "1200" -> "1,200".
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// "39,093 AED fils", "-23,000 AED fils".
export function formatMinor(c: Currency, a: Minor): string {
  const sign = a < 0 ? '-' : '';
  const digits = (a < 0 ? -a : a).toString();
  return `${sign}${groupThousands(digits)} ${c} fils`;
}

// "AED 390.93", "AED -230.00", "BHD 10.008".
export function formatMajor(c: Currency, a: Minor): string {
  const { decimals, perMajor } = CURRENCIES[c];
  const sign = a < 0 ? '-' : '';
  const size = BigInt(a < 0 ? -a : a);
  const unit = BigInt(perMajor);
  const whole = (size / unit).toString();
  const rest = (size % unit).toString().padStart(decimals, '0');
  return `${c} ${sign}${groupThousands(whole)}.${rest}`;
}

// Splits a total into equal parts. Every part gets the same share, rounded
// down, and the last part also takes whatever is left, so the parts add up
// to the total exactly. splitEqual(10000, 3) gives [3333, 3333, 3334].
export function splitEqual(total: Minor, parts: number): Minor[] {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new Error(`parts must be a whole number of at least 1: ${String(parts)}`);
  }
  const share = Math.floor(total / parts);
  const out: Minor[] = [];
  for (let i = 0; i < parts - 1; i++) {
    out.push(minor(share));
  }
  out.push(minor(total - share * (parts - 1)));
  return out;
}
