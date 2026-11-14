#!/usr/bin/env node
/**
 * arcagents-mcp: a standard MCP server over stdio.
 *
 * One tool, get_agent_data, returns ERC-8004 data for an agent ID from the paid
 * Arc ERC-8004 Explorer API (Arc Mainnet). Each request is paid automatically with x402 v2
 * in USDC on Arc or Base.
 *
 * stdout carries the MCP protocol only. Diagnostics go to stderr and never
 * contain the private key.
 */
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArcAgentsApi } from "./api.js";
import { ConfigError, PRICE_USDC, makeRedactor, parseConfig } from "./config.js";
import { PaymentLimiter } from "./payment/provider.js";
import { createX402Provider } from "./payment/x402.js";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
let config;
try {
    config = parseConfig(process.env);
}
catch (error) {
    const message = error instanceof ConfigError ? error.message : "Invalid configuration.";
    console.error(`arcagents-mcp configuration error: ${message}`);
    process.exit(1);
}
const redact = makeRedactor(config.privateKey);
const limiter = new PaymentLimiter(config.maxPayments);
// The payment protocol is chosen here, once. To add another protocol later, implement
// PaymentProvider and select it at this point; nothing below depends on x402.
let provider;
try {
    provider = await createX402Provider({ config, limiter, redact });
}
catch (error) {
    const detail = error instanceof Error ? redact(error.message) : "unknown error";
    console.error(`arcagents-mcp could not initialize the payment wallet: ${detail}`);
    process.exit(1);
}
const api = new ArcAgentsApi(provider, config.timeoutMs, redact);
const server = new McpServer({ name: "arcagents-mcp", title: "Arc Agents MCP", version: pkg.version });
server.registerTool("get_agent_data", {
    title: "Get ERC-8004 agent data",
    description: "Get ERC-8004 agent data from Arc Mainnet for one agent ID: identity and registration (owner, agent wallet, " +
        "metadata URI, registries), parsed metadata (name, description, services), reputation and feedback, " +
        "validation data, explorer links and fetch timestamp. Some fields may be unavailable depending on the " +
        `registry deployment; the API's error information is preserved. Costs $${PRICE_USDC} USDC per successful ` +
        `request, paid automatically with x402 on ${config.paymentNetwork === "arc" ? "Arc" : "Base"}. ` +
        "`agentId` is the ERC-8004 agent token ID (a positive integer, for example 15).",
    inputSchema: {
        agentId: z
            .number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER)
            .describe("ERC-8004 agent token ID on Arc Mainnet: a positive integer, e.g. 15"),
    },
    annotations: {
        title: "Get ERC-8004 agent data",
        readOnlyHint: false, // makes a USDC payment
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
}, async ({ agentId }) => {
    const result = await api.getAgentData(agentId);
    return {
        isError: result.isError,
        content: result.blocks.map((text) => ({ type: "text", text })),
    };
});
process.on("unhandledRejection", (reason) => {
    const detail = reason instanceof Error ? redact(reason.message) : "unknown error";
    console.error(`arcagents-mcp unhandled rejection: ${detail}`);
});
const shutdown = () => {
    void server.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", () => process.exit(0));
await server.connect(new StdioServerTransport());
console.error(`arcagents-mcp ${pkg.version} ready on stdio. Payment: ${provider.description}.`);
