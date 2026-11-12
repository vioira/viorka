// Explicit browser WS operation names share the REST operation IDs.
const operations: [string, RegExp, string][] = [
  ['GET', /^\/nodes\/([^/]+)$/, 'getNode'],
  ['DELETE', /^\/nodes\/([^/]+)$/, 'deleteNode'],
  ['POST', /^\/nodes\/([^/]+)\/revoke$/, 'revokeNode'],
  ['POST', /^\/nodes\/([^/]+)\/reenrollment$/, 'resetEnrollment'],
  ['POST', /^\/nodes\/([^/]+)\/enrollment-token$/, 'renewEnrollment'],
  ['DELETE', /^\/nodes\/([^/]+)\/enrollment-token$/, 'revokeEnrollment'],
  ['GET', /^\/nodes\/([^/]+)\/tasks$/, 'listNodeTasks'],
  ['POST', /^\/nodes\/([^/]+)\/tasks$/, 'createTask'],
  ['GET', /^\/tasks\/(?!summary$)([^/]+)$/, 'getTask'],
  ['GET', /^\/engine-catalog$/, 'engineCatalog'],
  ['GET', /^\/nodes\/([^/]+)\/engines$/, 'listEngines'],
  ['POST', /^\/nodes\/([^/]+)\/engines$/, 'installEngine'],
  ['GET', /^\/engines\/([^/]+)$/, 'getEngine'],
  ['PUT', /^\/engines\/([^/]+)\/draft$/, 'saveEngineDraft'],
  ['POST', /^\/engines\/([^/]+)\/actions$/, 'engineAction'],
  ['POST', /^\/engines\/([^/]+)\/connections$/, 'engineConnections'],
  ['POST', /^\/engines\/([^/]+)\/sync$/, 'retryEngineSync'],
  ['PUT', /^\/nodes\/([^/]+)\/engine-access$/, 'grantEngineAccess'],
  ['GET', /^\/nodes\/([^/]+)\/telemetry-settings$/, 'getTelemetrySettings'],
  ['GET', /^\/nodes\/([^/]+)\/telemetry-settings\/status$/, 'getTelemetrySettingsStatus'],
  ['PUT', /^\/nodes\/([^/]+)\/telemetry-settings$/, 'saveTelemetrySettings'],
  ['POST', /^\/nodes\/([^/]+)\/traffic-calibrations$/, 'calibrateTraffic'],
  ['GET', /^\/nodes\/([^/]+)\/metrics\/history$/, 'nodeMetricHistory'],
  ['GET', /^\/protocol-presets$/, 'listProtocolPresets'],
  ['GET', /^\/protocol-presets\/([^/]+)$/, 'getProtocolPreset'],
  ['GET', /^\/outbounds$/, 'listOutbounds'],
];
export function browserOperation(method: string, path: string) {
  for (const [verb, pattern, operation] of operations) {
    const match = verb === method && pattern.exec(path);
    if (match) return { method: operation, id: match[1] };
  }
}
