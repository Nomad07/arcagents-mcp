# Arc Agents MCP

Arc Agents MCP gives AI assistants, agents and other MCP-compatible clients access to ERC-8004 agent identity, metadata, reputation and validation data from **Arc Mainnet**, provided by [Arc ERC-8004 Explorer](https://www.arcagents.app/) - the Arc Agents platform - through a single tool: `get_agent_data`.

It is a standard [Model Context Protocol](https://modelcontextprotocol.io/) server over **stdio**. One published npm package works in every client that can launch a local stdio MCP server: Claude Desktop, Cursor, Visual Studio Code, Claude Code, Cline, Gemini CLI, OpenAI Codex, Zed, MCP Inspector, and any other application, AI assistant or agent that supports standard MCP stdio connections.

Each successful request costs **$0.002 USDC**, paid automatically with [x402](https://docs.x402.org/) v2 (`exact`) from a wallet you control, on **Arc Mainnet** (default) or **Base Mainnet**.

- **npm:** https://www.npmjs.com/package/arcagents-mcp
- **GitHub:** https://github.com/Nomad07/arcagents-mcp
- **Agent Skill:** [`SKILL.md`](SKILL.md)
- **Arc ERC-8004 Explorer:** https://www.arcagents.app
- **API OpenAPI spec:** https://www.arcagents.app/api/openapi.json

---

## What you get

`get_agent_data` takes an ERC-8004 agent ID and returns the API's JSON response. Depending on the network and registry deployment, it can include:

- **Identity and registration:** owner, agent wallet, metadata URI, and the identity, reputation and validation registry addresses
- **Metadata:** parsed agent metadata (name, description, services, `active`, `x402Support`), or `metadataError` when it could not be fetched
- **Reputation and feedback:** client count, feedback count, aggregate score, clients, and individual feedback records
- **Validation data:** availability, request count and validation requests
- **Links** to the agent on the Arc ERC-8004 Explorer, and the fetch timestamp (`fetchedAt`)

Some data may be unavailable for a given agent or registry deployment. Errors from the API are returned with their original details.

**Data network and payment network are different things.** ERC-8004 data is always read from Arc Mainnet. The paid API serves Arc Mainnet data only; Arc Testnet data is not available through this server. Base is a **payment network only**: it can pay for a request, but no data is read from Base.

---

## Payment

| | Arc Mainnet (default) | Base Mainnet |
|---|---|---|
| CAIP-2 network | `eip155:5042` | `eip155:8453` |
| SDK network alias | `arc` | `base` |
| USDC | `0x3600000000000000000000000000000000000000` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| EIP-712 domain | name `USDC`, version `2` | name `USD Coin`, version `2` |

- **Price:** $0.002 USDC per successful request (2000 atomic units, 6 decimals)
- **Protocol:** x402 version 2, scheme `exact` (EIP-3009 `transferWithAuthorization`), using the official [`uvd-x402-sdk`](https://github.com/UltravioletaDAO/uvd-x402-sdk-typescript)
- **Facilitator:** `https://facilitator.ultravioletadao.xyz` (no API key required)
- **Gas:** none for you. The facilitator submits the transfer.

> **Use a dedicated wallet.** Create a new wallet just for this server and fund it with a small amount of USDC (a few cents covers many requests) on the network you select. Never use your main wallet and never share its private key.

---

## Requirements

- **Node.js 20 or newer**
- A dedicated EVM wallet with a small USDC balance on Arc Mainnet (or Base Mainnet if you select `base`)
- An MCP client that can launch local stdio servers

No clone and no build step: every client below launches the published package with `npx -y arcagents-mcp`.

## Install

You do not need to install anything by hand. Your MCP client runs `npx -y arcagents-mcp` and npm downloads the package on first use. To install it globally instead:

```bash
npm install -g arcagents-mcp
```

then use `arcagents-mcp` as the command (with no arguments) in the configurations below.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | yes | - | Private key (`0x` + 64 hex characters) of the dedicated payment wallet |
| `ARCAGENTS_PAYMENT_NETWORK` | no | `arc` | Preferred payment network: `arc` or `base`. Any other value stops startup |
| `ARCAGENTS_MAX_PAYMENTS` | no | `50` | Maximum payments this server process may sign (integer 1-1000). At $0.002 each, the default caps a session at $0.10 |
| `ARCAGENTS_TIMEOUT_MS` | no | `30000` | Total timeout for one tool call, in milliseconds (1000-120000) |
| `ARCAGENTS_STATE_DIR` | no | `~/.arcagents-mcp` | Private directory where signed but unresolved payments are saved (one file per request), so they are resent, not replaced, after a restart. Must be an **absolute path** (a relative path or `~` is rejected at startup) and only readable by you; on Windows that needs a restrictive ACL |

A documented template is in [`.env.example`](.env.example). MCP clients pass these variables through their server configuration (shown below); the server does not read a `.env` file by itself.

---

## Setup by client

Every client launches the same command: `npx -y arcagents-mcp`. Replace `YOUR_EVM_PRIVATE_KEY` with the key of your dedicated wallet. Set `ARCAGENTS_PAYMENT_NETWORK` to `base` to pay on Base instead of Arc. The server runs over stdio: launched by hand (with `EVM_PRIVATE_KEY` set), it prints a one-line readiness message on stderr and waits for a client.

> On Windows, if a client cannot start `npx` directly, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "arcagents-mcp"]`.

### 1. Claude Desktop

Open **Settings > Developer > Edit Config**, or edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop completely.

### 2. Cursor

Edit `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` in a project, or use **Settings > Tools & MCP > Add Custom MCP Server**:

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

To keep the key out of the file, use `"EVM_PRIVATE_KEY": "${env:EVM_PRIVATE_KEY}"` and export the variable before starting Cursor.

### 3. Visual Studio Code

Current VS Code (Copilot) reads MCP servers from a top-level `mcpServers` object in one of two files:

- **Workspace:** `.mcp.json` in the workspace root (shareable with your team)
- **User (all workspaces):** `~/.copilot/mcp-config.json`

You can also add a server from the UI: **Chat: Open Customizations**, then **MCP Servers**, **Add Server**, **Command (stdio)**, with command `npx -y arcagents-mcp`.

```json
{
  "mcpServers": {
    "arcagents": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      },
      "tools": ["*"]
    }
  }
}
```

`${EVM_PRIVATE_KEY}` is a reference, not the key: it is read from the environment VS Code runs in, so export the variable and start VS Code from that shell (for example `export EVM_PRIVATE_KEY=0x...` then `code .`). A reference is safe to commit; a literal key is not, so never put the real key in `.mcp.json`. Use the braced `${NAME}` form: VS Code treats a bare `$NAME` as literal text. In the Customizations form, edit `.mcp.json` as text to keep `${...}` references.

**Legacy format (deprecated).** Older VS Code configurations use `.vscode/mcp.json` (or **MCP: Open User Configuration**) with a top-level `servers` key instead of `mcpServers`. VS Code documents this editor-managed format as belonging to the deprecated Local harness and recommends the files above for new setups. Use it only to maintain an existing configuration:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "evm-private-key",
      "description": "Private key of the dedicated Arc Agents MCP payment wallet",
      "password": true
    }
  ],
  "servers": {
    "arcagents": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "${input:evm-private-key}",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}
```

### 4. Claude Code

Add the server with one command (user scope makes it available in every project):

```bash
claude mcp add --transport stdio --scope user \
  --env EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \
  --env ARCAGENTS_PAYMENT_NETWORK=arc \
  arcagents -- npx -y arcagents-mcp
```

Or share it with a team through a project-level `.mcp.json` that reads the key from each developer's environment:

```json
{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}
```

Check it with `claude mcp list`, or `/mcp` inside Claude Code.

### 5. Cline

In the Cline panel open **MCP Servers > Configure > Configure MCP Servers**. This opens `cline_mcp_settings.json`. Add:

```json
{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "YOUR_EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Leave `autoApprove` empty so every paid call asks for your approval. The Cline CLI uses the same definition in `~/.cline/data/settings/cline_mcp_settings.json`.

### 6. Gemini CLI

Edit `~/.gemini/settings.json` (all projects) or `.gemini/settings.json` (one project):

```json
{
  "mcpServers": {
    "arcagents": {
      "command": "npx",
      "args": ["-y", "arcagents-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "$EVM_PRIVATE_KEY",
        "ARCAGENTS_PAYMENT_NETWORK": "arc"
      }
    }
  }
}
```

Gemini CLI expands `$EVM_PRIVATE_KEY` from your shell, so export it first (`export EVM_PRIVATE_KEY=0x...`). Variables listed explicitly in `env` are passed to the server even though Gemini CLI redacts key-like variables from the inherited environment. Or add it from the command line. The `--` makes everything after it, including `-y`, arguments of `npx` rather than options of `gemini`:

```bash
gemini mcp add -s user -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY -e ARCAGENTS_PAYMENT_NETWORK=arc arcagents npx -- -y arcagents-mcp
```

Run `/mcp` inside Gemini CLI to confirm it is connected.

### 7. OpenAI Codex

Edit `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.arcagents]
command = "npx"
args = ["-y", "arcagents-mcp"]
startup_timeout_sec = 60
# Forward the key from your shell environment instead of writing it in this file:
env_vars = ["EVM_PRIVATE_KEY"]

[mcp_servers.arcagents.env]
ARCAGENTS_PAYMENT_NETWORK = "arc"
```

`startup_timeout_sec = 60` gives `npx` time to download the package the first time. To put the key in the file instead, add `EVM_PRIVATE_KEY = "YOUR_EVM_PRIVATE_KEY"` under `[mcp_servers.arcagents.env]` and remove `env_vars`. Or use the CLI:

```bash
codex mcp add arcagents \
  --env EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \
  --env ARCAGENTS_PAYMENT_NETWORK=arc \
  -- npx -y arcagents-mcp
```

Run `/mcp` in the Codex TUI to confirm.

### 8. Zed

Open the settings file (**zed: open settings file**) and add a custom server under `context_servers`. You can also use **Settings > AI > MCP Servers > Add Server > Add Local Server**:

```json
{
  "context_servers": {
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

Open the Agent Panel settings and check that the server shows a green indicator, then enable its tool in the profile you use.

### 9. MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the quickest way to test the server and call the tool by hand.

```bash
npx @modelcontextprotocol/inspector \
  -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \
  -e ARCAGENTS_PAYMENT_NETWORK=arc \
  npx -y arcagents-mcp
```

Pass the variables with `-e`: Inspector does not forward your shell's environment to the server.

Or open the Inspector UI (`npx @modelcontextprotocol/inspector`) and fill in:

| Field | Value |
|---|---|
| Transport Type | `STDIO` |
| Command | `npx` |
| Arguments | `-y arcagents-mcp` |
| Environment Variables | `EVM_PRIVATE_KEY`, and optionally `ARCAGENTS_PAYMENT_NETWORK` |

Click **Connect**, open **Tools > List Tools** to see `get_agent_data`. Running the tool makes a real $0.002 payment. To list the tools without paying, use CLI mode:

```bash
npx @modelcontextprotocol/inspector --cli \
  -e EVM_PRIVATE_KEY=YOUR_EVM_PRIVATE_KEY \
  npx -y arcagents-mcp --method tools/list
```

### Any other MCP client

Any application, AI assistant or agent that supports standard MCP stdio connections can use this server. Configure it to launch `npx` with arguments `-y arcagents-mcp` and pass `EVM_PRIVATE_KEY` in the process environment. Clients that cannot launch local stdio servers (for example web-only chat apps that only accept remote HTTP MCP URLs) cannot use it.

---

## Using the tool

Ask your assistant something like:

> Use the Arc Agents MCP server to get the ERC-8004 data for agent 15.

**Tool call**

```json
{
  "name": "get_agent_data",
  "arguments": { "agentId": 15 }
}
```

`agentId` must be a positive integer. Anything else is rejected before any request or payment is made.

**Example response.** The shape follows the production [OpenAPI schema](https://www.arcagents.app/api/openapi.json) (`AgentResponse`). The values below are illustrative placeholders, not live data:

```json
{
  "agentId": 15,
  "network": "mainnet",
  "chainId": 5042,
  "identity": {
    "owner": "0x<OWNER_ADDRESS>",
    "agentWallet": "0x<AGENT_WALLET_ADDRESS>",
    "metadataUri": "ipfs://<CID>",
    "registries": {
      "identity": "0x<IDENTITY_REGISTRY>",
      "reputation": "0x<REPUTATION_REGISTRY>",
      "validation": null
    }
  },
  "metadata": {
    "name": "Example Agent",
    "description": "What the agent does.",
    "services": [{ "name": "web", "endpoint": "https://example.com" }],
    "active": true,
    "x402Support": true
  },
  "metadataError": null,
  "reputation": {
    "clientCount": 1,
    "feedbackCount": 1,
    "aggregateScore": "95",
    "clients": ["0x<CLIENT_ADDRESS>"],
    "feedback": [
      {
        "client": "0x<CLIENT_ADDRESS>",
        "feedbackIndex": 1,
        "value": "95",
        "tag1": null,
        "tag2": null,
        "isRevoked": false
      }
    ]
  },
  "validation": {
    "available": false,
    "reason": "<reason when unavailable>",
    "requestCount": null,
    "requests": []
  },
  "links": {
    "explorer": "https://www.arcagents.app",
    "agentOnExplorer": "https://www.arcagents.app/<agent-page>"
  },
  "fetchedAt": "<ISO 8601 timestamp>"
}
```

After a successful paid call the server adds a second text block with the settlement transaction hash and an explorer link when the API reports them. The first block is always the API JSON.

---

## Agent Skill

This repository includes [`SKILL.md`](SKILL.md), an Agent Skill for AI assistants that use Arc Agents MCP. The MCP server provides the `get_agent_data` tool. The skill tells an assistant how to use it well: what data comes back, how to explain it without inventing values, how payments work, and how to handle `503`, `409` and interrupted requests safely.

The skill does not replace the server setup above: the MCP server must be connected first. To use the skill, point an assistant that supports the Agent Skills format at `SKILL.md` using that product's own skill-loading instructions, or provide the file's contents as context in a conversation.

---

## Payment behavior and error handling

For each new request the server:

1. Sends the request without payment and receives the API's `402` challenge.
2. Checks that the challenge is x402 version 2 and picks **exactly one** accepted requirement: the one for your `ARCAGENTS_PAYMENT_NETWORK`.
3. Refuses to sign unless that requirement is `exact`, for the expected USDC contract and EIP-712 domain on that network, for exactly 2000 atomic units, with a valid `payTo` recipient and an authorization window of at most 300 seconds. The recipient, amount and timeout are taken from the live challenge, not hardcoded.
4. Signs one EIP-3009 authorization with `EVM_PRIVATE_KEY` and resends the same request with it.

The server **never switches to another network** after a failure and **never makes a second paid request to try a different payment method**. The per-session limit (`ARCAGENTS_MAX_PAYMENTS`) is checked before anything is signed, and concurrent identical calls share one request.

| HTTP status | Meaning | What the server does |
|---|---|---|
| `200` | Success, payment settled | Returns the API JSON, plus the transaction hash when reported |
| `400` | Invalid request | Returns the API error. No data returned |
| `402` (after paying) | Payment rejected, for example at verification | Returns the API error. No automatic retry |
| `404` | Agent ID not found on Arc Mainnet | Returns the API error. Not charged |
| `409` | Authorization already used, or request conflict | Returns the API error. **Does not sign a new payment** |
| `500` | Settlement failed or could not be confirmed | Returns the API error and any transaction hash it contains. **Does not sign a new payment** |
| `503` | No final result yet (RPC error, verification unavailable, settlement pending) | Returns the API error and `Retry-After`. **Does not sign a new payment** |

A `503` caused by an RPC error before settlement is not a paid successful request.

**Interrupted requests.** Before a signed payment is sent, it is saved as one small private file per request in `~/.arcagents-mcp` (or `ARCAGENTS_STATE_DIR`). If a request ends without a final answer (`503`, `500`, `409`, `429`, a timeout, a lost connection, or a response body that could not be read completely), asking again for the same agent ID resends the identical payment, including its `X-UVD-Purchase` context, and does not sign a new one. The saved payment context survives process restarts. The server reuses the same signed payment rather than creating a new authorization. The saved payment is removed once the API gives a final answer (any response other than `5xx`, `409` or `429`) and its body has been read completely. Nothing is retried automatically, and `Retry-After` is reported to you, not waited on.

If two MCP processes request the same agent ID at the same time, only one process can claim and send the payment. A competing process does not send another payment: it returns a temporary conflict message, and asking again reuses the saved payment.

A `409` carries a reason: `authorization_already_settled` (the SDK reports the authorization as already used, with payment confirmed) or `receipt_request_conflict` (the authorization belongs to another request; the API does not state whether it settled). Neither triggers a new authorization. If you have confirmed on chain that an earlier payment did not settle, delete that request's file in the state directory to start fresh. If the state cannot be read or written, nothing is signed or sent.

**State directory security.** The files contain signed authorizations. On macOS and Linux the server creates the directory `0700` and files `0600`, and never modifies an existing directory. On Windows those modes provide no confidentiality; protection comes from the folder's ACL. The default is under your user profile (`%USERPROFILE%\.arcagents-mcp`). A custom `ARCAGENTS_STATE_DIR` must be an absolute path (`~` is not expanded and relative paths are rejected) that only your account can read, with inherited access for other users removed on Windows.

API errors return the HTTP status, `retryAfter` when present, the API's original response under `apiResponse`, and a `guidance` sentence. Errors raised before or without an API response return `error`, `message` and `guidance`. The private key is never included in tool output or logs, and `stdout` carries only MCP protocol messages.

---

## Limitations

- Paid API data covers Arc Mainnet agents only. Arc Testnet data, including what the Arc ERC-8004 Explorer shows, is not available through the paid API.
- Validation data depends on registry availability and may be absent.
- Agent Activity is not currently available through this API.
- One agent ID per call: there is no search, listing or bulk endpoint.
- Payments use x402 only.

---

## Troubleshooting

**The server does not appear in my client.**
Check the config file path and JSON/TOML syntax, then restart the client fully. Confirm `node --version` is 20 or newer and `npx` is on the `PATH` the client uses. On the first run `npx` downloads the package, which can exceed a client's startup timeout; run `npx -y arcagents-mcp` once in a terminal (it prints a readiness line and waits), then restart the client.

**`EVM_PRIVATE_KEY is missing or malformed`**
The key must be `0x` followed by exactly 64 hex characters, with no spaces or quotes inside the value.

**`ARCAGENTS_STATE_DIR must be an absolute path`**
Write the full path in the client configuration (no `~`, no relative path), or remove the variable to use the default folder in your home directory.

**`ARCAGENTS_PAYMENT_NETWORK must be "arc" or "base"`**
Only those two values are accepted. Unset it to use Arc.

**`402` after payment, or "Payment verification failed"**
The API did not accept the payment. The reason is in `apiResponse`. A `402` after payment is a final answer: no automatic retry is made, and asking again starts a new request.

**`Payment limit reached`**
The process has signed `ARCAGENTS_MAX_PAYMENTS` payments. Restart the client to reset the counter, or raise the limit.

**`The API answered with HTTP ..., but its response body could not be read completely`**
The answer was cut off or timed out while being read. The signed payment is kept: ask again for the same agent ID and the same signed payment is resent, never a new one.

**`The request did not complete` / timeouts**
A payment may have been signed before the timeout. Ask again for the same agent ID: the same signed payment is resent (never a new one) until the API gives a final answer, so you are not charged twice. Raise `ARCAGENTS_TIMEOUT_MS` if your connection is slow.

**`Selected payment requirement was refused`** (or **`The API challenge must contain exactly one <network> payment option`**)
The API's challenge did not match what this server is willing to sign (wrong token, amount, domain or timeout, or no single option for your payment network). Nothing was signed. Check for a newer `arcagents-mcp` release.

**`Payment state could not be saved` / `could not be read`**
The server saves each signed payment before sending it and refuses to pay if it cannot. Set `ARCAGENTS_STATE_DIR` to a writable directory, or repair the directory it names (remove a request's file only after checking the earlier payment on chain).

**`Another process already holds a signed, unresolved payment for this request`**
A temporary conflict between two MCP processes. Nothing was sent by this call. Ask again: the next request resends the existing signed payment and creates no new authorization.

**`404`**
That agent ID is not minted on Arc Mainnet. You were not charged.

---

## Develop from source

```bash
git clone https://github.com/Nomad07/arcagents-mcp.git
cd arcagents-mcp
npm install
npm run build
EVM_PRIVATE_KEY=0x... npm start        # waits for an MCP client on stdio
```

To try the local build in MCP Inspector, run `npx @modelcontextprotocol/inspector -e EVM_PRIVATE_KEY=0x... node dist/index.js`.

To point a client at a local build, use `"command": "node"` and `"args": ["/absolute/path/to/arcagents-mcp/dist/index.js"]`.

## Security

- Use a **dedicated wallet** with a small USDC balance. The key is only used to sign x402 payment authorizations for this API.
- The API host and price are fixed in the code; the server will not sign for another host's challenge, token, amount or EIP-712 domain.
- Never commit a real `.env` or private key. `.env.example` contains no secrets.
- Keep `autoApprove` (or your client's equivalent) off for this tool so you see each paid call.

## License

MIT
