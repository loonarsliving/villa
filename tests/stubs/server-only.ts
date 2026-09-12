/**
 * `server-only` is provided by Next.js at build time and does not resolve
 * under a plain Node/vitest run. It exists purely as a compile-time guard
 * against importing a server module into a client bundle, so stubbing it
 * out in tests removes nothing the tests care about.
 */
export {};
