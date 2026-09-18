/**
 * @vitest-environment node
 *
 * Enforces #907's explicit acceptance criterion: the `:::argument` embed is a
 * VIEW of the graph — it never mutates, and that isn't just a claim in the PR
 * description. Reuses the same lexical `api.<domain>.<method>(` scanner the
 * data-flow coverage tests already share (`tests/helpers/renderer-api-surface.ts`)
 * so this can't silently drift from what "mutation" means elsewhere in the repo.
 */
import { describe, it, expect } from 'vitest';
import { apiCallsIn, dataflowMutationMethods } from '../helpers/renderer-api-surface';

const ARGUMENT_MAP_FILES = [
  'src/renderer/lib/components/ArgumentMap.svelte',
  'src/renderer/lib/markdown/argument-map-renderer.ts',
  'src/renderer/lib/preview/argument-map-query.ts',
];

describe('argument-map embed is read-only (#907)', () => {
  it('calls exactly api.graph.query — nothing else on the api.* surface', () => {
    const calls = apiCallsIn(ARGUMENT_MAP_FILES);
    expect(calls).toEqual(new Set(['graph.query']));
  });

  it('touches no method the data-flow rule classifies as a mutation', () => {
    const calls = apiCallsIn(ARGUMENT_MAP_FILES);
    const mutations = dataflowMutationMethods();
    for (const call of calls) {
      const [, method] = call.split('.');
      expect(mutations.has(method!), `${call} is a mutation`).toBe(false);
    }
  });
});
