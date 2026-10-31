/**
 * Normalises a phone number to E.164 (`+966501234567`). `dial` (e.g. `+966`) is
 * the country code the user picked; it is used when the number is national
 * (`0501234567` or `501234567`). Returns null when it can't be a phone number.
 */
function normalisePhone(input, dial) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (dial) {
    const code = String(dial).replace(/\D/g, '');
    digits = digits.replace(/^0+/, '');
    if (!digits.startsWith(code) || digits.length < 11) digits = code + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** National digits of a number (no country code guess): leading zeros removed. */
const nationalDigits = (input) => String(input || '').replace(/\D/g, '').replace(/^0+/, '');

module.exports = { normalisePhone, nationalDigits };
