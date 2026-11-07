/** Types for `packaged-app.mjs` (#2981, #2179). */

export function packagedAppPaths(root: string, platform?: string, arch?: string): {
  dir: string;
  app: string;
  binary: string;
  resources: string;
};

export const LINUX_EXECUTABLE_NAME: string;
