import { useAuthActions } from '@convex-dev/auth/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

// Maps @convex-dev/auth error messages to human Hebrew copy
function mapAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('invalid') || msg.includes('incorrect') || msg.includes('wrong')) {
    return 'הקוד שגוי. בדקי ונסי שוב.';
  }
  if (msg.includes('expired')) {
    return 'הקוד פג תוקף. לחצי על "שלח קוד חדש".';
  }
  if (msg.includes('rate') || msg.includes('too many') || msg.includes('limit')) {
    return 'יותר מדי ניסיונות. המתיני כמה דקות ונסי שוב.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
    return 'בעיית חיבור. בדקי את האינטרנט ונסי שוב.';
  }
  return 'משהו השתבש. בדקי את החיבור ונסי שוב.';
}

export default function VerifyScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [canResend, setCanResend] = useState(false);

  // Hidden input ref — we focus it when user taps the visual boxes
  const hiddenInputRef = useRef<TextInput>(null);

  // If phone param is missing (e.g. deep link / reload), send user back
  useEffect(() => {
    if (!phone) {
      router.replace('/(auth)/sign-in');
    }
  }, [phone, router]);

  // Resend cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = useCallback(
    async (digits: string) => {
      if (!phone || digits.length !== CODE_LENGTH || isVerifying) return;

      setIsVerifying(true);
      setError(null);

      try {
        await signIn('phone', { phone, code: digits });
        // Navigate to onboarding so new users always start the onboarding flow.
        // router.replace prevents going back to the verify screen.
        router.replace('/onboarding-step1');
      } catch (err) {
        console.error('[Auth] OTP verify failed:', err);
        setError(mapAuthError(err));
        // Clear the entered code so user can try again cleanly
        setCode('');
      } finally {
        setIsVerifying(false);
      }
    },
    [phone, isVerifying, signIn]
  );

  const handleCodeChange = (text: string) => {
    // Strip non-digits, cap at CODE_LENGTH
    const digits = text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);

    // Auto-submit when all digits are entered
    if (digits.length === CODE_LENGTH) {
      verify(digits);
    }
  };

  const handleResend = async () => {
    if (!canResend || isResending || isVerifying || !phone) return;

    setIsResending(true);
    setError(null);
    setCode('');

    try {
      await signIn('phone', { phone });
      // Reset cooldown for another 60 s
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCanResend(false);
      Alert.alert('נשלח!', 'קוד חדש נשלח למספר שלך.');
    } catch (err) {
      console.error('[Auth] Resend OTP failed:', err);
      setError('לא הצלחנו לשלוח קוד חדש. נסי שוב.');
    } finally {
      setIsResending(false);
    }
  };

  const focusInput = () => {
    hiddenInputRef.current?.focus();
  };

  // Display phone number partially masked for UX (keep last 4 digits visible)
  const maskedPhone = phone
    ? phone.replace(/(\+972)(\d+)(\d{4})$/, '$1•••$3')
    : '';

  const isSubmitting = isVerifying || isResending;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* כפתור חזרה */}
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="חזרה להזנת מספר טלפון"
            disabled={isSubmitting}
          >
            <Text style={styles.backBtnText}>→</Text>
          </Pressable>

          {/* כותרות */}
          <View style={styles.headerBlock}>
            <Text style={styles.title}>מה הקוד שקיבלת?</Text>
            <Text style={styles.subtitle}>
              שלחנו קוד בן 6 ספרות ל-{maskedPhone || 'הטלפון שלך'}
            </Text>
            {__DEV__ && (
              <Text style={styles.devHint}>
                DEV: קוד מופיע ב-Convex Dashboard logs
              </Text>
            )}
          </View>

          {/* קוד OTP — hidden input + boxes ויזואליים */}
          <Pressable
            onPress={focusInput}
            accessible={false}
            style={styles.codeContainer}
          >
            {/* Hidden input that captures all keyboard input and SMS autofill */}
            <TextInput
              ref={hiddenInputRef}
              value={code}
              onChangeText={handleCodeChange}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              // iOS SMS autofill
              textContentType="oneTimeCode"
              // Android SMS autofill
              autoComplete="sms-otp"
              autoFocus
              editable={!isSubmitting}
              style={styles.hiddenInput}
              accessibilityLabel="קוד אימות"
              accessibilityHint="הזיני את 6 הספרות שקיבלת בהודעה"
            />

            {/* Visual digit boxes — always LTR for numeric codes */}
            <View style={styles.boxesRow}>
              {Array.from({ length: CODE_LENGTH }).map((_, i) => {
                const isFocused = !isSubmitting && code.length === i;
                const isFilled = i < code.length;
                return (
                  <View
                    key={i}
                    style={[
                      styles.digitBox,
                      isFocused && styles.digitBoxFocused,
                      isFilled && styles.digitBoxFilled,
                      error && styles.digitBoxError,
                    ]}
                  >
                    {isVerifying && i === code.length - 1 ? (
                      <ActivityIndicator size="small" color="#4A9FE2" />
                    ) : (
                      <Text style={styles.digitText}>{code[i] ?? ''}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </Pressable>

          {/* שגיאה */}
          {error ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          {/* כפתור אישור — גיבוי כשאוטומטי לא מופעל */}
          <Pressable
            onPress={() => verify(code)}
            style={[
              styles.confirmBtn,
              (code.length < CODE_LENGTH || isSubmitting) && styles.confirmBtnDisabled,
            ]}
            disabled={code.length < CODE_LENGTH || isSubmitting}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="אמתי קוד"
            accessibilityState={{ disabled: code.length < CODE_LENGTH || isSubmitting }}
          >
            {isVerifying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmBtnText}>אישור</Text>
            )}
          </Pressable>

          {/* שליחה מחדש */}
          <View style={styles.resendRow}>
            {canResend ? (
              <Pressable
                onPress={handleResend}
                disabled={isResending || isVerifying}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="שלח קוד חדש"
              >
                {isResending ? (
                  <ActivityIndicator size="small" color="#4A9FE2" />
                ) : (
                  <Text style={styles.resendActive}>שלח לי קוד חדש</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.resendCooldown}>
                שליחה מחדש אפשרית בעוד {cooldown} שניות
              </Text>
            )}
          </View>

          {/* אם לא קיבלת — הנחיה */}
          <Text style={styles.helpText}>
            {`לא קיבלת קוד? בדקי שהמספר נכון, ולאחר ${RESEND_COOLDOWN_SECONDS} שניות תוכלי לבקש קוד חדש.`}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  backBtn: {
    alignSelf: 'flex-end',
    padding: 8,
    marginBottom: 8,
  },
  backBtnText: {
    fontSize: 22,
    color: '#4A9FE2',
  },
  headerBlock: {
    marginTop: 24,
    marginBottom: 40,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111418',
    textAlign: 'right',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'right',
  },
  devHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#f59e0b',
    textAlign: 'right',
    fontStyle: 'italic',
  },
  codeContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  // Absolutely hidden but still accessible to keyboard and autofill
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  },
  // Force LTR for digit boxes — OTP codes are always left-to-right
  boxesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  digitBox: {
    width: 48,
    height: 60,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  digitBoxFocused: {
    borderColor: '#4A9FE2',
    backgroundColor: '#eff6ff',
  },
  digitBoxFilled: {
    borderColor: '#4A9FE2',
    backgroundColor: '#ffffff',
  },
  digitBoxError: {
    borderColor: '#ef4444',
    backgroundColor: '#fff5f5',
  },
  digitText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111418',
  },
  errorText: {
    fontSize: 14,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  confirmBtn: {
    height: 56,
    backgroundColor: '#4A9FE2',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#4A9FE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnDisabled: {
    backgroundColor: '#bfdbfe',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  resendRow: {
    alignItems: 'center',
    marginTop: 24,
    minHeight: 28,
  },
  resendActive: {
    fontSize: 15,
    color: '#4A9FE2',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resendCooldown: {
    fontSize: 14,
    color: '#9ca3af',
  },
  helpText: {
    marginTop: 20,
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
});
