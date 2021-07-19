/**
 * @module update
 */

let timer;
let status = 'idle';
let aborted = false;

const RELOAD_INTERVAL = 300;

function reload() {
  clearTimeout(timer);

  timer = setTimeout(() => {
    if (!aborted) {
      window.location.reload();
    }
  }, RELOAD_INTERVAL);
}

function isUpToDate(hash) {
  return hash === __webpack_hash__;
}

function replace(hash, onUpdated) {
  module.hot
    .check()
    .then(() => {
      return module.hot.apply().then(updated => {
        status = module.hot.status();

        if (!updated || updated.length === 0) {
          reload();
        } else if (isUpToDate(hash)) {
          onUpdated();
        } else {
          replace(hash, onUpdated);
        }
      });
    })
    .catch(() => {
      status = 'fail';

      reload();
    });
}

export function abort() {
  aborted = true;

  clearTimeout(timer);
}

export function update(hash, hmr, forceReload, onUpdated = () => {}) {
  aborted = false;

  clearTimeout(timer);

  if (forceReload) {
    reload();
  } else if (isUpToDate(hash)) {
    onUpdated();
  } else if (hmr && module.hot) {
    if (status === 'idle') {
      replace(hash, onUpdated);
    } else if (status === 'fail') {
      reload();
    }
  } else {
    reload();
  }
}
