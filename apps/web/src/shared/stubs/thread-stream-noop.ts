/**
 * Noop stub for thread-stream — prevents Turbopack from following
 * pino@7 → thread-stream@0.15 → test files requiring 'tape'/'tap'.
 *
 * Temporary containment: the real fix is bug.0157 (dynamic import
 * with ssr: false for the WalletConnect component subtree).
 */

// biome-ignore lint/style/noDefaultExport: thread-stream's public API is a default export
export default class ThreadStream {
  write() {
    /* noop — client stub */
  }
  end() {
    /* noop — client stub */
  }
  flush() {
    /* noop — client stub */
  }
  destroy() {
    /* noop — client stub */
  }
}
