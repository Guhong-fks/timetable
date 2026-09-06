import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Simple XOR obfuscation key (not strong encryption, but prevents casual inspection)
const OBFUSCATE_KEY = 'CRA-2026-V2';

function obfuscate(plain: string): string {
  let result = '';
  for (let i = 0; i < plain.length; i++) {
    result += String.fromCharCode(plain.charCodeAt(i) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length));
  }
  // Convert to bytes then base64 encode
  const bytes = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i++) {
    bytes[i] = result.charCodeAt(i) & 0xFF;
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function deobfuscate(encoded: string): string | null {
  try {
    const raw = atob(encoded);
    let result = '';
    for (let i = 0; i < raw.length; i++) {
      result += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATE_KEY.charCodeAt(i % OBFUSCATE_KEY.length));
    }
    // Verify it's valid JSON (the expected format)
    JSON.parse(result);
    return result;
  } catch {
    // Fallback: might be legacy plaintext data (no obfuscation)
    try {
      JSON.parse(encoded);
      return encoded;
    } catch {
      return null;
    }
  }
}

export async function getStoredValue(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(key) ?? null;
      return raw ? deobfuscate(raw) : null;
    }
    const raw = await AsyncStorage.getItem(key);
    return raw ? deobfuscate(raw) : null;
  } catch (error) {
    console.warn(`Failed to read from storage for key "${key}":`, error);
    await removeStoredValue(key);
    return null;
  }
}

export async function setStoredValue(key: string, value: string): Promise<void> {
  try {
    const encoded = obfuscate(value);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, encoded);
      return;
    }
    await AsyncStorage.setItem(key, encoded);
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