/**
 * PostgresConnector (spec 08 §2) — a real database endpoint behind the M0 `Connector`
 * port, so AgentRunner and the rest of core never change. The schema snapshot is
 * served from a stored snapshot (captured app-side by the IntrospectionService, M1.4);
 * the executor is the only place plaintext credentials and real rows exist.
 */
import type { Connector, QueryExecutor, SchemaSnapshot } from '@evidata/ports';
import { PostgresExecutor } from './executor';
import type { PostgresConnectionParams } from './types';

export class PostgresConnector implements Connector {
  readonly kind = 'postgres';
  private readonly executor: PostgresExecutor;

  constructor(
    readonly id: string,
    params: PostgresConnectionParams,
    private readonly snapshot: SchemaSnapshot,
  ) {
    this.executor = new PostgresExecutor(params);
  }

  getSchemaSnapshot(): Promise<SchemaSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  getExecutor(): QueryExecutor {
    return this.executor;
  }

  /** Release the pooled connections (Connection removed/disabled). */
  close(): Promise<void> {
    return this.executor.close();
  }
}
