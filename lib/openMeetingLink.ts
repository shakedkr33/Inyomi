import { Alert, Linking } from 'react-native';
import { createMeetingLinkOpener } from './meetingLink';

export const openMeetingLink = createMeetingLinkOpener(
  (url) => Linking.openURL(url),
  (message) => Alert.alert('פתיחת פגישה', message)
);
