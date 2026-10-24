import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  DATABASE_SSL: z.enum(["require", "disable"]).default("disable"),
  API_PORT: z.coerce.number().int().positive().default(3001),
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;

const collectorEnvSchema = serverEnvSchema.extend({
  DATA_GO_KR_SERVICE_KEY: z.string().min(20, "must be set to the data.go.kr service key"),
  // Hard daily cap per source; well under the data.go.kr development-account limit (>= 1,000/day).
  API_DAILY_CALL_LIMIT: z.coerce.number().int().positive().max(1000).default(300),
});

export type CollectorConfig = z.infer<typeof collectorEnvSchema>;

export class ConfigError extends Error {}

// Validates server env. Error messages name the variables only, never their values.
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid server environment: ${problems.join("; ")}`);
  }
  return parsed.data;
}

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = collectorEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid collector environment: ${problems.join("; ")}`);
  }
  return parsed.data;
}

// Masks secrets that may appear in strings destined for logs or the sync_jobs table.
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text.replace(/(serviceKey=)[^&\s]+/gi, "$1***").replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1***@");
  for (const name of ["DATA_GO_KR_SERVICE_KEY", "DATABASE_URL"]) {
    const value = env[name];
    if (value && value.length >= 8) out = out.split(value).join("***");
  }
  return out;
}
