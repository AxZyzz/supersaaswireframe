import { bullConnection } from './queue.module';

describe('bullConnection', () => {
  it('local redis:// stays plain', () => {
    expect(bullConnection('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
    });
  });

  it('managed rediss:// keeps the ACL user, password and turns on TLS', () => {
    expect(
      bullConnection('rediss://default:p%40ss@eu1-x.upstash.io:6380'),
    ).toEqual({
      host: 'eu1-x.upstash.io',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      tls: { servername: 'eu1-x.upstash.io' },
    });
  });

  it('keeps a database index', () => {
    expect(bullConnection('redis://h:6379/2')).toMatchObject({ db: 2 });
  });
});
