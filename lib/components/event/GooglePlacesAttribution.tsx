import { Image, View } from 'react-native';

/** Official, unmodified Google Maps asset; fixed footer stays visible while scrolling. */
export function GooglePlacesAttribution(): React.JSX.Element {
  return (
    <View
      style={{
        paddingTop: 10,
        paddingBottom: 5,
        paddingHorizontal: 10,
        backgroundColor: '#fff',
      }}
    >
      <Image
        source={require('@/assets/images/google-maps-attribution.png')}
        style={{ width: 98, height: 18 }}
        resizeMode="contain"
        accessible={true}
        accessibilityLabel="Google Maps"
      />
    </View>
  );
}
