import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Modal,
  Alert,
  FlatList,
  Platform,
} from "react-native";

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
  signOut,
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

import { MainStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<MainStackParamList, "MainTabs">;

export default function Profile({ navigation }: Props) {
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

          setQrValue(
            JSON.stringify({
              name: data.displayName || "",
              email: data.email || "",
              phone: data.phoneNumber || "",
            })
          );

          if (data.gender) setGender(String(data.gender));

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
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow contacts permission to save this QR as a contact."
        );
        return;
      }

      const parsed = JSON.parse(qrData || "{}");
      const displayName =
        parsed.name || parsed.displayName || firebaseUser?.displayName || "";
      const email = parsed.email || "";
      const phone = parsed.phone || parsed.phoneNumber || "";

      if (!displayName && !email && !phone) {
        Alert.alert("Scan Error", "QR code does not contain contact info.");
        return;
      }

      const [firstName, ...restName] = String(displayName).split(" ");
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
        `${displayName || email || phone} has been added to your contacts.`
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
      const mediaTypesCompat = (ImagePicker as any).MediaType?.Images
        ? [(ImagePicker as any).MediaType.Images]
        : (ImagePicker as any).MediaTypeOptions?.Images;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypesCompat as any,
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

      await updateDoc(doc(db, "users", uid), {
        photoURL: downloadURL,
        updatedAt: new Date().toISOString(),
      });

      if (auth.currentUser) {
        await updateAuthProfile(auth.currentUser, { photoURL: downloadURL });
        setFirebaseUser(auth.currentUser);
      }

      setPhotoURL(downloadURL);

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

      await updateDoc(doc(db, "users", uid), {
        gender,
        birthDate: birthDate.toISOString(),
        phoneNumber: fullPhone,
        updatedAt: new Date().toISOString(),
      });

      setQrValue(
        JSON.stringify({
          name: firebaseUser?.displayName || "",
          email: firebaseUser?.email || "",
          phone: fullPhone,
        })
      );

      Alert.alert(
        "Profile Updated",
        "Your profile has been saved successfully."
      );
    } catch (e) {
      console.log("Error updating profile", e);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const avatarSource = photoURL && photoURL !== "-" ? { uri: photoURL } : null;

  // -------- Styles helpers --------
  const bgMain = isDarkmode ? themeColor.dark : themeColor.white;
  const bgCard = isDarkmode ? themeColor.dark200 : "#f7f7f7";
  const textMain = isDarkmode ? themeColor.white100 : themeColor.dark;

  const dropdownBaseStyle = {
    backgroundColor: isDarkmode ? themeColor.dark200 : themeColor.white,
    borderColor: "#ccc",
  };

  const dropdownTextStyle = {
    color: isDarkmode ? themeColor.white100 : themeColor.dark,
    fontSize: 14,
  };

  const dropdownListLabelStyle = {
    color: isDarkmode ? themeColor.white100 : themeColor.dark,
  };

  // -------- FlatList content (header) --------
  const Header = (
    <View>
      {/* Header */}
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

        <Text size="h3" fontWeight="bold">
          {firebaseUser?.displayName ?? "My Profile"}
        </Text>
        <Text style={{ opacity: 0.7, color: textMain }}>
          {firebaseUser?.email}
        </Text>

        <TouchableOpacity
          onPress={() => setTheme(isDarkmode ? "light" : "dark")}
          style={{ marginTop: 10 }}
        >
          <Text size="md" fontWeight="bold" style={{ color: textMain }}>
            {isDarkmode ? "☀️ light theme" : "🌑 dark theme"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Editable fields */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 10,
          backgroundColor: bgMain,
        }}
      >
        <Text
          size="h3"
          style={{
            alignSelf: "center",
            marginVertical: 20,
            color: textMain,
            fontWeight: "bold",
          }}
        >
          Edit Profile
        </Text>

        {/* Email */}
        <Text style={{ color: textMain }}>Email (read only)</Text>
        <TextInput
          containerStyle={{ marginTop: 10 }}
          value={firebaseUser?.email || ""}
          editable={false}
        />

        {/* Gender */}
        <Text style={{ marginTop: 20, color: textMain }}>Gender</Text>
        <View style={{ marginTop: 10 }}>
          <DropDownPicker
            open={genderOpen}
            value={gender}
            items={genderItems}
            setOpen={setGenderOpen}
            setValue={setGender as any}
            setItems={setGenderItems}
            placeholder="Select your gender"
            listMode="MODAL"
            modalTitle="Select gender"
            modalProps={{ animationType: "fade" }}
            modalContentContainerStyle={{
              backgroundColor: isDarkmode ? themeColor.dark : themeColor.white,
            }}
            modalTitleStyle={{
              color: isDarkmode ? themeColor.white100 : themeColor.dark,
              fontWeight: "bold",
            }}
            style={dropdownBaseStyle as any}
            textStyle={dropdownTextStyle as any}
            placeholderStyle={{ color: isDarkmode ? "#aaa" : "#777" } as any}
            dropDownContainerStyle={dropdownBaseStyle as any}
            listItemLabelStyle={dropdownListLabelStyle as any}
          />
        </View>

        {/* Birth Date */}
        <Text style={{ marginTop: 20, color: textMain }}>Birth Date</Text>
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
          <Text style={{ color: textMain }}>{formatDate(birthDate)}</Text>
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
                <View
                  style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}
                >
                  <View style={{ flex: 1 }}>
                    <DropDownPicker
                      open={yearOpen}
                      value={year}
                      items={years as any}
                      setOpen={setYearOpen}
                      setValue={setYear as any}
                      setItems={() => {}}
                      placeholder="Year"
                      listMode="MODAL"
                      modalTitle="Select year"
                      modalProps={{ animationType: "fade" }}
                      modalContentContainerStyle={{
                        backgroundColor: isDarkmode
                          ? themeColor.dark
                          : themeColor.white,
                      }}
                      modalTitleStyle={{
                        color: isDarkmode
                          ? themeColor.white100
                          : themeColor.dark,
                        fontWeight: "bold",
                      }}
                      style={{ ...(dropdownBaseStyle as any), minHeight: 46 }}
                      textStyle={dropdownTextStyle as any}
                      placeholderStyle={
                        { color: isDarkmode ? "#aaa" : "#777" } as any
                      }
                      listItemLabelStyle={dropdownListLabelStyle as any}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <DropDownPicker
                      open={monthOpen}
                      value={month}
                      items={months as any}
                      setOpen={setMonthOpen}
                      setValue={setMonth as any}
                      setItems={() => {}}
                      placeholder="Month"
                      listMode="MODAL"
                      modalTitle="Select month"
                      modalProps={{ animationType: "fade" }}
                      modalContentContainerStyle={{
                        backgroundColor: isDarkmode
                          ? themeColor.dark
                          : themeColor.white,
                      }}
                      modalTitleStyle={{
                        color: isDarkmode
                          ? themeColor.white100
                          : themeColor.dark,
                        fontWeight: "bold",
                      }}
                      style={{ ...(dropdownBaseStyle as any), minHeight: 46 }}
                      textStyle={dropdownTextStyle as any}
                      placeholderStyle={
                        { color: isDarkmode ? "#aaa" : "#777" } as any
                      }
                      listItemLabelStyle={dropdownListLabelStyle as any}
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
                      ? themeColor.white100
                      : themeColor.dark,
                    selectedDayBackgroundColor: themeColor.primary,
                    selectedDayTextColor: themeColor.white100,
                    todayTextColor: themeColor.primary,
                    dayTextColor: isDarkmode
                      ? themeColor.white100
                      : themeColor.dark,
                    textDisabledColor: "#888",
                    monthTextColor: isDarkmode
                      ? themeColor.white100
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
                    style={{ color: themeColor.white100, fontWeight: "bold" }}
                  >
                    Close
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Phone Number */}
        <Text style={{ marginTop: 20, color: textMain }}>Phone Number</Text>
        <View style={{ flexDirection: "row", marginTop: 10, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <DropDownPicker
              open={countryCodeOpen}
              value={countryCode}
              items={countryCodeItems}
              setOpen={setCountryCodeOpen}
              setValue={setCountryCode as any}
              setItems={setCountryCodeItems}
              placeholder="+60"
              listMode="MODAL"
              modalTitle="Select country code"
              modalProps={{ animationType: "fade" }}
              modalContentContainerStyle={{
                backgroundColor: isDarkmode
                  ? themeColor.dark
                  : themeColor.white,
              }}
              modalTitleStyle={{
                color: isDarkmode ? themeColor.white100 : themeColor.dark,
                fontWeight: "bold",
              }}
              style={{ ...(dropdownBaseStyle as any), minHeight: 50 }}
              textStyle={dropdownTextStyle as any}
              placeholderStyle={{ color: isDarkmode ? "#aaa" : "#777" } as any}
              listItemLabelStyle={dropdownListLabelStyle as any}
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
                color: textMain,
                height: 50,
              }}
            />
          </View>
        </View>

        <Button
          text={loading ? "Saving..." : "Save Changes"}
          onPress={handleSave}
          style={{ marginTop: 25 }}
          disabled={loading || !userDocLoaded}
        />

        {/* QR + Camera Scanner Section */}
        <View
          style={{
            marginTop: 30,
            marginBottom: 30,
            padding: 20,
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 10,
            backgroundColor: bgCard,
          }}
        >
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
                backgroundColor: qrTab === "myqr" ? themeColor.primary : "#ccc",
                borderRadius: 8,
                marginRight: 10,
              }}
            >
              <Text style={{ color: themeColor.white100 }}>My QR</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setQrTab("scan");
                setScanned(false);
              }}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 18,
                backgroundColor: qrTab === "scan" ? themeColor.primary : "#ccc",
                borderRadius: 8,
              }}
            >
              <Text style={{ color: themeColor.white100 }}>Scan QR</Text>
            </TouchableOpacity>
          </View>

          {qrTab === "myqr" && (
            <View style={{ alignItems: "center", paddingVertical: 20 }}>
              {qrValue ? (
                <QRCode value={qrValue} size={220} />
              ) : (
                <Text style={{ color: textMain }}>No QR data available</Text>
              )}
            </View>
          )}

          {qrTab === "scan" && (
            <View style={{ alignItems: "center" }}>
              {!permission && (
                <Text style={{ color: textMain }}>
                  Checking camera permission...
                </Text>
              )}

              {permission && !permission.granted && (
                <View style={{ alignItems: "center" }}>
                  <Text style={{ marginBottom: 10, color: textMain }}>
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

        {/* Logout (scrolls with content, not fixed) */}
        <View style={{ marginTop: 10, marginBottom: 50 }}>
          <Button
            text="Logout"
            status="danger"
            leftContent={
              <Ionicons
                name="log-out-outline"
                size={18}
                color={themeColor.white100}
              />
            }
            onPress={() => signOut(auth)}
          />
        </View>
      </View>
    </View>
  );

  // -------- UI (FlatList) --------
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled
      style={{ flex: 1 }}
    >
      <Layout>
        <FlatList
          data={[{ key: "only" }]}
          keyExtractor={(item) => item.key}
          renderItem={() => null}
          ListHeaderComponent={Header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      </Layout>
    </KeyboardAvoidingView>
  );
}
