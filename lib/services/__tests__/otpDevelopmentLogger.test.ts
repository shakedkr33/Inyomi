import { expect, it } from 'bun:test';
import { RequestManager } from '../../../node_modules/convex/src/browser/sync/request_manager';
import { createOtpDevelopmentLogger } from '../otpDevelopmentLogger';
import { createOtpRequestCoordinator } from '../otpRequestCoordinator';

const expected =
  '[CONVEX A(auth:signIn)] Uncaught Error: Could not verify code';
function harness() {
  const coordinator = createOtpRequestCoordinator();
  const messages: { level: string; args: unknown[] }[] = [];
  const output = Object.fromEntries(
    ['log', 'warn', 'error'].map((level) => [
      level,
      (...args: unknown[]) => messages.push({ level, args }),
    ])
  ) as Pick<Console, 'log' | 'warn' | 'error'>;
  const logger = createOtpDevelopmentLogger(
    () => coordinator.operation() === 'verify',
    output
  );
  return { coordinator, logger, messages };
}
it('installed SDK logs a rejection before delivery to the caller; expected OTP keeps a diagnostic at info level', async () => {
  const h = harness();
  const finish = h.coordinator.begin('+15555550101', 'verify');
  const manager = new RequestManager(h.logger, () => {});
  const pending = manager.request(
    { type: 'Action', requestId: 1, udfPath: 'auth:signIn', args: [] },
    true
  );
  let delivered = false;
  const handled = pending.then((result) => {
    delivered = true;
    expect(result.success).toBe(false);
    finish?.(false);
  });
  manager.onResponse({
    type: 'ActionResponse',
    requestId: 1,
    success: false,
    result:
      'Uncaught Error: Could not verify code\n    at synthetic (auth.ts:1:1)\n',
    logLines: [],
  });
  expect(delivered).toBe(false);
  expect(h.messages.map((x) => x.level)).toEqual(['log']);
  expect(h.messages[0].args).toEqual([
    '[InYomi auth] OTP verification rejected; retry is available.',
  ]);
  await handled;
  expect(h.coordinator.snapshot()).toBe(false);
});
it('expected request envelope with a request ID is classified narrowly', () => {
  const h = harness();
  h.coordinator.begin('+15555550101', 'verify');
  h.logger.error(
    '[CONVEX A(auth:signIn)] [Request ID: synthetic-123] Server Error\nUncaught Error: Could not verify code\n    at synthetic (auth.ts:1:1)'
  );
  expect(h.messages[0].level).toBe('log');
});
for (const message of [
  '[CONVEX A(auth:signIn)] Uncaught Error: Invalid API key',
  '[CONVEX A(auth:signIn)] Uncaught Error: Connection lost',
  '[CONVEX A(auth:signIn)] Uncaught Error: Too many failed attempts to verify code',
  '[CONVEX A(auth:signIn)] Uncaught Error: Could not verify code: database unavailable',
  `${expected}\nUncaught Error: unrelated server failure`,
  '[CONVEX A(other:action)] Uncaught Error: Could not verify code',
  '[CONVEX M(auth:signIn)] Uncaught Error: Could not verify code',
  '[CONVEX FATAL ERROR] Could not verify code',
]) {
  it(`preserves error diagnostics: ${message.split('\n')[0]}`, () => {
    const h = harness();
    h.coordinator.begin('+15555550101', 'verify');
    h.logger.error(message);
    expect(h.messages).toEqual([{ level: 'error', args: [message] }]);
  });
}
it('the exact rejection outside verification or during send remains an error', () => {
  const h = harness();
  h.logger.error(expected);
  h.coordinator.begin('+15555550101', 'send');
  h.logger.error(expected);
  expect(h.messages.map((x) => x.level)).toEqual(['error', 'error']);
});
it('multiple arguments, warnings and informational logs are forwarded unchanged', () => {
  const h = harness();
  h.coordinator.begin('+15555550101', 'verify');
  h.logger.error(expected, 'additional unexpected detail');
  h.logger.warn('security warning');
  h.logger.log('ordinary log');
  expect(h.messages).toEqual([
    { level: 'error', args: [expected, 'additional unexpected detail'] },
    { level: 'warn', args: ['security warning'] },
    { level: 'log', args: ['ordinary log'] },
  ]);
});
