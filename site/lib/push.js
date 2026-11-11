// Abonnement de cet appareil aux alertes de prix cible (notifications Web Push).
import { VAPID_PUBLIC_KEY } from '../config.js';

/** "ok" | "config" (clé absente) | "ios-install" (iPhone : installer le site d'abord) | "unsupported" | "denied" */
export function pushSupport() {
  if (!VAPID_PUBLIC_KEY) return 'config';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
    return ios && !installed ? 'ios-install' : 'unsupported';
  }
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

/** Le service worker, ou null s'il ne répond pas vite (site ouvert hors https, par exemple). */
async function registration() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 4000))]);
}

export async function currentSubscription() {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

const keyBytes = (b64url) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function enablePush(store) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications refusées. Autorisez-les pour ce site dans les réglages du navigateur.'
      : 'Notifications non autorisées.');
  }
  const reg = await registration();
  if (!reg) throw new Error('Le site n’est pas prêt pour les notifications. Rechargez la page.');
  let subscription;
  try {
    subscription = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  } catch (err) {
    throw new Error(`Le navigateur n’a pas pu s’abonner aux notifications (${err.message}).`);
  }
  await store.savePushSubscription(subscription);
}

export async function disablePush(store) {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await store.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}
