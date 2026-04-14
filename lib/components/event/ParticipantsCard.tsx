// FIXED: added family sharing section to participants bottom sheet
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Participant } from '@/lib/types/event';
// SHARED: phone selection logic for contact import
// FIXED: updated phone label filter to mobile-capable labels only
// FIXED: event flow now requires explicit number selection for contacts with 2+ mobile numbers
import {
  getDefaultPhoneNumber,
  getMobilePhones,
  getPhoneLabel,
  getPrimaryPhone,
  normalizePhone,
} from '@/lib/utils/contactPhone';

// ─── Family member type (from listMyFamilyContacts) ───────────────────────────
export interface FamilyMemberChip {
  _id: string;
  displayName?: string;
  color?: string;
}

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';

// Fixed turquoise style for all non-family participants
const CIRCLE_BG = '#e8f5fd';
const CIRCLE_BORDER = '#36a9e2';
const CIRCLE_TEXT = '#36a9e2';

/** Stable key for a contact: prefer contact.id, fallback to normalised phone */
function contactKey(contact: Contacts.Contact): string {
  return (contact as { id?: string }).id ?? normalizePhone(getPrimaryPhone(contact));
}

// ─── Email parsing ────────────────────────────────────────────────────────────

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\n\r]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@') && e.includes('.'));
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ParticipantsCardProps {
  participants: Participant[];
  onChange: (participants: Participant[]) => void;
  // FIXED: family sharing props — optional so existing usages without family data still compile
  familyMembers?: FamilyMemberChip[];
  allFamily?: boolean;
  sharedWithFamilyMemberIds?: string[];
  onFamilyChange?: (allFamily: boolean, selectedIds: string[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParticipantsCard({
  participants,
  onChange,
  familyMembers = [],
  allFamily = false,
  sharedWithFamilyMemberIds = [],
  onFamilyChange,
}: ParticipantsCardProps): React.JSX.Element {
  // 'main' = contacts button + email input; 'contacts' = contact list; 'phone-disambig' = multi-phone resolution
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<'main' | 'contacts' | 'phone-disambig'>('main');
  const [emailText, setEmailText] = useState('');
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  /** Temporarily selected contact keys (stable id or normalised phone) */
  const [draftContactIds, setDraftContactIds] = useState<string[]>([]);
  // EVENT FLOW: multi-select contact import with deferred phone disambiguation
  const [disambigContacts, setDisambigContacts] = useState<Contacts.Contact[]>([]);
  const [disambigSelections, setDisambigSelections] = useState<Record<string, string>>({});
  // "הצג הכל" list modal
  const [listOpen, setListOpen] = useState(false);

  const openSheet = useCallback((): void => {
    setSheetView('main');
    setEmailText('');
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback((): void => {
    setSheetOpen(false);
    setEmailText('');
    setContactSearch('');
    setContacts([]);
    setSheetView('main');
    setDraftContactIds([]);
    setDisambigContacts([]);
    setDisambigSelections({});
  }, []);

  // ── Add participants from email textarea ──────────────────────────────────
  const confirmEmailInput = (): void => {
    const emails = parseEmails(emailText);
    if (emails.length === 0) {
      closeSheet();
      return;
    }
    const existing = new Set(participants.map((p) => p.email));
    const newOnes: Participant[] = emails
      .filter((email) => !existing.has(email))
      .map((email, i) => ({
        id: `email-${Date.now()}-${i}`,
        name: email,
        email,
        color: CIRCLE_BG, // use turquoise tint for email participants
      }));
    onChange([...participants, ...newOnes]);
    closeSheet();
  };

  // ── Load device contacts (filtered by phone, not email) ───────────────────
  const openContactsPicker = useCallback(async (): Promise<void> => {
    setLoadingContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'גישה לאנשי קשר',
          'אנא אפשרי גישה לאנשי קשר בהגדרות הטלפון.',
          [{ text: 'הבנתי' }]
        );
        setLoadingContacts(false);
        return;
      }
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      // FIXED: updated phone label filter to mobile-capable labels only
      // Only contacts that have a name AND at least one mobile-capable number
      const withPhone = (result.data ?? []).filter(
        (c) => c.name && getMobilePhones(c).length > 0
      );
      setContacts(withPhone);
      setContactSearch('');
      setDraftContactIds([]);
      setSheetView('contacts');
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לטעון אנשי קשר.');
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  // ── Already-added guard (normalised phone dedupe) ─────────────────────────
  const addedPhones = new Set(
    participants
      .map((p) => normalizePhone(p.phone ?? ''))
      .filter((n) => n.length > 0)
  );

  const isAlreadyAdded = (contact: Contacts.Contact): boolean => {
    const norm = normalizePhone(getPrimaryPhone(contact));
    return norm.length > 0 && addedPhones.has(norm);
  };

  // ── Toggle a contact in/out of draft selection ────────────────────────────
  const toggleContactDraft = (contact: Contacts.Contact): void => {
    if (isAlreadyAdded(contact)) return; // already in event — ignore
    const key = contactKey(contact);
    setDraftContactIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // ── Commit all drafted contacts — defers to disambiguation if needed ───────
  const saveContactsDraft = (): void => {
    if (draftContactIds.length === 0) {
      closeSheet();
      return;
    }
    const drafted = draftContactIds
      .map((key) => contacts.find((c) => contactKey(c) === key))
      .filter((c): c is Contacts.Contact => c != null);

    // EVENT FLOW: multi-select contact import with deferred phone disambiguation
    // FIXED: updated phone label filter to mobile-capable labels only
    // Disambiguation is only needed when a contact has > 1 mobile-capable number
    // DEBUG: remove after confirming fix
    for (const c of drafted) {
      const mp = getMobilePhones(c);
      console.log('[DEBUG event] contact:', c.name,
        '| all phones:', JSON.stringify(c.phoneNumbers?.map(p => ({ label: p.label, number: p.number }))),
        '| mobile phones:', JSON.stringify(mp.map(p => ({ label: p.label, number: p.number }))),
        '| length:', mp.length,
        '| → needs disambig:', mp.length > 1,
      );
    }
    const needsDisambig = drafted.filter(
      (c) => getMobilePhones(c).length > 1
    );

    if (needsDisambig.length === 0) {
      // All contacts have 0 or 1 phone number — add directly
      const newOnes: Participant[] = drafted.map((c, i) => {
        const phone = normalizePhone(getPrimaryPhone(c)) || undefined;
        const localDisplayName = c.name?.trim() || undefined;
        // TODO: for shared event view, resolve sharedDisplayName via user lookup by phone before rendering to non-creator participants
        return {
          id: `contact-${Date.now()}-${i}`,
          name: localDisplayName ?? phone ?? '',
          phone,
          localDisplayName,
          color: CIRCLE_BG,
        };
      });
      onChange([...participants, ...newOnes]);
      closeSheet();
    } else {
      // FIXED: event flow now requires explicit number selection for contacts with 2+ mobile numbers
      // Preselect isPrimary phone (from contacts API) or first mobile for each contact
      // so "המשך" is usable immediately; user can still tap a different number before confirming.
      const preselected: Record<string, string> = {};
      for (const c of needsDisambig) {
        preselected[contactKey(c)] = getDefaultPhoneNumber(getMobilePhones(c));
      }
      setDisambigContacts(needsDisambig);
      setDisambigSelections(preselected);
      setSheetView('phone-disambig');
    }
  };

  // ── Finalize after all phone selections are confirmed ─────────────────────
  const confirmDisambig = (): void => {
    const allDrafted = draftContactIds
      .map((key) => contacts.find((c) => contactKey(c) === key))
      .filter((c): c is Contacts.Contact => c != null);

    const newOnes: Participant[] = allDrafted.map((c, i) => {
      const key = contactKey(c);
      // Use disambig selection if available, otherwise fall back to primary phone
      const rawPhone = disambigSelections[key] ?? getPrimaryPhone(c);
      const phone = normalizePhone(rawPhone) || undefined;
      const localDisplayName = c.name?.trim() || undefined;
      return {
        id: `contact-${Date.now()}-${i}`,
        name: localDisplayName ?? phone ?? '',
        phone,
        localDisplayName,
        color: CIRCLE_BG,
      };
    });
    onChange([...participants, ...newOnes]);
    closeSheet();
  };

  const removeParticipant = (id: string): void => {
    onChange(participants.filter((p) => p.id !== id));
  };

  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase();
    if (!q) return true;
    return (
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.phoneNumbers?.[0]?.number ?? '').includes(q)
    );
  });

  // ── Circle badge helpers ──────────────────────────────────────────────────
  const initial = (p: Participant): string =>
    (p.name.trim() || '?')[0]?.toUpperCase() ?? '?';

  return (
    <View style={s.card}>
      {/* ── Header ── */}
      <View style={s.headerRow}>
        <Pressable
          style={s.addBtn}
          onPress={openSheet}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="הוסף משתתף"
        >
          <Ionicons name="add" size={18} color={PRIMARY} />
        </Pressable>
        <Text style={s.label}>משתתפים</Text>
        <View style={[s.iconCircle, { backgroundColor: TINT }]}>
          <Ionicons name="people-outline" size={20} color={PRIMARY} />
        </View>
      </View>

      {/* ── Participant circles row ── */}
      {participants.length > 0 && (
        <View style={s.circlesRow}>
          {participants.map((p) => (
            <Pressable
              key={p.id}
              style={s.circle}
              onLongPress={() => removeParticipant(p.id)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} — לחץ לחיצה ארוכה להסרה`}
            >
              <Text style={s.circleText}>{initial(p)}</Text>
            </Pressable>
          ))}

          {/* "הצג הכל" — appears right next to circles */}
          <Pressable
            style={s.showAllBtn}
            onPress={() => setListOpen(true)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`הצג הכל ${participants.length}`}
          >
            <Text style={s.showAllText}>הצג הכל ({participants.length})</Text>
          </Pressable>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Add-participant sheet
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{ flex: 1 }}>
            {/* Backdrop — separate from sheet so sheet gestures never reach it */}
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
            <View style={s.modalSheetWrapper}>
            <View
              style={[s.sheet, (sheetView === 'contacts' || sheetView === 'phone-disambig') && s.sheetContacts]}
            >
              <View style={s.handle} />

              {/* ── Phone disambiguation view — only ambiguous contacts, deferred after "שמור" ── */}
              {sheetView === 'phone-disambig' && (
                <View style={s.contactsViewContainer}>
                  <View style={s.sheetHeaderRow}>
                    <Pressable
                      onPress={() => {
                        setSheetView('contacts');
                        setDisambigContacts([]);
                        setDisambigSelections({});
                      }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="חזרה"
                    >
                      <Ionicons name="chevron-forward" size={22} color="#334155" />
                    </Pressable>
                    <Text style={s.sheetTitle}>בחירת מספרי טלפון</Text>
                    <View style={{ width: 42 }} />
                  </View>

                  {/* Helper text */}
                  <Text style={s.phoneDisambigHint}>בחר/י מספר אחד לכל איש קשר</Text>

                  {/* Per-contact phone radio lists */}
                  <FlatList
                    data={disambigContacts}
                    keyExtractor={(c) => contactKey(c)}
                    style={s.contactList}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    keyboardShouldPersistTaps="handled"
                    scrollEnabled
                    nestedScrollEnabled
                    renderItem={({ item: contact }) => {
                      const key = contactKey(contact);
                      return (
                        <View>
                          {/* Contact name header */}
                          <Text style={s.disambigContactName}>
                            {contact.name?.trim() || key}
                          </Text>
                          {/* FIXED: updated phone label filter to mobile-capable labels only
                              Show ONLY mobile-capable numbers in disambiguation picker */}
                          {getMobilePhones(contact).map((phone, idx) => {
                            const isSelected =
                              disambigSelections[key] === phone.number;
                            return (
                              <Pressable
                                key={`${key}-${idx}`}
                                style={[
                                  s.contactRow,
                                  isSelected && s.contactRowSelected,
                                ]}
                                onPress={() =>
                                  setDisambigSelections((prev) => ({
                                    ...prev,
                                    [key]: phone.number ?? '',
                                  }))
                                }
                                accessible={true}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: isSelected }}
                                accessibilityLabel={`${getPhoneLabel(phone.label)} ${phone.number ?? ''}`}
                              >
                                {/* Label + number — RTL right side */}
                                <View style={s.contactRowInfo}>
                                  <Text style={s.contactName}>
                                    {getPhoneLabel(phone.label)}
                                  </Text>
                                  <Text style={s.contactPhone}>
                                    {phone.number}
                                  </Text>
                                </View>
                                {/* Radio circle — visual left (logical end in RTL) */}
                                <View
                                  style={[
                                    s.contactCheck,
                                    isSelected && s.contactCheckSelected,
                                  ]}
                                >
                                  {isSelected && (
                                    <Ionicons
                                      name="checkmark"
                                      size={14}
                                      color="#fff"
                                    />
                                  )}
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    }}
                  />

                  {/* "המשך" CTA — enabled only after user has explicitly chosen
                      a number for every ambiguous contact (no preselection). */}
                  {(() => {
                    const allSelected = disambigContacts.every(
                      (c) => !!disambigSelections[contactKey(c)]
                    );
                    return (
                      <Pressable
                        style={[s.saveBtn, !allSelected && s.saveBtnDisabled]}
                        onPress={confirmDisambig}
                        disabled={!allSelected}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="המשך"
                        accessibilityState={{ disabled: !allSelected }}
                      >
                        <Text style={s.saveBtnText}>המשך</Text>
                      </Pressable>
                    );
                  })()}
                </View>
              )}

              {/* ── Contacts view ── */}
              {sheetView === 'contacts' && (
                <View style={s.contactsViewContainer}>
                  <View style={s.sheetHeaderRow}>
                    <Pressable
                      onPress={() => {
                        setSheetView('main');
                        setDraftContactIds([]);
                      }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="חזרה"
                    >
                      <Ionicons name="chevron-forward" size={22} color="#334155" />
                    </Pressable>
                    <Text style={s.sheetTitle}>בחירה מאנשי קשר</Text>
                    {/* Live counter */}
                    {draftContactIds.length > 0 ? (
                      <Text style={s.draftCounter}>נבחרו {draftContactIds.length}</Text>
                    ) : (
                      <View style={{ width: 42 }} />
                    )}
                  </View>

                  {/* ── Selected-contact chips — above search, capped height ── */}
                  {draftContactIds.length > 0 && (
                    <View style={s.selectedSummaryBox}>
                      <Text style={s.selectedSummaryLabel}>נבחרו</Text>
                      <ScrollView
                        scrollEnabled
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        scrollIndicatorInsets={{ right: 1 }}
                        style={{ maxHeight: 96 }}
                        keyboardShouldPersistTaps="handled"
                      >
                        <View style={s.chipWrap}>
                          {draftContactIds.map((key) => {
                            const c = contacts.find((ct) => contactKey(ct) === key);
                            const phone = c ? getPrimaryPhone(c) : '';
                            const label = c?.name?.trim() || phone || key;
                            return (
                              <View key={key} style={s.chip}>
                                {/* ✕ on LEFT side (RTL logical end) */}
                                <Pressable
                                  onPress={() => {
                                    setDraftContactIds((prev) =>
                                      prev.filter((k) => k !== key)
                                    );
                                  }}
                                  hitSlop={6}
                                  accessible={true}
                                  accessibilityRole="button"
                                  accessibilityLabel={`הסר ${label}`}
                                >
                                  <Ionicons name="close" size={12} color={PRIMARY} />
                                </Pressable>
                                <Text style={s.chipText} numberOfLines={1}>
                                  {label}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>
                  )}

                  <TextInput
                    style={s.searchInput}
                    value={contactSearch}
                    onChangeText={setContactSearch}
                    placeholder="חיפוש לפי שם או מספר..."
                    placeholderTextColor="#9ca3af"
                    textAlign="right"
                    accessible={true}
                    accessibilityLabel="חיפוש"
                  />

                  <FlatList
                    data={filteredContacts}
                    keyExtractor={(c, i) => contactKey(c) || `c-${i}`}
                    style={s.contactList}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    keyboardShouldPersistTaps="handled"
                    scrollEnabled
                    nestedScrollEnabled
                    renderItem={({ item }) => {
                      const alreadyAdded = isAlreadyAdded(item);
                      const key = contactKey(item);
                      const selected = !alreadyAdded && draftContactIds.includes(key);
                      const phone = getPrimaryPhone(item);
                      const displayName = item.name?.trim() || phone;
                      return (
                        <Pressable
                          style={[
                            s.contactRow,
                            selected && s.contactRowSelected,
                            alreadyAdded && s.contactRowDisabled,
                          ]}
                          onPress={() => toggleContactDraft(item)}
                          disabled={alreadyAdded}
                          accessible={true}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected, disabled: alreadyAdded }}
                          accessibilityLabel={displayName}
                        >
                          {/* RTL: name+phone on the right, checkmark on the left */}
                          <View style={s.contactRowInfo}>
                            <Text style={s.contactName} numberOfLines={1}>
                              {displayName}
                            </Text>
                            {phone.length > 0 && (
                              <Text style={s.contactPhone} numberOfLines={1}>
                                {phone}
                              </Text>
                            )}
                          </View>
                          {/* Checkmark on visual left (logical end in RTL) */}
                          <View style={[s.contactCheck, selected && s.contactCheckSelected]}>
                            {(selected || alreadyAdded) && (
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color={alreadyAdded ? '#94a3b8' : '#fff'}
                              />
                            )}
                          </View>
                        </Pressable>
                      );
                    }}
                    ListEmptyComponent={
                      <Text style={s.emptyContacts}>
                        {loadingContacts ? 'טוען...' : 'לא נמצאו אנשי קשר'}
                      </Text>
                    }
                  />

                  {/* Save button — pinned to bottom */}
                  <Pressable
                    style={[
                      s.saveBtn,
                      draftContactIds.length === 0 && s.saveBtnDisabled,
                    ]}
                    onPress={saveContactsDraft}
                    disabled={draftContactIds.length === 0}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`שמור ${draftContactIds.length} אנשי קשר`}
                  >
                    <Text style={s.saveBtnText}>
                      {draftContactIds.length > 0
                        ? `שמור (${draftContactIds.length})`
                        : 'שמור'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* ── Main view ── */}
              {sheetView === 'main' && (
                <>
                  <Text style={s.sheetTitle}>הוסף משתתף</Text>

                  {/* ── Family sharing section — hidden when no family members ── */}
                  {familyMembers.length > 0 && onFamilyChange && (
                    <>
                      <Text style={s.familySectionTitle}>שיתוף עם המשפחה</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={s.familyChipsRow}
                        style={{ direction: 'rtl' }}
                      >
                        {/* "כולם" chip */}
                        <Pressable
                          style={[s.allChip, allFamily && s.allChipSelected]}
                          onPress={() => {
                            if (allFamily) {
                              // Deselect all
                              onFamilyChange(false, []);
                            } else {
                              // Select all family
                              onFamilyChange(true, familyMembers.map((m) => m._id));
                            }
                          }}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityLabel="כולם"
                          accessibilityState={{ selected: allFamily }}
                        >
                          <Text style={[s.allChipText, allFamily && s.allChipTextSelected]}>
                            כולם
                          </Text>
                        </Pressable>

                        {/* Individual member chips */}
                        {familyMembers.map((member) => {
                          const isSelected = allFamily || sharedWithFamilyMemberIds.includes(member._id);
                          const initials = (member.displayName ?? '?').trim().substring(0, 2);
                          const color = member.color ?? PRIMARY;
                          return (
                            <Pressable
                              key={member._id}
                              style={s.memberChipWrap}
                              onPress={() => {
                                if (allFamily) {
                                  // Deselect "כולם", keep others except this one
                                  const rest = familyMembers
                                    .map((m) => m._id)
                                    .filter((id) => id !== member._id);
                                  onFamilyChange(false, rest);
                                } else {
                                  const next = isSelected
                                    ? sharedWithFamilyMemberIds.filter((id) => id !== member._id)
                                    : [...sharedWithFamilyMemberIds, member._id];
                                  onFamilyChange(false, next);
                                }
                              }}
                              accessible={true}
                              accessibilityRole="button"
                              accessibilityLabel={member.displayName ?? 'חבר משפחה'}
                              accessibilityState={{ selected: isSelected }}
                            >
                              <View style={[
                                s.memberCircle,
                                { backgroundColor: color },
                                isSelected && { borderColor: color, borderWidth: 3, opacity: 1 },
                                !isSelected && { opacity: 0.45 },
                              ]}>
                                <Text style={s.memberInitials}>{initials}</Text>
                              </View>
                              <Text style={s.memberName} numberOfLines={1}>
                                {member.displayName ?? ''}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      <Text style={s.familyHelperText}>האירוע תמיד נשמר גם אצלך</Text>

                      {/* Separator between family and external sections */}
                      <View style={s.sectionDivider}>
                        <View style={s.separatorLine} />
                        <Text style={s.sectionDividerLabel}>או הוסף משתתפים חיצוניים</Text>
                        <View style={s.separatorLine} />
                      </View>
                    </>
                  )}

                  <Pressable
                    style={s.contactsBtn}
                    onPress={openContactsPicker}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="בחירה מאנשי קשר"
                  >
                    <Ionicons name="person-circle-outline" size={20} color={PRIMARY} />
                    <Text style={s.contactsBtnText}>
                      {loadingContacts ? 'טוען...' : 'בחירה מאנשי קשר'}
                    </Text>
                  </Pressable>

                  <View style={s.separatorRow}>
                    <View style={s.separatorLine} />
                    <Text style={s.separatorOr}>או הכנס ישירות</Text>
                    <View style={s.separatorLine} />
                  </View>

                  <Text style={s.emailHint}>
                    כתובות אימייל, מופרדות בפסיק, נקודה-פסיק או שורה חדשה
                  </Text>
                  <TextInput
                    style={s.emailTextArea}
                    value={emailText}
                    onChangeText={setEmailText}
                    placeholder={'user@example.com, another@example.com'}
                    placeholderTextColor="#9ca3af"
                    textAlign="right"
                    multiline
                    numberOfLines={3}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessible={true}
                    accessibilityLabel="כתובות אימייל"
                  />

                  <Pressable
                    style={s.saveBtn}
                    onPress={confirmEmailInput}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="שמור"
                  >
                    <Text style={s.saveBtnText}>שמור</Text>
                  </Pressable>
                </>
              )}
            </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          "הצג הכל" list modal — shows full participant list
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={listOpen} transparent animationType="slide" onRequestClose={() => setListOpen(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setListOpen(false)}>
          <Pressable style={[s.sheet, { maxHeight: '70%' }]} onPress={() => undefined}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>משתתפים באירוע</Text>

            <FlatList
              data={participants}
              keyExtractor={(p) => p.id}
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => (
                <View style={s.listRow}>
                  {/* Turquoise circle */}
                  <Pressable
                    style={s.listRemoveBtn}
                    onPress={() => {
                      removeParticipant(item.id);
                      if (participants.length <= 1) setListOpen(false);
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`הסר ${item.name}`}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color="#94a3b8" />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={s.listName} numberOfLines={1}>{item.name}</Text>
                    {(item.phone ?? item.email) ? (
                      <Text style={s.listSub} numberOfLines={1}>
                        {item.phone ?? item.email}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.circle}>
                    <Text style={s.circleText}>{initial(item)}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={s.emptyContacts}>אין משתתפים</Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Circles row ───────────────────────────────────────────────────────────
  circlesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    justifyContent: 'flex-end',
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CIRCLE_BG,
    borderWidth: 2,
    borderColor: CIRCLE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: 14,
    fontWeight: '700',
    color: CIRCLE_TEXT,
  },
  showAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  showAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheetWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    paddingTop: 12,
    // No flex:1 here — main view ("הוסף משתתף") must size to content only
    maxHeight: '88%',
  },
  // Applied only in contacts view — restores flex distribution for FlatList
  sheetContacts: {
    flex: 1,
  },
  // Flex container for the contacts view — distributes space so FlatList fills remainder
  contactsViewContainer: {
    flex: 1,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 14,
  },
  contactsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TINT,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  contactsBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
  },
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  separatorOr: {
    fontSize: 12,
    color: '#9ca3af',
  },
  emailHint: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 6,
  },
  emailTextArea: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fafafa',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  // ── Contacts list ─────────────────────────────────────────────────────────
  searchInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  contactList: {
    // flex: 1 fills remaining space between summary/search and the save button
    flex: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 10,
  },
  contactRowSelected: {
    backgroundColor: TINT,
    borderRadius: 8,
  },
  contactRowDisabled: {
    opacity: 0.4,
  },
  contactRowInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  contactName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'right',
  },
  contactPhone: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
  },
  // Checkmark box on visual left (logical end in RTL)
  contactCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCheckSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  // Selected-contact chips summary box (above search field)
  selectedSummaryBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  selectedSummaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 6,
  },
  // RTL chip wrap — inside ScrollView, no maxHeight needed here
  chipWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: TINT,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  // Live counter shown in header row
  draftCounter: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
    minWidth: 42,
    textAlign: 'right',
  },
  saveBtnDisabled: {
    backgroundColor: '#e5e7eb',
  },
  emptyContacts: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 24,
  },
  // ── Family sharing section ────────────────────────────────────────────────
  familySectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    textAlign: 'right',
    marginBottom: 10,
    marginTop: 4,
  },
  familyChipsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  allChip: {
    borderWidth: 1.5,
    borderColor: PRIMARY,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  allChipSelected: {
    backgroundColor: PRIMARY,
  },
  allChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
  },
  allChipTextSelected: {
    color: '#fff',
  },
  memberChipWrap: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 56,
  },
  memberCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  memberName: {
    fontSize: 10,
    fontWeight: '500',
    color: '#374151',
    textAlign: 'center',
    maxWidth: 52,
  },
  familyHelperText: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 4,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 14,
  },
  sectionDividerLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    flexShrink: 1,
  },
  // ── Phone disambiguation view ─────────────────────────────────────────────
  phoneDisambigHint: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginBottom: 10,
  },
  disambigContactName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    marginBottom: 4,
  },
  // ── "הצג הכל" list modal rows ─────────────────────────────────────────────
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  listRemoveBtn: {
    padding: 4,
  },
  listName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'right',
  },
  listSub: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
  },
});
