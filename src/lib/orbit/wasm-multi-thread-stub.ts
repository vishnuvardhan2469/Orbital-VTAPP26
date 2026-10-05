/**
 * Stub for satellite.js's multi-threaded WASM runtime.
 *
 * satellite.js v7 ships three SGP4 implementations: pure JS (what this app
 * uses), a single-threaded WASM build, and a pthreads WASM build. The pthreads
 * build cannot be bundled — its worker entry uses top-level `await`, which has
 * no equivalent in the IIFE format a classic worker needs — so `vite build`
 * fails the moment the bundler follows that dynamic import, even though nothing
 * calls it.
 *
 * `vite.config.ts` aliases `#wasm-multi-thread` here to break that edge. The
 * single-threaded WASM runtime is untouched and still available.
 *
 * To actually use pthreads SGP4 (worthwhile only for catalogs in the tens of
 * thousands): remove the alias, serve the app cross-origin isolated
 * (`Cross-Origin-Opener-Policy: same-origin` plus
 * `Cross-Origin-Embedder-Policy: require-corp`, which SharedArrayBuffer needs),
 * and configure Vite to emit ES-module workers.
 */
export default function createWasmModuleMultiThread(): Promise<never> {
  return Promise.reject(
    new Error(
      'satellite.js multi-threaded WASM runtime is not bundled in this build. ' +
        'See src/lib/orbit/wasm-multi-thread-stub.ts for how to enable it.',
    ),
  )
}
