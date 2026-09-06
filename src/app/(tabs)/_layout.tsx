import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useColorScheme } from 'react-native';

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
            <SymbolView name={{ ios: 'tablecells', android: 'table_view', web: 'table_view' }} tintColor={color} size={size} weight="semibold" />
          ),
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: '导入',
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={{ ios: 'doc.badge.plus', android: 'file_upload', web: 'file_upload' }} tintColor={color} size={size} weight="semibold" />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} tintColor={color} size={size} weight="semibold" />
          ),
        }}
      />
    </Tabs>
  );
}