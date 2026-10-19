import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  removeContactEmail,
  removeContactEmails,
} from '../../lib/familyContactPrivacy';

const root = resolve(import.meta.dir, '../..');
const pickerSource = readFileSync(
  resolve(root, 'components/onboarding/AddPersonBottomSheet.tsx'),
  'utf8'
);
const editorSource = readFileSync(
  resolve(root, 'hooks/useFamilyProfileEditor.ts'),
  'utf8'
);

describe('device-contact email minimization', () => {
  it('requests only the contact fields required for name and phone selection', () => {
    expect(pickerSource).toContain('Contacts.Fields.Name');
    expect(pickerSource).toContain('Contacts.Fields.PhoneNumbers');
    expect(pickerSource).not.toContain('Contacts.Fields.Emails');
    expect(pickerSource).not.toMatch(/contact\.emails/);
  });

  it('contact selection payloads contain name, phone and contactId but no email', () => {
    expect(pickerSource).toContain(
      'onContactSelected({ name, phone, contactId })'
    );
    expect(pickerSource).not.toMatch(/onContactSelected\([^)]*email/s);
  });

  it('family profile editing has no contact-email field or forwarding path', () => {
    expect(editorSource).not.toMatch(/email:\s*data\.email/);
    expect(editorSource).not.toMatch(/email:\s*pendingMember\.email/);
    expect(editorSource).not.toMatch(/email:\s*member\.email/);
    expect(editorSource).toContain(
      'removeContactEmails(initialFamilyMembers ?? [])'
    );
  });

  it('removes contact email without changing name, phone or invitation fields', () => {
    const original = {
      id: 'contact-1',
      name: 'Contact Name',
      email: 'contact@example.com',
      phone: '050-123-4567',
      selectedPhoneNumber: '050-123-4567',
      inviteStatus: 'invited',
    };

    expect(removeContactEmail(original)).toEqual({
      id: 'contact-1',
      name: 'Contact Name',
      phone: '050-123-4567',
      selectedPhoneNumber: '050-123-4567',
      inviteStatus: 'invited',
    });
    expect(original.email).toBe('contact@example.com');
  });

  it('supports contacts that never had an email and preserves array ordering', () => {
    const contacts = [
      { id: 'one', name: 'One', phone: '0501111111' },
      { id: 'two', name: 'Two', email: 'two@example.com' },
    ];

    expect(removeContactEmails(contacts)).toEqual([
      { id: 'one', name: 'One', phone: '0501111111' },
      { id: 'two', name: 'Two' },
    ]);
  });
});
