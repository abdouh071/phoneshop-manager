import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc, getDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
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

export const notificationService = {
  /**
   * Register device for push notifications and save token to user profile
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
            await updateDoc(userRef, {
              pushToken: token,
              pushTokenUpdatedAt: serverTimestamp(),
            });
            console.log('[NotificationService] Saved push token for user:', userId);
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
   * Send push notification to a specific user by their Firestore user ID
   */
  async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<boolean> {
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.pushToken) {
          return await this.sendPushNotification(userData.pushToken, title, body, data, channelId);
        }
      }
    } catch (err) {
      console.warn('[NotificationService] Error finding user token:', err);
    }
    return false;
  },

  /**
   * Broadcast push notification to all users matching a specific role (e.g. 'admin' or 'sales_agent')
   */
  async sendPushToRole(
    role: string,
    title: string,
    body: string,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<number> {
    let sentCount = 0;
    try {
      const q = query(collection(db, 'users'), where('role', '==', role));
      const snap = await getDocs(q);
      const tokens: string[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.pushToken && !tokens.includes(data.pushToken)) {
          tokens.push(data.pushToken);
        }
      });

      for (const token of tokens) {
        const ok = await this.sendPushNotification(token, title, body, data, channelId);
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
    title: string,
    body: string,
    data: Record<string, any> = {},
    channelId: string = 'default'
  ): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
      },
      trigger: channelId ? { channelId } : null,
    });
  },
};
