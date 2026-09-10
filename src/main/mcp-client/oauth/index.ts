/** Public surface of the MCP client's OAuth 2.1 flow (#2030). */
export { connectMcpServerWithOAuth, reauthorizeWithStepUp, runAuthorizationFlow, type McpOAuthConnectOptions } from './flow';
export type {
  AuthorizationContext,
  AuthorizationFlowResult,
  AuthorizationServerMetadata,
  ClientRegistration,
  ProtectedResourceMetadata,
  RunAuthorizationFlowOptions,
  StoredOAuthRecord,
  TokenResponse,
} from './types';
export { unionScopes } from './step-up';
export { canonicalServerUri } from './resource-metadata';
