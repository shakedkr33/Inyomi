import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useAction } from 'convex/react';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '@/convex/_generated/api';
import type { PlaceSuggestion } from '@/convex/googlePlaces';
import type { LocationSource } from '@/lib/eventLocation';
import { rtl } from '@/lib/rtl';
import { GooglePlacesAttribution } from './GooglePlacesAttribution';

const PRIMARY = '#36a9e2';
const TINT = '#e8f5fd';
const AUTOCOMPLETE_DEBOUNCE_MS = 250;

// ─── Types ────────────────────────────────────────────────────────────────────

type LocMode = 'address' | 'link';

export type { PlaceSuggestion } from '@/convex/googlePlaces';

/** Values emitted on every change. Callers spread these into event state. */
export interface LocationUpdate {
  onlineUrlEdited?: boolean;
  location: string; // physical address → EventData.location
  onlineUrl: string; // meeting URL     → EventData.onlineUrl
  /** Empty string clears legacy coordinates. */
  locationUrl?: string;
  locationSource?: LocationSource | null;
  googlePlaceId?: string | null;
}

/**
 * Anchor data emitted to the parent so it can render the suggestion list
 * as a screen-level overlay (not clipped by the editor ScrollView).
 */
export interface LocationOverlayAnchor {
  /** Absolute screen x of the input */
  inputX: number;
  /** Absolute screen y of the TOP edge of the input */
  inputY: number;
  /** Input height in screen pixels */
  inputHeight: number;
  /** Input width in screen pixels */
  inputWidth: number;
  suggestions: PlaceSuggestion[];
  /** Cancel blur timer so suggestion presses aren't swallowed */
  onPressIn: () => void;
  onSelect: (s: PlaceSuggestion) => void;
  onDismiss: () => void;
}

interface LocationCardProps {
  locationUrl?: string;
  locationSource?: LocationSource | null;
  googlePlaceId?: string | null;
  /** Current physical address (EventData.location) */
  location?: string;
  /** Current meeting URL (EventData.onlineUrl) */
  onlineUrl?: string;
  onChange: (update: LocationUpdate) => void;
  /**
   * When provided, suggestion list is NOT rendered inline.
   * Instead this callback is invoked with anchor data so the parent can
   * render the list in a screen-level overlay that isn't clipped.
   * Pass null to dismiss the overlay.
   */
  onOverlayUpdate?: (anchor: LocationOverlayAnchor | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LocationCard({
  location,
  onlineUrl,
  locationUrl,
  locationSource,
  googlePlaceId,
  onChange,
  onOverlayUpdate,
}: LocationCardProps): React.JSX.Element {
  const autocomplete = useAction(api.googlePlaces.autocomplete);
  const details = useAction(api.googlePlaces.details);
  const sessionRef = useRef<string | null>(null);
  const autocompleteRequestRef = useRef<AbortController | null>(null);
  const [searchError, setSearchError] = useState(false);
  const hasAddress = !!location?.trim();
  const hasLink = !!onlineUrl?.trim();

  // Derive initial open/mode from saved values
  const [cardOpen, setCardOpen] = useState(hasAddress || hasLink);
  const [locMode, setLocMode] = useState<LocMode>(hasLink ? 'link' : 'address');
  // Editing-session drafts only. Parent state always contains the active tab's
  // save payload; switching does not destroy the other tab's draft.
  const addressDraft = useRef<LocationUpdate>({
    location: location ?? '',
    onlineUrl: '',
    locationUrl,
    locationSource,
    googlePlaceId,
  });
  const linkDraft = useRef(onlineUrl ?? '');
  const linkEdited = useRef(false);
  const emitAddress = useCallback(
    (update: LocationUpdate) => {
      addressDraft.current = update;
      onChange(update);
    },
    [onChange]
  );
  const [addressFocused, setAddressFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const addressInputRef = useRef<TextInput>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const input = location?.trim() ?? '';
    if (!addressFocused || input.length < 2 || input.length > 200) {
      setSuggestions([]);
      return undefined;
    }

    const controller = new AbortController();
    autocompleteRequestRef.current = controller;
    sessionRef.current ??= randomUUID();
    const sessionToken = sessionRef.current;
    const timer = setTimeout(() => {
      const loadSuggestions = async (): Promise<void> => {
        if (controller.signal.aborted) return;
        try {
          const result = await autocomplete({ input, sessionToken });
          if (!controller.signal.aborted) {
            setSuggestions(result.ok ? result.value : []);
            setSearchError(!result.ok);
          }
        } catch {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setSearchError(true);
          }
        }
      };
      void loadSuggestions();
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [addressFocused, location, autocomplete]);

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      detailsRequestRef.current?.abort();
    },
    []
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const closeSuggestions = useCallback((): void => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    autocompleteRequestRef.current?.abort();
    sessionRef.current = null;
    setAddressFocused(false);
    setSuggestions([]);
    onOverlayUpdate?.(null);
  }, [onOverlayUpdate]);

  const handleOpen = (): void => {
    setLocMode('address');
    setCardOpen(true);
  };

  const handleClose = (): void => {
    closeSuggestions();
    detailsRequestRef.current?.abort();
    setCardOpen(false);
    setLocMode('address');
    linkDraft.current = '';
    linkEdited.current = false;
    emitAddress({
      location: '',
      onlineUrl: '',
      locationUrl: '',
      locationSource: null,
      googlePlaceId: null,
    });
  };

  const switchMode = (mode: LocMode): void => {
    if (mode === locMode) return;
    closeSuggestions();
    detailsRequestRef.current?.abort();
    setSearchError(false);
    setLocMode(mode);
    onChange(
      mode === 'address'
        ? addressDraft.current
        : {
            location: '',
            onlineUrl: linkDraft.current,
            onlineUrlEdited: linkEdited.current,
            locationUrl: '',
            locationSource: null,
            googlePlaceId: null,
          }
    );
  };

  const handleAddressChange = (text: string): void => {
    autocompleteRequestRef.current?.abort();
    setSuggestions([]);
    setSearchError(false);
    if (!text.trim()) sessionRef.current = null;
    detailsRequestRef.current?.abort();
    emitAddress({
      location: text,
      onlineUrl: '',
      locationUrl: '',
      locationSource: text.trim() ? 'manual' : null,
      googlePlaceId: null,
    });
  };

  const handleAddressFocus = (): void => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setAddressFocused(true);
  };

  const handleAddressBlur = (): void => {
    blurTimerRef.current = setTimeout(closeSuggestions, 150);
  };

  const handleSuggestionPress = useCallback(
    async (suggestion: PlaceSuggestion): Promise<void> => {
      const sessionToken = sessionRef.current;
      closeSuggestions();
      setSearchError(false);
      addressInputRef.current?.blur();
      Keyboard.dismiss();

      emitAddress({
        location: suggestion.description,
        onlineUrl: '',
        locationUrl: '',
        locationSource: 'google',
        googlePlaceId: suggestion.placeId,
      });

      detailsRequestRef.current?.abort();
      if (!sessionToken) return;

      const controller = new AbortController();
      detailsRequestRef.current = controller;
      try {
        const result = await details({
          placeId: suggestion.placeId,
          sessionToken,
        });
        // Complete the existing autocomplete session, but never persist Details
        // coordinates or let its response rewrite the selected address.
        if (!controller.signal.aborted && !result.ok) setSearchError(true);
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
        // Keep the selected description as a plain address if details fail.
      } finally {
        if (detailsRequestRef.current === controller) {
          detailsRequestRef.current = null;
        }
      }
    },
    [closeSuggestions, emitAddress, details]
  );

  // ── Overlay: notify parent when anchor position / suggestions change ────────
  //
  // Live refs for callbacks that would otherwise appear in the effect deps and
  // create an infinite loop:
  //   onChange (EventScreen prop) is an inline arrow → new reference every render
  //   → handleSuggestionPress (depends on onChange) gets a new identity
  //   → overlay effect re-runs → measureInWindow → setLocationOverlay (EventScreen)
  //   → EventScreen re-renders → new onChange → loop
  //
  // By reading callbacks through stable refs the effect only runs when the truly
  // meaningful inputs change: focus state, suggestion content, or the parent callback.
  const latestHandleSuggestionPress = useRef(handleSuggestionPress);
  latestHandleSuggestionPress.current = handleSuggestionPress;
  const latestCloseSuggestions = useRef(closeSuggestions);
  latestCloseSuggestions.current = closeSuggestions;

  useEffect(() => {
    if (!onOverlayUpdate) return;
    if (!addressFocused || suggestions.length === 0) {
      onOverlayUpdate(null);
      return;
    }
    // measureInWindow gives absolute screen coordinates (accounts for scroll/layout)
    let active = true;
    addressInputRef.current?.measureInWindow((x, y, w, h) => {
      if (!active) return;
      onOverlayUpdate({
        inputX: x,
        inputY: y,
        inputHeight: h,
        inputWidth: w,
        suggestions,
        onPressIn: () => {
          if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
        },
        onSelect: (s) => {
          void latestHandleSuggestionPress.current(s);
        },
        onDismiss: () => latestCloseSuggestions.current(),
      });
    });
    return () => {
      active = false;
    };
  }, [
    addressFocused,
    suggestions,
    onOverlayUpdate,
    // closeSuggestions and handleSuggestionPress are accessed via live refs above
    // so their identity changes do not re-trigger the measurement effect.
  ]);

  // ── Collapsed ─────────────────────────────────────────────────────────────

  if (!cardOpen) {
    return (
      <Pressable
        style={s.emptyRow}
        onPress={handleOpen}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="הוספת מיקום"
      >
        <View style={s.emptyIconCircle}>
          <Ionicons name="location-outline" size={18} color="#36a9e2" />
        </View>
        <Text style={s.emptyText}>הוספת מיקום</Text>
      </Pressable>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────

  return (
    <View style={s.card}>
      {/* Header: label first (physical RIGHT in RTL), X button last (physical LEFT) */}
      <View style={s.headerRow}>
        <Text style={s.headerLabel}>מיקום</Text>
        <Pressable
          onPress={handleClose}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="הסרת מיקום"
          style={s.closeBtn}
        >
          <MaterialIcons name="close" size={16} color="#94a3b8" />
        </Pressable>
      </View>

      {/* Mode chips — כתובת first (physical RIGHT in RTL), קישור second */}
      <View style={s.typeRow}>
        <TypeChip
          label="כתובת"
          active={locMode === 'address'}
          onPress={() => switchMode('address')}
        />
        <TypeChip
          label="קישור"
          active={locMode === 'link'}
          onPress={() => switchMode('link')}
        />
      </View>

      {/* ── Address mode: Google Places Autocomplete ── */}
      {locMode === 'address' && (
        <View style={s.inputWrapper}>
          <TextInput
            ref={addressInputRef}
            style={s.placesTextInput}
            value={location ?? ''}
            onChangeText={handleAddressChange}
            onFocus={handleAddressFocus}
            onBlur={handleAddressBlur}
            placeholder="חיפוש כתובת..."
            placeholderTextColor="#94a3b8"
            textAlign={rtl.inputTextAlign}
            clearButtonMode="while-editing"
            accessible={true}
            accessibilityLabel="חיפוש כתובת"
          />

          {searchError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: '#475569', textAlign: rtl.textAlign }}
            >
              חיפוש המיקום לא זמין כרגע. אפשר להזין כתובת ידנית.
            </Text>
          ) : null}
          {addressFocused && suggestions.length > 0 && !onOverlayUpdate ? (
            <InlineSuggestionList
              suggestions={suggestions}
              onPressIn={() => {
                if (blurTimerRef.current) {
                  clearTimeout(blurTimerRef.current);
                  blurTimerRef.current = null;
                }
              }}
              onSelect={(s) => void handleSuggestionPress(s)}
            />
          ) : null}
        </View>
      )}

      {/* ── Link mode: plain URL TextInput ── */}
      {locMode === 'link' && (
        <View style={s.inputWrapper}>
          <TextInput
            style={s.linkInput}
            value={onlineUrl ?? ''}
            onChangeText={(text) => {
              linkDraft.current = text;
              linkEdited.current = true;
              onChange({
                location: '',
                onlineUrl: text,
                onlineUrlEdited: true,
                locationUrl: '',
                locationSource: null,
                googlePlaceId: null,
              });
            }}
            placeholder="https://..."
            placeholderTextColor="#94a3b8"
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessible={true}
            accessibilityLabel="קישור לפגישה"
          />
        </View>
      )}
    </View>
  );
}

// ─── InlineSuggestionList (fallback when no overlay callback) ─────────────────

function InlineSuggestionList({
  suggestions,
  onPressIn,
  onSelect,
}: {
  suggestions: PlaceSuggestion[];
  onPressIn: () => void;
  onSelect: (s: PlaceSuggestion) => void;
}): React.JSX.Element {
  return (
    <View style={s.placesList}>
      <ScrollView
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={true}
      >
        {suggestions.map((suggestion, index) => (
          <Pressable
            key={suggestion.placeId}
            style={[
              s.placesRow,
              index < suggestions.length - 1 && s.placesRowWithSeparator,
            ]}
            onPressIn={onPressIn}
            onPress={() => onSelect(suggestion)}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`בחירת כתובת: ${suggestion.description}`}
          >
            <Text style={s.placesDescription}>{suggestion.description}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <GooglePlacesAttribution />
    </View>
  );
}

// ─── TypeChip ─────────────────────────────────────────────────────────────────

function TypeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[s.typeChip, active && s.typeChipActive]}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[s.typeChipText, active && s.typeChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  emptyRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: rtl.textAlign,
  },
  emptyIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8f5fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingTop: 14,
    paddingHorizontal: 14,
    // No paddingBottom — inputWrapper provides the section's bottom spacing
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    zIndex: 10,
    gap: 10,
  },
  headerRow: {
    flexDirection: rtl.flexDirection,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  closeBtn: {
    padding: 4,
  },
  typeRow: {
    flexDirection: rtl.flexDirection,
    gap: 8,
    justifyContent: 'flex-start',
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  typeChipActive: {
    backgroundColor: TINT,
    borderColor: PRIMARY,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  typeChipTextActive: {
    color: PRIMARY,
  },
  inputWrapper: {
    position: 'relative',
    zIndex: 20,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    paddingBottom: 14,
  },

  // ── Inline Google Places autocomplete ─────────────────────────────────────
  placesTextInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fafafa',
    textAlign: rtl.inputTextAlign,
    marginBottom: 0,
  },
  placesList: {
    position: 'absolute',
    top: 62,
    right: 0,
    left: 0,
    zIndex: 30,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    marginTop: 4,
    backgroundColor: '#fff',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  placesRow: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  placesRowWithSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  placesDescription: {
    fontSize: 14,
    color: '#111827',
    textAlign: rtl.textAlign,
  },
  // ── Link (URL) input ──────────────────────────────────────────────────────
  linkInput: {
    height: 42,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fafafa',
    textAlign: rtl.inputTextAlign,
  },
});
