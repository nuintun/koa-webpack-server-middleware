/**
 * @module hot
 */

// Last error.
let error: Error;
// Last update hash.
let hash: string = __webpack_hash__;
// HMR status.
let status: HotUpdateStatus = 'idle';

/**
 * @function isUpdateAvailable
 * @description Is there a newer version of this code available.
 */
export function isUpdateAvailable(): boolean {
  // __webpack_hash__ is the hash of the current compilation.
  // It's a global variable injected by webpack.
  return hash !== __webpack_hash__;
}

/**
 * @function updateHash
 * @description Update hash.
 * @param value - The new hash value.
 */
export function updateHash(value: string): void {
  hash = value;
}

/**
 * @function updateStatus
 * @description Update status.
 * @param value The new status of the hot update.
 */
export function updateStatus(value: HotUpdateStatus): void {
  status = value;
}

// Initialize status.
if (import.meta.webpackHot) {
  updateStatus(import.meta.webpackHot.status());
}

/**
 * @function attemptUpdates
 * @description Attempt to update code on the fly, fall back to a hard reload.
 * @param hmr Whether to enable HMR.
 * @param fallback Fallback function when HMR fail.
 */
export function attemptUpdates(hmr: boolean, fallback: (error?: Error) => void): void {
  // Update available.
  if (isUpdateAvailable()) {
    // HMR enabled.
    if (hmr && import.meta.webpackHot) {
      switch (status) {
        case 'idle':
          // Get status.
          updateStatus('check');

          // Auto check and apply updates.
          import.meta.webpackHot
            .check(true)
            .then(updated => {
              // Update status.
              updateStatus(import.meta.webpackHot.status());

              // When updated modules is available,
              // it indicates server is ready to serve new bundle.
              if (updated) {
                // While update completed, do it again until no update available.
                attemptUpdates(hmr, fallback);
              }
            })
            .catch((exception: Error) => {
              // Get status.
              const status = import.meta.webpackHot.status();

              // Update status.
              if (status === 'fail' || status === 'abort') {
                updateStatus(status);
              } else {
                updateStatus('fail');
              }

              // Cache error.
              error = exception;

              // Call fallback.
              fallback(error);
            });
          break;
        case 'fail':
        case 'abort':
          // Call fallback.
          fallback(error);
          break;
      }
    } else {
      // HMR disabled.
      fallback();
    }
  }
}
