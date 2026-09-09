import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '@/state/theme-context';
import { Colors } from '@/constants/theme';

export default function TabLayout() {
  const { theme } = useAppTheme();
  const activeColor = theme.backgroundSelected;
  const inactiveColor = theme.textSecondary;
  const tabBarBackground = theme.background;
  // Status bar content matches the scheme (light text on the dark theme).
  // Detected via the canonical dark base color — same check the grid uses.
  const isDark = theme.background === Colors.dark.background;

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
              <Ionicons name="grid-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="import"
          options={{
            title: '导入',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="document-text-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: '设置',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
