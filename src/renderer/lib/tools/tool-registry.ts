// Import all tool definitions so they register with the registry
import '../../../shared/tools/definitions/index';

// Re-export registry functions for renderer use
export { getAllToolInfos, getToolInfosByCategory, getTool } from '../../../shared/tools/registry';
