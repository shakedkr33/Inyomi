import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials';
import { Phone } from '@convex-dev/auth/providers/Phone';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';
import { query } from './_generated/server';
import { getAuthUserId } from './sessionAuth';

const generate6DigitOtp = () =>
  Promise.resolve(String(Math.floor(100000 + Math.random() * 900000)));

function getTwilioEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !verifyServiceSid) {
    throw new Error('Missing Twilio environment variables');
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    verifyServiceSid,
  };
}

function getAppleReviewEnv() {
  const phone = process.env.APP_REVIEW_PHONE;
  const otp = process.env.APP_REVIEW_OTP;

  if (!phone || !otp) {
    return null;
  }

  return { phone, otp };
}

function basicAuth(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function sendOtpWithTwilio(phone: string, code: string) {
  const reviewEnv = getAppleReviewEnv();

  if (reviewEnv && phone === reviewEnv.phone) {
    console.log(
      '[Auth] Apple Review demo phone detected. Skipping Twilio SMS.'
    );
    return;
  }

  const { apiKeySid, apiKeySecret, verifyServiceSid } = getTwilioEnv();

  const body = new URLSearchParams({
    To: phone,
    Channel: 'sms',
    CustomCode: code,
  });

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuth(apiKeySid, apiKeySecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Auth] Twilio OTP send failed:', errorText);
    throw new Error('Failed to send OTP via Twilio');
  }
}

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    ConvexCredentials({
      id: 'apple-review',
      authorize: async (credentials, ctx) => {
        const reviewEnv = getAppleReviewEnv();

        if (!reviewEnv) {
          return null;
        }

        const phone =
          typeof credentials.phone === 'string' ? credentials.phone : null;
        const code =
          typeof credentials.code === 'string' ? credentials.code : null;

        if (phone === null || code === null) {
          return null;
        }

        if (phone !== reviewEnv.phone || code !== reviewEnv.otp) {
          return null;
        }

        const userId = await ctx.runMutation(
          internal.appleReviewAuth.getOrCreateAppleReviewUser,
          { phone }
        );

        return { userId };
      },
    }),
    {
      ...Phone({
        sendVerificationRequest: async ({ identifier: phone, token: code }) => {
          await sendOtpWithTwilio(phone, code);
        },
      }),
      generateVerificationToken: generate6DigitOtp,
    },
  ],
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000,
  },
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const now = Date.now();
      const phone = (args.profile as { phone?: string }).phone ?? undefined;

      if (args.existingUserId) {
        await ctx.db.patch(args.existingUserId, {
          phone,
          updatedAt: now,
        });
        return args.existingUserId;
      }

      const userId = await ctx.db.insert('users', {
        phone,
        role: 'user',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      if (phone) {
        await ctx.runMutation(internal.members.matchOnPhone, { userId, phone });
      }

      return userId;
    },
  },
});

// Preserve the public endpoint, but report live application authentication,
// rather than only whether Convex accepted the JWT signature.
export const isAuthenticated = query({
  args: {},
  handler: async (ctx) => (await getAuthUserId(ctx)) !== null,
});
