import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_TIMEOUT_MS = 10000; // 10s：防止后台恢复时存储超时

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Storage timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function getStoredValue(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await withTimeout(AsyncStorage.getItem(key), STORAGE_TIMEOUT_MS);
  } catch (error) {
    console.warn(`Failed to read from storage for key "${key}":`, error);
    await removeStoredValue(key);
    return null;
  }
}

export async function setStoredValue(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await withTimeout(AsyncStorage.setItem(key, value), STORAGE_TIMEOUT_MS);
  } catch (error) {
    console.warn(`Failed to write to storage for key "${key}":`, error);
    // 不再静默清理，避免误删有效数据
  }
}

async function removeStoredValue(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await withTimeout(AsyncStorage.removeItem(key), STORAGE_TIMEOUT_MS);
  } catch {
    // Ignore cleanup failures
  }
}