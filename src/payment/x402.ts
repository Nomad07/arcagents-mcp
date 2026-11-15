/**
 * x402 v2 ("exact") payment provider built on the official uvd-x402-sdk.
 *
 * Flow (all driven by the SDK):
 *   1. GET the resource without payment and receive the 402 challenge.
 *   2. select(): choose exactly ONE accepted requirement (the configured network)
 *      and validate it before anything is signed.
 *   3. The SDK signs an EIP-3009 authorization with the EVM private key and
 *      resends the identical GET with the payment headers.
 *
 * The SDK signs with its own built-in token configuration for the chosen network
 * (address, EIP-712 name and version). The validation in select() therefore
 * refuses any challenge whose token or domain differs from that configuration,
 * so the wallet can never sign for an asset or domain it was not meant to.
 * Recipient (payTo), amount and timeout always come from the live challenge.
 *
 * The SDK's receipt flow (fetchWithReceipt) keeps the signed payment in a purchase
 * context. uvd-x402-sdk requires that context to be persisted durably before the
 * authorized request is sent, and to be resumed (same signature, no new payment)
 * after a lost response, a restart or an HTTP 500. It is saved with
 * PendingPaymentStore (one file per request) and kept until the API gives a final
 * answer: authorization expiry is NOT treated as proof that settlement failed, so
 * there is no timer. While a purchase is unresolved (no response, 5xx, 409, 429)
 * the next identical request resends the SAME signed payment; a new payment is
 * never signed for it. If the context cannot be saved or read, nothing is sent or
 * signed (fail closed).
 *
 * Ordering of one new purchase, and where the cross-process claim sits:
 *   get() finds nothing -> probe -> select() -> SDK signs -> persist() -> send.
 * persist() runs after signing and strictly BEFORE the signed request is sent, and
 * its first call is an exclusive create (claim). Two processes that both found
 * nothing may both sign, but only the one that wins the claim ever sends: the
 * loser's persist() throws PaymentConflictError, which aborts the exchange before
 * its authorization leaves the process. The claim is deliberately not taken before
 * signing, because a claim without a saved payment would be a stale lock if the
 * process died in between.
 */
import {
  X402Client,
  createPurchaseContext,
  getExplorerTxUrl,
  type PurchaseContext,
  type X402PaymentOffer,
} from "uvd-x402-sdk";
import { PRICE_ATOMIC, PRICE_USDC, type Config, type PaymentNetwork } from "../config.js";
import {
  PendingClaimExistsError,
  PendingClaimInProgressError,
  PendingPaymentStore,
} from "./pending-store.js";
import {
  PaymentConflictError,
  PaymentError,
  PaymentLimiter,
  PaymentRefusedError,
  type PaidRequest,
  type PaymentOutcome,
  type PaymentProvider,
  type PaymentSettlement,
} from "./provider.js";

interface NetworkSpec {
  /** Network alias used by uvd-x402-sdk. */
  sdkName: string;
  caip2: string;
  label: string;
  usdc: string;
  domainName: string;
  domainVersion: string;
}

export const NETWORKS: Record<PaymentNetwork, NetworkSpec> = {
  arc: {
    sdkName: "arc",
    caip2: "eip155:5042",
    label: "Arc Mainnet",
    usdc: "0x3600000000000000000000000000000000000000",
    domainName: "USDC",
    domainVersion: "2",
  },
  base: {
    sdkName: "base",
    caip2: "eip155:8453",
    label: "Base Mainnet",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    domainName: "USD Coin",
    domainVersion: "2",
  },
};

/** Longest authorization window this server accepts from a challenge. */
const MAX_TIMEOUT_SECONDS = 300;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface X402ProviderOptions {
  config: Config;
  limiter: PaymentLimiter;
  redact: (text: string) => string;
}

function isPaymentFailure(error: unknown): error is PaymentRefusedError | PaymentConflictError | PaymentError {
  return (
    error instanceof PaymentRefusedError || error instanceof PaymentConflictError || error instanceof PaymentError
  );
}

/**
 * uvd-x402-sdk 2.116.0 receives the accepted payment requirement in createPayment() but its EVM
 * path encodes only { x402Version, scheme, network, payload }. x402 v2 servers match a payment
 * against its `accepted` requirement, so this wrapper adds the exact `accepted` object (and the
 * `resource` and `extensions` the SDK was given, when present) to the encoded header. The
 * authorization and signature in `payload` are not touched. Because the SDK builds the
 * PAYMENT-SIGNATURE header, and the pending-payment record, from the returned value, the added
 * fields are sent and persisted consistently.
 */
function includeAcceptedRequirement(client: X402Client): void {
  const sdkCreatePayment = client.createPayment.bind(client);
  client.createPayment = async (info) => {
    const result = await sdkCreatePayment(info);
    if (!info.accepted) return result;

    const decoded = JSON.parse(Buffer.from(result.paymentHeader, "base64").toString("utf8")) as Record<string, unknown>;
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("the payment SDK returned an unexpected payment header");
    }
    if (decoded.accepted === undefined) decoded.accepted = info.accepted;
    if (decoded.resource === undefined && info.resource !== undefined) decoded.resource = info.resource;
    if (decoded.extensions === undefined && info.extensions !== undefined) decoded.extensions = info.extensions;

    const paymentHeader = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64");
    return {
      ...result,
      paymentHeader,
      headers: { ...result.headers, "X-PAYMENT": paymentHeader, "PAYMENT-SIGNATURE": paymentHeader },
    };
  };
}

export async function createX402Provider(options: X402ProviderOptions): Promise<X402Provider> {
  const spec = NETWORKS[options.config.paymentNetwork];
  const client = new X402Client({
    defaultChain: spec.sdkName,
    x402Version: 2,
    debug: false,
  });
  includeAcceptedRequirement(client);
  const payer = await client.connectWithPrivateKey(options.config.privateKey, spec.sdkName);
  return new X402Provider(client, spec, payer, options);
}

export class X402Provider implements PaymentProvider {
  readonly protocol = "x402";
  readonly description: string;
  private readonly pending: PendingPaymentStore;

  constructor(
    private readonly client: X402Client,
    private readonly spec: NetworkSpec,
    readonly payer: string,
    private readonly options: X402ProviderOptions,
  ) {
    this.description = `x402 v2 (exact), USDC on ${spec.label} (${spec.caip2}), $${PRICE_USDC} per request`;
    this.pending = new PendingPaymentStore(options.config.stateDir);
  }

  async fetchPaid(request: PaidRequest): Promise<PaymentOutcome> {
    const key = request.url;

    // An unresolved purchase for this request is resumed as is, however old it is.
    // If the saved state cannot be read we cannot know whether one exists: sign nothing.
    let stored: PurchaseContext | undefined;
    try {
      stored = this.pending.get(key);
    } catch (error) {
      if (error instanceof PendingClaimInProgressError) throw this.conflict();
      throw new PaymentRefusedError(
        `Saved payment state in ${this.pending.dir} could not be read (${this.describeError(error)}), so it is ` +
          "unknown whether an earlier payment for this request is still unresolved. Nothing was signed. " +
          "Fix the directory, or remove this request's file only after checking the earlier payment on chain.",
      );
    }

    const resent = Boolean(stored?.paymentHeaders);
    const context: PurchaseContext = stored ?? createPurchaseContext();

    const select = (offers: X402PaymentOffer[]): X402PaymentOffer => this.pickOffer(offers);

    // The SDK awaits this before it sends the signed request, so an exception here stops
    // the exchange before anything is sent. A resumed purchase already owns its record
    // and only updates it. A new purchase must win the exclusive claim first.
    let owned = stored !== undefined;
    const persist = (copy: PurchaseContext): void => {
      try {
        if (owned) {
          this.pending.update(key, copy);
        } else {
          this.pending.claim(key, copy);
          owned = true;
        }
      } catch (error) {
        if (error instanceof PendingClaimExistsError) throw this.conflict();
        throw new PaymentError(
          `Payment state could not be saved in ${this.pending.dir} (${this.describeError(error)}). ` +
            "A payment is only sent after its state is saved, so if this happened before the first send " +
            "nothing was sent. Set ARCAGENTS_STATE_DIR to a writable directory.",
          this.hasSavedPayment(key),
        );
      }
    };

    let result;
    try {
      result = await this.client.fetchWithReceipt(request.url, {
        method: "GET",
        context,
        persist,
        select,
        maxAmount: PRICE_USDC,
        tokenType: "usdc",
        fetchImpl: this.guardedFetch(request.signal),
        init: {
          redirect: "error",
          signal: request.signal,
          headers: { Accept: "application/json" },
        },
      });
    } catch (error) {
      if (isPaymentFailure(error)) throw error;
      throw new PaymentError(this.describeError(error), this.hasSavedPayment(key));
    }

    if (isPaymentFailure(result.error)) throw result.error;

    const paymentSigned = Boolean(result.context.paymentHeaders);
    const response = result.response;

    if (!response) {
      if (!paymentSigned) this.forget(key);
      return {
        response: null,
        paymentSigned,
        resent,
        transportError: this.describeError(result.error),
      };
    }

    // Read the complete body exactly once BEFORE any cleanup. If the read fails or times out the
    // final answer was not fully received, so the signed payment is kept and a repeat call resends it.
    let body: string | undefined;
    let bodyError: string | undefined;
    try {
      body = await response.text();
    } catch (error) {
      bodyError = this.describeError(error);
    }

    // Keep the signed payment while the exchange has no final answer: 5xx (settlement
    // failed, unconfirmed or pending), 409 (conflict: do not sign another payment), 429, or a
    // response whose body could not be read completely. A repeat call resends this same payment
    // and never signs a new one for this request, however much time has passed. Any other status
    // with a fully read body is a final answer (200 success, 400/404 rejected before settlement,
    // 402 refused credential).
    const keep =
      paymentSigned &&
      (bodyError !== undefined || response.status >= 500 || response.status === 409 || response.status === 429);
    if (!keep) this.forget(key);

    return {
      response,
      body,
      bodyError,
      paymentSigned,
      resent,
      settlement: this.readSettlement(response),
    };
  }

  /** Another process owns the unresolved payment for this request; this call sent nothing. */
  private conflict(): PaymentConflictError {
    return new PaymentConflictError(
      "Another process already holds a signed, unresolved payment for this request. This call sent nothing, and " +
        "the authorization it prepared was discarded unsent. Ask again in a moment: the next request resends the " +
        "existing signed payment and no new payment authorization is created.",
    );
  }

  private hasSavedPayment(key: string): boolean {
    try {
      return this.pending.has(key);
    } catch {
      return false;
    }
  }

  /** Drops a resolved purchase. If this fails the entry is harmlessly resent next time. */
  private forget(key: string): void {
    try {
      this.pending.delete(key);
    } catch {
      // The leftover entry resolves to the same final answer when resent.
    }
  }

  /**
   * Chooses exactly one payment requirement from the live challenge and validates it.
   * Throws PaymentRefusedError (nothing signed) if anything is off. Never falls back
   * to another network.
   */
  private pickOffer(offers: X402PaymentOffer[]): X402PaymentOffer {
    const spec = this.spec;
    const matching = offers.filter((o) => o.network.toLowerCase() === spec.caip2);
    if (matching.length !== 1) {
      const offered = offers.map((o) => o.network).join(", ") || "none";
      throw new PaymentRefusedError(
        `The API challenge must contain exactly one ${spec.label} (${spec.caip2}) payment option; ` +
          `found ${matching.length} (offered networks: ${offered}). Nothing was signed and no other network was tried.`,
      );
    }
    const offer = matching[0] as X402PaymentOffer;
    const raw = offer.raw as {
      scheme?: unknown;
      extra?: { name?: unknown; version?: unknown } | null;
    };

    const problems: string[] = [];
    if (raw.scheme !== "exact") problems.push("scheme is not exact");
    if (offer.chainName !== spec.sdkName) problems.push("network is not recognized by the payment SDK");
    if (typeof offer.asset !== "string" || offer.asset.toLowerCase() !== spec.usdc.toLowerCase()) {
      problems.push("token is not the expected USDC contract");
    }
    if (offer.amount !== PRICE_ATOMIC || offer.decimals !== 6) {
      problems.push(`amount is not exactly ${PRICE_ATOMIC} atomic units ($${PRICE_USDC})`);
    }
    if (raw.extra?.name !== spec.domainName || raw.extra?.version !== spec.domainVersion) {
      problems.push(`EIP-712 domain is not "${spec.domainName}" version "${spec.domainVersion}"`);
    }
    if (
      typeof offer.payTo !== "string" ||
      !ADDRESS_RE.test(offer.payTo) ||
      offer.payTo.toLowerCase() === ZERO_ADDRESS
    ) {
      problems.push("recipient (payTo) is not a valid address");
    }
    const timeout = offer.maxTimeoutSeconds;
    if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SECONDS) {
      problems.push(`maxTimeoutSeconds is missing or outside 1-${MAX_TIMEOUT_SECONDS}`);
    }
    if (problems.length > 0) {
      throw new PaymentRefusedError(
        `Selected payment requirement was refused (${spec.label}): ${problems.join("; ")}. Nothing was signed.`,
      );
    }

    if (!this.options.limiter.tryReserve()) {
      throw new PaymentRefusedError(
        `Payment limit reached: this session already signed ${this.options.limiter.max} payments ` +
          "(ARCAGENTS_MAX_PAYMENTS). Restart the MCP server or raise the limit. Nothing was signed.",
      );
    }
    return offer;
  }

  /**
   * Transport used for every HTTP exchange: no redirects, shared abort signal, and the
   * challenge must be an x402 v2 document before the SDK reads it.
   */
  private guardedFetch(signal: AbortSignal): typeof fetch {
    return async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error", signal });
      const headers = new Headers(init?.headers);
      const isPaid = headers.has("PAYMENT-SIGNATURE") || headers.has("X-PAYMENT");
      if (!isPaid && response.status === 402) {
        let body: unknown;
        try {
          body = await response.clone().json();
        } catch {
          body = undefined; // the SDK reports an unreadable challenge itself
        }
        if (body !== undefined) {
          const doc = body as { x402Version?: unknown; accepts?: unknown };
          if (doc.x402Version !== 2 || !Array.isArray(doc.accepts)) {
            throw new PaymentRefusedError("The API returned a 402 that is not an x402 v2 challenge. Nothing was signed.");
          }
        }
      }
      return response;
    };
  }

  private readSettlement(response: Response): PaymentSettlement | undefined {
    const header = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
    if (!header || header.length > 32768) return undefined;
    try {
      const data = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
        success?: unknown;
        transaction?: unknown;
        network?: unknown;
      };
      if (data.success === false) return undefined;
      const transaction =
        typeof data.transaction === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.transaction)
          ? data.transaction
          : undefined;
      return {
        network: typeof data.network === "string" ? data.network : this.spec.caip2,
        transaction,
        explorerUrl: transaction ? (getExplorerTxUrl(this.spec.sdkName, transaction) ?? undefined) : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.name === "TimeoutError") return "the request timed out";
      return this.options.redact(error.message).slice(0, 300);
    }
    return "unknown error";
  }
}
