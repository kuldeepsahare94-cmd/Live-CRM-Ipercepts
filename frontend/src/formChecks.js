// The same checks the server makes (backend/services/validate.js), so a typo is shown
// under the field before Save instead of coming back as an error afterwards.
const PHONE_CHARS = /^[0-9+\-() ]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i;
const URL_OK = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** kind: 'phone' | 'email' | 'url' | 'number' — '' (no message) when fine or empty */
export function checkFormat(kind, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '' || v === null || v === undefined) return '';
  if (kind === 'phone') {
    const digits = String(v).replace(/\D/g, '');
    return !PHONE_CHARS.test(String(v)) || digits.length < 7 || digits.length > 15 ? 'Enter a valid number (7 to 15 digits, e.g. 98765 43210).' : '';
  }
  if (kind === 'email') return EMAIL.test(String(v)) ? '' : 'Enter a valid email, like name@company.com.';
  if (kind === 'url') return URL_OK.test(String(v)) || DOMAIN.test(String(v)) ? '' : 'Enter a web address like https://example.com';
  if (kind === 'number') return Number.isNaN(Number(v)) ? 'Enter a number.' : '';
  return '';
}

/** the field types of the universal forms → a kind above (or '') */
export const kindOfType = (t) => ({ phone: 'phone', email: 'email', url: 'url', number: 'number', decimal: 'number', currency: 'number', percent: 'number' }[t] || '');
