import { Tabs } from 'expo-router';
import { Image, useColorScheme } from 'react-native';

const iconStyle = (color: string, size: number) => ({
  width: size,
  height: size,
  tintColor: color,
});

export default function TabLayout() {
  const scheme = useColorScheme();
  const activeColor = scheme === 'dark' ? '#FFF' : '#153B50';
  const inactiveColor = scheme === 'dark' ? '#B4C5BE' : '#61706A';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: { backgroundColor: scheme === 'dark' ? '#14202B' : '#F7F8F6', borderTopWidth: 0, elevation: 0 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '课表',
          tabBarIcon: ({ color, size }) => (
            <Image source={require('../../../assets/images/tabIcons/home.png')} style={iconStyle(String(color), size)} />
          ),
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: '导入',
          tabBarIcon: ({ color, size }) => (
            <Image source={require('../../../assets/images/tabIcons/explore.png')} style={iconStyle(String(color), size)} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <Image source={require('../../../assets/images/tabIcons/explore.png')} style={iconStyle(String(color), size)} />
          ),
        }}
      />
    </Tabs>
  );
}