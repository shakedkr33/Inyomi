import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isNavigating = useRef(false);

  const goToSignIn = () => {
    if (isNavigating.current) return;
    isNavigating.current = true;
    router.replace('/(auth)/sign-in');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.phoneSection}>
          <View style={styles.phoneMockup}>
            <View style={styles.phoneScreen}>
              <View style={styles.phoneScreenPlaceholder} />
            </View>
          </View>
        </View>

        <View style={styles.brandSection}>
          <Image
            source={require('@/assets/images/logo-inyomi.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="InYomi Logo"
          />

          <Text style={styles.headline}>
            כל האירועים, המשימות והתיאומים שלך במקום אחד
          </Text>
        </View>
      </View>

      <Pressable
        onPress={goToSignIn}
        style={[styles.cta, { bottom: insets.bottom + 24 }]}
        accessibilityRole="button"
        accessibilityLabel="בואו נתחיל"
      >
        <Text style={styles.ctaText}>בואו נתחיל</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f6f7f8',
    paddingHorizontal: 24,
    position: 'relative',
  },

  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 170,
  },

  phoneSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },

  phoneMockup: {
    width: 270,
    height: 500,
    backgroundColor: '#0d1117',
    borderRadius: 48,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 16,
  },

  phoneScreen: {
    flex: 1,
    borderRadius: 36,
    overflow: 'hidden',
    backgroundColor: '#e8edf2',
  },

  phoneScreenPlaceholder: {
    flex: 1,
    backgroundColor: '#dde5ec',
  },

  brandSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },

  logo: {
    width: 150,
    height: 88,
    marginBottom: 4,
  },

  headline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111418',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
    maxWidth: 320,
  },

  cta: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 60,
    backgroundColor: '#36A9E2',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    borderWidth: 1,
    borderColor: '#2497d3',
  },

  ctaText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
});
