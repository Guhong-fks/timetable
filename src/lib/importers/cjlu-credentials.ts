import * as SecureStore from 'expo-secure-store';

const CJLU_CREDENTIALS_KEY = 'cjlu-jw-credentials-v1';

export interface CjluCredentials {
  username: string;
  password: string;
}

export async function loadCjluCredentials(): Promise<CjluCredentials | null> {
  const stored = await SecureStore.getItemAsync(CJLU_CREDENTIALS_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<CjluCredentials>;
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    if (!parsed.username.trim() || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export async function saveCjluCredentials(credentials: CjluCredentials): Promise<void> {
  if (!credentials.username.trim() || !credentials.password) throw new Error('教务账号或密码为空');
  await SecureStore.setItemAsync(CJLU_CREDENTIALS_KEY, JSON.stringify(credentials), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearCjluCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CJLU_CREDENTIALS_KEY);
}
