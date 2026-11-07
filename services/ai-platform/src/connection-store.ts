import { join } from "node:path";

/** TTS audio cache directory. Connection secrets live in Postgres, not in this folder. */
export function dataDir(): string {
  return process.env.AI_PLATFORM_DATA_DIR?.trim() || join(process.cwd(), "data");
}
