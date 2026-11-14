/**
 * Arc ERC-8004 Explorer API client.
 *
 * GET /api/agent/paid?network=mainnet&agentId={agentId}
 *
 * Knows nothing about x402: payment is delegated to a PaymentProvider. This file
 * only builds the request, applies the timeout, and maps the API's status codes
 * to tool results while preserving the API's own response.
 */
import { API_BASE_URL, API_PATH, DATA_NETWORK } from "./config.js";
import { PaymentConflictError, PaymentError, PaymentRefusedError, } from "./payment/provider.js";
const MAX_BODY_CHARS = 200_000;
export class ArcAgentsApi {
    provider;
    timeoutMs;
    redact;
    inFlight = new Map();
    constructor(provider, timeoutMs, 
    /** Removes secrets (the configured private key) from any message returned to the client. */
    redact) {
        this.provider = provider;
        this.timeoutMs = timeoutMs;
        this.redact = redact;
    }
    /** Concurrent identical calls share one request so a single question never pays twice. */
    getAgentData(agentId) {
        const existing = this.inFlight.get(agentId);
        if (existing)
            return existing;
        const run = this.run(agentId).finally(() => this.inFlight.delete(agentId));
        this.inFlight.set(agentId, run);
        return run;
    }
    buildUrl(agentId) {
        const url = new URL(API_PATH, API_BASE_URL);
        url.searchParams.set("network", DATA_NETWORK);
        url.searchParams.set("agentId", String(agentId));
        return url.toString();
    }
    async run(agentId) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const outcome = await this.provider.fetchPaid({
                url: this.buildUrl(agentId),
                signal: controller.signal,
            });
            return await this.mapOutcome(outcome);
        }
        catch (error) {
            return this.mapFailure(error);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async mapOutcome(outcome) {
        const { response } = outcome;
        if (!response) {
            const reason = outcome.transportError ?? "no response";
            const hint = outcome.paymentSigned
                ? "A payment authorization was already signed for this request and may still settle. " +
                    "No new payment was signed. Calling again for the same agent ID resends the same signed payment " +
                    "(never a new one) until the API gives a final answer, so you are not charged twice."
                : "No payment was signed.";
            return errorResult({ error: "no_response", message: `The request did not complete: ${reason}.`, guidance: hint });
        }
        // The provider reads the body exactly once and keeps any saved payment if that read failed.
        if (outcome.bodyError !== undefined || outcome.body === undefined) {
            return errorResult({
                error: "response_incomplete",
                message: `The API answered with HTTP ${response.status}, but its response body could not be read completely` +
                    ` (${this.redact(outcome.bodyError ?? "no body")}).`,
                guidance: outcome.paymentSigned
                    ? "The payment outcome could not be determined. The signed payment was kept: no new payment " +
                        "authorization will be created for this agent ID, and asking again resends the same signed payment " +
                        "(same PAYMENT-SIGNATURE and X-UVD-Purchase), so you are not charged twice."
                    : "No payment was sent for this request.",
            });
        }
        const text = outcome.body.slice(0, MAX_BODY_CHARS);
        const parsed = parseJson(text);
        const status = response.status;
        if (status === 200) {
            const blocks = [parsed.ok ? JSON.stringify(parsed.value, null, 2) : text];
            const note = paymentNote(outcome);
            if (note)
                blocks.push(note);
            return { isError: false, blocks };
        }
        const retryAfter = response.headers.get("Retry-After");
        const document = {
            httpStatus: status,
            ...(retryAfter ? { retryAfter } : {}),
            apiResponse: parsed.ok ? parsed.value : text,
            guidance: guidanceFor(status, outcome, retryAfter, text),
        };
        const blocks = [JSON.stringify(document, null, 2)];
        const note = paymentNote(outcome);
        if (note)
            blocks.push(note);
        return { isError: true, blocks };
    }
    mapFailure(error) {
        if (error instanceof PaymentRefusedError) {
            return errorResult({
                error: "payment_refused",
                message: this.redact(error.message),
                guidance: "No payment was signed.",
            });
        }
        if (error instanceof PaymentConflictError) {
            return errorResult({
                error: "payment_pending_in_another_process",
                message: this.redact(error.message),
                guidance: "Temporary conflict. Nothing was sent by this call. Ask again for the same agent ID: the next request " +
                    "reuses the existing signed payment, and no new payment authorization will be created.",
            });
        }
        if (error instanceof PaymentError) {
            return errorResult({
                error: "payment_failed",
                message: this.redact(error.message),
                guidance: error.paymentSigned
                    ? "A payment authorization may have been signed. No new payment was signed. Calling again for the same " +
                        "agent ID resends the same signed payment (never a new one) until the API gives a final answer."
                    : "No payment was sent for this request.",
            });
        }
        const message = error instanceof Error ? this.redact(error.message).slice(0, 300) : "unknown error";
        return errorResult({
            error: "unexpected_error",
            message,
            // The failure may have happened before or after a payment was signed, so stay neutral.
            guidance: "The outcome of this request could not be determined. If a payment was already signed for it, that " +
                "signed payment is kept: asking again for the same agent ID resends it and never creates a new " +
                "authorization. Otherwise nothing was signed.",
        });
    }
}
function errorResult(document) {
    return { isError: true, blocks: [JSON.stringify(document, null, 2)] };
}
function parseJson(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    }
    catch {
        return { ok: false };
    }
}
/** Short, factual note about the payment attached to a result. Never includes signed material. */
function paymentNote(outcome) {
    if (!outcome.paymentSigned)
        return undefined;
    const status = outcome.response?.status;
    if (status === 200) {
        const s = outcome.settlement;
        const lines = ["Payment: settled."];
        if (outcome.resent)
            lines.push("The previously signed payment was resent; no new payment was signed.");
        if (s?.transaction)
            lines.push(`Transaction: ${s.transaction}`);
        if (s?.explorerUrl)
            lines.push(`Verify: ${s.explorerUrl}`);
        return lines.join("\n");
    }
    return ("Payment: a payment authorization was signed for this request, but the API did not confirm settlement. " +
        "No new payment was signed" +
        (outcome.resent ? " (the previously signed payment was resent)." : "."));
}
function guidanceFor(status, outcome, retryAfter, bodyText) {
    switch (status) {
        case 400:
            return "Invalid request. Use a positive integer agentId. The API serves ERC-8004 data from Arc Mainnet only.";
        case 402:
            return outcome.paymentSigned
                ? "The payment was not accepted (for example rejected at verification). The API did not return data. " +
                    "The reason is in apiResponse. No automatic retry was made."
                : "Payment is required but no payment was made.";
        case 404:
            return "Agent ID not found on Arc Mainnet. Not charged.";
        case 409: {
            const reuse = "No new payment authorization will be created for this agent ID: asking again reuses the existing signed " +
                "payment (same PAYMENT-SIGNATURE and X-UVD-Purchase). No data was returned for this request.";
            if (bodyText.includes("authorization_already_settled")) {
                return ("Reason authorization_already_settled: the SDK reports that this authorization was already used and its " +
                    "payment confirmed. " +
                    reuse);
            }
            if (bodyText.includes("receipt_request_conflict")) {
                return ("Reason receipt_request_conflict: this authorization belongs to another purchase or request. The API " +
                    "does not say whether that payment settled or failed, so no conclusion about settlement should be drawn. " +
                    reuse);
            }
            return ("Payment authorization conflict: the authorization was already used or belongs to another purchase " +
                "(see the reason in apiResponse). " +
                reuse);
        }
        case 500:
            return ("Settlement failed or could not be confirmed. No data was returned. A new payment was not signed, and none " +
                "will be signed for this agent ID while this payment is unresolved: asking again only resends the same " +
                "signed payment. Any transaction hash is in apiResponse; check it on chain.");
        case 503: {
            const wait = retryAfter ? ` Retry-After: ${retryAfter}.` : "";
            return ("No final result yet (RPC error before settlement, or settlement pending or unverified)." +
                wait +
                " A new payment was not signed. Ask again after the delay: the same signed payment is resent (never a new " +
                "one) until the API gives a final answer, so you are not charged twice. An rpc_error before settlement " +
                "is not charged.");
        }
        default:
            return `Unexpected HTTP status ${status}. A new payment was not signed.`;
    }
}
