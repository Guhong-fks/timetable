import * as SecureStore from 'expo-secure-store';

const AHU_CREDENTIALS_KEY = 'ahu-jw-credentials-v1';

export interface AhuCredentials {
  username: string;
  password: string;
}

export async function loadAhuCredentials(): Promise<AhuCredentials | null> {
  const stored = await SecureStore.getItemAsync(AHU_CREDENTIALS_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<AhuCredentials>;
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    if (!parsed.username.trim() || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export async function saveAhuCredentials(credentials: AhuCredentials): Promise<void> {
  if (!credentials.username.trim() || !credentials.password) {
    throw new Error('教务账号或密码为空');
  }
  await SecureStore.setItemAsync(AHU_CREDENTIALS_KEY, JSON.stringify(credentials), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearAhuCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(AHU_CREDENTIALS_KEY);
}
