import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Button, Alert, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Layout, TopNav, useTheme, themeColor, Text } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useTeamData } from "./TaskHooks";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<MainStackParamList, "TaskQRScanner"> & {
  onJoinSuccess?: (projectId: string, teamId: string) => void;
};

export default function ({ navigation, onJoinSuccess }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  
  // Logic from QRCodeScan.tsx
  const scannedRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const { joinTeam } = useTeamData(null); 

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
        requestPermission();
    }
  }, [permission]);

  const handleBarCodeScanned = async ({ type, data }: any) => {
    if (!isScanning) return;
    if (scannedRef.current) return;

    scannedRef.current = true;
    setIsScanning(false); // Stop scanning immediately

    try {
      const parsed = JSON.parse(data);
      if (parsed.projectId && parsed.teamId && parsed.name) {
          Alert.alert(
             "Join Team", 
             `Do you want to join "${parsed.name}"?`, 
             [
             { text: "Cancel", onPress: () => {}, style: "cancel" },
             { text: "Join", onPress: async () => {
                 const result = await joinTeam(parsed.teamId, parsed.projectId);
                 if (result === "success") {
                     Alert.alert("Success", "You have joined the team!", [{ 
                        text: "OK", 
                        onPress: () => {
                             if (onJoinSuccess) {
                                 onJoinSuccess(parsed.projectId, parsed.teamId);
                             } else {
                                 navigation.goBack();
                             }
                        } 
                     }]);
                 } else if (result === "already_joined") {
                     Alert.alert("Notice", "You are already a member of this team.", [{ 
                        text: "View Team", 
                        onPress: () => {
                             if (onJoinSuccess) {
                                 onJoinSuccess(parsed.projectId, parsed.teamId);
                             } else {
                                 navigation.goBack();
                             }
                        } 
                     }]);
                 } else {
                     Alert.alert("Error", "Failed to join team. Please try again or check your permission.");
                 }
             }}
          ]);
      } else {
          Alert.alert("Invalid QR Code", "This QR code does not contain valid Team info.", [{ text: "OK" }]);
      }
    } catch (e) {
      Alert.alert("Invalid QR Code", "Could not parse QR code data.", [{ text: "OK" }]);
    }
  };

  if (!permission) return <Layout><View style={styles.center}><Text>Requesting permission...</Text></View></Layout>;
  
  if (!permission.granted) {
      return (
        <Layout>
            <View style={styles.center}>
                <Text style={{marginBottom: 10, color: isDarkmode ? '#fff' : '#000'}}>No access to camera</Text>
                <Button title="Grant Permission" onPress={requestPermission} />
            </View>
        </Layout>
      );
  }

  return (
    <Layout>
      <TopNav
         middleContent="Scan Team QR"
         leftContent={<Ionicons name="chevron-back" size={20} color={isDarkmode ? themeColor.white100 : themeColor.dark} />}
         leftAction={() => navigation.goBack()}
         rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
         }
         rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />
      <View style={{ flex: 1 }}>
        <CameraView
           onBarcodeScanned={
               isScanning 
                ? (scannedRef.current ? undefined : handleBarCodeScanned)
                : undefined
           }
           barcodeScannerSettings={{
               barcodeTypes: ["qr"],
           }}
           style={StyleSheet.absoluteFillObject}
           facing="back"
        />
        
        {/* Overlay Guide */}
        <View style={styles.overlay}>
             <View style={styles.scanBox} />
             {isScanning && (
                <Text style={styles.guideText}>Scanning...</Text>
             )}
        </View>

        {/* Control Button */}
        <View style={styles.controlContainer}>
            <Button 
                title={isScanning ? "Scanning..." : "Start Scan"} 
                disabled={isScanning}
                onPress={() => {
                    scannedRef.current = false;
                    setIsScanning(true);
                }} 
            />
        </View>
      </View>
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
  },
  scanBox: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: '#6366f1',
      backgroundColor: 'transparent',
      borderRadius: 20,
  },
  guideText: {
      marginTop: 20,
      color: '#fff',
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: 8,
      borderRadius: 4,
      overflow: 'hidden'
  },
  controlContainer: {
      position: 'absolute',
      bottom: 50,
      width: '100%',
      paddingHorizontal: 50,
  }
});
