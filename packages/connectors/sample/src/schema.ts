/**
 * Sample "Advertising Platform" schema (spec 05 §2.1) and its structural
 * SchemaSnapshot. Two logical areas — usage-like spend (`campaign_spend`) and
 * billing-like `invoices` — so the cross-area reconciliation scenario is
 * meaningful within one source. `invoices.customer_ref` is intentionally a
 * loose reference (not a clean FK) to drive the Unblock Path (spec 05 §4.3).
 */
import type { SchemaSnapshot } from '@evidata/ports';

/** Captured-at is fixed so the snapshot is deterministic for tests/smoke. */
export const SAMPLE_SNAPSHOT_AT = '2026-06-17T00:00:00Z';

export const SAMPLE_DDL = `
CREATE TABLE accounts (
  id           integer PRIMARY KEY,
  name         text NOT NULL,
  status       text NOT NULL,              -- 'active' | 'churned'
  created_at   date NOT NULL,
  contact_email text                       -- marked sensitive in Policy
);

CREATE TABLE campaigns (
  id           integer PRIMARY KEY,
  account_id   integer NOT NULL REFERENCES accounts(id),
  name         text NOT NULL,
  budget       numeric(12,2) NOT NULL
);

CREATE TABLE campaign_spend (
  id           bigint PRIMARY KEY,
  account_id   integer NOT NULL REFERENCES accounts(id),
  campaign_id  integer NOT NULL REFERENCES campaigns(id),
  day          date NOT NULL,
  amount       numeric(12,2) NOT NULL,
  status       text NOT NULL               -- 'posted' | 'void'
);

CREATE TABLE invoices (
  id           integer PRIMARY KEY,
  account_id   integer NOT NULL REFERENCES accounts(id),
  period_month date NOT NULL,
  amount       numeric(12,2) NOT NULL,
  settled_at   date,
  customer_ref text                         -- intentionally NOT a clean FK to accounts
);
`;

export const SAMPLE_SCHEMA_SNAPSHOT: SchemaSnapshot = {
  dataSourceId: 'sample',
  capturedAt: SAMPLE_SNAPSHOT_AT,
  partial: false,
  tables: [
    {
      name: 'accounts',
      comment: 'Customers of the advertising platform.',
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, primaryKey: true },
        { name: 'name', dataType: 'text', nullable: false },
        { name: 'status', dataType: 'text', nullable: false, comment: "'active' | 'churned'" },
        { name: 'created_at', dataType: 'date', nullable: false },
        { name: 'contact_email', dataType: 'text', nullable: true, comment: 'sensitive' },
      ],
    },
    {
      name: 'campaigns',
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, primaryKey: true },
        {
          name: 'account_id',
          dataType: 'integer',
          nullable: false,
          references: { table: 'accounts', column: 'id' },
        },
        { name: 'name', dataType: 'text', nullable: false },
        { name: 'budget', dataType: 'numeric', nullable: false },
      ],
    },
    {
      name: 'campaign_spend',
      comment: 'Daily spend per campaign (usage-like area).',
      columns: [
        { name: 'id', dataType: 'bigint', nullable: false, primaryKey: true },
        {
          name: 'account_id',
          dataType: 'integer',
          nullable: false,
          references: { table: 'accounts', column: 'id' },
        },
        {
          name: 'campaign_id',
          dataType: 'integer',
          nullable: false,
          references: { table: 'campaigns', column: 'id' },
        },
        { name: 'day', dataType: 'date', nullable: false },
        { name: 'amount', dataType: 'numeric', nullable: false },
        { name: 'status', dataType: 'text', nullable: false, comment: "'posted' | 'void'" },
      ],
    },
    {
      name: 'invoices',
      comment: 'Monthly invoices (billing-like area). customer_ref is a loose reference.',
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, primaryKey: true },
        {
          name: 'account_id',
          dataType: 'integer',
          nullable: false,
          references: { table: 'accounts', column: 'id' },
        },
        { name: 'period_month', dataType: 'date', nullable: false },
        { name: 'amount', dataType: 'numeric', nullable: false },
        { name: 'settled_at', dataType: 'date', nullable: true },
        {
          name: 'customer_ref',
          dataType: 'text',
          nullable: true,
          comment: 'loose ref; not a clean FK',
        },
      ],
    },
  ],
};
