export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};

function write(level: LogLevel, component: string, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, fields) => write("debug", component, msg, fields),
    info: (msg, fields) => write("info", component, msg, fields),
    warn: (msg, fields) => write("warn", component, msg, fields),
    error: (msg, fields) => write("error", component, msg, fields),
  };
}
