/*
 * (v1.10) The last step of "Use my location": when the CRM's address service cannot answer
 * (the free map service busy), THIS device asks BigDataCloud's free service for the area of
 * where it is now — city, district, state, PIN code, country (often not the street).
 * Their free service must be called from the device that found the place, with its current
 * place only — which is exactly this case. Nothing is stored there.
 */
export async function deviceArea(lat, lng) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 10000) : null;
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return null;
    const x = await res.json();
    const admin = (x.localityInfo && x.localityInfo.administrative) || [];
    const district = (admin.find((a) => Number(a.adminLevel) === 5) || {}).name || '';
    const city = x.city || x.locality || '';
    const area = x.locality && x.locality !== city ? x.locality : '';
    const out = {
      line: area, area, city, district: district.replace(/ district$/i, ''), state: x.principalSubdivision || '',
      pincode: String(x.postcode || '').replace(/\s+/g, ''), country: x.countryName ? String(x.countryName).replace(/ \(the\)$/, '') : '',
      lat: Number(lat), lng: Number(lng),
    };
    out.label = [out.area, out.city, out.state, out.pincode].filter(Boolean).join(', ');
    return out.city || out.state ? out : null;
  } catch { return null; } finally { if (t) clearTimeout(t); }
}
