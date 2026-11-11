/** P2P fabrics must never share signaling or swarm ids across operators. */
export const P2P_REALM_LUMINARYWORKS = "luminaryworks" as const;
export const P2P_REALM_ENTFUNHUB = "entfunhub" as const;

export type P2pRealm =
  | typeof P2P_REALM_LUMINARYWORKS
  | typeof P2P_REALM_ENTFUNHUB;

export function swarmIdForSegment(realm: P2pRealm, objectKey: string): string {
  const key = objectKey.startsWith("/") ? objectKey : `/${objectKey}`;
  return `${realm}:${key}`;
}
