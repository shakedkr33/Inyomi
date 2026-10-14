import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_DELETION_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from '../../config/legalUrls';
import schema from '../../convex/schema';

it('pins Production to the existing deployment while retaining Dev and Preview', () => {
  const eas = JSON.parse(
    readFileSync(new URL('../../eas.json', import.meta.url), 'utf8')
  );
  expect(eas.build.production.env.EXPO_PUBLIC_CONVEX_URL).toBe(
    'https://peaceful-cricket-429.convex.cloud'
  );
  for (const profile of ['development', 'preview']) {
    expect(eas.build[profile].env.EXPO_PUBLIC_CONVEX_URL).toBe(
      'https://sincere-panther-608.convex.cloud'
    );
  }
  expect(eas.build.production.environment).toBe('production');
});
it('retains exactly the optional string-array legacy Production field', () => {
  const tables = JSON.parse(schema.export()).tables;
  expect(
    tables.find((t: { tableName: string }) => t.tableName === 'spaces')
      .documentType.value.primarySources
  ).toEqual({
    optional: true,
    fieldType: { type: 'array', value: { type: 'string' } },
  });
});
it('uses the canonical public legal destinations without environment overrides', () => {
  expect([
    PRIVACY_POLICY_URL,
    TERMS_OF_SERVICE_URL,
    ACCOUNT_DELETION_URL,
  ]).toEqual([
    'https://inyomi.com/privacy',
    'https://inyomi.com/terms',
    'https://inyomi.com/delete-account',
  ]);
});
