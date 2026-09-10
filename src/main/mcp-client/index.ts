/** Public surface of the MCP client transport layer (#2029). */
export { connectMcpServer, shutdownAllMcpClients, type McpClient, type ConnectMcpServerOptions } from './client';
export {
  type McpEra,
  type McpServerDescriptor,
  type McpToolDescriptor,
  type McpContentBlock,
  type McpToolCallResult,
  type McpSubscriptionFilter,
  type McpNotification,
  type McpSubscription,
  type McpTransport,
  type InputRequiredHandler,
} from './types';
export { McpClientError, McpConnectionError, McpAuthRequiredError, McpProtocolError, McpInputRequiredUnhandledError } from './errors';
export { defaultInputRequiredHandler } from './mrtr';
