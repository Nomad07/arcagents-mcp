/**
 * Payment-provider interface.
 *
 * The API client and the MCP tool only know this interface. Everything that is
 * specific to a payment protocol (x402 today) lives behind it, so a different
 * provider can be added later by implementing PaymentProvider and choosing it
 * at startup, without touching the tool or the API client.
 *
 * Contract for implementers:
 *  - fetchPaid() performs ONE logical paid request. It never tries another
 *    payment method or network after a failure.
 *  - It must not sign a second payment for a request whose first payment may
 *    still settle; it resends the identical signed payment instead.
 *  - It never exposes keys or signed payment material to callers.
 */
/** The payment policy refused to sign. Nothing was signed. */
export class PaymentRefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = "PaymentRefusedError";
    }
}
/**
 * Another process already holds a signed, unresolved payment for this request.
 * Nothing was sent by this call. Asking again reuses that existing payment.
 */
export class PaymentConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = "PaymentConflictError";
    }
}
/** The payment exchange failed. `paymentSigned` says whether an authorization exists. */
export class PaymentError extends Error {
    paymentSigned;
    constructor(message, paymentSigned) {
        super(message);
        this.name = "PaymentError";
        this.paymentSigned = paymentSigned;
    }
}
/** Per-session cap on the number of payments this process may sign. */
export class PaymentLimiter {
    max;
    used = 0;
    constructor(max) {
        this.max = max;
    }
    tryReserve() {
        if (this.used >= this.max)
            return false;
        this.used += 1;
        return true;
    }
}
