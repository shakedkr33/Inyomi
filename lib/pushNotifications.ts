import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const PROMPT_SEEN_KEY = 'inyomi_push_permission_prompt_seen';

// ─── Pending Navigation Store ─────────────────────────────────────────────────
// Notification handlers publish a screen target here.
// The authenticated layout subscribes and consumes the target when routing is
// ready. This decouples delivery (which can happen before the nav tree mounts)
// from execution.

type PendingNavigationListener = (screen: string) => void;

let pendingNavigationTarget: string | null = null;
const pendingNavigationListeners = new Set<PendingNavigationListener>();

function setPendingNavigationTarget(screen: string): void {
  pendingNavigationTarget = screen;
  for (const listener of pendingNavigationListeners) {
    listener(screen);
  }
}

export function consumePendingNavigationTarget(): string | null {
  const target = pendingNavigationTarget;
  pendingNavigationTarget = null;
  return target;
}

/**
 * Non-destructive read of the pending navigation target — unlike
 * consumePendingNavigationTarget(), this does NOT clear it. Used by the
 * cold-start notification guard (app/(authenticated)/_layout.tsx) to check
 * "was a target captured?" without consuming it before routing is ready.
 */
export function peekPendingNavigationTarget(): string | null {
  return pendingNavigationTarget;
}

export function subscribeToPendingNavigation(
  listener: PendingNavigationListener
): () => void {
  pendingNavigationListeners.add(listener);
  return () => {
    pendingNavigationListeners.delete(listener);
  };
}

// ─── Android Notification Channels ───────────────────────────────────────────
// Only "communities" is used in this sprint.
// The other channels (reminders, family, system) are pre-registered here so
// that future sprints can target them without requiring another native build.

export async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('communities', {
    name: 'קהילות',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'עדכונים ואירועים מקהילות',
  });

  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'תזכורות',
    importance: Notifications.AndroidImportance.HIGH,
    description: 'תזכורות לאירועים ומשימות',
  });

  await Notifications.setNotificationChannelAsync('family', {
    name: 'משפחה',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'עדכוני משפחה',
  });

  await Notifications.setNotificationChannelAsync('system', {
    name: 'מערכת',
    importance: Notifications.AndroidImportance.LOW,
    description: 'עדכוני מערכת',
  });
}

// ─── Notification Action Categories ──────────────────────────────────────────
// Registered for BOTH iOS and Android.
// expo-notifications supports setNotificationCategoryAsync on Android via the
// same API — action buttons are shown in the notification shade when the
// notification's categoryId matches a registered category.
// opensAppToForeground: true is intentional on all actions — these are
// state-changing operations (RSVP / calendar add / task add) where foreground
// execution guarantees the JS handler runs and the user sees the result.

export async function setupNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('COMMUNITY_EVENT_RSVP', [
    {
      identifier: 'RSVP_YES',
      buttonTitle: 'כן',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'RSVP_MAYBE',
      buttonTitle: 'אולי',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'RSVP_NO',
      buttonTitle: 'לא',
      options: { opensAppToForeground: true },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('COMMUNITY_EVENT_ADD', [
    {
      identifier: 'ADD_TO_CALENDAR',
      buttonTitle: 'הוסף ליומן',
      options: { opensAppToForeground: true },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('COMMUNITY_IMPORTANT_ITEM', [
    {
      identifier: 'ADD_TO_TASKS',
      buttonTitle: 'הוסף למשימות שלי',
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  if (!Device.isDevice) {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus !== 'granted') {
    const seen = await AsyncStorage.getItem(PROMPT_SEEN_KEY);
    if (seen) {
      return null;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    await AsyncStorage.setItem(PROMPT_SEEN_KEY, 'true');
    if (status !== 'granted') {
      return null;
    }
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
      ?.projectId;

  if (!projectId) {
    console.warn('[Push] Missing EAS projectId for push token registration');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

// ─── Cold-Start Capture ───────────────────────────────────────────────────────
// Must be called as early as possible (root layout mount). Reads the response
// that Expo Notifications stores when the OS launches the app from a cold state
// due to a notification tap, and publishes it to the pending navigation store.
// clearLastNotificationResponseAsync is available in expo-notifications ≥ 0.29;
// confirmed present in 0.32.17. It prevents the same response from being
// replayed on a subsequent app launch.

export async function captureColdStartNotification(): Promise<void> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return;

    const data = response.notification.request.content.data as
      | Record<string, unknown>
      | undefined;

    if (data?.screen && typeof data.screen === 'string') {
      setPendingNavigationTarget(data.screen);
    }

    await Notifications.clearLastNotificationResponseAsync();
  } catch (err) {
    console.warn('[Push] captureColdStartNotification failed:', err);
  }
}

// ─── Notification Response Listener ──────────────────────────────────────────

export function setupNotificationHandlers(): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const actionId = response.actionIdentifier;

      if (
        actionId === 'RSVP_YES' ||
        actionId === 'RSVP_MAYBE' ||
        actionId === 'RSVP_NO'
      ) {
        console.log(
          '[Push] RSVP action received (not wired yet):',
          actionId,
          data
        );
        return;
      }

      if (actionId === 'ADD_TO_CALENDAR') {
        console.log(
          '[Push] ADD_TO_CALENDAR action received (not wired yet):',
          data
        );
        return;
      }

      if (actionId === 'ADD_TO_TASKS') {
        console.log(
          '[Push] ADD_TO_TASKS action received (not wired yet):',
          data
        );
        return;
      }

      if (data?.screen && typeof data.screen === 'string') {
        setPendingNavigationTarget(data.screen);
      }
    }
  );

  return () => subscription.remove();
}
