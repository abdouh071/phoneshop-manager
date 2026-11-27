import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { Text, Appbar, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

export const ScannerScreen = ({ navigation, route }: any) => {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    const getCameraPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    getCameraPermissions();
  }, []);

  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    setScanned(true);
    // Return the scanned data back to the previous screen (WorkbenchScreen)
    if (route.params?.onScan) {
      route.params.onScan(data);
    }
    navigation.goBack();
  };

  if (hasPermission === null) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{t('scanner.noCameraAccess', 'No access to camera')}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>{t('common.back', 'Back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.BackAction onPress={() => navigation.goBack()} color={colors.textInverse} />
        <Appbar.Content
          title={t('scanner.title', 'Scan Ticket Barcode')}
          titleStyle={styles.headerTitle}
        />
      </Appbar.Header>

      <CameraView
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8", "upc_e"],
        }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.overlay}>
        <View style={styles.unfocusedContainer}></View>
        <View style={styles.middleContainer}>
          <View style={styles.unfocusedContainer}></View>
          <View style={styles.focusedContainer}>
            {/* Corner Markers */}
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <View style={styles.unfocusedContainer}></View>
        </View>
        <View style={styles.unfocusedContainer}></View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    backgroundColor: colors.cameraCanvas,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.brand,
  },
  headerTitle: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.title,
  },
  errorText: {
    fontSize: fontSize.subtitle,
    color: colors.danger,
    marginBottom: spacing.xl,
  },
  backButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  backButtonText: {
    color: colors.onBrand,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  overlay: {
    position: 'absolute',
    top: 64, // below header
    left: 0,
    right: 0,
    bottom: 0,
  },
  unfocusedContainer: {
    flex: 1,
    backgroundColor: colors.cameraScrim,
  },
  middleContainer: {
    flexDirection: 'row',
    flex: 2,
  },
  focusedContainer: {
    flex: 6,
    borderWidth: 0,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: colors.onBrand,
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
});
