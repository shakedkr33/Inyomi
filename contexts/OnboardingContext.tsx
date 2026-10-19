import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { deriveNameFromServerProfile } from '@/lib/legacyNameHydration';
import {
  getOnboardingDraft,
  type OnboardingDraft,
} from '@/lib/onboardingState';
import { startupTrace } from '@/lib/startupTrace';

export interface FamilyMember {
  id: string;
  name: string;
  color: string;
  type?: 'person' | 'pet';
  contactId?: string;
  phone?: string;
  // FIXED: added family-member status fields — additive only
  sourceType?: 'contact' | 'manual';
  selectedPhoneNumber?: string;
  maskedPhone?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  matchedUserId?: string;
  // FIXED: QA — minimal-safe connected signal for read-only preview rows
  // (pending-family onboarding) that never receive matchedUserId itself
  // (see getMyPendingFamilyPreview's isConnected boolean). Admin-visible
  // rows keep using matchedUserId directly; this is purely a fallback so
  // FamilyMemberCard.tsx can show the "מחובר" state without the real id.
  isConnected?: boolean;
}

export interface FamilyData {
  owner: { firstName: string; lastName?: string; color: string };
  familyMembers: FamilyMember[];
}

// הגדרת סוגי הנתונים שנאסוף מהמסכים שעיצבת
interface OnboardingData {
  spaceType?: 'personal' | 'couple' | 'family' | 'business'; // שלב 1
  childCount?: number; // שלב מותנה
  challenges?: string[]; // שלב 2
  fullName?: string; // שלב 4 (legacy)
  profileColor?: string; // שלב 4 (legacy)
  firstName?: string; // שלב 4
  lastName?: string; // שלב 4
  nickname?: string; // שלב 4 — optional, for internal/family use
  personalColor?: string; // שלב 4
  familyData?: FamilyData; // שלב 4 - מרחב משפחתי
  onboardingCompleted?: boolean; // set to true after finishOnboarding is attempted post-OTP
}

// FIXED: added hydrateFromServer to OnboardingContext
interface ServerProfile {
  fullName?: string;
  // Phase 1: canonical split-name identity — undefined for legacy users
  // who only ever saved fullName (see convex/users.ts getMyProfile).
  firstName?: string;
  lastName?: string;
  profileColor?: string;
  spaceType?: string;
  familyContacts?: FamilyMember[];
}

interface OnboardingContextType {
  data: OnboardingData;
  updateData: (newData: Partial<OnboardingData>) => void;
  resetData: () => void;
  hydrateFromServer: (profile: ServerProfile) => void;
  // True once the one-time startup check of the local pre-auth draft
  // (AsyncStorage `onboarding_draft`) has completed — whether or not a
  // draft was actually found. Routing decisions that depend on
  // `data.spaceType` being fully settled (family-bootstrap, authenticated
  // layout) should wait for this before deciding, to avoid a brief
  // incorrect redirect while the async check is still in flight.
  isDraftHydrated: boolean;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined
);

// FIXED: Stage 1 — pure merge used to hydrate Step 1 / Step 2 answers from
// the persisted draft into in-memory OnboardingContext state after a process
// restart. Exported (and pure) so the merge rule is unit-testable without
// rendering the Provider:
//   - if the draft is missing/invalid, `current` is returned unchanged.
//   - if `current` already has a spaceType or non-empty challenges (i.e. the
//     user answered again in this same session, or a newer write already
//     landed), the draft is NEVER applied — it must not clobber fresher
//     in-memory answers with stale storage values.
export function mergeDraftIntoOnboardingData(
  current: OnboardingData,
  draft: OnboardingDraft | null
): OnboardingData {
  if (!draft) return current;
  const hasNewerInMemoryAnswers =
    Boolean(current.spaceType) ||
    (current.challenges !== undefined && current.challenges.length > 0);
  if (hasNewerInMemoryAnswers) return current;

  return {
    ...current,
    spaceType: draft.spaceType as OnboardingData['spaceType'],
    challenges: draft.challenges,
  };
}

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<OnboardingData>({});
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);

  const updateData = (newData: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...newData }));
  };

  const resetData = () => setData({});

  // FIXED: Stage 1 — one-time draft hydration on cold start. Runs once per
  // Provider mount (i.e. once per app process), before Step1/Step2 answers
  // could possibly exist in-memory yet, so the "don't clobber newer answers"
  // guard in mergeDraftIntoOnboardingData is a defensive backstop rather
  // than the primary protection. isDraftHydrated flips to true exactly once
  // this check settles (found a draft, found none, or failed to read) so
  // routing consumers (family-bootstrap, authenticated layout) can gate
  // their redirect decisions on it instead of racing the async read.
  useEffect(() => {
    let isCancelled = false;
    getOnboardingDraft()
      .then((draft) => {
        if (isCancelled) return;
        setData((prev) => mergeDraftIntoOnboardingData(prev, draft));
      })
      .catch(() => {
        // No draft to hydrate — proceed as a fresh session.
      })
      .finally(() => {
        if (!isCancelled) {
          setIsDraftHydrated(true);
          // TEMPORARY (Step A baseline instrumentation).
          startupTrace('T3_DRAFT_HYDRATED');
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // FIXED: context now rehydrates from Convex on authenticated app start.
  // Phase 1: prefers the canonical server firstName/lastName when present
  // (users who completed mandatory onboarding under Phase 1, or who
  // explicitly edited their name — see convex/users.ts updateMyProfile).
  // Falls back to splitting fullName on first whitespace for legacy users
  // who only ever saved fullName — lossy for middle names, but matches
  // what finishOnboarding stored before Phase 1. Does not overwrite
  // fields that are already set, so a just-completed onboarding session
  // is never clobbered by stale server data.
  const hydrateFromServer = (profile: ServerProfile) => {
    setData((prev) => {
      // Phase 1 final correction: derivation extracted to a pure helper
      // (lib/legacyNameHydration.ts) for testability — behavior is
      // unchanged. This is a DISPLAY/EDIT-CONVENIENCE fallback only; it
      // must never be treated as an explicit identity edit (see
      // lib/identityEditGuard.ts, wired in useFamilyProfileEditor).
      const { firstName: serverFirstName, lastName: serverLastName } =
        deriveNameFromServerProfile(profile);
      // FIXED: family profile persistence — restore family contacts from Convex on app restart
      const restoredFamilyData =
        prev.familyData ||
        (profile.familyContacts?.length
          ? {
              owner: {
                firstName: serverFirstName,
                lastName: serverLastName || undefined,
                color: profile.profileColor ?? '#36a9e2',
              },
              familyMembers: profile.familyContacts,
            }
          : undefined);
      return {
        ...prev,
        firstName: prev.firstName || serverFirstName,
        lastName: prev.lastName || serverLastName,
        personalColor: prev.personalColor || profile.profileColor,
        spaceType:
          prev.spaceType || (profile.spaceType as OnboardingData['spaceType']),
        familyData: restoredFamilyData,
        onboardingCompleted: true,
      };
    });
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        updateData,
        resetData,
        hydrateFromServer,
        isDraftHydrated,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

// פונקציה קלה לשימוש בכל מסך
export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
