// Tiny structured JSON logger shared by the Node Lambda handlers.
//
// Emits one JSON object per line so CloudWatch Logs Insights can query on fields
// (e.g. `filter level = "ERROR"`, `stats count() by event`). Dependency-free —
// esbuild bundles it into each handler. `event` is a stable colon-namespaced name
// (e.g. "extract:start"); pass request-specific context as `fields`.
type Fields = Record<string, unknown>;

const FUNCTION = process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'recipator';
const ENV = process.env.DEPLOY_ENV ?? 'unknown';

function emit(level: 'INFO' | 'WARN' | 'ERROR', event: string, fields?: Fields): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    fn: FUNCTION,
    env: ENV,
    event,
    ...fields,
  });
  // ERROR to stderr, everything else to stdout — both land in the function's log group.
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

export const log = {
  info:  (event: string, fields?: Fields) => emit('INFO', event, fields),
  warn:  (event: string, fields?: Fields) => emit('WARN', event, fields),
  error: (event: string, fields?: Fields) => emit('ERROR', event, fields),
};
