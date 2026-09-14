import { useQuery } from 'convex/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import type { SelectedContactData } from '@/components/onboarding/AddPersonBottomSheet';
import { AddPersonBottomSheet } from '@/components/onboarding/AddPersonBottomSheet';
import { UpgradeModal, type UpgradeReason } from '@/components/UpgradeModal';
import { api } from '@/convex/_generated/api';
import { useEffectiveAccess } from '@/hooks/useEffectiveAccess';
import {
  loadPersistedBirthdays,
  persistBirthdays,
  purgeLegacyGlobalBirthdayStorage,
} from '@/lib/birthdayStorage';
import type { Birthday } from '@/lib/types/birthday';
import {
  ensureContactsAccess,
  presentContactsAccessDeniedAlert,
} from '@/lib/utils/contactsPermission';
import { BirthdayAddChoiceSheet } from './BirthdayAddChoiceSheet';
import { BirthdayCardSheet } from './BirthdayCardSheet';
import { BirthdayEditSheet } from './BirthdayEditSheet';

/** Phone number used by the Apple App Review demo account. */
const APPLE_REVIEW_PHONE = '+972510000000';

interface BirthdaySheetsContextValue {
  openBirthdayCard: (birthday: Birthday) => void;
  openBirthdayEdit: (birthday?: Birthday) => void;
  openBirthdayCreate: () => void;
  openBirthdayAddChoice: () => void;
  closeAll: () => void;
  deleteBirthday: (id: string) => void;
  birthdays: Birthday[];
  findBirthdayByName: (name: string) => Birthday | undefined;
}

const BirthdaySheetsContext = createContext<BirthdaySheetsContextValue | null>(
  null
);

export function useBirthdaySheets(): BirthdaySheetsContextValue {
  const context = useContext(BirthdaySheetsContext);
  if (!context) {
    throw new Error(
      'useBirthdaySheets must be used within BirthdaySheetsProvider'
    );
  }
  return context;
}

// SEED_BIRTHDAYS removed: first-launch empty list is now the correct behaviour.
// Showing demo data to real users was a regression — removed 2026-06-28.

interface ProviderProps {
  children: ReactNode;
}

export function BirthdaySheetsProvider({
  children,
}: ProviderProps): React.JSX.Element {
  const { isExpiredFree } = useEffectiveAccess();

  // Read current user to detect the Apple Review demo account.
  // Returns undefined while loading, null if unauthenticated, or the user doc.
  const currentUser = useQuery(api.users.getCurrentUser);

  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const birthdaysRef = useRef<Birthday[]>([]);
  // SECURITY: identifies which authenticated user's data is currently loaded
  // into memory. null = signed out / not yet resolved. This is the single
  // source of truth used to (a) detect identity changes so the previous
  // user's birthdays are cleared immediately, and (b) guard against a slow
  // load for a previous user resolving after a new user became current.
  const loadedUserIdRef = useRef<string | null>(null);
  const [selectedBirthday, setSelectedBirthday] = useState<Birthday | null>(
    null
  );
  const [cardSheetVisible, setCardSheetVisible] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [addChoiceVisible, setAddChoiceVisible] = useState(false);
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason>('personal');

  // Guard: prevents acting after unmount and blocks double-tap from firing two
  // concurrent permission requests.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [isContactsIntentPending, setIsContactsIntentPending] = useState(false);

  const handleContactsAccessIntent = async (): Promise<void> => {
    const { granted, canAskAgain } = await ensureContactsAccess();
    setIsContactsIntentPending(false);
    if (!isMountedRef.current) return;
    if (granted) {
      setContactPickerVisible(true);
    } else {
      presentContactsAccessDeniedAlert(canAskAgain);
    }
  };

  useEffect(() => {
    birthdaysRef.current = birthdays;
  }, [birthdays]);

  const commitBirthdays = useCallback(
    async (next: Birthday[]): Promise<void> => {
      // SECURITY: capture the active user id synchronously — persistBirthdays
      // always writes to THIS id's scoped key, even if the authenticated user
      // changes later while the write is in flight. This ensures a delayed
      // write from a previous user can never land in a new user's storage.
      const activeUserId = loadedUserIdRef.current;
      if (!activeUserId) {
        // No authenticated user loaded — nothing safe to persist to.
        // (Sheets that call this should not be reachable in this state.)
        return;
      }

      birthdaysRef.current = next;
      setBirthdays(next);
      try {
        await persistBirthdays(activeUserId, next);
      } catch (error) {
        if (__DEV__) {
          console.error('[Birthdays] Failed to persist birthdays', error);
        }
      }
    },
    []
  );

  // One-time, user-independent cleanup of the old global (unscoped) key.
  // Runs once per mount; never reads the legacy key's contents into any
  // account — see purgeLegacyGlobalBirthdayStorage's doc comment.
  const hasPurgedLegacyRef = useRef(false);
  useEffect(() => {
    if (hasPurgedLegacyRef.current) return;
    hasPurgedLegacyRef.current = true;
    void purgeLegacyGlobalBirthdayStorage();
  }, []);

  // SECURITY: this effect is the sole place birthday state is loaded, and it
  // re-runs on every authenticated-identity change (A → B, B → signed out,
  // signed out → A, etc.) — not just once per mount. On every identity
  // change it clears in-memory state IMMEDIATELY (synchronously, before any
  // async storage read starts) so there is no render frame where a new
  // user could see the previous user's birthdays. The async load that
  // follows is guarded by loadedUserIdRef so a slow read for a since-
  // replaced identity can never overwrite the current user's state.
  useEffect(() => {
    // currentUser is undefined while the Convex identity query is in-flight.
    // Defer until identity is resolved.
    if (currentUser === undefined) return;

    const nextUserId = currentUser?._id ? String(currentUser._id) : null;
    const previousUserId = loadedUserIdRef.current;

    // No actual identity change (e.g. an unrelated profile field refresh
    // producing a new currentUser object reference) — nothing to do.
    if (nextUserId === previousUserId) return;

    // Identity changed — clear the previous user's birthdays from memory
    // immediately, before touching storage for the next identity.
    loadedUserIdRef.current = nextUserId;
    birthdaysRef.current = [];
    setBirthdays([]);

    if (nextUserId === null) {
      // Signed out — nothing to load. The previous user's persisted,
      // scoped data is left untouched on disk (never deleted on sign-out).
      return;
    }

    // Apple Review demo account: always show empty birthdays, never read or
    // write AsyncStorage for this identity — no personal data leaks.
    if (currentUser?.phone === APPLE_REVIEW_PHONE) {
      return;
    }

    // Capture the user id this load is FOR. If the authenticated identity
    // changes again before this resolves, loadedUserIdRef will no longer
    // equal requestUserId, and the stale result below is discarded instead
    // of overwriting the new user's state (prevents the async-race leak).
    const requestUserId = nextUserId;
    const load = async (): Promise<void> => {
      try {
        const saved = await loadPersistedBirthdays(requestUserId);
        if (loadedUserIdRef.current !== requestUserId) return;

        if (saved !== null) {
          if (__DEV__) {
            console.log(
              `[Birthdays] source=AsyncStorage count=${saved.length}`
            );
          }
          birthdaysRef.current = saved;
          setBirthdays(saved);
          return;
        }

        // No saved data yet for this user (fresh account / fresh install).
        if (__DEV__) {
          console.log('[Birthdays] source=empty (no saved data found)');
        }
        birthdaysRef.current = [];
        setBirthdays([]);
      } catch (error) {
        if (loadedUserIdRef.current !== requestUserId) return;
        if (__DEV__) {
          console.error('[Birthdays] Failed to load birthdays', error);
          console.log('[Birthdays] source=error (storage read failed)');
        }
        birthdaysRef.current = [];
        setBirthdays([]);
      }
    };

    void load();
  }, [currentUser]);

  const openBirthdayCard = (birthday: Birthday): void => {
    setSelectedBirthday(birthday);
    setCardSheetVisible(true);
  };

  const openBirthdayEdit = (birthday?: Birthday): void => {
    if (isExpiredFree) {
      setUpgradeReason('personal');
      setUpgradeModalVisible(true);
      return;
    }
    setSelectedBirthday(birthday ?? null);
    setEditSheetVisible(true);
  };

  const openBirthdayCreate = (): void => {
    if (isExpiredFree) {
      setUpgradeReason('personal');
      setUpgradeModalVisible(true);
      return;
    }
    setSelectedBirthday(null);
    setEditSheetVisible(true);
  };

  const openBirthdayAddChoice = (): void => {
    if (isExpiredFree) {
      setUpgradeReason('personal');
      setUpgradeModalVisible(true);
      return;
    }
    setAddChoiceVisible(true);
  };

  const closeAll = (): void => {
    setCardSheetVisible(false);
    setEditSheetVisible(false);
    setTimeout(() => setSelectedBirthday(null), 300);
  };

  const handleEdit = (): void => {
    if (isExpiredFree) {
      setCardSheetVisible(false);
      setUpgradeReason('personal');
      setUpgradeModalVisible(true);
      return;
    }
    setCardSheetVisible(false);
    setTimeout(() => setEditSheetVisible(true), 300);
  };

  const handleSave = (data: Partial<Birthday>): void => {
    const current = birthdaysRef.current;
    const next =
      data.id && data.id !== ''
        ? current.map((b) =>
            b.id === data.id ? { ...b, ...data, updatedAt: Date.now() } : b
          )
        : [
            ...current,
            {
              id: Date.now().toString(),
              name: data.name ?? '',
              day: data.day ?? 1,
              month: data.month ?? 1,
              year: data.year ?? null,
              photoUri: data.photoUri ?? null,
              contactId: data.contactId ?? null,
              source: data.source ?? 'manual',
              phoneNumber: data.phoneNumber ?? null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ];

    void (async () => {
      await commitBirthdays(next);
      closeAll();
    })();
  };

  const deleteBirthday = (id: string): void => {
    const next = birthdaysRef.current.filter((b) => b.id !== id);

    void (async () => {
      await commitBirthdays(next);
      if (selectedBirthday?.id === id) {
        closeAll();
      }
    })();
  };

  const handleDelete = (): void => {
    if (selectedBirthday?.id) {
      deleteBirthday(selectedBirthday.id);
    }
  };

  const handleContactSelected = (data: SelectedContactData): void => {
    setContactPickerVisible(false);
    setSelectedBirthday({
      id: '',
      name: data.name,
      day: 1,
      month: new Date().getMonth() + 1,
      year: null,
      photoUri: null,
      contactId: data.contactId ?? null,
      source: 'contact',
      phoneNumber: data.phone ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setTimeout(() => setEditSheetVisible(true), 300);
  };

  const findBirthdayByName = (name: string): Birthday | undefined =>
    birthdays.find((b) => b.name === name);

  const value: BirthdaySheetsContextValue = {
    openBirthdayCard,
    openBirthdayEdit,
    openBirthdayCreate,
    openBirthdayAddChoice,
    closeAll,
    deleteBirthday,
    birthdays,
    findBirthdayByName,
  };

  return (
    <BirthdaySheetsContext.Provider value={value}>
      {children}
      <BirthdayCardSheet
        birthday={selectedBirthday}
        visible={cardSheetVisible}
        onClose={closeAll}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
      <BirthdayEditSheet
        key={selectedBirthday?.id || selectedBirthday?.contactId || 'create'}
        birthday={selectedBirthday ?? undefined}
        visible={editSheetVisible}
        onClose={closeAll}
        onSave={handleSave}
        onDelete={selectedBirthday?.id ? handleDelete : undefined}
      />
      <BirthdayAddChoiceSheet
        visible={addChoiceVisible}
        onClose={() => setAddChoiceVisible(false)}
        onManual={() => {
          setAddChoiceVisible(false);
          setTimeout(() => {
            setSelectedBirthday(null);
            setEditSheetVisible(true);
          }, 300);
        }}
        onFromContacts={() => {
          if (isContactsIntentPending) return;
          setIsContactsIntentPending(true);
          setAddChoiceVisible(false);
          if (Platform.OS === 'android') {
            void handleContactsAccessIntent();
          }
          // iOS: handled by onDismiss below, which fires after the close
          // animation fully completes — no artificial delay needed.
        }}
        onDismiss={() => {
          if (Platform.OS === 'ios' && isContactsIntentPending) {
            void handleContactsAccessIntent();
          }
        }}
      />
      <AddPersonBottomSheet
        visible={contactPickerVisible}
        onClose={() => setContactPickerVisible(false)}
        onContactSelected={handleContactSelected}
        onManual={() => {
          setContactPickerVisible(false);
          setTimeout(() => {
            setSelectedBirthday(null);
            setEditSheetVisible(true);
          }, 300);
        }}
        openContactsDirectly={true}
      />
      <UpgradeModal
        visible={upgradeModalVisible}
        reason={upgradeReason}
        onClose={() => setUpgradeModalVisible(false)}
      />
    </BirthdaySheetsContext.Provider>
  );
}
