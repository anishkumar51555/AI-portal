import pino from "pino";
import { env } from "./env";

/**
 * Structured logging.
 *
 * Rules that make logs useful in an incident (docs/12 section 5):
 *   - JSON, never string concatenation. `logger.info("user " + id + " did x")`
 *     is unsearchable; a `userId` field is one filter away.
 *   - Every line carries the requestId, so one request's story is one query.
 *   - Never log secrets, tokens, raw IPs, or full request bodies. Logs leak;
 *     assume they will be read by someone who should not read them.
 *   - Log business events ("component published"), not control flow
 *     ("entering function"). Control-flow logs are noise that hides signal.
 */

const isProduction = env.NODE_ENV === "production";

export const logger = pino({
  level: env.LOG_LEVEL,

  // Belt and braces: even if a caller passes something sensitive, it is redacted
  // before it reaches a transport. Defence against the mistake, not just the rule.
  redact: {
    paths: [
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "authorization",
      "cookie",
      "ip",
      "*.password",
      "*.token",
      "*.secret",
      "req.headers.authorization",
      "req.headers.cookie",
      "AUTH_SECRET",
      "S3_SECRET_ACCESS_KEY",
      "DATABASE_URL",
    ],
    censor: "[redacted]",
  },

  base: { service: "ai-portal" },
  timestamp: pino.stdTimeFunctions.isoTime,

  // Human-readable locally; raw JSON in production where a log platform parses it.
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname,service",
          translateTime: "HH:MM:ss",
        },
      },
});

/**
 * A logger bound to one request. Pass this down instead of the root logger so
 * every line is correlated without each call site remembering to add the id.
 */
export function requestLogger(requestId: string, extra?: Record<string, unknown>) {
  return logger.child({ requestId, ...extra });
}

export type Logger = typeof logger;
