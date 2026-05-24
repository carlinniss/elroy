const INSTANCE_STORAGE_KEY = 'elroy-bot-instance-id';

export function getBotInstanceId(): string {
  if (typeof window === 'undefined') return '';

  let id = sessionStorage.getItem(INSTANCE_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(INSTANCE_STORAGE_KEY, id);
  }
  return id;
}
