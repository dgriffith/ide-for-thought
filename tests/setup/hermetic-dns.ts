/**
 * Global vitest setup: `safeFetch` (#2566) resolves every host before it
 * fetches. Unit tests mock `fetch` and must not depend on real DNS, so every
 * name resolves to a public documentation-adjacent address here. Tests about
 * the address checks install their own resolver with `setSafeFetchLookup`.
 */
import { setSafeFetchLookup } from '../../src/main/safe-fetch';

setSafeFetchLookup(async () => ['93.184.216.34']);
