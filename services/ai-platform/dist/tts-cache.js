"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTtsCache = readTtsCache;
exports.writeTtsCache = writeTtsCache;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const connection_store_1 = require("./connection-store");
function cacheDir() {
    return (0, node_path_1.join)((0, connection_store_1.dataDir)(), "tts-cache");
}
function readTtsCache(key) {
    try {
        const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(cacheDir(), `${key}.json`), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed?.audioBase64 || !parsed.mime)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function writeTtsCache(key, entry) {
    const dir = cacheDir();
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, `${key}.json`), `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}
