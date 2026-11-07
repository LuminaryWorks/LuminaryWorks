"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataDir = dataDir;
const node_path_1 = require("node:path");
/** TTS audio cache directory. Connection secrets live in Postgres, not in this folder. */
function dataDir() {
    return process.env.AI_PLATFORM_DATA_DIR?.trim() || (0, node_path_1.join)(process.cwd(), "data");
}
