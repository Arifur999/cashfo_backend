// geoip-country ships no types; this is the one call the app makes.
declare module 'geoip-country' {
  export interface GeoCountry {
    // ISO 3166-1 alpha-2, e.g. "BD".
    country: string;
    // English name, e.g. "Bangladesh".
    name: string;
  }

  // Null for an address the database doesn't place (private, reserved).
  export function lookup(ip: string): GeoCountry | null;

  const geoip: { lookup: typeof lookup };
  export default geoip;
}
