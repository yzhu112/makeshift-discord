export class CallTelemetry {
  id = 'test-attempt';
  event() {}
  attach() {}
  finish() { window.callTest.telemetryFinished++; }
}
export const errorDetails = () => ({});
export const resumePendingDiagnostics = () => () => {};
