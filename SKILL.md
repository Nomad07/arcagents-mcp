---
name: arcagents-mcp
description: Retrieve and explain ERC-8004 agent data from Arc Mainnet (identity, owner, agent wallet, metadata, reputation feedback, validation) through the Arc Agents MCP server and its paid get_agent_data tool. Use when the user asks about an ERC-8004 agent ID on Arc, wants an agent's registration, metadata or reputation summarized or compared, or asks how to connect or pay for Arc Agents MCP.
license: MIT
compatibility: Requires an MCP client that can launch local stdio servers, Node.js 20 or newer, and network access. Each successful request costs $0.002 USDC, paid from a dedicated EVM wallet whose private key is set as EVM_PRIVATE_KEY in the MCP server configuration by the user, never in chat.
metadata:
  author: Nomad07
  version: "1.0.0"
---

# Arc Agents MCP

## What is Arc Agents MCP?

Arc Agents MCP is a standard Model Context Protocol (MCP) server that gives AI assistants access to ERC-8004 agent data on Arc Mainnet. ERC-8004 is an onchain registry standard for agent identity, reputation and validation.

The server reads from the paid API of Arc ERC-8004 Explorer - the Arc Agents platform - at https://www.arcagents.app. It exposes one tool, `get_agent_data`, and pays for each request automatically from a wallet the user controls.

## Quick Start

The user (not you) connects the server by adding it to their MCP client configuration. The launch command is:

```
npx -y arcagents-mcp
```

Requirements:

- Node.js 20 or newer.
- An EVM wallet private key, provided as the environment variable `EVM_PRIVATE_KEY` (`0x` followed by 64 hex characters). It signs the payment for each request. Recommend a dedicated wallet holding only a small USDC balance, never the user's main wallet.
- Optional: `ARCAGENTS_PAYMENT_NETWORK=arc|base` selects which network pays for requests. The default is `arc`.

Example configuration block (most clients use this `mcpServers` shape; the placeholder must be replaced by the user, in their own config file):

```json
{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "YOUR_EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}
```

Rules for you:

- Never ask the user to paste, type or reveal a private key in chat. If a key appears in the conversation, do not repeat it and tell the user to rotate it.
- Point the user to the project README for per-client setup: https://github.com/Nomad07/arcagents-mcp
- If the `get_agent_data` tool is not available, tell the user the server is not connected and share the setup steps above. Do not try to fetch the data another way and present it as coming from this tool.

## Available Tool

### `get_agent_data`

- **Input:** `agentId`, a positive integer: the ERC-8004 agent ID (token ID), for example `15`.
- **Behavior:** retrieves that agent's ERC-8004 information from **Arc Mainnet** and returns the API's JSON response.
- **Cost:** $0.002 USDC per successful request.

Validate input before calling: the ID must be a positive whole number. Do not guess IDs. Ask the user if no ID was given.

Each call costs money. Do not call the tool repeatedly "to check" or in bulk loops unless the user asked for it. Reuse data already returned in the conversation instead of fetching it again.

The paid API only serves Arc Mainnet. Do not claim or imply that it reads Arc Testnet, Base or any other network. Base is only a possible payment network.

## Available Data

The response can include the following. Report only what is actually present in the response.

- **Identity and registration:** `agentId`, `network`, `chainId`, and the identity, reputation and validation registry addresses.
- **Owner and agent wallet:** the owner address and the designated agent wallet.
- **Metadata:** the metadata URI (IPFS or HTTPS) and the parsed metadata when it could be fetched: name, description, services, `active`, `x402Support`. If the metadata could not be fetched, `metadata` is null and `metadataError` explains why.
- **Reputation:** client count, feedback count, aggregate score, clients, and individual feedback records (client, index, value, tags, `isRevoked`).
- **Validation:** whether validation data is available, a reason when it is not, the request count, and validation requests and responses when they exist.
- **Links and timestamp:** links to the agent in the Arc ERC-8004 Explorer and the `fetchedAt` time.

**Some fields may be unavailable.** Depending on the agent and the registry contracts deployed, values can be null, empty, or missing, and validation data may be absent entirely. This is normal. Say that a field is unavailable; never fill it in.

After a successful paid call the server may add a second text block with the payment transaction hash and explorer link. The first block is always the API JSON.

## Usage Examples

**Retrieve data for an agent**
> "Get the ERC-8004 data for agent 15." Call `get_agent_data` with `agentId: 15`, then present the main fields.

**Explain registration and metadata**
> "What is agent 8 and how is it registered?" Call the tool, then explain owner, agent wallet, metadata URI and registries. Describe services only if they are in the metadata. If `metadataError` is set, report it instead of guessing what the metadata says.

**Summarize reputation feedback**
> "How is agent 14 rated?" Report `clientCount`, `feedbackCount`, `aggregateScore`, and a short summary of the feedback records, noting revoked entries. If there is no feedback, say so.

**Compare two agents**
> "Compare agent 1 and agent 8." Make one call per ID (two paid requests; tell the user), then compare the same fields side by side. If a field exists for one agent but not the other, say that, rather than treating missing data as zero.

**Identify missing information**
> "What do we not know about agent 22?" After the call, list the fields that are null, empty or marked unavailable, such as `metadata`, `validation.available` and its `reason`. State clearly that these are unavailable and do not infer values.

When answering, distinguish what the API returned from your own interpretation, and mention that data comes from Arc Mainnet as of `fetchedAt`.

## Payments

- **Protocol:** x402 version 2, scheme `exact` (an EIP-3009 transfer authorization), settled through the Ultravioleta DAO facilitator.
- **Price:** $0.002 USDC (2000 atomic units, 6 decimals) per successful request. There are no subscriptions or monthly fees.
- **Supported payment networks:**
  - Arc Mainnet (`eip155:5042`), the default
  - Base Mainnet (`eip155:8453`)
- **How it works:** the API's payment challenge lists the accepted options. The server selects exactly one, matching `ARCAGENTS_PAYMENT_NETWORK`, and pays directly to the recipient specified by that payment requirement. It checks the token, amount and signing domain before signing. It never switches to the other network after a failure.
- **Payment protocol support:** x402 only. Do not describe any other payment protocol, including MPP, as supported.
- The payer wallet needs USDC on the selected network. The user does not need native gas tokens for the payment.

## Payment Safety and Error Handling

- Never ask the user to disclose their private key, and never include one in tool calls, files or messages.
- **Never retry a paid request by creating a new payment when the previous outcome is uncertain.** Do not try to work around errors by changing networks, wallets or settings in the middle of a request.
- The server saves pending payment state locally (in `~/.arcagents-mcp`, or `ARCAGENTS_STATE_DIR`) before sending a signed payment. If a request is interrupted, asking again for the **same agent ID** resumes it: the server resends the identical signed payment and does not sign a new one. This also works after the MCP server restarts.
- **503, a timeout, or an incomplete response** means there may be no final result yet. Report that to the user, respect any `Retry-After` value, and, after that delay, call `get_agent_data` again with the same `agentId`. The server resumes the same payment context instead of paying twice. Do not retry in a tight loop.
- **409 conflict** (the authorization was already used, or belongs to another request) must not trigger a new authorization. Report the `reason` in the response as given: `authorization_already_settled` means the facilitator reports that authorization as already used with its payment confirmed; `receipt_request_conflict` means it belongs to another request, and the API does not say whether that payment settled. Do not guess which. The server keeps the existing signed payment and will not create a new one for that agent ID.
- **402 after payment** means the API did not accept the payment. Report the reason given in the response. It is a final answer, so asking again starts a new request.
- **500** means settlement failed or could not be confirmed. Do not sign or request a new payment; tell the user and pass on any transaction hash in the response. Asking again for the same agent ID only resends the same signed payment.
- **404** means the agent ID is not minted on Arc Mainnet; the request is not charged.
- A message such as "another process already holds a signed, unresolved payment" is a temporary conflict. Only one process can claim and send a payment for a request, and the competing process sends nothing. Ask again later; the existing payment is reused.
- Do not claim a request was free, unpaid or not charged when its payment outcome is uncertain. Say the outcome could not be determined and what the response states.
- Do not invent agent data, transaction hashes, balances or payment results. If the tool returns an error, quote the error and its guidance rather than paraphrasing it into something more optimistic.

## Limitations

- Paid API data covers Arc Mainnet agents only.
- Testnet is available in the Arc ERC-8004 Explorer interface, but not through the paid API or this MCP server.
- Validation data depends on registry availability and may be absent.
- Agent Activity is not currently available through this API.
- The tool returns data for one agent ID per call; there is no search, listing or bulk endpoint.
- Responses reflect the moment of `fetchedAt` and are not live-updating.

## Resources

- Arc ERC-8004 Explorer: https://www.arcagents.app
- API OpenAPI specification: https://www.arcagents.app/api/openapi.json
- MCP repository (setup for each client, configuration, troubleshooting): https://github.com/Nomad07/arcagents-mcp
