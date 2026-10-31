/** Uppercases and strips spaces from an IBAN. */
const normaliseIban = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

/** ISO 13616 check: structure plus the mod-97 checksum. */
function isValidIban(value) {
  const iban = normaliseIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** `SA•• •••• •••• •••• •••• 1234`: country code and last four digits only. */
function maskIban(value) {
  const iban = normaliseIban(value);
  if (iban.length < 8) return null;
  return `${iban.slice(0, 2)}•• •••• •••• ${iban.slice(-4)}`;
}

module.exports = { normaliseIban, isValidIban, maskIban };
