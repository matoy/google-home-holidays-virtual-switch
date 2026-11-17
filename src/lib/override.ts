import { getAppConfig } from "./config";

export interface SwitchOverride {
  isOn: boolean;
  updatedAt: string;
  expiresAt: string;
}

export const OVERRIDE_TTL_SECONDS = 12 * 3600;
const KV_TIMEOUT_MS = 3000;

interface GlobalWithOverride {
  __zoneCSwitchOverrides?: Map<string, SwitchOverride>;
}

function getMemoryStore(): Map<string, SwitchOverride> {
  const g = globalThis as unknown as GlobalWithOverride;
  if (!g.__zoneCSwitchOverrides) {
    g.__zoneCSwitchOverrides = new Map();
  }
  return g.__zoneCSwitchOverrides;
}

function getOverrideKey(): string {
  return `gh-override:${getAppConfig().deviceId}`;
}

function getRestKvConfig(): { url: string; token: string } | null {
  const kvUrl =
    process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const kvToken =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (kvUrl && kvToken) {
    return { url: kvUrl.replace(/\/+$/, ""), token: kvToken };
  }
  return null;
}

export function isSharedOverrideStoreConfigured(): boolean {
  return getRestKvConfig() !== null;
}

async function kvCommand(args: Array<string | number>): Promise<unknown> {
  const kv = getRestKvConfig();
  if (!kv) {
    throw new Error("Shared KV store is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KV_TIMEOUT_MS);

  try {
    const response = await fetch(kv.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${kv.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`KV store HTTP ${response.status}`);
    }

    const data = (await response.json()) as { result?: unknown; error?: string };
    if (data.error) {
      throw new Error(`KV store error: ${data.error}`);
    }
    return data.result ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

function isExpired(override: SwitchOverride, nowMs: number = Date.now()): boolean {
  const expMs = Date.parse(override.expiresAt);
  return !Number.isFinite(expMs) || expMs <= nowMs;
}

export async function getSwitchOverride(): Promise<SwitchOverride | null> {
  const key = getOverrideKey();
  const kv = getRestKvConfig();

  if (kv) {
    try {
      const raw = await kvCommand(["GET", key]);
      if (typeof raw !== "string" || !raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as SwitchOverride;
      if (typeof parsed?.isOn !== "boolean" || isExpired(parsed)) {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn("Falling back to in-memory switch override after KV GET failure:", err);
    }
  }

  const mem = getMemoryStore();
  const existing = mem.get(key);
  if (!existing) {
    return null;
  }
  if (isExpired(existing)) {
    mem.delete(key);
    return null;
  }
  return existing;
}

export async function setSwitchOverride(
  isOn: boolean,
  ttlSeconds: number = OVERRIDE_TTL_SECONDS,
): Promise<SwitchOverride> {
  const nowMs = Date.now();
  const override: SwitchOverride = {
    isOn,
    updatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
  };

  const key = getOverrideKey();
  getMemoryStore().set(key, override);

  if (getRestKvConfig()) {
    await kvCommand(["SETEX", key, ttlSeconds, JSON.stringify(override)]);
  }

  return override;
}

export async function clearSwitchOverride(): Promise<SwitchOverride | null> {
  const key = getOverrideKey();
  const previous = await getSwitchOverride();
  getMemoryStore().delete(key);

  if (getRestKvConfig()) {
    await kvCommand(["DEL", key]);
  }

  return previous;
}

export function resetMemoryOverridesForTests(): void {
  getMemoryStore().clear();
}
