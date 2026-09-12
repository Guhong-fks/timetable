import { Redirect } from 'expo-router';

/**
 * 桌面小组件点击入口：coursetableapp://widget
 * 小组件 PendingIntent 以该 URI 打开 App，统一重定向回课表主页，
 * 避免 Expo Router 因未匹配路由而弹出 Unmatched Route。
 */
export default function WidgetRoute() {
  return <Redirect href="/" />;
}
