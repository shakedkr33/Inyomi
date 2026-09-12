import type React from 'react';
import { createContext, useContext, useState } from 'react';

export interface FamilyMember {
  id: string;
  name: string;
  color: string;
  type?: 'person' | 'pet';
  contactId?: string;
  phone?: string;
  email?: string;
  // FIXED: added family-member status fields — additive only
  sourceType?: 'contact' | 'manual';
  selectedPhoneNumber?: string;
  maskedPhone?: string;
  inviteStatus?: 'none' | 'invited' | 'joined';
  matchedUserId?: string;
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
  profileColor?: string;
  spaceType?: string;
  familyContacts?: FamilyMember[];
}

interface OnboardingContextType {
  data: OnboardingData;
  updateData: (newData: Partial<OnboardingData>) => void;
  resetData: () => void;
  hydrateFromServer: (profile: ServerProfile) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined
);

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<OnboardingData>({});

  const updateData = (newData: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...newData }));
  };

  const resetData = () => setData({});

  // FIXED: context now rehydrates from Convex on authenticated app start.
  // Splits fullName on first whitespace into firstName/lastName — lossy for middle names
  // but matches what finishOnboarding stores. Does not overwrite fields that are already set,
  // so a just-completed onboarding session is never clobbered by stale server data.
  const hydrateFromServer = (profile: ServerProfile) => {
    setData((prev) => {
      const parts = (profile.fullName ?? '').trim().split(/\s+/);
      const serverFirstName = parts[0] ?? '';
      const serverLastName = parts.slice(1).join(' ');
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
      value={{ data, updateData, resetData, hydrateFromServer }}
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
