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
  sources?: string[]; // שלב 3
  fullName?: string; // שלב 4 (legacy)
  profileColor?: string; // שלב 4 (legacy)
  firstName?: string; // שלב 4
  lastName?: string; // שלב 4
  nickname?: string; // שלב 4 — optional, for internal/family use
  personalColor?: string; // שלב 4
  familyData?: FamilyData; // שלב 4 - מרחב משפחתי
}

interface OnboardingContextType {
  data: OnboardingData;
  updateData: (newData: Partial<OnboardingData>) => void;
  resetData: () => void;
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

  return (
    <OnboardingContext.Provider value={{ data, updateData, resetData }}>
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
