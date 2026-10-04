"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataDir = dataDir;
exports.loadConnections = loadConnections;
exports.saveConnections = saveConnections;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function dataDir() {
    return process.env.AI_PLATFORM_DATA_DIR?.trim() || (0, node_path_1.join)(process.cwd(), "data");
}
function connectionsPath() {
    return (0, node_path_1.join)(dataDir(), "connections.json");
}
function loadConnections() {
    try {
        const raw = (0, node_fs_1.readFileSync)(connectionsPath(), "utf8");
        const parsed = JSON.parse(raw);
        const map = new Map();
        for (const row of parsed.items ?? []) {
            if (row?.uid)
                map.set(row.uid, row);
        }
        return map;
    }
    catch {
        return new Map();
    }
}
function saveConnections(rows) {
    const file = connectionsPath();
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(file), { recursive: true });
    const tmp = `${file}.tmp`;
    (0, node_fs_1.writeFileSync)(tmp, `${JSON.stringify({ items: [...rows] }, null, 2)}\n`, { encoding: "utf8" });
    (0, node_fs_1.renameSync)(tmp, file);
}
