/**
 * Configuration for arcagents-mcp.
 *
 * Everything that identifies the production API is a constant on purpose: the
 * server signs payments for this one endpoint only and is not pointed at other
 * hosts through environment variables.
 */

import { homedir } from "node:os";
import path, { join, resolve } from "node:path";

export const API_BASE_URL = "https://www.arcagents.app";
export const API_PATH = "/api/agent/paid";
export const OPENAPI_URL = "https://www.arcagents.app/api/openapi.json";
/** ERC-8004 data always comes from Arc Mainnet, whatever network pays for it. */
export const DATA_NETWORK = "mainnet";

/** $0.002 USDC per successful request (6 decimals). */
export const PRICE_ATOMIC = "2000";
export const PRICE_USDC = "0.002";

export type PaymentNetwork = "arc" | "base";

export interface Config {
  privateKey: string;
  paymentNetwork: PaymentNetwork;
  maxPayments: number;
  timeoutMs: number;
  /** Private directory where signed, unresolved payments are saved so they survive a restart. */
  stateDir: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function intInRange(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

/**
 * ARCAGENTS_STATE_DIR must be an absolute path. A relative path would resolve against the working
 * directory of whichever client launched the server, so a saved unresolved payment could be looked
 * for in a different place next time; "~" is never expanded by Node or by MCP clients. The message
 * does not echo the configured value. `pathApi` is injectable so both platforms' rules can be tested.
 */
export function validateStateDir(value: string, pathApi: Pick<typeof path, "isAbsolute" | "resolve"> = path): string {
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    throw new ConfigError(
      'ARCAGENTS_STATE_DIR must be an absolute path. "~" is not expanded: write the full path ' +
        "(for example /Users/you/.arcagents-mcp or C:\\Users\\you\\.arcagents-mcp), or leave the variable unset.",
    );
  }
  if (!pathApi.isAbsolute(value)) {
    throw new ConfigError(
      "ARCAGENTS_STATE_DIR must be an absolute path (a relative path would point to a different directory " +
        "depending on how the MCP client starts the server). Use the full path, or leave the variable unset " +
        "to use the default directory in your home folder.",
    );
  }
  return pathApi.resolve(value);
}

/**
 * Reads and validates the environment. Error messages never contain the private
 * key or any part of it.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const privateKey = env.EVM_PRIVATE_KEY?.trim();
  if (!privateKey || !PRIVATE_KEY_RE.test(privateKey)) {
    throw new ConfigError(
      "EVM_PRIVATE_KEY is missing or malformed. Expected 0x followed by 64 hex characters " +
        "(a dedicated wallet holding a small USDC balance on the payment network).",
    );
  }

  const rawNetwork = env.ARCAGENTS_PAYMENT_NETWORK?.trim().toLowerCase();
  let paymentNetwork: PaymentNetwork = "arc";
  if (rawNetwork) {
    if (rawNetwork !== "arc" && rawNetwork !== "base") {
      throw new ConfigError(
        'ARCAGENTS_PAYMENT_NETWORK must be "arc" or "base" (default "arc"). ' +
          "It selects the network that pays for requests; ERC-8004 data always comes from Arc Mainnet.",
      );
    }
    paymentNetwork = rawNetwork;
  }

  const customStateDir = env.ARCAGENTS_STATE_DIR?.trim();

  return {
    privateKey,
    paymentNetwork,
    maxPayments: intInRange(env.ARCAGENTS_MAX_PAYMENTS, "ARCAGENTS_MAX_PAYMENTS", 1, 1000, 50),
    timeoutMs: intInRange(env.ARCAGENTS_TIMEOUT_MS, "ARCAGENTS_TIMEOUT_MS", 1000, 120000, 30000),
    stateDir: customStateDir ? validateStateDir(customStateDir) : resolve(join(homedir(), ".arcagents-mcp")),
  };
}

/** Removes the configured private key from any text before it is logged or returned. */
export function makeRedactor(privateKey: string): (text: string) => string {
  const bare = privateKey.replace(/^0x/i, "");
  return (text: string) => text.split(privateKey).join("[redacted]").split(bare).join("[redacted]");
}
