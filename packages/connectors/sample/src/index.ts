// @evidata/connector-sample — executable Sample Data Source (spec 05).
export {
  createSampleConnector,
  sampleSafetyContext,
  sampleVerifiedContext,
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_ALLOWED_TABLES,
  SAMPLE_SENSITIVE_COLUMNS,
  SAMPLE_POLICY,
  SAMPLE_CONTEXT,
} from './sample-connector';
export type {
  SampleConnectorHandle,
  SampleDataSourceContext,
  SampleGlossaryTerm,
  SampleEntityMapping,
} from './sample-connector';
export { PgliteQueryExecutor } from './executor';
export { SAMPLE_SCHEMA_SNAPSHOT, SAMPLE_SNAPSHOT_AT, SAMPLE_DDL } from './schema';
export {
  seedSample,
  SEED_COUNTS,
  ACME_ACCOUNT_ID,
  ACME_MAY_SPEND,
  ACME_JUNE_SPEND,
  ACME_MOM_PCT,
  ACME_SUMMER_SALE_JUNE,
} from './seed';
