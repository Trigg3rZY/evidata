import { describe, expect, it } from 'vitest';
import {
  canUseDefaultRegisteredModel,
  canUseFixtureProvider,
  noRegisteredModelMessage,
  unboundInvestigationModelMessage,
} from './ask-route';

describe('ask-route model fallback policy (#170)', () => {
  it('allows fixture only for anonymous Sample asks', () => {
    expect(canUseFixtureProvider({ dataSourceId: 'sample' })).toBe(true);
    expect(canUseFixtureProvider({ dataSourceId: 'sample', userId: 'u1' })).toBe(false);
    expect(canUseFixtureProvider({ dataSourceId: 'real-ds' })).toBe(false);
  });

  it('uses the registered default only for new authenticated conversations', () => {
    expect(canUseDefaultRegisteredModel({ userId: 'u1' })).toBe(true);
    expect(canUseDefaultRegisteredModel({ userId: 'u1', investigationId: 'inv-1' })).toBe(false);
    expect(canUseDefaultRegisteredModel({})).toBe(false);
  });

  it('surfaces a clear no-model message', () => {
    expect(noRegisteredModelMessage('en')).toContain('Register a model');
    expect(noRegisteredModelMessage('zh-CN')).toContain('注册一个模型');
    expect(unboundInvestigationModelMessage('en')).toContain('not bound');
    expect(unboundInvestigationModelMessage('zh-CN')).toContain('没有绑定');
  });
});
