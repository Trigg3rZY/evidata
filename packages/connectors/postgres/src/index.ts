// @evidata/connector-postgres — real read-only/cursor-bounded/cancellable execution
// behind the Connector/QueryExecutor ports (spec 08 §2).
export { PostgresConnector } from './connector';
export { PostgresExecutor } from './executor';
export { sslFor } from './types';
export type { PostgresConnectionParams } from './types';
