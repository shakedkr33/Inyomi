import { Phone } from '@convex-dev/auth/providers/Phone';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';

// The Phone() wrapper only forwards sendVerificationRequest to the top-level
// provider object. generateVerificationToken is placed inside options and is
// never read by the library's token-generation logic (signIn.js reads
// provider.generateVerificationToken directly). We spread Phone() and patch
// generateVerificationToken onto the top-level object so the library finds it.
const generate6DigitOtp = () =>
  Promise.resolve(String(Math.floor(100000 + Math.random() * 900000)));

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...Phone({
        sendVerificationRequest: async ({ identifier: phone, token: code }) => {
          // SMS_PROVIDER_STUB: replace this with Twilio Verify in Phase 2
          // RATE_LIMIT_STUB: add server-side rate limiting in Phase 2
          console.log(`[Auth] OTP for ${phone}: ${code}`);
        },
      }),
      generateVerificationToken: generate6DigitOtp,
    },
  ],
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const now = Date.now();
      // For Phone provider, the identifier is in args.profile.phone (E.164 format)
      const phone = (args.profile as { phone?: string }).phone ?? undefined;

      if (args.existingUserId) {
        await ctx.db.patch(args.existingUserId, {
          phone,
          updatedAt: now,
        });
        return args.existingUserId;
      }

      // New user — insert first, then run phone-based family member matching
      const userId = await ctx.db.insert('users', {
        phone,
        role: 'user',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // FIXED: phone-based family member matching via internalMutation on members table
      // The createOrUpdateUser ctx is scoped to auth tables only and cannot query the
      // app's members table directly. We delegate to an internalMutation that has the
      // full app DataModel and can use the by_phone index for O(1) matching.
      if (phone) {
        await ctx.runMutation(internal.members.matchOnPhone, { userId, phone });
      }

      return userId;
    },
  },
});
