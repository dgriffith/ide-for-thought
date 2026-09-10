/**
 * Client registration priority ladder (#2030) — pre-registered → CIMD → DCR.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { _setCimdClientMetadataUrlForTests, registerClient } from '../../../../src/main/mcp-client/oauth/client-registration';
import { McpClientRegistrationFailedError } from '../../../../src/main/mcp-client/errors';
import type { AuthorizationServerMetadata } from '../../../../src/main/mcp-client/oauth/types';

afterEach(() => {
  vi.unstubAllGlobals();
  _setCimdClientMetadataUrlForTests('');
});

function metadata(overrides: Partial<AuthorizationServerMetadata> = {}): AuthorizationServerMetadata {
  return {
    issuer: 'https://as.example.com',
    response_types_supported: ['code'],
    ...overrides,
  };
}

describe('registerClient', () => {
  it('uses pre-registered client info first, without any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
      preRegistered: { clientId: 'manual-client-id' },
      redirectUris: ['http://127.0.0.1:1/callback'],
    });
    expect(result).toEqual({ clientId: 'manual-client-id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to DCR when there is no pre-registered client and CIMD is unconfigured', async () => {
    let seenBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://as.example.com/register');
      seenBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ client_id: 'dcr-client-id' }), { status: 201 });
    }));
    const result = await registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
      redirectUris: ['http://127.0.0.1:41417/callback'],
      scope: 'files:read',
    });
    expect(result).toEqual({ clientId: 'dcr-client-id' });
    expect(seenBody).toMatchObject({
      redirect_uris: ['http://127.0.0.1:41417/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      application_type: 'native',
      scope: 'files:read',
    });
  });

  it('carries a client_secret through when DCR issues one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ client_id: 'id', client_secret: 'secret' }), { status: 201 })));
    const result = await registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
      redirectUris: ['http://127.0.0.1:41417/callback'],
    });
    expect(result).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('throws McpClientRegistrationFailedError when DCR returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 400 })));
    await expect(
      registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
        redirectUris: ['http://127.0.0.1:41417/callback'],
      }),
    ).rejects.toThrow(McpClientRegistrationFailedError);
  });

  it('throws McpClientRegistrationFailedError when the DCR response has no client_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 201 })));
    await expect(
      registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
        redirectUris: ['http://127.0.0.1:41417/callback'],
      }),
    ).rejects.toThrow(McpClientRegistrationFailedError);
  });

  it('throws McpClientRegistrationFailedError when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await expect(
      registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
        redirectUris: ['http://127.0.0.1:41417/callback'],
      }),
    ).rejects.toThrow(McpClientRegistrationFailedError);
  });

  it('throws McpClientRegistrationFailedError when the request throws a non-Error value', async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately exercising the non-Error branch of the error-message ternary
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'boom'; }));
    await expect(
      registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
        redirectUris: ['http://127.0.0.1:41417/callback'],
      }),
    ).rejects.toThrow(/boom/);
  });

  it('throws McpClientRegistrationFailedError when DCR returns a 2xx with a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 201 })));
    await expect(
      registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
        redirectUris: ['http://127.0.0.1:41417/callback'],
      }),
    ).rejects.toThrow(McpClientRegistrationFailedError);
  });

  it('threads an AbortSignal through to the DCR request', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ client_id: 'id' }), { status: 201 });
    }));
    await registerClient(metadata({ registration_endpoint: 'https://as.example.com/register' }), {
      redirectUris: ['http://127.0.0.1:41417/callback'],
      signal: controller.signal,
    });
    expect(seenSignal).toBe(controller.signal);
  });

  it('throws McpClientRegistrationFailedError when no mechanism is available at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      registerClient(metadata(), { redirectUris: ['http://127.0.0.1:41417/callback'] }),
    ).rejects.toThrow(McpClientRegistrationFailedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses CIMD when configured and the AS advertises support, without any network call', async () => {
    _setCimdClientMetadataUrlForTests('https://minerva.example.com/oauth/client-metadata.json');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await registerClient(
      metadata({ registration_endpoint: 'https://as.example.com/register', client_id_metadata_document_supported: true }),
      { redirectUris: ['http://127.0.0.1:41417/callback'] },
    );
    expect(result).toEqual({ clientId: 'https://minerva.example.com/oauth/client-metadata.json' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not attempt CIMD when the AS does not advertise support, even with pre-registered absent (falls to DCR)', async () => {
    // client_id_metadata_document_supported: false — and CIMD_CLIENT_METADATA_URL
    // is empty by default anyway, so this exercises the "gated off" branch.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ client_id: 'dcr-id' }), { status: 201 })));
    const result = await registerClient(
      metadata({ registration_endpoint: 'https://as.example.com/register', client_id_metadata_document_supported: false }),
      { redirectUris: ['http://127.0.0.1:41417/callback'] },
    );
    expect(result).toEqual({ clientId: 'dcr-id' });
  });
});
