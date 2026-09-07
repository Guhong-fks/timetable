import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useAppTheme } from '@/state/theme-context';

export default function TabLayout() {
  const { theme } = useAppTheme();
  const activeColor = theme.backgroundSelected;
  const inactiveColor = theme.textSecondary;
  const tabBarBackground = theme.background;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: { backgroundColor: tabBarBackground, borderTopWidth: 0, elevation: 0 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '课表',
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={{ ios: 'tablecells', android: 'table_view', web: 'table_view' }} tintColor={color} size={24} weight="semibold" />
          ),
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: '导入',
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={{ ios: 'doc.badge.plus', android: 'file_upload', web: 'file_upload' }} tintColor={color} size={24} weight="semibold" />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} tintColor={color} size={24} weight="semibold" />
          ),
        }}
      />
    </Tabs>
  );
}