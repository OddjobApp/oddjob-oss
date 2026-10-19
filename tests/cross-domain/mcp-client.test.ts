/**
 * MCP client service — connecting to an external MCP server and running its tools.
 *
 * Rewritten. The previous suite was written against an interface that does not
 * exist (connectToServer, listConnections, shutdown, getServerConfig,
 * disconnectFromServer, disconnectAll) and mocked the SDK's package root, which
 * the service never imports — so it failed to collect and none of its eighteen
 * tests had ever run. This one drives the API the service actually exposes.
 *
 * The stdio path gets the most attention here, because it is the one that
 * executes a command on this machine: `validateMcpCommand` and
 * `sandboxMcpCommand` are the guards between an agent-supplied server config and
 * a spawned process, and neither had a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { ClientMock, clientInstances, StdioTransport, SseTransport, HttpTransport } = vi.hoisted(() => {
  const clientInstances: any[] = [];
  const ClientMock = vi.fn().mockImplementation(function () {
    const instance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'search', description: 'Search tool' },
          { name: 'getDocument', description: 'Get document tool' },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Tool execution result' }] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    };
    clientInstances.push(instance);
    return instance;
  });

  return {
    ClientMock,
    clientInstances,
    StdioTransport: vi.fn().mockImplementation(function (opts: any) { return { kind: "stdio", opts }; }),
    SseTransport: vi.fn().mockImplementation(function (url: any) { return { kind: "sse", url }; }),
    HttpTransport: vi.fn().mockImplementation(function (url: any) { return { kind: "http", url }; }),
  };
});

// The four subpaths mcp-client.service.ts imports. Mocking the package root
// intercepts none of them.
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: ClientMock }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: StdioTransport }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: SseTransport }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: HttpTransport }));

import { MCPClientService } from '../../server/domain/agents/core/mcp-client.service.js';

/** The client the service built for the most recent connect. */
const lastClient = () => clientInstances[clientInstances.length - 1];

const stdioConfig = (over: Record<string, unknown> = {}) => ({
  transport: 'stdio' as const,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  ...over,
});

describe('MCPClientService', () => {
  let service: MCPClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    service = new MCPClientService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('connect', () => {
    it('opens a stdio server and returns a session holding its tools', async () => {
      const session = await service.connect(stdioConfig());

      expect(StdioTransport).toHaveBeenCalledWith({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      });
      expect(lastClient().connect).toHaveBeenCalledOnce();
      expect(session.id).toMatch(/^mcp-/);
      expect(session.tools.map((t: any) => t.name)).toEqual(['search', 'getDocument']);
      expect(service.getSession(session.id)).toBe(session);
      expect(service.getSessions()).toHaveLength(1);
    });

    it('opens an SSE server at the URL it was given', async () => {
      await service.connect({ transport: 'sse', serverUrl: 'https://mcp.example/sse' });

      expect(SseTransport).toHaveBeenCalledOnce();
      expect(String(SseTransport.mock.calls[0][0])).toBe('https://mcp.example/sse');
      expect(StdioTransport).not.toHaveBeenCalled();
    });

    it('falls through to streamable HTTP for anything else', async () => {
      await service.connect({ transport: 'http', serverUrl: 'https://mcp.example/mcp' });

      expect(HttpTransport).toHaveBeenCalledOnce();
      expect(String(HttpTransport.mock.calls[0][0])).toBe('https://mcp.example/mcp');
    });

    it.each([
      [{ transport: 'stdio' as const }, /Command required for stdio/],
      [{ transport: 'sse' as const }, /Server URL required for SSE/],
      [{ transport: 'http' as const }, /Server URL required for HTTP/],
    ])('refuses a config missing what its transport needs (%#)', async (config, message) => {
      await expect(service.connect(config)).rejects.toThrow(message);
      expect(service.getSessions()).toHaveLength(0);
    });

    it('gives up rather than hanging when the server never completes the handshake', async () => {
      ClientMock.mockImplementationOnce(function () {
        const instance = {
          connect: vi.fn(() => new Promise(() => {})), // never settles
          close: vi.fn().mockResolvedValue(undefined),
          listTools: vi.fn(),
          callTool: vi.fn(),
        };
        clientInstances.push(instance);
        return instance;
      });

      await expect(service.connect(stdioConfig({ timeout: 20 }))).rejects.toThrow('Connection timeout');
      expect(service.getSessions()).toHaveLength(0);
    });

    it('records no session when the handshake fails', async () => {
      ClientMock.mockImplementationOnce(function () {
        const instance = {
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
          close: vi.fn().mockResolvedValue(undefined),
          listTools: vi.fn(),
          callTool: vi.fn(),
        };
        clientInstances.push(instance);
        return instance;
      });

      await expect(service.connect(stdioConfig())).rejects.toThrow('Connection refused');
      expect(service.getSessions()).toHaveLength(0);
    });
  });

  /**
   * The guard between a server config and a process on this machine. A config
   * can reach here from a stored integration record, so "the user typed it" is
   * not a safety argument.
   */
  describe('stdio command validation', () => {
    it.each([
      ['sudo', ['rm']],
      ['npx', ['server; rm -rf /']],
      ['npx', ['$(whoami)']],
      ['npx', ['`id`']],
      ['npx', ['a | sh']],
      ['npx', ['&& chmod 777 /']],
      ['rm -rf', ['/']],
      ['chown', ['root', '/etc']],
    ])('refuses to spawn %s %j', async (command, args) => {
      await expect(service.connect(stdioConfig({ command, args }))).rejects.toThrow(
        /Security validation failed/,
      );

      // The point is that nothing was spawned, not merely that it threw.
      expect(StdioTransport).not.toHaveBeenCalled();
      expect(ClientMock).not.toHaveBeenCalled();
      expect(service.getSessions()).toHaveLength(0);
    });

    it('allows an ordinary server command through', async () => {
      await expect(service.connect(stdioConfig())).resolves.toBeDefined();
      expect(StdioTransport).toHaveBeenCalledOnce();
    });
  });

  describe('stdio sandbox', () => {
    it('spawns the command directly when sandboxing is off', async () => {
      vi.stubEnv('MCP_SANDBOX_ENABLED', 'false');

      await service.connect(stdioConfig({ command: 'node', args: ['server.js'] }));

      expect(StdioTransport).toHaveBeenCalledWith({ command: 'node', args: ['server.js'] });
    });

    it('wraps the command in a hardened container when sandboxing is on', async () => {
      vi.stubEnv('MCP_SANDBOX_ENABLED', 'true');

      await service.connect(stdioConfig({ command: 'node', args: ['server.js'] }));

      const { command, args } = StdioTransport.mock.calls[0][0] as { command: string; args: string[] };
      expect(command).toBe('docker');
      // The restrictions are the point of the wrapper, so assert them by name.
      expect(args).toEqual(expect.arrayContaining(['run', '--rm', '-i']));
      expect(args.join(' ')).toContain('--network none');
      expect(args.join(' ')).toContain('--user 1000:1000');
      expect(args.join(' ')).toContain('--memory 512m');
      // The wrapped command still runs, after the image.
      expect(args.slice(-2)).toEqual(['node', 'server.js']);
    });

    it('picks a python image for a python server', async () => {
      vi.stubEnv('MCP_SANDBOX_ENABLED', 'true');

      await service.connect(stdioConfig({ command: 'python3', args: ['server.py'] }));

      const { args } = StdioTransport.mock.calls[0][0] as { args: string[] };
      expect(args).toContain('python:3.11-alpine');
    });
  });

  describe('executeTool', () => {
    it('passes the call to the session\'s client and returns its result', async () => {
      const session = await service.connect(stdioConfig());
      const client = lastClient();

      const result = await service.executeTool(session.id, {
        name: 'search',
        arguments: { query: 'oddjob' },
      });

      expect(client.callTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: { query: 'oddjob' },
      });
      expect(result).toEqual({ content: [{ type: 'text', text: 'Tool execution result' }] });
    });

    it('marks the session active, so cleanup does not reap it mid-use', async () => {
      const session = await service.connect(stdioConfig());
      const before = session.lastActivity.getTime();
      await new Promise((r) => setTimeout(r, 5));

      await service.executeTool(session.id, { name: 'search', arguments: {} });

      expect(service.getSession(session.id)!.lastActivity.getTime()).toBeGreaterThan(before);
    });

    it('refuses a session it does not hold', async () => {
      await expect(
        service.executeTool('mcp-not-a-session', { name: 'search', arguments: {} }),
      ).rejects.toThrow(/session not found/i);
    });

    it('surfaces a tool failure rather than swallowing it', async () => {
      const session = await service.connect(stdioConfig());
      lastClient().callTool.mockRejectedValueOnce(new Error('Tool exploded'));

      await expect(
        service.executeTool(session.id, { name: 'search', arguments: {} }),
      ).rejects.toThrow('Tool exploded');
    });

    it('gives up on a tool that never returns', async () => {
      const session = await service.connect(stdioConfig({ timeout: 20 }));
      lastClient().callTool.mockImplementationOnce(() => new Promise(() => {}));

      await expect(
        service.executeTool(session.id, { name: 'search', arguments: {} }),
      ).rejects.toThrow('Tool execution timeout');
    });
  });

  describe('listTools', () => {
    it('refreshes what the session believes the server offers', async () => {
      const session = await service.connect(stdioConfig());
      lastClient().listTools.mockResolvedValueOnce({ tools: [{ name: 'newTool', description: 'Added later' }] });

      const tools = await service.listTools(session.id);

      expect(tools.map((t: any) => t.name)).toEqual(['newTool']);
      expect(service.getSession(session.id)!.tools.map((t: any) => t.name)).toEqual(['newTool']);
    });

    it('refuses a session it does not hold', async () => {
      await expect(service.listTools('mcp-not-a-session')).rejects.toThrow(/session not found/i);
    });
  });

  describe('disconnect', () => {
    it('closes the client and forgets the session', async () => {
      const session = await service.connect(stdioConfig());
      const client = lastClient();

      await service.disconnect(session.id);

      expect(client.close).toHaveBeenCalledOnce();
      expect(service.getSession(session.id)).toBeUndefined();
      expect(service.getSessions()).toHaveLength(0);
    });

    it('forgets the session even when closing throws, so a broken client cannot leak', async () => {
      const session = await service.connect(stdioConfig());
      lastClient().close.mockRejectedValueOnce(new Error('socket already gone'));

      await expect(service.disconnect(session.id)).resolves.toBeUndefined();
      expect(service.getSessions()).toHaveLength(0);
    });

    it('is a no-op for a session it does not hold', async () => {
      await expect(service.disconnect('mcp-not-a-session')).resolves.toBeUndefined();
    });
  });

  describe('cleanupInactiveSessions', () => {
    it('reaps what has gone quiet and keeps what has not', async () => {
      const stale = await service.connect(stdioConfig());
      const fresh = await service.connect(stdioConfig());

      // Age the first session past the threshold.
      service.getSession(stale.id)!.lastActivity = new Date(Date.now() - 10 * 60 * 1000);

      await service.cleanupInactiveSessions(5 * 60 * 1000);

      expect(service.getSession(stale.id)).toBeUndefined();
      expect(service.getSession(fresh.id)).toBeDefined();
    });
  });
});
