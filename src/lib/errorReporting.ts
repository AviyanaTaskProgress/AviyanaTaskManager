// Backend engineering review (2026-09): errors only ever went to
// console.error + a toast — nothing was captured anywhere the team
// could see after the fact, so a production bug a user hits (and
// doesn't bother reporting) is invisible. This is NOT a replacement
// for a real error-tracking service (Sentry, etc.) — wiring one up
// needs an actual account/DSN this session doesn't have — but it's
// the seam to plug one into: every uncaught error and unhandled
// promise rejection funnels through `reportError()` below, so
// swapping the body of that one function for `Sentry.captureException`
// (npm install @sentry/react, a few lines here) is the entire
// integration once there's a DSN to point it at.
export interface ErrorReport {
  message: string;
  stack?: string;
  source: 'window.onerror' | 'unhandledrejection' | 'react-error-boundary';
  context?: Record<string, unknown>;
}

function reportError(report: ErrorReport) {
  // Replace this body with a real reporter (Sentry.captureException,
  // LogRocket, a custom logging endpoint, etc.) when one is available.
  // Kept as a plain console.error for now so nothing changes behavior-
  // wise today — the value right now is having ONE place to upgrade
  // later, not a new dependency added speculatively.
  console.error(`[${report.source}]`, report.message, report.context ?? '');
}

let installed = false;

/** Call once, near app startup (see App.tsx). Safe to call more than once. */
export function installGlobalErrorReporting() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportError({
      message: event.message,
      stack: event.error?.stack,
      source: 'window.onerror',
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: 'unhandledrejection',
    });
  });
}

/** For ErrorBoundary components to funnel React render errors through the same reporter. */
export function reportReactError(error: Error, context?: Record<string, unknown>) {
  reportError({ message: error.message, stack: error.stack, source: 'react-error-boundary', context });
}
