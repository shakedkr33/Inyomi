import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useStartupDestinationReady } from '@/lib/hooks/useStartupDestinationReady';

// מסך 404 - מוצג כאשר המשתמש מנסה לגשת לנתיב שאינו קיים
export default function NotFoundScreen() {
  // This top-level route can be the very first (and only) screen on a
  // cold start (e.g. a deep link to an unknown path), bypassing both the
  // (auth) and (authenticated) child InYomiSplashScreen layouts. Its own
  // root view laying out IS the real destination surface.
  const { onLayout: handleNotFoundDestinationLayout } =
    useStartupDestinationReady('not-found');

  return (
    <>
      <Stack.Screen options={{ title: 'אופס!' }} />
      <View
        className="flex-1 items-center justify-center p-5"
        onLayout={handleNotFoundDestinationLayout}
      >
        <Text className="text-xl font-bold">המסך הזה לא קיים.</Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-blue-500">חזור למסך הבית</Text>
        </Link>
      </View>
    </>
  );
}
