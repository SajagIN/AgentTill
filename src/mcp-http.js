import { createMcpServer } from "./mcp-server.js";

/**
 * Bridges one JSON-RPC request onto a freshly constructed MCP server.
 *
 * The MCP SDK's in-memory transport is callback based, so `execute()` resolves
 * with the server's first reply to `reqMessage`. Notifications carry no reply
 * and are answered with null.
 */
class MemoryTransport {
  constructor(reqMessage) {
    this.reqMessage = reqMessage;
    this.onmessage = null;
  }

  async start() {}
  async close() {}
  async send(message) {
    this.resolveResponse?.(message);
  }

  execute() {
    return new Promise((resolve) => {
      this.resolveResponse = resolve;
      this.onmessage?.(this.reqMessage);
    });
  }
}

async function dispatch(message) {
  if (message?.method === "notifications/initialized") return null;
  const server = createMcpServer();
  const transport = new MemoryTransport(message);
  await server.connect(transport);
  return transport.execute();
}

/**
 * Handle an MCP JSON-RPC body (single request or batch).
 * @returns {Promise<{status:number, body?:object|object[]}>}
 */
export async function handleMcpRequest(body) {
  if (!body) return { status: 400, body: { error: "missing body" } };

  if (Array.isArray(body)) {
    const responses = [];
    for (const message of body) {
      const response = await dispatch(message);
      if (response) responses.push(response);
    }
    return { status: 200, body: responses };
  }

  const response = await dispatch(body);
  // JSON-RPC notifications get no response body.
  if (response === null) return { status: 204 };
  return { status: 200, body: response };
}
