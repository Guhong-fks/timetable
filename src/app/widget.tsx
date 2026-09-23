import { Redirect } from 'expo-router';

/**
 * 兼容旧版桌面组件的 coursetableapp://widget 链接。
 * 新版组件直接打开首页，不再经过此中转路由。
 */
export default function WidgetRoute() {
  return <Redirect href="/" />;
}
