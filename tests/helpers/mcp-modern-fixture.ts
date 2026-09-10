/**
 * Hand-built modern-era (2026-07-28) MCP server fixture (#2029). No real
 * server speaks this era yet, so this stands in for one: `server/discover`,
 * `tools/list` (alternating JSON-body/SSE-body responses so both response
 * paths get exercised), `tools/call` (including a scripted
 * `input_required` → `complete` sequence for the `needs-input` tool, and a
 * deliberate `HeaderMismatch` for `trigger-header-mismatch`), and
 * `subscriptions/listen` (ack frame + one change notification).
 */
import http from 'node:http';

export interface ModernFixtureRequestLogEntry {
  httpMethod: string;
  jsonRpcMethod?: string;
  headers: Record<string, string>;
}

export interface ModernFixtureServer {
  url: string;
  requestLog: ModernFixtureRequestLogEntry[];
  close(): Promise<void>;
}

interface SseFrameInput {
  event?: string;
  id?: string;
  data: unknown;
}

export function startModernFixture(): Promise<ModernFixtureServer> {
  const requestLog: ModernFixtureRequestLogEntry[] = [];
  let toolsListCalls = 0;
  let needsInputCalls = 0;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k] = v;
        }

        let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        requestLog.push({ httpMethod: req.method ?? '', jsonRpcMethod: msg.method, headers });

        const params = msg.params ?? {};
        const toolName = params.name;

        const sendJson = (status: number, body: Record<string, unknown>) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...body }));
        };
        const sendSse = (status: number, frames: SseFrameInput[]) => {
          res.writeHead(status, { 'content-type': 'text/event-stream' });
          for (const f of frames) {
            if (f.event) res.write(`event: ${f.event}\n`);
            if (f.id) res.write(`id: ${f.id}\n`);
            res.write(`data: ${typeof f.data === 'string' ? f.data : JSON.stringify(f.data)}\n\n`);
          }
          res.end();
        };

        if (msg.method === 'server/discover') {
          sendJson(200, { result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: {} } });
          return;
        }

        if (msg.method === 'tools/list') {
          toolsListCalls += 1;
          const result = {
            resultType: 'complete',
            tools: [
              { name: 'get-time', description: 'returns the time', inputSchema: { type: 'object', properties: {} } },
              { name: 'needs-input', description: 'exercises MRTR', inputSchema: { type: 'object', properties: {} } },
              { name: 'trigger-header-mismatch', description: 'always fails with HeaderMismatch', inputSchema: { type: 'object', properties: {} } },
            ],
          };
          if (toolsListCalls % 2 === 0) sendSse(200, [{ event: 'message', data: { jsonrpc: '2.0', id: msg.id, result } }]);
          else sendJson(200, { result });
          return;
        }

        if (msg.method === 'tools/call') {
          if (toolName === 'trigger-header-mismatch') {
            sendJson(400, { error: { code: -32020, message: 'Header mismatch' } });
            return;
          }
          if (toolName === 'needs-input') {
            needsInputCalls += 1;
            if (needsInputCalls === 1) {
              sendJson(200, {
                result: {
                  resultType: 'input_required',
                  inputRequests: { r1: { method: 'roots/list', params: {} } },
                  requestState: 'fixture-state',
                },
              });
            } else {
              sendJson(200, { result: { resultType: 'complete', content: [{ type: 'text', text: 'mrtr-done' }], isError: false } });
            }
            return;
          }
          sendJson(200, { result: { resultType: 'complete', content: [{ type: 'text', text: `called ${String(toolName)}` }], isError: false } });
          return;
        }

        if (msg.method === 'subscriptions/listen') {
          sendSse(200, [
            {
              data: {
                jsonrpc: '2.0',
                method: 'notifications/subscriptions/acknowledged',
                params: { _meta: { 'io.modelcontextprotocol/subscriptionId': msg.id } },
              },
            },
            { data: { jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} } },
          ]);
          return;
        }

        sendJson(404, { error: { code: -32601, message: `unknown method ${String(msg.method)}` } });
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        requestLog,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
