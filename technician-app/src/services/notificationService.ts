import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc, getDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import i18next from 'i18next';
import { db } from '../lib/firebase';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
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

export const notificationService = {
  /**
   * Register device for push notifications and save token + preferredLanguage to user profile
   */
  async registerForPushNotificationsAsync(userId?: string): Promise<string | null> {
    let token: string | null = null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4f46e5',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('repairs', {
        name: 'Repair Updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#10b981',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('approvals', {
        name: 'Admin Approvals',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400],
        lightColor: '#f59e0b',
        sound: 'default',
      });
    }

    if (!Device.isDevice) {
      console.log('[NotificationService] Running on simulator/emulator, push notifications limited.');
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[NotificationService] Notification permission not granted');
        return null;
      }

      const pushTokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'f7f4d1c2-b95d-40c1-a983-a63e235cb403',
      });
      token = pushTokenData.data;

      if (token) {
        await AsyncStorage.setItem('expo_push_token', token);

        if (userId) {
          try {
            const userRef = doc(db, 'users', userId);
            const currentLang = i18next.language || 'en';
            await updateDoc(userRef, {
              pushToken: token,
              pushTokenUpdatedAt: serverTimestamp(),
              preferredLanguage: currentLang.startsWith('ar') ? 'ar' : currentLang.startsWith('fr') ? 'fr' : 'en',
            });
            console.log('[NotificationService] Saved push token & language for user:', userId);
          } catch (err) {
            console.warn('[NotificationService] Error updating user push token in Firestore:', err);
          }
        }
      }
    } catch (error) {
      console.warn('[NotificationService] Failed to register push token:', error);
    }

    return token;
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

    const message = {
      to: toPushToken,
      sound: 'default',
      title,
      body,
      data,
      channelId,
    };

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
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
      const q = query(collection(db, 'users'), where('role', '==', role));
      const snap = await getDocs(q);
      const sentTokens = new Set<string>();

      for (const docSnap of snap.docs) {
        const userData = docSnap.data();
        const token = userData.pushToken;
        if (token && !sentTokens.has(token)) {
          sentTokens.add(token);
          const targetLang = userData.preferredLanguage || 'en';
          const resolved = resolveMessage(message, targetLang);
          const ok = await this.sendPushNotification(token, resolved.title, resolved.body, data, channelId);
          if (ok) sentCount++;
        }
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
      content: {
        title: resolved.title,
        body: resolved.body,
        data,
        sound: 'default',
      },
      trigger: channelId ? { channelId } : null,
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
};
