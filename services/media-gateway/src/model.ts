export type SegmentMeta = {
  name: string;
  duration: number;
  iv?: string;
};

export type VariantMeta = {
  name: string;
  bandwidth?: number;
  targetDuration: number;
  segments: SegmentMeta[];
};

export type AssetRecord = {
  tenant: string;
  assetId: string;
  title: string;
  licenseCode: string;
  licenseUri: string;
  attribution: string;
  sourceUrl: string;
  publicSuffix: string;
  keyId: string;
  keyHex: string;
  variants: VariantMeta[];
};

export type SessionRecord = {
  sessionId: string;
  tenant: string;
  assetId: string;
  subjectId: string;
  keyId: string;
  exp: number;
};

export interface MediaStore {
  init(): Promise<void>;
  putAsset(asset: AssetRecord): Promise<void>;
  getAsset(tenant: string, assetId: string): Promise<AssetRecord | null>;
  putSession(session: SessionRecord, ttlSec: number): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
}
