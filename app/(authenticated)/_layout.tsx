import { MaterialIcons } from '@expo/vector-icons'; // שימוש באייקונים מהעיצוב
import { useConvexAuth } from 'convex/react';
import { Redirect, Tabs, useRootNavigationState } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { PAYMENT_SYSTEM_ENABLED } from '@/config/appConfig';
import { useRevenueCat } from '@/contexts/RevenueCatContext';

export default function AuthenticatedLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isPremium, isLoading: isRevenueCatLoading } = useRevenueCat();
  const navigationState = useRootNavigationState();

  if (!navigationState?.key || isLoading || isRevenueCatLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#4A9FE2" />
      </View>
    );
  }

  if (!isAuthenticated && !__DEV__) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (PAYMENT_SYSTEM_ENABLED && !isPremium) {
    return <Redirect href="/(auth)/paywall" />;
  }

  const tabIcon = (iconName: string, color: string, focused: boolean) => (
    <View
      style={focused ? styles.activeTabHighlight : styles.inactiveTabWrapper}
    >
      <MaterialIcons name={iconName as never} size={24} color={color} />
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4A9FE2',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f0f0f0',
          height: 90,
          paddingBottom: 25,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
          marginTop: 5,
        },
      }}
    >
      {/* === 3 טאבים בלבד === */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'בית',
          tabBarIcon: ({ color, focused }) => tabIcon('home', color, focused),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'יומן',
          tabBarIcon: ({ color, focused }) =>
            tabIcon('calendar-today', color, focused),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'משימות',
          tabBarIcon: ({ color, focused }) =>
            tabIcon('check-circle-outline', color, focused),
        }}
      />

      {/* === מסכים מוסתרים מהטאב בר === */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="birthdays" options={{ href: null }} />
      <Tabs.Screen name="event/new" options={{ href: null }} />
      <Tabs.Screen name="event/[id]" options={{ href: null }} />
      <Tabs.Screen name="task/new" options={{ href: null }} />
      <Tabs.Screen name="task/[id]" options={{ href: null }} />
      <Tabs.Screen name="import-calendar" options={{ href: null }} />
      <Tabs.Screen name="import-holidays" options={{ href: null }} />
      <Tabs.Screen name="family-profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  activeTabHighlight: {
    backgroundColor: '#e0ecff',
    width: 55,
    height: 32,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  inactiveTabWrapper: {
    width: 55,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
