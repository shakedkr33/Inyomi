import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { colors, shadows } from '../../constants/theme';
import type { FamilyMember } from '../../contexts/OnboardingContext';
import { ColorPicker, TakenColor } from './ColorPicker';

// ─────────────────────────────────────────────────────────────────────────────
// FIXED: manual members no longer show a status badge — descriptive secondary line shown instead
// FIXED: card now renders correct secondary line and badge per member type
// FIXED: role-aware card — isAdmin controls which actions are rendered
// ─────────────────────────────────────────────────────────────────────────────

// Only 3 real badge values — manual members return null (no badge rendered)
type FamilyMemberBadge = 'מחובר' | 'שלח שוב' | 'שלח הזמנה' | null;

const BADGE_STYLES: Record<NonNullable<FamilyMemberBadge>, { bg: string; text: string }> = {
  'מחובר':      { bg: '#dcfce7', text: '#16a34a' },
  'שלח הזמנה': { bg: '#ede9fe', text: '#7c3aed' },
  'שלח שוב':   { bg: '#fff7ed', text: '#ea580c' },
};

// FIXED: deriveFamilyMemberBadge returns null for manual members (no badge shown)
// Backward compat: members without sourceType are inferred from phone/contactId presence.
function deriveFamilyMemberBadge(member: FamilyMember): FamilyMemberBadge {
  if (member.matchedUserId) return 'מחובר';
  const effectiveSourceType =
    member.sourceType ?? (member.phone || member.contactId ? 'contact' : 'manual');
  const effectivePhone =
    member.selectedPhoneNumber ?? (effectiveSourceType === 'contact' ? member.phone : undefined);
  if (effectiveSourceType === 'contact' && member.inviteStatus === 'invited') return 'שלח שוב';
  if (effectiveSourceType === 'contact' && effectivePhone) return 'שלח הזמנה';
  return null; // manual member — no badge
}

interface DisplayCardProps {
  member: FamilyMember;
  onEdit: () => void;
  onRemove: () => void;
  // FIXED: role-aware display card — edit/remove hidden for members
  isAdmin?: boolean;
}

export function FamilyMemberDisplayCard({
  member,
  onEdit,
  onRemove,
  isAdmin = true,
}: DisplayCardProps) {
  const initials = member.name.trim().substring(0, 2);
  const isPet = member.type === 'pet';

  const inner = (
    <>
      {/* Remove button — left side (RTL end), admin only */}
      {isAdmin && (
        <Pressable
          onPress={onRemove}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`הסר את ${member.name}`}
          className="p-2"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={20} color="#9ca3af" />
        </Pressable>
      )}

      {/* Name + avatar — right side (RTL start) */}
      <View className="flex-row items-center gap-3" style={{ flex: isAdmin ? 0 : 1, flexDirection: 'row' }}>
        <Text className="font-bold text-[15px] text-gray-900">
          {member.name}
        </Text>
        <View
          style={{ backgroundColor: member.color }}
          className="w-10 h-10 rounded-full items-center justify-center"
        >
          {isPet ? (
            <MaterialIcons name="pets" size={18} color="white" />
          ) : (
            <Text className="text-xs font-bold opacity-80">{initials}</Text>
          )}
        </View>
      </View>
    </>
  );

  if (isAdmin) {
    return (
      <Pressable
        onPress={onEdit}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`ערוך את ${member.name}`}
        className="bg-white p-4 rounded-2xl flex-row items-center justify-between mb-3"
        style={shadows.soft}
      >
        {inner}
      </Pressable>
    );
  }

  return (
    <View
      className="bg-white p-4 rounded-2xl flex-row-reverse items-center mb-3"
      style={shadows.soft}
    >
      {inner}
    </View>
  );
}

interface EditCardProps {
  name: string;
  color: string;
  onChangeName: (text: string) => void;
  onChangeColor: (color: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
  // FIXED: taken colors now show owner initials and are non-tappable
  /** Colors already taken by other family members — shown with initials, non-tappable */
  takenColors?: TakenColor[];
  /** Color palette to display; defaults to people palette inside ColorPicker */
  palette?: readonly string[];
}

export function FamilyMemberEditCard({
  name,
  color,
  onChangeName,
  onChangeColor,
  onConfirm,
  onCancel,
  label,
  takenColors,
  palette,
}: EditCardProps) {
  const canSave = name.trim().length > 0;

  return (
    <View
      className="bg-white border-2 p-4 rounded-2xl mb-3"
      style={[shadows.soft, { borderColor: colors.primary }]}
    >
      {/* Header row: label right, cancel X left */}
      <View className="flex-row-reverse items-center justify-between mb-3">
        {label ? (
          <Text className="text-xs font-semibold text-gray-500">{label}</Text>
        ) : (
          <View />
        )}
        <Pressable
          onPress={onCancel}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="ביטול"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="p-1"
        >
          <MaterialIcons name="close" size={20} color="#9ca3af" />
        </Pressable>
      </View>

      {/* Name input — single field, no split */}
      <View
        className="bg-[#f6f7f8] rounded-xl overflow-hidden mb-4"
        style={{ minHeight: 52 }}
      >
        <TextInput
          value={name}
          onChangeText={onChangeName}
          placeholder="שם..."
          placeholderTextColor="#9ca3af"
          className="flex-1 px-4 text-base font-bold text-[#111517]"
          style={{ textAlign: 'right', height: 52 }}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={canSave ? onConfirm : undefined}
        />
      </View>

      <ColorPicker
        selectedColor={color}
        onSelectColor={onChangeColor}
        takenColors={takenColors}
        palette={palette}
        size={38}
      />

      {/* Save button — blue, full width, disabled while name is empty */}
      <Pressable
        onPress={onConfirm}
        disabled={!canSave}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="שמירה"
        accessibilityState={{ disabled: !canSave }}
        className="mt-4 h-12 rounded-xl items-center justify-center"
        style={{ backgroundColor: canSave ? colors.primary : '#e5e7eb' }}
      >
        <Text
          className="font-bold text-base"
          style={{ color: canSave ? '#ffffff' : '#9ca3af' }}
        >
          שמירה
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXED: implemented family-member card UI with status chips and masked phone
// FIXED: wired correct actions per family-member status
// FIXED: role-aware management card — forbidden actions hidden for members
// Used exclusively in family-profile.tsx (settings screen).
// FamilyMemberDisplayCard is kept for onboarding-step4.tsx too.
// ─────────────────────────────────────────────────────────────────────────────

interface ManagementCardProps {
  member: FamilyMember;
  onEdit: () => void;
  onRemove: () => void;
  onSendInvite: () => void;
  onConvertToContact: () => void;
  // FIXED: role-aware actions — admin-only actions hidden for members
  isAdmin?: boolean;
  // FIXED: used to show "מנהל/ת המשפחה" badge when this entity row's matchedUserId is the admin
  adminUserId?: string;
}

export function FamilyMemberManagementCard({
  member,
  onEdit,
  onRemove,
  onSendInvite,
  onConvertToContact,
  isAdmin = true,
  adminUserId,
}: ManagementCardProps) {
  const initials = member.name.trim().substring(0, 2);
  const isPet = member.type === 'pet';

  // FIXED: deriveFamilyMemberBadge returns null for manual members (no badge shown)
  const badge = deriveFamilyMemberBadge(member);

  // FIXED: card now renders correct secondary line per member type
  // Contact → masked phone; Manual → descriptive text, no badge
  const effectiveSourceType =
    member.sourceType ?? (member.phone || member.contactId ? 'contact' : 'manual');
  const secondaryLabel =
    effectiveSourceType === 'contact' && (member.maskedPhone ?? member.phone)
      ? (member.maskedPhone ?? member.phone)
      : 'פרופיל ידני - ללא התחברות לאפליקציה';

  // FIXED: admin badge — shown when this entity row's matchedUserId is the space admin
  const isAdminEntity = Boolean(
    adminUserId && member.matchedUserId && member.matchedUserId === adminUserId
  );

  // Whether to show the actions separator row at all:
  // Admin → always show (has action buttons)
  // Member + badge==='מחובר' → show (green indicator)
  // Member + other → no actions to show, skip separator entirely
  const showActionsRow = isAdmin || badge === 'מחובר';

  return (
    <View className="bg-white rounded-2xl p-4 mb-3" style={shadows.soft}>
      {/* ── Top area: avatar | name+secondary | admin badge ── */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }}>
        {/* Avatar — rightmost in RTL */}
        <View
          className="w-11 h-11 rounded-full items-center justify-center"
          style={{ backgroundColor: member.color }}
        >
          {isPet ? (
            <MaterialIcons name="pets" size={19} color="white" />
          ) : (
            <Text className="text-xs font-bold text-white opacity-90">
              {initials}
            </Text>
          )}
        </View>

        {/* Name + secondary label — tappable to edit for admin only */}
        {isAdmin ? (
          <Pressable
            onPress={onEdit}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`ערוך את ${member.name}`}
            style={{ flex: 1 }}
          >
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text
                className="font-bold text-[15px] text-gray-900"
                numberOfLines={1}
              >
                {member.name}
              </Text>
              {/* FIXED: admin badge shown on entity row matching admin userId */}
              {isAdminEntity && (
                <View style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 99,
                  backgroundColor: '#e8f5fd',
                }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#36a9e2' }}>
                    מנהל/ת המשפחה
                  </Text>
                </View>
              )}
            </View>
            <Text
              className="text-xs text-gray-400 mt-0.5 text-right"
              numberOfLines={1}
            >
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text
                className="font-bold text-[15px] text-gray-900"
                numberOfLines={1}
              >
                {member.name}
              </Text>
              {/* FIXED: admin badge shown on entity row matching admin userId */}
              {isAdminEntity && (
                <View style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 99,
                  backgroundColor: '#e8f5fd',
                }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#36a9e2' }}>
                    מנהל/ת המשפחה
                  </Text>
                </View>
              )}
            </View>
            <Text
              className="text-xs text-gray-400 mt-0.5 text-right"
              numberOfLines={1}
            >
              {secondaryLabel}
            </Text>
          </View>
        )}
      </View>

      {/* ── Actions row — admin sees full controls; member sees only status indicator ── */}
      {showActionsRow && (
        <View
          style={{
            flexDirection: 'row-reverse',
            alignItems: 'center',
            marginTop: 10,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: '#f1f5f9',
            gap: 8,
          }}
        >
          {/* Primary action (admin only) — rightmost in RTL */}
          {isAdmin && (badge === 'שלח הזמנה' || badge === 'שלח שוב') && (
            <Pressable
              onPress={onSendInvite}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={badge}
              style={{
                flex: 1,
                backgroundColor: '#e8f5fd',
                borderRadius: 10,
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#36a9e2' }}>
                {badge}
              </Text>
            </Pressable>
          )}

          {/* Manual member (badge === null) — "הפוך לאיש קשר", admin only */}
          {isAdmin && badge === null && (
            <Pressable
              onPress={onConvertToContact}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="הפוך לאיש קשר"
              style={{
                flex: 1,
                backgroundColor: '#f1f5f9',
                borderRadius: 10,
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155' }}>
                הפוך לאיש קשר
              </Text>
            </Pressable>
          )}

          {/* "מחובר" — non-tappable green display block, shown for all roles */}
          {badge === 'מחובר' && (
            <View
              style={{
                flex: 1,
                backgroundColor: '#dcfce7',
                borderRadius: 10,
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#16a34a' }}>
                מחובר
              </Text>
            </View>
          )}

          {/* Edit — icon button, admin only */}
          {isAdmin && (
            <Pressable
              onPress={onEdit}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="עריכה"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: '#f6f7f8',
              }}
            >
              <MaterialIcons name="edit" size={16} color="#6b7280" />
            </Pressable>
          )}

          {/* Delete — icon button, admin only */}
          {isAdmin && (
            <Pressable
              onPress={onRemove}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="מחיקה"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: '#fff0f0',
              }}
            >
              <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
