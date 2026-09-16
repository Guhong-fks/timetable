import { BG_IMAGE_KEY, BG_OPACITY_KEY, SPLASH_IMAGE_KEY } from '@/constants/storage-keys';
import { createCropTarget } from '@/lib/image-crop';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Dimensions, PixelRatio } from 'react-native';

/** 课表背景图默认透明度（浅色模式；深色模式会再减半）。 */
const DEFAULT_BG_OPACITY = 0.3;

type ViewportSize = { width: number; height: number };

interface BackgroundContextValue {
  /** 用户自选课表背景图的本地 URI；null 表示用内置默认立绘。 */
  bgImageUri: string | null;
  /** 课表背景图透明度 0~1。 */
  bgOpacity: number;
  /** 用户自选启动页图的本地 URI；null 表示用内置默认立绘。 */
  splashImageUri: string | null;
  /** 记录课表背景实际铺设区域，供裁剪器使用。 */
  setTimetableViewportSize: (size: ViewportSize) => void;
  /** 打开相册并按目标区域裁剪、持久化图片。 */
  pickBgImage: () => Promise<void>;
  resetBgImage: () => Promise<void>;
  setBgOpacity: (v: number) => Promise<void>;
  pickSplashImage: () => Promise<void>;
  resetSplashImage: () => Promise<void>;
}

const BackgroundContext = createContext<BackgroundContextValue | null>(null);

/** 把裁剪后的临时图片复制到文档目录，避免被系统缓存清理。 */
async function copyToDocuments(uri: string, name: string): Promise<string> {
  const dir = FileSystem.documentDirectory ?? '';
  const dest = `${dir}${name}`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

async function pickAndCrop(size: ViewportSize, name: string): Promise<string | null> {
  const target = createCropTarget(size.width, size.height, PixelRatio.get());
  if (!target) return null;

  // Android Photo Picker 的编辑器支持双指缩放与拖动；aspect 锁定为目标区域比例。
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: target.aspect,
    quality: 1,
  });
  if (res.canceled || !res.assets[0]) return null;

  // 编辑器负责自由裁剪；这里把结果统一到实际显示区域的物理像素尺寸，
  // 避免超大原图浪费空间，也避免低分辨率图片显示发虚。
  const output = await manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: target.outputWidth, height: target.outputHeight } }],
    { compress: 0.9, format: SaveFormat.JPEG },
  );
  return copyToDocuments(output.uri, name);
}

export function BackgroundProvider({ children }: PropsWithChildren) {
  const [bgImageUri, setBgImageUri] = useState<string | null>(null);
  const [bgOpacity, setBgOpacityState] = useState(DEFAULT_BG_OPACITY);
  const [splashImageUri, setSplashImageUri] = useState<string | null>(null);
  const [timetableViewport, setTimetableViewport] = useState<ViewportSize>(() => {
    const window = Dimensions.get('window');
    return { width: window.width, height: window.height };
  });

  useEffect(() => {
    void (async () => {
      const [bg, op, sp] = await Promise.all([
        getStoredValue(BG_IMAGE_KEY),
        getStoredValue(BG_OPACITY_KEY),
        getStoredValue(SPLASH_IMAGE_KEY),
      ]);
      if (bg) setBgImageUri(bg);
      if (op !== null) {
        const n = Number(op);
        if (Number.isFinite(n)) setBgOpacityState(Math.min(1, Math.max(0.05, n)));
      }
      if (sp) setSplashImageUri(sp);
    })();
  }, []);

  const setTimetableViewportSize = useCallback((size: ViewportSize) => {
    if (size.width <= 0 || size.height <= 0) return;
    setTimetableViewport(previous => (
      Math.abs(previous.width - size.width) < 1 && Math.abs(previous.height - size.height) < 1
        ? previous
        : size
    ));
  }, []);

  const pickBgImage = useCallback(async () => {
    const saved = await pickAndCrop(timetableViewport, 'custom_bg.jpg');
    if (!saved) return;
    setBgImageUri(saved);
    await setStoredValue(BG_IMAGE_KEY, saved);
  }, [timetableViewport]);

  const resetBgImage = useCallback(async () => {
    setBgImageUri(null);
    await setStoredValue(BG_IMAGE_KEY, '');
  }, []);

  const setBgOpacity = useCallback(async (v: number) => {
    const clamped = Math.min(1, Math.max(0.05, v));
    setBgOpacityState(clamped);
    await setStoredValue(BG_OPACITY_KEY, JSON.stringify(clamped));
  }, []);

  const pickSplashImage = useCallback(async () => {
    const window = Dimensions.get('window');
    const saved = await pickAndCrop(
      { width: window.width, height: window.height },
      'custom_splash.jpg',
    );
    if (!saved) return;
    setSplashImageUri(saved);
    await setStoredValue(SPLASH_IMAGE_KEY, saved);
  }, []);

  const resetSplashImage = useCallback(async () => {
    setSplashImageUri(null);
    await setStoredValue(SPLASH_IMAGE_KEY, '');
  }, []);

  return (
    <BackgroundContext.Provider
      value={{
        bgImageUri,
        bgOpacity,
        splashImageUri,
        setTimetableViewportSize,
        pickBgImage,
        resetBgImage,
        setBgOpacity,
        pickSplashImage,
        resetSplashImage,
      }}
    >
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground(): BackgroundContextValue {
  const ctx = useContext(BackgroundContext);
  if (!ctx) throw new Error('useBackground must be used inside BackgroundProvider');
  return ctx;
}
