/**
 * Payment-provider interface.
 *
 * The API client and the MCP tool only know this interface. Everything that is
 * specific to a payment protocol (x402 today) lives behind it, so a different
 * provider (for example MPP) can be added later by implementing PaymentProvider
 * and choosing it at startup, without touching the tool or the API client.
 *
 * Contract for implementers:
 *  - fetchPaid() performs ONE logical paid request. It never tries another
 *    payment method or network after a failure.
 *  - It must not sign a second payment for a request whose first payment may
 *    still settle; it resends the identical signed payment instead.
 *  - It never exposes keys or signed payment material to callers.
 */

export interface PaidRequest {
  /** Full request URL (GET). */
  url: string;
  /** Aborts the whole exchange (challenge and paid request). */
  signal: AbortSignal;
}

export interface PaymentSettlement {
  /** Payment network as reported by the settlement (for example "eip155:5042"). */
  network?: string;
  /** Settlement transaction hash, when one was reported. */
  transaction?: string;
  /** Block explorer link for the transaction, when known. */
  explorerUrl?: string;
}

export interface PaymentOutcome {
  /** The API response, or null when no HTTP response arrived (timeout, connection loss). */
  response: Response | null;
  /**
   * The complete response body, read exactly once by the provider. The provider must read it
   * BEFORE it discards any saved payment state, so that a failed or timed-out read can never
   * lose a signed payment. Undefined when there is no response or the read failed.
   */
  body?: string;
  /** Sanitized description of a failed body read. The saved payment (if any) was kept. */
  bodyError?: string;
  /** A payment authorization was created or resent for this request. */
  paymentSigned: boolean;
  /** The authorization was a previously signed one that was resent; nothing new was signed. */
  resent: boolean;
  /** Settlement details from the response, when the response reported them. */
  settlement?: PaymentSettlement;
  /** Sanitized description of a transport failure when response is null. */
  transportError?: string;
}

export interface PaymentProvider {
  /** Protocol name, for example "x402". */
  readonly protocol: string;
  /** One-line, human readable description of what this provider pays with. */
  readonly description: string;
  /** Public address of the paying wallet. */
  readonly payer: string;
  fetchPaid(request: PaidRequest): Promise<PaymentOutcome>;
}

/** The payment policy refused to sign. Nothing was signed. */
export class PaymentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRefusedError";
  }
}

/**
 * Another process already holds a signed, unresolved payment for this request.
 * Nothing was sent by this call. Asking again reuses that existing payment.
 */
export class PaymentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConflictError";
  }
}

/** The payment exchange failed. `paymentSigned` says whether an authorization exists. */
export class PaymentError extends Error {
  readonly paymentSigned: boolean;
  constructor(message: string, paymentSigned: boolean) {
    super(message);
    this.name = "PaymentError";
    this.paymentSigned = paymentSigned;
  }
}

/** Per-session cap on the number of payments this process may sign. */
export class PaymentLimiter {
  private used = 0;
  constructor(readonly max: number) {}

  tryReserve(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}
