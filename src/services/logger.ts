export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function parseLogLevel(value: string): LogLevel {
  const upper = value.toUpperCase();
  if (upper in LEVEL_ORDER) return upper as LogLevel;
  return "INFO";
}

export interface Logger {
  debug(data: Record<string, unknown>): void;
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
}

export function createLogger(logLevel: string): Logger {
  const configured = parseLogLevel(logLevel);

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
  }

  function log(level: LogLevel, data: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const entry = { level, ...data };
    if (level === "ERROR") {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  return {
    debug: (data) => log("DEBUG", data),
    info: (data) => log("INFO", data),
    warn: (data) => log("WARN", data),
    error: (data) => log("ERROR", data),
  };
}
