import * as Contacts from 'expo-contacts';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { Alert } from 'react-native';
import type { Birthday } from '@/lib/types/birthday';
import { BirthdayCardSheet } from './BirthdayCardSheet';
import { BirthdayEditSheet } from './BirthdayEditSheet';

interface BirthdaySheetsContextValue {
  openBirthdayCard: (birthday: Birthday) => void;
  openBirthdayEdit: (birthday?: Birthday) => void;
  openBirthdayCreate: () => void;
  closeAll: () => void;
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

const MOCK_BIRTHDAYS: Birthday[] = [
  {
    id: '1',
    name: 'דני כהן',
    day: 15,
    month: 2,
    year: 1995,
    photoUri: null,
    contactId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: '2',
    name: 'נועה לוי',
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: null,
    photoUri: null,
    contactId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: '3',
    name: 'נועה',
    day: 5,
    month: new Date().getMonth() + 1,
    year: 2018,
    photoUri: null,
    contactId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: '4',
    name: 'סבתא רחל',
    day: 15,
    month: new Date().getMonth() + 1,
    year: null,
    photoUri: null,
    contactId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

interface ProviderProps {
  children: ReactNode;
}

export function BirthdaySheetsProvider({
  children,
}: ProviderProps): React.JSX.Element {
  const [birthdays, setBirthdays] = useState<Birthday[]>(MOCK_BIRTHDAYS);
  const [selectedBirthday, setSelectedBirthday] = useState<Birthday | null>(
    null
  );
  const [cardSheetVisible, setCardSheetVisible] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);

  const openBirthdayCard = (birthday: Birthday): void => {
    setSelectedBirthday(birthday);
    setCardSheetVisible(true);
  };

  const openBirthdayEdit = (birthday?: Birthday): void => {
    setSelectedBirthday(birthday ?? null);
    setEditSheetVisible(true);
  };

  const openBirthdayCreate = async (): Promise<void> => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאות נדרשות', 'נא לאפשר גישה לאנשי קשר');
      return;
    }

    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return;

    const prefillBirthday: Birthday = {
      id: '',
      name: contact.name || '',
      day: 1,
      month: new Date().getMonth() + 1,
      year: null,
      photoUri: contact.image?.uri ?? null,
      contactId: contact.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSelectedBirthday(prefillBirthday);
    setEditSheetVisible(true);
  };

  const closeAll = (): void => {
    setCardSheetVisible(false);
    setEditSheetVisible(false);
    setTimeout(() => setSelectedBirthday(null), 300);
  };

  const handleEdit = (): void => {
    setCardSheetVisible(false);
    setTimeout(() => setEditSheetVisible(true), 300);
  };

  const handleSave = (data: Partial<Birthday>): void => {
    if (data.id && data.id !== '') {
      setBirthdays((prev) =>
        prev.map((b) =>
          b.id === data.id ? { ...b, ...data, updatedAt: Date.now() } : b
        )
      );
    } else {
      setBirthdays((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          name: data.name ?? '',
          day: data.day ?? 1,
          month: data.month ?? 1,
          year: data.year ?? null,
          photoUri: data.photoUri ?? null,
          contactId: data.contactId ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
    }
    closeAll();
  };

  const handleDelete = (): void => {
    if (selectedBirthday?.id) {
      setBirthdays((prev) => prev.filter((b) => b.id !== selectedBirthday.id));
      closeAll();
    }
  };

  const findBirthdayByName = (name: string): Birthday | undefined =>
    birthdays.find((b) => b.name === name);

  const value: BirthdaySheetsContextValue = {
    openBirthdayCard,
    openBirthdayEdit,
    openBirthdayCreate,
    closeAll,
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
      />
      <BirthdayEditSheet
        key={selectedBirthday?.id || selectedBirthday?.contactId || 'create'} //
        birthday={selectedBirthday ?? undefined}
        visible={editSheetVisible}
        onClose={closeAll}
        onSave={handleSave}
        onDelete={selectedBirthday?.id ? handleDelete : undefined}
      />
    </BirthdaySheetsContext.Provider>
  );
}
