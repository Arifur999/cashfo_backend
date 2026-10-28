import { isIP } from 'node:net';
import geoip from 'geoip-country';

// The country an IP address is in, by name, from the GeoLite2 country
// database bundled with geoip-country (no network call). "Unknown" for an
// address it can't place: a private network, a test client, anything that
// isn't an IP at all.
export function countryOfIp(ipAddress: string | null): string {
  if (!ipAddress) return 'Unknown';
  // How an IPv4 client can appear on a dual-stack socket.
  const address = ipAddress.startsWith('::ffff:') ? ipAddress.slice('::ffff:'.length) : ipAddress;
  if (!isIP(address)) return 'Unknown';
  return geoip.lookup(address)?.name ?? 'Unknown';
}

// The same, or null when the address can't be placed: for showing beside
// it ("Bangladesh · 103.4.145.1").
export const placeOfIp = (ipAddress: string | null): string | null => {
  const country = countryOfIp(ipAddress);
  return country === 'Unknown' ? null : country;
};

// The country with its ISO code (BD, US, ...), or null when the address
// can't be placed: for comparing places, where a name could change between
// database releases but the code doesn't.
export function ipCountry(ipAddress: string | null): { code: string; name: string } | null {
  if (!ipAddress) return null;
  const address = ipAddress.startsWith('::ffff:') ? ipAddress.slice('::ffff:'.length) : ipAddress;
  if (!isIP(address)) return null;
  const found = geoip.lookup(address);
  return found?.country ? { code: found.country, name: found.name || found.country } : null;
}
