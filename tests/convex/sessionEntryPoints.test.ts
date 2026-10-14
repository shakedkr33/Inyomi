import { expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { invoke, privacyFixture } from './helpers/privacyFixture';

// Exercise every exported public query/mutation against a revoked identity.
// No source-string assertions or auth module mocks. Only the two intentional
// unauthenticated previews are exempt. Internal/service handlers are not gated.
const convexDir = new URL('../../convex/', import.meta.url);
const publicPreviews = new Set([
  'shareLinks.ts:getSharePreview',
  'communities.ts:getCommunityByInviteCode',
]);
for (const file of readdirSync(fileURLToPath(convexDir)).filter((f) =>
  f.endsWith('.ts')
)) {
  const module = await import(new URL(file, convexDir).href);
  for (const [name, entry] of Object.entries(module)) {
    if (typeof entry !== 'function') continue;
    const registered = entry as unknown as {
      isPublic?: boolean;
      isQuery?: boolean;
      isMutation?: boolean;
    };
    if (!registered.isPublic || (!registered.isQuery && !registered.isMutation))
      continue;
    const label = `${file}:${name}`;
    if (publicPreviews.has(label)) continue;
    it(`${label} rejects revoked identity before accessing application data`, async () => {
      const f = privacyFixture();
      let identityReads = 0;
      let forbiddenOperation = false;
      f.ctx.auth.getUserIdentity = async () => {
        identityReads++;
        return { subject: 'owner|session' };
      };
      const forbidden = () => {
        forbiddenOperation = true;
        throw new Error('Protected data accessed before session validation');
      };
      f.ctx.db.get = async (id: string) => {
        if (id === 'session') return null;
        return forbidden();
      };
      f.ctx.db.query = forbidden;
      f.ctx.db.insert = forbidden;
      f.ctx.db.patch = forbidden;
      f.ctx.db.delete = forbidden;
      try {
        // Args are deliberately empty: all app access must be after auth.
        // Hosted argument validation may reject earlier, which is also safe.
        await invoke(entry, f.ctx, {});
      } catch {
        // Protected mutations may throw; read endpoints may return null/empty.
      }
      expect(identityReads).toBeGreaterThan(0);
      expect(forbiddenOperation).toBe(false);
    });
  }
}
