import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteField,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import i18next from 'i18next';
import { db } from '../lib/firebase';

const PUSH_TOKEN_KEY = 'expo_push_token';
const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || 'f7f4d1c2-b95d-40c1-a983-a63e235cb403';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * expo-notifications routes a LOCAL notification to an Android channel through the
 * content, not the trigger. The previous call passed `{ channelId }` as the
 * trigger, which is not a valid trigger shape and throws — every in-app alert on
 * Android died on that error while the code logged nothing.
 */
const notificationContent = (
  title: string,
  body: string,
  data: Record<string, unknown>,
  channelId: string
): Notifications.NotificationContentInput => ({
  title,
  body,
  data,
  sound: 'default',
  ...(Platform.OS === 'android' && channelId ? { channelId } : {}),
});

export interface LocalizedMessage {
  title: string;
  body: string;
}

export interface MultilingualMessage {
  en: LocalizedMessage;
  fr: LocalizedMessage;
  ar: LocalizedMessage;
}

export function resolveMessage(
  message: MultilingualMessage | LocalizedMessage,
  lang?: string
): LocalizedMessage {
  if ('en' in message && 'fr' in message && 'ar' in message) {
    const clean = (lang || i18next.language || 'en').toLowerCase();
    if (clean.startsWith('ar')) return (message as MultilingualMessage).ar;
    if (clean.startsWith('fr')) return (message as MultilingualMessage).fr;
    return (message as MultilingualMessage).en;
  }
  return message as LocalizedMessage;
}

let tokenSubscription: Notifications.EventSubscription | null = null;
let boundUserId: string | null = null;

/**
 * A sale that empties several parts fired one low-stock alert per line, and each alert
 * re-read the whole `users` collection for the admin roster — N identical Firestore
 * reads from inside checkout. The roster is shared for a few seconds instead; a token
 * registered before the window opened is already inside it, and a brand-new one arrives
 * on the next alert batch.
 */
const ROLE_ROSTER_TTL_MS = 10_000;

interface RoleTarget {
  token: string;
  lang: string;
}

const roleRoster = new Map<string, { targets: RoleTarget[]; takenAt: number }>();
const roleRosterInFlight = new Map<string, Promise<RoleTarget[]>>();

const roleTargets = (role: string): Promise<RoleTarget[]> => {
  const cached = roleRoster.get(role);
  if (cached && Date.now() - cached.takenAt < ROLE_ROSTER_TTL_MS) return Promise.resolve(cached.targets);

  const running = roleRosterInFlight.get(role);
  if (running) return running;

  const pass = (async () => {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', role)));
    const targets: RoleTarget[] = [];
    for (const docSnap of snap.docs) {
      const userData = docSnap.data();
      const token = userData.pushToken;
      if (typeof token === 'string' && token) {
        targets.push({ token, lang: userData.preferredLanguage || 'en' });
      }
    }
    roleRoster.set(role, { targets, takenAt: Date.now() });
    return targets;
  })().finally(() => {
    roleRosterInFlight.delete(role);
  });

  roleRosterInFlight.set(role, pass);
  return pass;
};

const persistToken = (token: string) => AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

const saveTokenToProfile = async (userId: string, token: string): Promise<void> => {
  try {
    const currentLang = (i18next.language || 'en').toLowerCase();
    await updateDoc(doc(db, 'users', userId), {
      pushToken: token,
      pushTokenUpdatedAt: serverTimestamp(),
      preferredLanguage: currentLang.startsWith('ar') ? 'ar' : currentLang.startsWith('fr') ? 'fr' : 'en',
    });
  } catch (err) {
    console.warn('[NotificationService] Could not save the push token to the profile:', err);
  }
};

/**
 * Expo can hand out a different token after an OTA update, a reinstall, or a
 * push-certificate change. Without a listener the profile keeps the dead token and
 * alerts silently stop arriving for that technician.
 *
 * The event carries the raw device token (FCM/APNs), not an Expo token — storing it
 * straight into `pushToken` would poison the field, because the Expo Push API only
 * accepts `ExponentPushToken[…]` values. It is exchanged for the Expo token first.
 */
const startPushTokenListener = () => {
  if (tokenSubscription) return;
  tokenSubscription = Notifications.addPushTokenListener((deviceToken) => {
    void (async () => {
      try {
        const { data } = await Notifications.getExpoPushTokenAsync({
          projectId: EAS_PROJECT_ID,
          devicePushToken: deviceToken,
        });
        const next = data as string | null;
        if (!next || !next.startsWith('ExponentPushToken')) return;
        await persistToken(next);
        if (boundUserId) await saveTokenToProfile(boundUserId, next);
      } catch (err) {
        // Offline at the moment of rotation: the next cold start re-registers.
        console.warn('[NotificationService] Could not exchange the rotated push token:', err);
      }
    })();
  });
};

// ── Desktop-originated alert watcher state ──
const WATCHED_STATUSES = ['pending', 'in_progress', 'ready', 'returned'];
const WATCHED_DOCS = 60;
/** Beyond this, one summary beats a wall of banners (e.g. a desktop bulk import). */
const MAX_ALERTS_PER_PASS = 4;

let alertUnsub: (() => void) | null = null;
let alertUid: string | null = null;
let seeded = false;
let seenStatus: Record<string, string> = {};

interface PendingAlert {
  kind: 'new' | 'status';
  data: Record<string, unknown>;
  message: MultilingualMessage;
}

const STATUS_WORDS: Record<string, { en: string; fr: string; ar: string }> = {
  pending: { en: 'Pending', fr: 'En attente', ar: 'قيد الانتظار' },
  in_progress: { en: 'In progress', fr: 'En cours', ar: 'قيد الإصلاح' },
  ready: { en: 'Ready for pickup', fr: 'Prête', ar: 'جاهزة' },
  returned: { en: 'Returned', fr: 'Retournée', ar: 'مرجوعة' },
  completed: { en: 'Completed', fr: 'Terminée', ar: 'مكتملة' },
  cancelled: { en: 'Cancelled', fr: 'Annulée', ar: 'ملغاة' },
};

const word = (status: string | undefined, lang: 'en' | 'fr' | 'ar') =>
  (status && STATUS_WORDS[status]?.[lang]) || status || '—';

const fire = async (alerts: PendingAlert[]): Promise<void> => {
  if (alerts.length > MAX_ALERTS_PER_PASS) {
    await Notifications.scheduleNotificationAsync({
      content: notificationContent(
        'Repairs updated',
        `${alerts.length} tickets changed since the last check`,
        { screen: 'Workbench' },
        'repairs'
      ),
      trigger: null,
    });
    return;
  }
  for (const alert of alerts) {
    const resolved = resolveMessage(alert.message, i18next.language || 'en');
    await Notifications.scheduleNotificationAsync({
      content: notificationContent(resolved.title, resolved.body, alert.data, 'repairs'),
      trigger: null,
    });
  }
};

export const notificationService = {
  /**
   * Register device for push notifications and save token + preferredLanguage to user profile
   */
  async registerForPushNotificationsAsync(userId?: string): Promise<string | null> {
    if (userId) boundUserId = userId;

    if (Platform.OS === 'android') {
      const t = (key: string, fallback: string) => i18next.t(key, fallback);
      await Notifications.setNotificationChannelAsync('default', {
        name: t('notifications.channel.general', 'General Alerts'),
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4f46e5',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('repairs', {
        name: t('notifications.channel.repairs', 'Repair Updates'),
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#10b981',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('approvals', {
        name: t('notifications.channel.approvals', 'Admin Approvals'),
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400],
        lightColor: '#f59e0b',
        sound: 'default',
      });
    }

    if (!Device.isDevice) {
      // Simulators cannot receive a push token; the in-app watcher still works.
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return null;
      }

      const pushTokenData = await Notifications.getExpoPushTokenAsync({
        projectId: EAS_PROJECT_ID,
      });
      const token = pushTokenData.data;

      if (token) {
        await persistToken(token);
        if (userId) await saveTokenToProfile(userId, token);
        startPushTokenListener();
      }

      return token;
    } catch (error) {
      console.warn('[NotificationService] Failed to register push token:', error);
      return null;
    }
  },

  /**
   * Called on logout. The token is removed from the profile so the next person to
   * sign in on this tablet does not receive this account's repair alerts — but only
   * when it is still the token this device published, so a second phone logged in
   * as the same user keeps its own registration.
   */
  async clearDevicePushToken(userId?: string | null): Promise<void> {
    if (tokenSubscription) {
      tokenSubscription.remove();
      tokenSubscription = null;
    }
    boundUserId = null;

    const stored = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => undefined);

    if (!userId || !stored) return;
    try {
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data()?.pushToken === stored) {
        await updateDoc(ref, { pushToken: deleteField(), pushTokenUpdatedAt: deleteField() });
      }
    } catch (err) {
      console.warn('[NotificationService] Could not clear the push token:', err);
    }
  },

  /**
   * Send push notification via Expo Push API
   */
  async sendPushNotification(
    toPushToken: string,
    title: string,
    body: string,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<boolean> {
    if (!toPushToken || !toPushToken.startsWith('ExponentPushToken')) {
      return false;
    }

    // The Expo Push API field is `_channel_id`; a top-level `channelId` is not part
    // of the documented message schema and was silently dropped by the service.
    const message = {
      to: toPushToken,
      sound: 'default',
      title,
      body,
      data,
      _channel_id: channelId,
    };

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      const resData = await res.json();
      return resData?.data?.status === 'ok';
    } catch (err) {
      console.warn('[NotificationService] Error sending push notification:', err);
      return false;
    }
  },

  /**
   * Send push notification to a specific user by their Firestore user ID, formatted in their preferred language
   */
  async sendPushToUser(
    userId: string,
    message: MultilingualMessage | LocalizedMessage,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<boolean> {
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.pushToken) {
          const targetLang = userData.preferredLanguage || i18next.language || 'en';
          const resolved = resolveMessage(message, targetLang);
          return await this.sendPushNotification(userData.pushToken, resolved.title, resolved.body, data, channelId);
        }
      }
    } catch (err) {
      console.warn('[NotificationService] Error finding user token:', err);
    }
    return false;
  },

  /**
   * Broadcast push notification to all users matching a specific role (e.g. 'admin' or 'repair_agent'),
   * delivering to each user in their personal preferred language (en/fr/ar)
   */
  async sendPushToRole(
    role: string,
    message: MultilingualMessage | LocalizedMessage,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<number> {
    let sentCount = 0;
    try {
      const targets = await roleTargets(role);
      const sentTokens = new Set<string>();

      for (const target of targets) {
        if (sentTokens.has(target.token)) continue;
        sentTokens.add(target.token);
        const resolved = resolveMessage(message, target.lang);
        const ok = await this.sendPushNotification(target.token, resolved.title, resolved.body, data, channelId);
        if (ok) sentCount++;
      }
    } catch (err) {
      console.warn('[NotificationService] Error broadcasting to role:', err);
    }
    return sentCount;
  },

  /**
   * Trigger an instant local notification on the current device
   */
  async triggerLocalNotification(
    message: MultilingualMessage | LocalizedMessage,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<void> {
    const resolved = resolveMessage(message, i18next.language || 'en');
    await Notifications.scheduleNotificationAsync({
      content: notificationContent(resolved.title, resolved.body, data, channelId),
      // null = deliver immediately. A bare `{ channelId }` here is not a trigger.
      trigger: null,
    });
  },

  // ==========================================
  // CONVENIENCE TRILINGUAL NOTIFICATION HELPERS
  // ==========================================

  /**
   * Trigger notification to Admins when a new Approval Request is created by staff
   */
  async notifyAdminsNewApprovalRequest(
    staffName: string,
    actionLabel: string,
    reason?: string,
    requestId?: string
  ): Promise<void> {
    const reasonText = reason ? ` (${reason})` : '';
    const multilingual: MultilingualMessage = {
      en: {
        title: 'New Approval Request',
        body: `${staffName} is requesting approval: "${actionLabel}"${reasonText}`,
      },
      fr: {
        title: "Demande d'approbation",
        body: `${staffName} demande une approbation : « ${actionLabel} »${reasonText}`,
      },
      ar: {
        title: 'طلب موافقة جديد',
        body: `يطلب ${staffName} الموافقة على: "${actionLabel}"${reasonText}`,
      },
    };

    await this.sendPushToRole('admin', multilingual, { requestId, type: 'approval_request' }, 'approvals');
  },

  /**
   * Trigger notification to the requesting staff member when an Admin resolves their request
   */
  async notifyStaffApprovalDecision(
    staffUserId: string,
    actionLabel: string,
    decision: 'approved' | 'rejected',
    adminName: string,
    rejectionReason?: string
  ): Promise<void> {
    const multilingual: MultilingualMessage = decision === 'approved' ? {
      en: {
        title: 'Request Approved',
        body: `Admin ${adminName} approved your request for "${actionLabel}".`,
      },
      fr: {
        title: 'Demande approuvée',
        body: `L'administrateur ${adminName} a approuvé votre demande pour « ${actionLabel} ».`,
      },
      ar: {
        title: 'تمت الموافقة على طلبك',
        body: `وافق المشرف ${adminName} على طلبك بخصوص "${actionLabel}".`,
      },
    } : {
      en: {
        title: 'Request Rejected',
        body: `Admin ${adminName} rejected "${actionLabel}": ${rejectionReason || 'No reason provided'}`,
      },
      fr: {
        title: 'Demande rejetée',
        body: `L'administrateur ${adminName} a rejeté « ${actionLabel} » : ${rejectionReason || 'Aucune raison fournie'}`,
      },
      ar: {
        title: 'تم رفض طلبك',
        body: `رفض المشرف ${adminName} طلب "${actionLabel}": ${rejectionReason || 'لم يحدد سبب'}`,
      },
    };

    await this.sendPushToUser(staffUserId, multilingual, { decision, actionLabel }, 'approvals');
  },

  /**
   * Trigger notification when a new repair is created (sent to all technicians and assigned tech)
   */
  async notifyNewRepair(
    ticketNum: string,
    deviceName: string,
    issue: string,
    assignedTechUserId?: string
  ): Promise<void> {
    const multilingualAll: MultilingualMessage = {
      en: {
        title: 'New Repair Checked In',
        body: `Ticket #${ticketNum} (${deviceName}): ${issue}`,
      },
      fr: {
        title: 'Nouvelle réparation enregistrée',
        body: `Ticket #${ticketNum} (${deviceName}) : ${issue}`,
      },
      ar: {
        title: 'تم تسجيل جهاز للإصلاح',
        body: `تذكرة #${ticketNum} (${deviceName}): ${issue}`,
      },
    };

    // Broadcast to repair agents
    await this.sendPushToRole('repair_agent', multilingualAll, { ticketNum, screen: 'Workbench' }, 'repairs');

    // If assigned directly to a specific technician ID, send a direct high-priority alert
    if (assignedTechUserId) {
      const multilingualAssigned: MultilingualMessage = {
        en: {
          title: 'Repair Assigned to You',
          body: `You were assigned Ticket #${ticketNum} (${deviceName}).`,
        },
        fr: {
          title: 'Réparation qui vous est assignée',
          body: `Le ticket #${ticketNum} (${deviceName}) vous a été assigné.`,
        },
        ar: {
          title: 'تم تكليفك بتصليح جهاز',
          body: `تم تعيين التذكرة #${ticketNum} (${deviceName}) لك.`,
        },
      };
      await this.sendPushToUser(assignedTechUserId, multilingualAssigned, { ticketNum, screen: 'Workbench' }, 'repairs');
    }
  },

  /**
   * Trigger notification when a repair is finished and ready for pickup
   */
  async notifyRepairReady(
    ticketNum: string,
    deviceName: string,
    technicianName: string,
    ticketId: string
  ): Promise<void> {
    const toSales: MultilingualMessage = {
      en: {
        title: 'Repair Ready for Pickup',
        body: `Ticket #${ticketNum} (${deviceName}) is repaired and ready on the shelf for customer.`,
      },
      fr: {
        title: 'Réparation prête pour le client',
        body: `Ticket #${ticketNum} (${deviceName}) est réparé et prêt en rayon.`,
      },
      ar: {
        title: 'الجهاز جاهز للتسليم',
        body: `تذكرة #${ticketNum} (${deviceName}) تم إصلاحها وجاهزة للتسليم للزبون.`,
      },
    };

    const toAdmins: MultilingualMessage = {
      en: {
        title: 'Device Repaired',
        body: `Ticket #${ticketNum} (${deviceName}) marked ready by ${technicianName}.`,
      },
      fr: {
        title: 'Appareil réparé',
        body: `Ticket #${ticketNum} (${deviceName}) marqué prêt par ${technicianName}.`,
      },
      ar: {
        title: 'تم إنهاء الإصلاح',
        body: `تذكرة #${ticketNum} (${deviceName}) تم إنهاؤها بواسطة ${technicianName}.`,
      },
    };

    await this.sendPushToRole('sales_agent', toSales, { ticketId, screen: 'Workbench' }, 'repairs');
    await this.sendPushToRole('admin', toAdmins, { ticketId, screen: 'Workbench' }, 'repairs');
  },

  /**
   * Trigger notification when stock drops below threshold
   */
  async notifyLowStock(productName: string, remainingStock: number): Promise<void> {
    const multilingual: MultilingualMessage = {
      en: {
        title: 'Low Stock Alert',
        body: `"${productName}" is running low (${remainingStock} left in stock)!`,
      },
      fr: {
        title: 'Alerte Stock Faible',
        body: `« ${productName} » est presque épuisé (${remainingStock} restants) !`,
      },
      ar: {
        title: 'تنبيه انخفاض المخزون',
        body: `المنتج "${productName}" قارب على النفاد (المتبقي: ${remainingStock} فقط)!`,
      },
    };

    await this.sendPushToRole('admin', multilingual, { productName, remainingStock }, 'default');
  },

  // ==========================================
  // DESKTOP-ORIGINATED ALERTS
  // ==========================================
  //
  // The project is on the Spark plan: Cloud Functions cannot be deployed, so nothing
  // on the server can push when the desktop app creates or moves a ticket. A technician
  // whose workbench was open on the shelf therefore never learned that the shop had
  // checked a phone in from the counter.
  //
  // This watcher closes that gap with a real-time Firestore listener plus a local
  // notification, which needs no server and no push token. It alerts while the app is
  // alive; a genuinely killed app still cannot be reached without Functions, and that
  // limit is honest rather than something the code can pretend away.

  /**
   * Starts listening for tickets created or moved elsewhere. The query matches the
   * workbench predicate exactly, so it is served by the already-declared composite
   * index (status ASC, createdAt DESC) and needs no new index or rules deploy.
   */
  async startRepairAlertWatcher(userId: string): Promise<void> {
    if (!userId || alertUid === userId) return;
    this.stopRepairAlertWatcher();
    alertUid = userId;

    const q = query(
      collection(db, 'repairs'),
      where('status', 'in', WATCHED_STATUSES),
      orderBy('createdAt', 'desc'),
      limit(WATCHED_DOCS)
    );

    alertUnsub = onSnapshot(
      q,
      (snapshot) => {
        // The first delivery is history, not news: 60 pre-existing tickets would
        // otherwise all fire as "new" every time the app cold-starts.
        if (!seeded) {
          seeded = true;
          for (const d of snapshot.docs) seenStatus[d.id] = d.data()?.status;
          return;
        }

        const alerts: PendingAlert[] = [];
        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed') {
            delete seenStatus[change.doc.id];
            continue;
          }
          const data = change.doc.data() as any;
          const status = data?.status;
          if (!status) continue;
          const previous = seenStatus[change.doc.id];
          seenStatus[change.doc.id] = status;

          const actorId = change.type === 'added'
            ? data.createdById
            : data.statusHistory?.[data.statusHistory.length - 1]?.changedById;
          // Someone else moved my workbench — this device already knows its own writes.
          if (actorId && actorId === alertUid) continue;

          // A doc still in the stream after leaving it is a modification we ignore.
          if (change.type === 'modified' && previous === status) continue;

          const ticketNumber = data.ticketNumber || change.doc.id;
          const device = `${data.deviceBrand || ''} ${data.deviceModel || ''}`.trim() || '—';
          const dataPayload = { ticketId: change.doc.id, ticketNumber, screen: 'Workbench' };

          alerts.push(
            change.type === 'added' || !previous
              ? {
                  kind: 'new',
                  data: dataPayload,
                  message: {
                    en: { title: 'New Repair Checked In', body: `Ticket #${ticketNumber} (${device})` },
                    fr: { title: 'Nouvelle réparation enregistrée', body: `Ticket #${ticketNumber} (${device})` },
                    ar: { title: 'تم تسجيل جهاز للإصلاح', body: `تذكرة #${ticketNumber} (${device})` },
                  },
                }
              : {
                  kind: 'status',
                  data: dataPayload,
                  message: {
                    en: { title: `Ticket #${ticketNumber}`, body: `Status: ${word(previous, 'en')} → ${word(status, 'en')}` },
                    fr: { title: `Ticket #${ticketNumber}`, body: `Statut : ${word(previous, 'fr')} → ${word(status, 'fr')}` },
                    ar: { title: `تذكرة #${ticketNumber}`, body: `من ${word(previous, 'ar')} إلى ${word(status, 'ar')}` },
                  },
                }
          );
        }

        if (alerts.length === 0) return;
        void fire(alerts);
      },
      (error) => {
        // Non-critical: the workbench listener surfaces a real connectivity problem.
        console.warn('[NotificationService] Repair alert watcher error (non-critical):', error);
      }
    );
  },

  stopRepairAlertWatcher(): void {
    if (alertUnsub) {
      alertUnsub();
      alertUnsub = null;
    }
    alertUid = null;
    seeded = false;
    seenStatus = {};
  },
};
