export const REDISTRIBUTABLE = new Set(["CC0", "PD", "CC-BY", "CC-BY-SA", "MIT"]);

/** Tenant-owned VOD (teacher upload). Playable via sessions; not OER redistributable. */
export const TENANT_OWNED = new Set(["PRIVATE"]);

export const REGISTERABLE = new Set([...REDISTRIBUTABLE, ...TENANT_OWNED]);

const STORAGE_HOST = /backblazeb2\.com|amazonaws\.com|r2\.cloudflarestorage\.com/i;

export function assertRedistributable(licenseCode: string): void {
  if (!REGISTERABLE.has(licenseCode)) {
    throw new Error("LICENSE_NOT_REDISTRIBUTABLE");
  }
}

export function containsStorageHost(value: string): boolean {
  return STORAGE_HOST.test(value);
}
