import { describe, expect, it } from 'vitest';
import { canDataSource } from './authz';

describe('Data Source capability matrix (M2-B1a, #121)', () => {
  it('owner has every capability', () => {
    for (const cap of [
      'author',
      'publish',
      'view_draft',
      'query',
      'manage_members',
      'transfer_or_delete',
    ] as const) {
      expect(canDataSource('owner', cap)).toBe(true);
    }
  });

  it('admin authors/publishes/manages but cannot transfer or delete', () => {
    expect(canDataSource('admin', 'author')).toBe(true);
    expect(canDataSource('admin', 'publish')).toBe(true);
    expect(canDataSource('admin', 'view_draft')).toBe(true);
    expect(canDataSource('admin', 'query')).toBe(true);
    expect(canDataSource('admin', 'manage_members')).toBe(true);
    expect(canDataSource('admin', 'transfer_or_delete')).toBe(false);
  });

  it('querier can only query — never authors, sees drafts, or manages', () => {
    expect(canDataSource('querier', 'query')).toBe(true);
    expect(canDataSource('querier', 'author')).toBe(false);
    expect(canDataSource('querier', 'view_draft')).toBe(false);
    expect(canDataSource('querier', 'publish')).toBe(false);
    expect(canDataSource('querier', 'manage_members')).toBe(false);
    expect(canDataSource('querier', 'transfer_or_delete')).toBe(false);
  });

  it('no membership (null) → no capability', () => {
    expect(canDataSource(null, 'query')).toBe(false);
    expect(canDataSource(undefined, 'author')).toBe(false);
  });
});
