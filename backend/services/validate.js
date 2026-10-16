/*
 * Checks on what is typed into a record (v1.7). The app and the web show the same
 * messages next to the field; this is the one that cannot be skipped, so a script
 * or an import is held to the same rules.
 *
 *   check(body, { required, phone, email, url, positive, oneOf }, { partial })
 *     → null when fine, else a short sentence for the person.
 *
 * `partial` (an edit): only the fields that are in the body are looked at.
 * Names are trimmed in place: "  Asha  " is saved as "Asha".
 */
const PHONE_CHARS = /^[0-9+\-() ]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i;
const URL_OK = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

const NAMES = { student_name: 'Name', first_name: 'First name', account_name: 'Company name', mobile: 'Mobile number', alternate_mobile: 'Alternate mobile', phone: 'Phone number', whatsapp: 'WhatsApp number', secondary_email: 'Second email', subject: 'Subject' };
const label = (k) => NAMES[k] || String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const has = (b, k) => Object.prototype.hasOwnProperty.call(b, k);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function check(b, rules = {}, { partial = false } = {}) {
  if (!b || typeof b !== 'object') return null;
  for (const k of rules.required || []) {
    if (partial && !has(b, k)) continue;
    if (typeof b[k] === 'string') b[k] = b[k].trim();
    if (empty(b[k])) return `${label(k)} is required.`;
  }
  for (const k of rules.phone || []) {
    if (empty(b[k])) continue;
    const v = String(b[k]).trim();
    const digits = v.replace(/\D/g, '');
    if (!PHONE_CHARS.test(v) || digits.length < 7 || digits.length > 15) return `${label(k)} is not a valid phone number (7 to 15 digits).`;
  }
  for (const k of rules.email || []) {
    if (!empty(b[k]) && !EMAIL.test(String(b[k]).trim())) return `${label(k)} is not a valid email address.`;
  }
  for (const k of rules.url || []) {
    if (empty(b[k])) continue;
    const v = String(b[k]).trim();
    if (URL_OK.test(v)) { b[k] = v; continue; }
    // "www.mehtasteel.in" (as printed on a card) is a website: it is saved as https://www.mehtasteel.in
    if (DOMAIN.test(v)) { b[k] = `https://${v}`; continue; }
    return `${label(k)} must be a web address like https://example.com (links such as javascript: are not allowed).`;
  }
  for (const k of rules.positive || []) {
    if (partial && !has(b, k)) continue;
    const n = Number(b[k]);
    if (empty(b[k]) || Number.isNaN(n) || n <= 0) return `${label(k)} must be more than 0.`;
  }
  for (const [k, list] of Object.entries(rules.oneOf || {})) {
    if (!empty(b[k]) && !list.map((x) => String(x).toLowerCase()).includes(String(b[k]).toLowerCase())) return `${label(k)} must be one of: ${list.join(', ')}.`;
  }
  return null;
}

/** respond 400 with the sentence when there is one; true when the request was answered */
function reject(res, message) {
  if (!message) return false;
  res.status(400).json({ error: message });
  return true;
}

module.exports = { check, reject };
