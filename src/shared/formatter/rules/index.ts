/**
 * Side-effect barrel that registers every formatter rule (#155–#161).
 * Importing this module causes each rule file to run its `registerRule`
 * call, populating the shared registry before the engine consults it.
 *
 * Empty until the category tickets land — each sub-issue adds a line here:
 *
 *   import './yaml/trailing-spaces';        // #155
 *   import './heading/heading-increment';   // #156
 *   …
 */
export {};
