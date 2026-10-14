import { describe, expect, it } from 'bun:test';
import { Phone } from '@convex-dev/auth/providers/Phone';
import { createVerificationCodeImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/mutations/createVerificationCode';
import { verifyCodeAndSignInImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/mutations/verifyCodeAndSignIn';
import { signInImpl } from '../../node_modules/@convex-dev/auth/src/server/implementation/signIn';
import { privacyFixture } from './helpers/privacyFixture';

// Diagnostic tests, not a deployed fix. Real installed Auth orchestration and
// mutations, synthetic DB and delivery ONLY. No Twilio/client/device execution.
// No env loading, real credentials, JWT generation or SMS/network requests.
const PHONE = '+15555550101';
const FIRST = '182736';
const SECOND = '493827';
function fixture() {
  const f = privacyFixture(null);
  f.tables.authAccounts = [
    {
      _id: 'account',
      userId: 'owner',
      provider: 'phone',
      providerAccountId: PHONE,
    },
  ];
  f.tables.authSessions = [];
  f.tables.authRefreshTokens = [];
  const delivered: string[] = [];
  let next = FIRST;
  let delivery: (code: string) => Promise<void> = async (code) => {
    delivered.push(code);
  };
  let generate: () => Promise<string> = async () => next;
  const provider = {
    ...Phone({ sendVerificationRequest: async ({ token }) => delivery(token) }),
    generateVerificationToken: () => generate(),
  };
  const config = {
    providers: [provider],
    callbacks: {
      createOrUpdateUser: async () => 'owner',
      redirect: async () => 'https://synthetic.invalid',
    },
  };
  const getProvider = (id: string) => {
    if (id !== 'phone') throw new Error('Unexpected synthetic provider');
    return provider;
  };
  const action = {
    auth: { ...f.ctx.auth, config },
    runMutation: async (
      _name: unknown,
      { args }: { args: Record<string, unknown> }
    ) => {
      // Restore writes on thrown mutation errors, but preserve writes when a
      // mutation returns null and the OUTER action subsequently throws.
      const before = structuredClone(f.tables);
      try {
        if (args.type === 'createVerificationCode') {
          return await createVerificationCodeImpl(
            f.ctx as unknown as Parameters<
              typeof createVerificationCodeImpl
            >[0],
            args as unknown as Parameters<typeof createVerificationCodeImpl>[1],
            getProvider as Parameters<typeof createVerificationCodeImpl>[2],
            config as unknown as Parameters<
              typeof createVerificationCodeImpl
            >[3]
          );
        }
        if (args.type === 'verifyCodeAndSignIn') {
          return await verifyCodeAndSignInImpl(
            f.ctx as unknown as Parameters<typeof verifyCodeAndSignInImpl>[0],
            args as unknown as Parameters<typeof verifyCodeAndSignInImpl>[1],
            getProvider as Parameters<typeof verifyCodeAndSignInImpl>[2],
            config as unknown as Parameters<typeof verifyCodeAndSignInImpl>[3]
          );
        }
        throw new Error('Unexpected Auth mutation');
      } catch (error) {
        for (const key of Object.keys(f.tables)) delete f.tables[key];
        Object.assign(f.tables, before);
        throw error;
      }
    },
  };
  const run = (params: Record<string, string>) =>
    signInImpl(
      action as unknown as Parameters<typeof signInImpl>[0],
      provider,
      {
        params: {
          phone: PHONE,
          redirectTo: 'https://synthetic.invalid',
          ...params,
        },
      },
      { generateTokens: false, allowExtraProviders: false }
    );
  return {
    ...f,
    delivered,
    send: () => run({}),
    verify: (code: string, phone = PHONE) => run({ code, phone }),
    next: (code: string) => {
      next = code;
    },
    delivery: (fn: typeof delivery) => {
      delivery = fn;
    },
    generate: (fn: typeof generate) => {
      generate = fn;
    },
  };
}

describe('installed Phone OTP lifecycle — diagnostic evidence', () => {
  it('initial request stores one hashed challenge and verification consumes it', async () => {
    const f = fixture();
    expect(await f.send()).toEqual({ kind: 'started', started: true });
    expect(f.tables.authVerificationCodes).toHaveLength(1);
    expect(f.tables.authVerificationCodes[0].code).not.toBe(FIRST);
    expect(await f.verify(FIRST)).toMatchObject({
      kind: 'signedIn',
      signedIn: { userId: 'owner' },
    });
    expect(f.tables.authVerificationCodes).toHaveLength(0);
    await expect(f.verify(FIRST)).rejects.toThrow('Could not verify code');
  });
  for (const reversed of [false, true]) {
    it(`latest persisted challenge wins regardless of SMS arrival order: reversed=${reversed}`, async () => {
      const f = fixture();
      const queued: string[] = [];
      f.delivery(async (code) => {
        queued.push(code);
      });
      await f.send();
      f.next(SECOND);
      await f.send();
      const arrival = reversed ? [...queued].reverse() : queued;
      expect(arrival).toHaveLength(2);
      expect(new Set(arrival).size).toBe(2);
      expect(f.tables.authVerificationCodes).toHaveLength(1);
      // Delivery order does not modify the persisted verification state.
      await expect(f.verify(FIRST)).rejects.toThrow('Could not verify code');
      expect(await f.verify(SECOND)).toMatchObject({ kind: 'signedIn' });
    });
  }
  it('concurrent sends can persist the earlier request last; not proof of the device incident', async () => {
    const f = fixture();
    let release!: (code: string) => void;
    let count = 0;
    f.generate(() =>
      ++count === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(SECOND)
    );
    const earlier = f.send();
    await f.send();
    release(FIRST);
    await earlier;
    expect(f.tables.authVerificationCodes).toHaveLength(1);
    await expect(f.verify(SECOND)).rejects.toThrow('Could not verify code');
    expect(await f.verify(FIRST)).toMatchObject({ kind: 'signedIn' });
  });
  for (const failure of ['provider rejection', 'network interruption']) {
    it(`resend ${failure} occurs AFTER replacing the previous challenge`, async () => {
      const f = fixture();
      await f.send();
      f.next(SECOND);
      f.delivery(async () => {
        throw new Error(failure);
      });
      await expect(f.send()).rejects.toThrow(failure);
      expect(f.delivered).toHaveLength(1);
      await expect(f.verify(FIRST)).rejects.toThrow('Could not verify code');
      // Synthetic knowledge only: code was stored even though delivery failed.
      expect(await f.verify(SECOND)).toMatchObject({ kind: 'signedIn' });
    });
  }
  it('delivery adapter retaining an older code mismatches Auth; provider assumption only', async () => {
    const f = fixture();
    await f.send();
    f.next(SECOND);
    f.delivery(async () => {
      f.delivered.push(FIRST);
    });
    await f.send();
    await expect(f.verify(f.delivered[1])).rejects.toThrow(
      'Could not verify code'
    );
    expect(await f.verify(SECOND)).toMatchObject({ kind: 'signedIn' });
  });
  it('invalid entry does not prevent a later correct entry', async () => {
    const f = fixture();
    await f.send();
    await expect(f.verify(SECOND)).rejects.toThrow('Could not verify code');
    expect(await f.verify(FIRST)).toMatchObject({ kind: 'signedIn' });
  });
  it('expiry rejects and consumes the expired record', async () => {
    const f = fixture();
    await f.send();
    f.tables.authVerificationCodes[0].expirationTime = Date.now() - 1;
    await expect(f.verify(FIRST)).rejects.toThrow('Could not verify code');
    expect(f.tables.authVerificationCodes).toHaveLength(0);
  });
  it('a code for one phone cannot sign in another phone', async () => {
    const f = fixture();
    await f.send();
    await expect(f.verify(FIRST, '+15555550102')).rejects.toThrow('matching');
    expect(f.tables.authSessions).toHaveLength(0);
    expect(await f.verify(FIRST)).toMatchObject({ kind: 'signedIn' });
  });
  it('server failed-verification rate limit remains enforced', async () => {
    const f = fixture();
    await f.send();
    f.tables.authRateLimits = [
      {
        _id: 'limit',
        identifier: PHONE,
        attemptsLeft: 0,
        lastAttemptTime: Date.now(),
      },
    ];
    await expect(f.verify(FIRST)).rejects.toThrow('Could not verify code');
    expect(f.tables.authSessions).toHaveLength(0);
    expect(f.tables.authVerificationCodes).toHaveLength(1);
  });
});
