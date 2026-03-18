import { useAuthActions } from '@convex-dev/auth/react';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { parseIsraeliPhone } from '@/lib/phoneUtils';

export default function PhoneInputScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const handleContinue = async () => {
    if (isLoading) return;

    const normalized = parseIsraeliPhone(phone.trim());
    if (!normalized) {
      setError(
        'מספר הטלפון לא תקין. אנא הזן/י מספר ישראלי בפורמט 05X-XXXXXXX.'
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await signIn('phone', { phone: normalized });
      router.push({
        pathname: '/(auth)/verify',
        params: { phone: normalized },
      });
    } catch (err) {
      console.error('[Auth] Failed to send OTP:', err);
      setError('לא הצלחנו לשלוח קוד. בדוק/י את החיבור לאינטרנט ונסה/י שוב.');
    } finally {
      setIsLoading(false);
    }
  };

  const hasInput = phone.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoWrapper}>
            <Image
              source={require('@/assets/images/logo-inyomi.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="InYomi Logo"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.headline}>כניסה מהירה</Text>

            <Text style={styles.supporting}>
              הקלד/י מספר טלפון ונשלח אליך קוד SMS להתחברות
            </Text>

            <Text style={styles.fieldLabel}>מספר טלפון</Text>

            <View
              style={[styles.phoneRow, error ? styles.phoneRowError : null]}
            >
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>+972</Text>
              </View>

              <View style={styles.prefixDivider} />

              <TextInput
                ref={inputRef}
                style={styles.input}
                value={phone}
                onChangeText={(text) => {
                  setPhone(text);
                  if (error) setError(null);
                }}
                placeholder="050-000-0000"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                returnKeyType="done"
                onSubmitEditing={handleContinue}
                autoFocus
                textAlign="left"
                accessible={true}
                accessibilityLabel="מספר טלפון"
                accessibilityHint="הזן/י מספר טלפון ישראלי"
              />
            </View>

            {error ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={handleContinue}
              style={[
                styles.cta,
                (!hasInput || isLoading) && styles.ctaDisabled,
              ]}
              disabled={!hasInput || isLoading}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="שלח קוד"
              accessibilityHint="שלח קוד אימות לטלפון"
              accessibilityState={{ disabled: !hasInput || isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.ctaText}>שלח קוד</Text>
              )}
            </Pressable>

            <Text style={styles.legal}>
              {'בלחיצה על "שלח קוד" הנך מאשר/ת את '}
              <Text
                style={styles.legalLink}
                onPress={() => {}}
                accessible={true}
                accessibilityRole="link"
                accessibilityLabel="תנאי השימוש"
              >
                תנאי השימוש
              </Text>
              {' ואת '}
              <Text
                style={styles.legalLink}
                onPress={() => {}}
                accessible={true}
                accessibilityRole="link"
                accessibilityLabel="מדיניות הפרטיות"
              >
                מדיניות הפרטיות
              </Text>
              {' של InYomi'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 40,
  },

  logoWrapper: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 150,
    height: 88,
  },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  headline: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111418',
    textAlign: 'center',
    marginBottom: 10,
  },
  supporting: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 8,
  },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    backgroundColor: '#f9fafb',
    overflow: 'hidden',
  },
  phoneRowError: {
    borderColor: '#ef4444',
    backgroundColor: '#fff5f5',
  },
  prefix: {
    paddingHorizontal: 14,
    height: '100%',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  prefixText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  prefixDivider: {
    width: 1,
    height: '65%',
    backgroundColor: '#d1d5db',
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 14,
    fontSize: 17,
    color: '#111418',
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'right',
  },

  cta: {
    marginTop: 24,
    marginBottom: 16,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#36A9E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    backgroundColor: '#A7D6F0',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  legal: {
    marginTop: 4,
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    color: '#36a9e2',
    textDecorationLine: 'underline',
  },
});
