// @evidata/db — M0 MetadataStore schema + pglite-backed Drizzle client (spec 10).
export * from './schema';
export { createMetadataDb } from './client';
export type { MetadataDb, MetadataDbHandle, CreateMetadataDbOptions } from './client';
export { DrizzleMetadataStore, type MetadataStoreOptions } from './store';
