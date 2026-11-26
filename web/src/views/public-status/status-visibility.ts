// Keep the existing stream through brief tab switches.
const hiddenGraceMs = 30_000;

export function observeStatusVisibility(resume: () => () => void) {
  let pause: (() => void) | undefined;
  let timer: number | undefined;
  let deadline = 0;
  let away = false;

  function cancelDeadline() {
    window.clearTimeout(timer);
    timer = undefined;
    deadline = 0;
  }

  function suspend() {
    cancelDeadline();
    pause?.();
    pause = undefined;
  }

  function sync() {
    if (away) return;
    if (document.hidden) {
      if (pause && timer === undefined) {
        deadline = Date.now() + hiddenGraceMs;
        timer = window.setTimeout(suspend, hiddenGraceMs);
      }
      return;
    }
    // A frozen tab can become visible before its overdue timer runs.
    if (deadline && Date.now() >= deadline) suspend();
    cancelDeadline();
    pause ??= resume();
  }

  function leave() {
    away = true;
    suspend();
  }
  function enter() {
    away = false;
    sync();
  }

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', enter);
  sync();
  return () => {
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', enter);
    leave();
  };
}
