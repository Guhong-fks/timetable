import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

/**
 * App 自绘的全屏启动页（借鉴 B站做法）：
 * 系统 Splash（白色底 + 小图标）只在 RN 加载前显示一瞬间；
 * RN 首帧渲染后立即接管，显示这张全屏图（宽度铺满屏幕、上下白色留白），
 * 等课表数据 hydrate 完成后再淡出。
 */
export function RnSplash({
  visible,
  onFadedOut,
  onReady,
  imageSource,
}: {
  visible: boolean;
  onFadedOut?: () => void;
  onReady?: () => void;
  imageSource?: ImageSourcePropType;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      opacity.setValue(1);
      return;
    }
    const anim = Animated.timing(opacity, {
      toValue: 0,
      duration: 350,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onFadedOut?.();
    });
    return () => anim.stop();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="auto">
      <Animated.View style={[styles.fill, { opacity }]}>
        <Image
          source={imageSource ?? require('../../assets/images/splash.png')}
          style={styles.image}
          resizeMode="contain"
          onLoad={onReady}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 9999,
    elevation: 9999,
  },
  fill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
