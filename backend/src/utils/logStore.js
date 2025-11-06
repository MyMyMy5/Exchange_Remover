const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const rootDir = path.join(__dirname, "../../data");
const resolvedLogDir = process.env.PURGE_LOG_DIR ? path.resolve(process.env.PURGE_LOG_DIR) : rootDir;
const resolvedLogFile = process.env.PURGE_LOG_FILE
  ? path.resolve(process.env.PURGE_LOG_FILE)
  : path.join(resolvedLogDir, "purge-actions.jsonl");

const ensureStorage = async () => {
  await fs.mkdir(path.dirname(resolvedLogFile), { recursive: true });
};

const appendLogEntry = async (entry) => {
  const record = {
    id: entry.id || randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    ...entry
  };

  await ensureStorage();
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(resolvedLogFile, line, "utf8");
  return record;
};

const readLogEntries = async ({ limit = 200 } = {}) => {
  try {
    const content = await fs.readFile(resolvedLogFile, "utf8");
    const entries = content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (limit && entries.length > limit) {
      return entries.slice(0, limit);
    }

    return entries;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const getLogFilePath = () => resolvedLogFile;

module.exports = {
  appendLogEntry,
  readLogEntries,
  getLogFilePath
};
