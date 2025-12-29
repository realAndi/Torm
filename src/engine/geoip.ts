/**
 * GeoIP Lookup Utility for Torm Engine
 *
 * Provides IP-to-country lookups for peer geolocation.
 * Uses a bundled GeoIP database for fast local lookups.
 *
 * @module engine/geoip
 */

// Cache for IP lookups to avoid repeated lookups for the same IP
const ipCountryCache = new Map<string, string | undefined>();

// Maximum cache size to prevent memory issues
const MAX_CACHE_SIZE = 10000;

/**
 * Check if an IP is a private/local address
 *
 * @param ip - IP address string
 * @returns true if the IP is private/local
 */
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip === 'localhost') return true;

  // IPv6 private ranges
  if (ip.startsWith('::1')) return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  return false;
}

/** GeoIP lookup function type */
type GeoIPLookup = (ip: string) => { country: string } | null;

/**
 * GeoIP lookup service
 *
 * Attempts to load geoip-lite if available, otherwise falls back
 * to no geolocation (returns undefined for all lookups).
 */
class GeoIPService {
  private lookupFn: GeoIPLookup | null = null;
  private initialized = false;

  /**
   * Initialize the GeoIP service
   *
   * Attempts to load geoip-lite module. If not available,
   * the service will return undefined for all lookups.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Try to dynamically import geoip-lite
      // This package includes a bundled MaxMind GeoLite database

      const geoip = await import(
        /* webpackIgnore: true */ 'geoip-lite' as string
      );
      const module = geoip.default || geoip;
      if (module && typeof module.lookup === 'function') {
        this.lookupFn = module.lookup;
      }
    } catch {
      // geoip-lite not installed, service will return undefined for all lookups
      this.lookupFn = null;
    }

    this.initialized = true;
  }

  /**
   * Look up the country code for an IP address
   *
   * @param ip - IP address string
   * @returns Two-letter country code (ISO 3166-1 alpha-2) or undefined if unknown
   */
  lookup(ip: string): string | undefined {
    // Check cache first
    if (ipCountryCache.has(ip)) {
      return ipCountryCache.get(ip);
    }

    // Private IPs have no country
    if (isPrivateIP(ip)) {
      ipCountryCache.set(ip, undefined);
      return undefined;
    }

    let country: string | undefined;

    if (this.lookupFn) {
      try {
        const result = this.lookupFn(ip);
        country = result?.country;
      } catch {
        country = undefined;
      }
    }

    // Manage cache size
    if (ipCountryCache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entries (first 1000)
      const keysToDelete = Array.from(ipCountryCache.keys()).slice(0, 1000);
      for (const key of keysToDelete) {
        ipCountryCache.delete(key);
      }
    }

    ipCountryCache.set(ip, country);
    return country;
  }

  /**
   * Clear the lookup cache
   */
  clearCache(): void {
    ipCountryCache.clear();
  }
}

// Singleton instance
const geoipService = new GeoIPService();

/**
 * Initialize the GeoIP service
 *
 * Should be called once during engine startup.
 */
export async function initializeGeoIP(): Promise<void> {
  await geoipService.initialize();
}

/**
 * Look up the country code for an IP address
 *
 * @param ip - IP address string
 * @returns Two-letter country code (ISO 3166-1 alpha-2) or undefined if unknown
 */
export function lookupCountry(ip: string): string | undefined {
  return geoipService.lookup(ip);
}

/**
 * Clear the GeoIP lookup cache
 */
export function clearGeoIPCache(): void {
  geoipService.clearCache();
}

export default geoipService;
