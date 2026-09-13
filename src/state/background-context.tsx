import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getStoredValue, setStoredValue } from '@/lib/storage';
import { BG_IMAGE_KEY, BG_OPACITY_KEY, SPLASH_IMAGE_KEY } from '@/constants/storage-keys';

/** 课表背景图默认透明度（浅色模式；深色模式会再减半）。 */
export const DEFAULT_BG_OPACITY = 0.3;

interface BackgroundContextValue {
  /** 用户自选课表背景图的本地 URI；null 表示用内置默认立绘。 */
  bgImageUri: string | null;
  /** 课表背景图透明度 0~1。 */
  bgOpacity: number;
  /** 用户自选启动页图的本地 URI；null 表示用内置默认立绘。 */
  splashImageUri: string | null;
  /** 打开相册选一张课表背景图并持久化。 */
  pickBgImage: () => Promise<void>;
  resetBgImage: () => Promise<void>;
  setBgOpacity: (v: number) => Promise<void>;
  pickSplashImage: () => Promise<void>;
  resetSplashImage: () => Promise<void>;
}

const BackgroundContext = createContext<BackgroundContextValue | null>(null);

/** 把相册选出来的临时图片复制到文档目录，避免被系统缓存清理。 */
async function copyToDocuments(uri: string, name: string): Promise<string> {
  const dir = FileSystem.documentDirectory ?? '';
  const dest = `${dir}${name}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

async function pickOne(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (res.canceled || !res.assets[0]) return null;
  return res.assets[0].uri;
}

export function BackgroundProvider({ children }: PropsWithChildren) {
  const [bgImageUri, setBgImageUri] = useState<string | null>(null);
  const [bgOpacity, setBgOpacityState] = useState(DEFAULT_BG_OPACITY);
  const [splashImageUri, setSplashImageUri] = useState<string | null>(null);

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

  const pickBgImage = useCallback(async () => {
    const uri = await pickOne();
    if (!uri) return;
    const saved = await copyToDocuments(uri, 'custom_bg.jpg');
    setBgImageUri(saved);
    await setStoredValue(BG_IMAGE_KEY, saved);
  }, []);

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
    const uri = await pickOne();
    if (!uri) return;
    const saved = await copyToDocuments(uri, 'custom_splash.jpg');
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
