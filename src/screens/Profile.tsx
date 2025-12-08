import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Modal,
  Alert,
} from "react-native";
import { MainStackParamList } from "../types/navigation";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  Text,
  TextInput,
  Button,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Contacts from "expo-contacts";

import {
  getAuth,
  updateProfile as updateAuthProfile,
  User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { Calendar } from "react-native-calendars";
import DropDownPicker from "react-native-dropdown-picker";
import { TextInputMask } from "react-native-masked-text";

export default function ({
  navigation,
}: NativeStackScreenProps<MainStackParamList, "MainTabs">) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();
  const storage = getStorage();
  const uid = auth.currentUser?.uid || "";

  // -------- State --------
  const [firebaseUser, setFirebaseUser] = useState<User | null>(
    auth.currentUser
  );

  const [qrValue, setQrValue] = useState("");
  const [qrTab, setQrTab] = useState<"myqr" | "scan">("myqr");
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [photoURL, setPhotoURL] = useState<string | undefined>(
    auth.currentUser?.photoURL || undefined
  );
  const [gender, setGender] = useState<string>("");
  const [birthDate, setBirthDate] = useState<Date>(new Date());
  const [countryCode, setCountryCode] = useState<string>("+60");
  const [phoneNumber, setPhoneNumber] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [userDocLoaded, setUserDocLoaded] = useState<boolean>(false);

  // dropdowns
  const [genderOpen, setGenderOpen] = useState(false);
  const [genderItems, setGenderItems] = useState([
    { label: "Male", value: "Male" },
    { label: "Female", value: "Female" },
  ]);

  const [countryCodeOpen, setCountryCodeOpen] = useState(false);
  const [countryCodeItems, setCountryCodeItems] = useState([
    { label: "+60", value: "+60" },
  ]);

  // calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const [year, setYear] = useState<number>(birthDate.getFullYear());
  const [month, setMonth] = useState<number>(birthDate.getMonth() + 1);
  const [calendarCurrent, setCalendarCurrent] = useState<string>("");

  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () =>
      Array.from(
        { length: currentYear - 1950 + 1 },
        (_, i) => currentYear - i
      ).map((y) => ({ label: String(y), value: y })),
    [currentYear]
  );

  const months = useMemo(
    () => [
      { label: "Jan", value: 1 },
      { label: "Feb", value: 2 },
      { label: "Mar", value: 3 },
      { label: "Apr", value: 4 },
      { label: "May", value: 5 },
      { label: "Jun", value: 6 },
      { label: "Jul", value: 7 },
      { label: "Aug", value: 8 },
      { label: "Sep", value: 9 },
      { label: "Oct", value: 10 },
      { label: "Nov", value: 11 },
      { label: "Dec", value: 12 },
    ],
    []
  );

  // sync calendar current date
  useEffect(() => {
    setCalendarCurrent(`${year}-${pad2(month)}-01`);
  }, [year, month]);

  // request gallery permission
  useEffect(() => {
    (async () => {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to change your profile picture."
        );
      }
    })();
  }, []);

  // load user data from Firestore & set QR value
  useEffect(() => {
    if (!uid) return;

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const data = snap.data() as any;

          // QR data that others will scan and save as contact
          setQrValue(
            JSON.stringify({
              name: data.displayName || "",
              email: data.email || "",
              phone: data.phoneNumber || "",
            })
          );

          if (data.gender) setGender(data.gender);

          if (data.birthDate) {
            const d = new Date(data.birthDate);
            if (!isNaN(d.getTime())) {
              setBirthDate(d);
              setYear(d.getFullYear());
              setMonth(d.getMonth() + 1);
            }
          }

          if (data.phoneNumber) {
            const full = String(data.phoneNumber);
            const match = full.match(/^(\+\d{1,3})(\d{6,11})$/);
            if (match) {
              setCountryCode(match[1]);
              setPhoneNumber(match[2]);
            } else {
              setPhoneNumber(full.replace(/[^0-9]/g, ""));
            }
          }

          if (data.photoURL && data.photoURL !== "-") {
            setPhotoURL(String(data.photoURL));
          }
        }
        setUserDocLoaded(true);
      } catch (e) {
        console.log("Error loading user doc", e);
        Alert.alert("Error", "Failed to load profile data.");
      }
    };

    load();
  }, [uid, db]);

  const formatDate = (date: Date): string =>
    date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const onDateSelect = (day: any) => {
    const selectedDate = new Date(day.dateString);
    setBirthDate(selectedDate);
    setYear(selectedDate.getFullYear());
    setMonth(selectedDate.getMonth() + 1);
    setShowCalendar(false);
  };

  // -------- Scan handler: save QR as phone contact --------
  const handleQrScanned = async (qrData: string) => {
    try {
      // Ask for contacts permission
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow contacts permission to save this QR as a contact."
        );
        return;
      }

      // Parse QR (expected JSON)
      const parsed = JSON.parse(qrData || "{}");
      const displayName =
        parsed.name || parsed.displayName || firebaseUser?.displayName || "";
      const email = parsed.email || "";
      const phone = parsed.phone || parsed.phoneNumber || "";

      if (!displayName && !email && !phone) {
        Alert.alert("Scan Error", "QR code does not contain contact info.");
        return;
      }

      const [firstName, ...restName] = displayName.split(" ");
      const lastName = restName.join(" ");

      const contact: any = {
        [Contacts.Fields.FirstName]: firstName || displayName || "Unknown",
        [Contacts.Fields.LastName]: lastName || "",
      };

      if (phone && phone !== "-") {
        contact[Contacts.Fields.PhoneNumbers] = [
          { label: "mobile", number: phone },
        ];
      }

      if (email && email !== "-") {
        contact[Contacts.Fields.Emails] = [{ label: "home", email }];
      }

      await Contacts.addContactAsync(contact);

      Alert.alert(
        "Contact Saved",
        `${displayName || email || phone} has been added to your contacts.`,
        [
          {
            text: "OK",
          },
        ]
      );
    } catch (err) {
      console.log("Error parsing/saving QR contact", err);
      Alert.alert("Scan Error", "Invalid QR format.");
    }
  };

  // -------- Change photo handler --------
  const handleChangePhoto = async () => {
    if (!uid) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const storageRef = ref(storage, `profilePictures/${uid}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);

      // 1) update Firestore users/{uid}
      await updateDoc(doc(db, "users", uid), {
        photoURL: downloadURL,
        updatedAt: new Date().toISOString(),
      });

      // 2) update Firebase Auth profile
      if (auth.currentUser) {
        await updateAuthProfile(auth.currentUser, {
          photoURL: downloadURL,
        });
        setFirebaseUser(auth.currentUser);
      }

      setPhotoURL(downloadURL);

      // 3) OPTIONAL: update CreatedUserPhoto in Topic documents
      try {
        const topicsRef = collection(db, "Topic");
        const q = query(
          topicsRef,
          where("CreatedUser.CreatedUserId", "==", uid)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.forEach((docSnap) => {
            batch.update(docSnap.ref, {
              "CreatedUser.CreatedUserPhoto": downloadURL,
            });
          });
          await batch.commit();
        }
      } catch (err) {
        console.log("Error updating Topic CreatedUserPhoto", err);
      }

      Alert.alert("Profile Photo Updated", "Your profile picture was saved.");
    } catch (error) {
      console.log("Error updating photo", error);
      Alert.alert("Error", "Failed to update profile photo.");
    }
  };

  // -------- Save (gender, birth date, phone) --------
  const handleSave = async () => {
    if (!uid) return;

    const phoneDigits = phoneNumber.replace(/[\s-]/g, "");

    if (!gender) {
      Alert.alert("Validation", "Please select your gender.");
      return;
    }

    if (!phoneDigits) {
      Alert.alert("Validation", "Phone number is required.");
      return;
    }

    if (!/^[0-9]{9,11}$/.test(phoneDigits)) {
      Alert.alert(
        "Validation",
        "Please enter a valid Malaysian phone number (9–11 digits)."
      );
      return;
    }

    const today = new Date();
    const onlyToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const onlyBirth = new Date(
      birthDate.getFullYear(),
      birthDate.getMonth(),
      birthDate.getDate()
    );
    if (onlyBirth > onlyToday) {
      Alert.alert("Validation", "Birth date cannot be in the future.");
      return;
    }
    setLoading(true);
    try {
      const fullPhone = `${countryCode}${phoneDigits}`;

      // 1) Update Firestore
      await updateDoc(doc(db, "users", uid), {
        gender,
        birthDate: birthDate.toISOString(),
        phoneNumber: fullPhone,
        updatedAt: new Date().toISOString(),
      });

      // 2) Immediately refresh the QR value with the new phone number
      setQrValue(
        JSON.stringify({
          name: firebaseUser?.displayName || "",
          email: firebaseUser?.email || "",
          phone: fullPhone,
        })
      );

      Alert.alert(
        "Profile Updated",
        "Your profile has been saved successfully.",
        [{ text: "OK" }]
      );
    } catch (e) {
      console.log("Error updating profile", e);
      setLoading(false);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const avatarSource = photoURL && photoURL !== "-" ? { uri: photoURL } : null;

  // -------- UI --------
  return (
    <KeyboardAvoidingView behavior="height" enabled style={{ flex: 1 }}>
      <Layout>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {/* Header with avatar */}
          <View
            style={{
              paddingTop: 40,
              paddingBottom: 20,
              alignItems: "center",
              backgroundColor: isDarkmode ? "#17171E" : themeColor.white100,
            }}
          >
            {avatarSource ? (
              <Image
                source={avatarSource}
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: 55,
                  borderWidth: 2,
                  borderColor: themeColor.info,
                  marginBottom: 10,
                }}
              />
            ) : (
              <Ionicons
                name="person-circle-outline"
                size={110}
                color={themeColor.info}
                style={{ marginBottom: 10 }}
              />
            )}

            <TouchableOpacity onPress={handleChangePhoto}>
              <Text
                style={{
                  color: themeColor.info,
                  fontWeight: "bold",
                  marginBottom: 10,
                }}
              >
                Change Profile Photo
              </Text>
            </TouchableOpacity>

            <Text size="h4" fontWeight="bold">
              {firebaseUser?.displayName ?? "My Profile"}
            </Text>
            <Text style={{ opacity: 0.7 }}>{firebaseUser?.email}</Text>

            <TouchableOpacity
              onPress={() =>
                isDarkmode ? setTheme("light") : setTheme("dark")
              }
              style={{ marginTop: 10 }}
            >
              <Text size="md" fontWeight="bold">
                {isDarkmode ? "☀️ light theme" : "🌑 dark theme"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Editable fields */}
          <View
            style={{
              flex: 1,
              paddingHorizontal: 20,
              paddingBottom: 30,
              paddingTop: 10,
              backgroundColor: isDarkmode ? themeColor.dark : themeColor.white,
            }}
          >
            <Text
              fontWeight="bold"
              size="h4"
              style={{ alignSelf: "center", marginVertical: 20 }}
            >
              Edit Profile
            </Text>

            {/* Email (read only) */}
            <Text>Email (read only)</Text>
            <TextInput
              containerStyle={{ marginTop: 10 }}
              value={firebaseUser?.email || ""}
              editable={false}
            />

            {/* Gender */}
            <Text style={{ marginTop: 20 }}>Gender</Text>
            <View style={{ marginTop: 10, zIndex: 3000 }}>
              <DropDownPicker
                open={genderOpen}
                value={gender}
                items={genderItems}
                setOpen={setGenderOpen}
                setValue={setGender}
                setItems={setGenderItems}
                placeholder="Select your gender"
                style={{
                  backgroundColor: isDarkmode
                    ? themeColor.dark200
                    : themeColor.white,
                  borderColor: "#ccc",
                }}
                textStyle={{
                  color: isDarkmode ? themeColor.white : themeColor.dark,
                }}
                dropDownContainerStyle={{
                  backgroundColor: isDarkmode
                    ? themeColor.dark200
                    : themeColor.white,
                  borderColor: "#ccc",
                }}
              />
            </View>

            {/* Birth Date */}
            <Text style={{ marginTop: 20 }}>Birth Date</Text>
            <TouchableOpacity
              onPress={() => {
                const d = birthDate;
                setYear(d.getFullYear());
                setMonth(d.getMonth() + 1);
                setShowCalendar(true);
              }}
              style={{
                marginTop: 10,
                padding: 15,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: "#ccc",
                backgroundColor: isDarkmode ? themeColor.dark200 : "#f5f5f5",
              }}
            >
              <Text>{formatDate(birthDate)}</Text>
            </TouchableOpacity>

            {/* Calendar modal */}
            {showCalendar && (
              <Modal
                visible={showCalendar}
                transparent
                animationType="fade"
                onRequestClose={() => setShowCalendar(false)}
              >
                <View
                  style={{
                    flex: 1,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: isDarkmode
                        ? themeColor.dark
                        : themeColor.white,
                      borderRadius: 10,
                      padding: 20,
                      width: "90%",
                      maxWidth: 420,
                    }}
                  >
                    {/* Year / Month selectors */}
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 10,
                        marginBottom: 12,
                        zIndex: 9999,
                      }}
                    >
                      <View style={{ flex: 1, zIndex: 9999 }}>
                        <DropDownPicker
                          open={yearOpen}
                          value={year}
                          items={years}
                          setOpen={setYearOpen}
                          setValue={setYear}
                          setItems={() => {}}
                          placeholder="Year"
                          style={{
                            backgroundColor: isDarkmode
                              ? themeColor.dark200
                              : themeColor.white,
                            borderColor: "#ccc",
                            minHeight: 46,
                          }}
                          dropDownContainerStyle={{
                            backgroundColor: isDarkmode
                              ? themeColor.dark200
                              : themeColor.white,
                            borderColor: "#ccc",
                          }}
                        />
                      </View>
                      <View style={{ flex: 1, zIndex: 9998 }}>
                        <DropDownPicker
                          open={monthOpen}
                          value={month}
                          items={months}
                          setOpen={setMonthOpen}
                          setValue={setMonth}
                          setItems={() => {}}
                          placeholder="Month"
                          style={{
                            backgroundColor: isDarkmode
                              ? themeColor.dark200
                              : themeColor.white,
                            borderColor: "#ccc",
                            minHeight: 46,
                          }}
                          dropDownContainerStyle={{
                            backgroundColor: isDarkmode
                              ? themeColor.dark200
                              : themeColor.white,
                            borderColor: "#ccc",
                          }}
                        />
                      </View>
                    </View>

                    <Calendar
                      key={calendarCurrent}
                      current={calendarCurrent}
                      onDayPress={onDateSelect}
                      maxDate={new Date().toISOString().split("T")[0]}
                      markedDates={{
                        [birthDate.toISOString().split("T")[0]]: {
                          selected: true,
                          selectedColor: themeColor.primary,
                        },
                      }}
                      theme={{
                        backgroundColor: isDarkmode
                          ? themeColor.dark
                          : themeColor.white,
                        calendarBackground: isDarkmode
                          ? themeColor.dark
                          : themeColor.white,
                        textSectionTitleColor: isDarkmode
                          ? themeColor.white
                          : themeColor.dark,
                        selectedDayBackgroundColor: themeColor.primary,
                        selectedDayTextColor: themeColor.white,
                        todayTextColor: themeColor.primary,
                        dayTextColor: isDarkmode
                          ? themeColor.white
                          : themeColor.dark,
                        textDisabledColor: "#888",
                        monthTextColor: isDarkmode
                          ? themeColor.white
                          : themeColor.dark,
                        arrowColor: themeColor.primary,
                      }}
                    />

                    <TouchableOpacity
                      onPress={() => setShowCalendar(false)}
                      style={{
                        marginTop: 20,
                        padding: 12,
                        backgroundColor: themeColor.primary,
                        borderRadius: 5,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: themeColor.white,
                          fontWeight: "bold",
                        }}
                      >
                        Close
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            {/* Phone Number */}
            <Text style={{ marginTop: 20 }}>Phone Number</Text>
            <View
              style={{
                flexDirection: "row",
                marginTop: 10,
                gap: 10,
                zIndex: 2000,
              }}
            >
              <View style={{ flex: 1, zIndex: 2000 }}>
                <DropDownPicker
                  open={countryCodeOpen}
                  value={countryCode}
                  items={countryCodeItems}
                  setOpen={setCountryCodeOpen}
                  setValue={setCountryCode}
                  setItems={setCountryCodeItems}
                  placeholder="+60"
                  style={{
                    backgroundColor: isDarkmode
                      ? themeColor.dark200
                      : themeColor.white,
                    borderColor: "#ccc",
                    minHeight: 50,
                  }}
                  textStyle={{
                    color: isDarkmode ? themeColor.white : themeColor.dark,
                    fontSize: 14,
                  }}
                  dropDownContainerStyle={{
                    backgroundColor: isDarkmode
                      ? themeColor.dark200
                      : themeColor.white,
                    borderColor: "#ccc",
                  }}
                  listItemLabelStyle={{
                    color: isDarkmode ? themeColor.white : themeColor.dark,
                  }}
                />
              </View>

              <View style={{ flex: 2 }}>
                <TextInputMask
                  type={"custom"}
                  options={{ mask: "99-9999999" }}
                  placeholder="12-4567890"
                  value={phoneNumber}
                  keyboardType="phone-pad"
                  onChangeText={(text) =>
                    setPhoneNumber(text.replace(/[^0-9]/g, ""))
                  }
                  style={{
                    padding: 15,
                    borderRadius: 5,
                    borderWidth: 1,
                    borderColor: "#ccc",
                    backgroundColor: isDarkmode
                      ? themeColor.dark200
                      : themeColor.white,
                    color: isDarkmode ? themeColor.white : themeColor.dark,
                    height: 50,
                  }}
                />
              </View>
            </View>

            {/* Save button */}
            <Button
              text={loading ? "Saving..." : "Save Changes"}
              onPress={handleSave}
              style={{ marginTop: 25 }}
              disabled={loading || !userDocLoaded}
            />
          </View>

          {/* QR + Camera Scanner Section */}
          <View
            style={{
              marginTop: 30,
              marginHorizontal: 20,
              marginBottom: 30,
              padding: 20,
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              backgroundColor: isDarkmode ? themeColor.dark200 : "#f7f7f7",
            }}
          >
            {/* Tabs: My QR / Scan */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                marginBottom: 15,
              }}
            >
              <TouchableOpacity
                onPress={() => setQrTab("myqr")}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 18,
                  backgroundColor:
                    qrTab === "myqr" ? themeColor.primary : "#ccc",
                  borderRadius: 8,
                  marginRight: 10,
                }}
              >
                <Text style={{ color: themeColor.white }}>My QR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setQrTab("scan")}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 18,
                  backgroundColor:
                    qrTab === "scan" ? themeColor.primary : "#ccc",
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: themeColor.white }}>Scan QR</Text>
              </TouchableOpacity>
            </View>

            {/* ---- MY QR ---- */}
            {qrTab === "myqr" && (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                {qrValue ? (
                  <QRCode value={qrValue} size={220} />
                ) : (
                  <Text>No QR data available</Text>
                )}
              </View>
            )}

            {/* ---- CAMERA SCAN ---- */}
            {qrTab === "scan" && (
              <View style={{ alignItems: "center" }}>
                {/* Permission states */}
                {!permission && <Text>Checking camera permission...</Text>}

                {permission && !permission.granted && (
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ marginBottom: 10 }}>
                      Camera access is required to scan QR codes.
                    </Text>
                    <Button
                      text="Allow Camera"
                      onPress={requestPermission}
                      size="md"
                    />
                  </View>
                )}

                {permission && permission.granted && (
                  <View
                    style={{
                      width: 260,
                      height: 260,
                      overflow: "hidden",
                      borderRadius: 16,
                      marginTop: 10,
                    }}
                  >
                    <CameraView
                      style={{ flex: 1 }}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                      onBarcodeScanned={({ data }) => {
                        // if we already handled one scan, ignore further scans
                        if (scanned) return;

                        setScanned(true);
                        handleQrScanned(data);
                      }}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </Layout>
    </KeyboardAvoidingView>
  );
}
