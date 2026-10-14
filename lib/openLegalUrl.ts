import { Alert, Linking } from 'react-native';

export async function openLegalUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('לא ניתן לפתוח את הקישור', 'אפשר לנסות שוב מאוחר יותר.');
  }
}
