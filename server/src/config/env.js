import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(14),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  QR_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  PAYMENT_PROVIDER: z.enum(['razorpay', 'mock']).default('razorpay'),
  RAZORPAY_KEY_ID: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  RAZORPAY_KEY_SECRET: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(20).default(2),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('ShiftCrew <no-reply@shiftcrew.test>'),
  ENABLE_SCHEDULER: z
    .union([z.boolean(), z.string()])
    .default('true')
    .transform((v) => v === true || String(v).trim().toLowerCase() === 'true'),
  LLM_ENABLED: z
    .union([z.boolean(), z.string()])
    .default('false')
    .transform((v) => v === true || String(v).trim().toLowerCase() === 'true'),
  LLM_PROVIDER: z.string().default('mock').transform((v) => v.trim()),
  LLM_BASE_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_API_KEY: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_MODEL: z.string().optional().default(''),
  LLM_FALLBACK_PROVIDER: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_FALLBACK_BASE_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_FALLBACK_API_KEY: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_FALLBACK_MODEL: z.string().optional().default(''),
  LLM_GLOBAL_RPM: z.coerce.number().min(1).default(10),
  LLM_DAILY_TOKEN_BUDGET: z.coerce.number().min(0).default(100000),
  LLM_ALLOW_USER_DATA: z
    .union([z.boolean(), z.string()])
    .default('false')
    .transform((v) => v === true || String(v).trim().toLowerCase() === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
