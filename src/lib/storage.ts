import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export async function getStoredValue(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await AsyncStorage.getItem(key);
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
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Failed to write to storage for key "${key}":`, error);
  }
}

async function removeStoredValue(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore cleanup failures; the next write will replace the value.
  }
}