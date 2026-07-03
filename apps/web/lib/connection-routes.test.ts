import { describe, expect, it } from 'vitest';
import { BadRequestError, parseConnectionInput, parseConnectionPatch } from './connection-routes';

const valid = {
  name: 'Warehouse',
  host: 'localhost',
  port: '5432',
  database: 'app',
  sslMode: 'disable',
  user: 'reader',
  password: 'pw',
};

describe('connection route validation', () => {
  it('parses a full connection input', () => {
    expect(parseConnectionInput({ ...valid, name: ' Warehouse ' })).toMatchObject({
      name: 'Warehouse',
      port: 5432,
      sslMode: 'disable',
    });
  });

  it('rejects invalid ports and ssl modes', () => {
    expect(() => parseConnectionInput({ ...valid, port: 0 })).toThrow(BadRequestError);
    expect(() => parseConnectionInput({ ...valid, sslMode: 'nope' })).toThrow(BadRequestError);
  });

  it('omits blank edit secrets so saved credentials can be reused', () => {
    expect(parseConnectionPatch({ host: 'db.local', user: ' ', password: '' })).toEqual({
      host: 'db.local',
    });
  });

  it('rejects malformed edit secrets', () => {
    expect(() => parseConnectionPatch({ host: 'db.local', password: 123 })).toThrow(
      BadRequestError,
    );
  });
});
