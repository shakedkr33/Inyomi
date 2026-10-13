import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rtl } from '@/lib/rtl';
import { getHebcalRecordsForYear } from '@/lib/services/hebcalHolidayProvider';
import { HOLIDAY_CATEGORY_DEFINITIONS } from '@/lib/services/holidayCategoryDefinitions';
import {
  loadCalendarLayerFilters,
  saveCalendarLayerFilters,
} from '@/lib/storage/calendarLayerFilterPreferences';
import {
  loadHolidayOverlayPreferences,
  saveHolidayOverlayPreferences,
} from '@/lib/storage/holidayOverlayPreferences';
import type { HolidayCategoryId } from '@/lib/types/holidayOverlay';

// ── Category definitions (display order is fixed per spec) ────────────────────
// Shared with the Google Calendar import flow's holiday-selection step —
// see lib/services/holidayCategoryDefinitions.ts.

const CATEGORIES = HOLIDAY_CATEGORY_DEFINITIONS;

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HolidayOverlaySettingsScreen(): React.JSX.Element {
  const router = useRouter();

  /**
   * isHydrated: false while AsyncStorage is being read on mount.
   * Switches are disabled until hydration completes, preventing any
   * hydration-race from overwriting a user's immediate change.
   */
  const [isHydrated, setIsHydrated] = useState(false);
  const [enabledSet, setEnabledSet] = useState<Set<HolidayCategoryId>>(
    new Set()
  );

  // ── Load persisted preferences on mount ──────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const hydrate = async (): Promise<void> => {
      const prefs = await loadHolidayOverlayPreferences();
      if (!cancelled) {
        setEnabledSet(new Set(prefs.enabledCategories));
        setIsHydrated(true);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (categoryId: HolidayCategoryId): Promise<void> => {
      if (!isHydrated) return;

      const prevCount = enabledSet.size;
      const isCurrentlyEnabled = enabledSet.has(categoryId);

      const newSet = new Set(enabledSet);
      if (isCurrentlyEnabled) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      const newCount = newSet.size;

      // Update UI immediately (optimistic)
      setEnabledSet(newSet);

      // Persist holiday preferences
      await saveHolidayOverlayPreferences({
        enabledCategories: Array.from(newSet),
      });

      // ── Calendar filter sync: only at zero↔non-zero boundary ──────────────
      // Rule 1: zero → first category enabled → showHolidays true
      // Rule 2: last category disabled → zero → showHolidays false
      // Rule 3: changing categories while ≥1 remains enabled → no change to showHolidays

      if (prevCount === 0 && newCount > 0) {
        try {
          const existing = await loadCalendarLayerFilters();
          await saveCalendarLayerFilters({ ...existing, showHolidays: true });
        } catch {
          // Storage failure must not crash or block the UI
        }

        // Background cache warm-up for the current Gregorian year.
        // Fire-and-forget: never awaited, never blocks UI, errors ignored.
        void getHebcalRecordsForYear(new Date().getFullYear());
      } else if (prevCount > 0 && newCount === 0) {
        try {
          const existing = await loadCalendarLayerFilters();
          await saveCalendarLayerFilters({ ...existing, showHolidays: false });
        } catch {
          // Storage failure must not crash or block the UI
        }
      }
      // Mid-range change (≥1 enabled before AND after): showHolidays left intact.
    },
    [isHydrated, enabledSet]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.screen}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.back()}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="חזור"
        >
          <MaterialIcons name="arrow-forward-ios" size={20} color="#1e293b" />
        </Pressable>
        <Text style={s.headerTitle}>חגים ומועדים</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Description */}
        <Text style={s.description}>
          {'בחר/י אילו חגים וימים מיוחדים יוצגו ביומן שלך.'}
        </Text>

        {/* Toggle rows card — inline styles so layout is unambiguous in every build */}
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            marginHorizontal: 16,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          {CATEGORIES.map((cat, index) => {
            const isEnabled = isHydrated && enabledSet.has(cat.id);

            return (
              <React.Fragment key={cat.id}>
                <TouchableOpacity
                  onPress={() => void handleToggle(cat.id)}
                  disabled={!isHydrated}
                  activeOpacity={0.7}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked: isEnabled,
                    disabled: !isHydrated,
                  }}
                  accessibilityLabel={cat.label}
                  style={{
                    flexDirection: rtl.flexDirection,
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    minHeight: 72,
                    backgroundColor: '#ffffff',
                  }}
                >
                  {/* Physical RIGHT (RTL start): Text — flex 1 fills remaining space, never clipped */}
                  <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: isHydrated ? '#1a1a2e' : '#94a3b8',
                        textAlign: rtl.textAlign,
                        lineHeight: 22,
                        flexShrink: 1,
                      }}
                    >
                      {cat.label}
                    </Text>
                    {cat.subtitle !== undefined && (
                      <Text
                        style={{
                          fontSize: 13,
                          color: '#6b7280',
                          textAlign: rtl.textAlign,
                          marginTop: 2,
                          lineHeight: 19,
                          flexShrink: 1,
                        }}
                      >
                        {cat.subtitle}
                      </Text>
                    )}
                  </View>

                  {/* Physical LEFT (RTL end): Toggle — fixed 60pt column, pointer events blocked */}
                  <View
                    style={{
                      width: 60,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    pointerEvents="none"
                  >
                    <Switch
                      value={isEnabled}
                      onValueChange={() => void handleToggle(cat.id)}
                      disabled={!isHydrated}
                      trackColor={{ false: '#b0bec5', true: '#36a9e2' }}
                      thumbColor="#ffffff"
                      ios_backgroundColor="#b0bec5"
                    />
                  </View>
                </TouchableOpacity>

                {/* Divider between rows — not after the last */}
                {index < CATEGORIES.length - 1 && (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: '#f0f0f0',
                      marginLeft: 76,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Footer explanation */}
        <Text
          style={{
            fontSize: 13,
            color: '#6b7280',
            textAlign: rtl.textAlign,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 24,
            lineHeight: 22,
          }}
        >
          {
            'החגים מוצגים כשכבה ביומן ואינם אירועים אישיים. אפשר להסתיר אותם בכל עת דרך סינון היומן.'
          }
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles — only header/nav chrome; category rows and footer use inline styles ──

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  header: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: rtl.textAlign,
  },
  headerSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  description: {
    fontSize: 14,
    color: '#64748b',
    textAlign: rtl.textAlign,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
    lineHeight: 21,
  },
});
