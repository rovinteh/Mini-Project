import React, { useState } from "react";
import {
  View,
  Platform,
  KeyboardAvoidingView,
  TouchableOpacity,
  Modal,
} from "react-native";
import { MainStackParamList } from "../../types/navigation";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  TextInput,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getFirestore, addDoc, collection } from "firebase/firestore";
import { getAuth, User } from "firebase/auth";
import { Calendar } from "react-native-calendars";
import DropDownPicker from "react-native-dropdown-picker";

export default function ({
  navigation,
}: NativeStackScreenProps<MainStackParamList, "TransactionAdd">) {
  const { isDarkmode, setTheme } = useTheme();

  const [amount, setAmount] = useState<string>("");

  // ---- Type dropdown (income / expense) ----
  const [typeOpen, setTypeOpen] = useState<boolean>(false);
  const [type, setType] = useState<string>("expense");
  const [typeItems, setTypeItems] = useState([
    { label: "Expense", value: "expense" },
    { label: "Income", value: "income" },
  ]);

  // ---- Category dropdown + add category ----
  const [categoryOpen, setCategoryOpen] = useState<boolean>(false);
  const [category, setCategory] = useState<string>("");
  const [categoryItems, setCategoryItems] = useState([
    { label: "Food", value: "Food" },
    { label: "Transport", value: "Transport" },
    { label: "Shopping", value: "Shopping" },
    { label: "Bills", value: "Bills" },
  ]);
  const [newCategory, setNewCategory] = useState<string>("");

  // ---- Date with Calendar ----
  const [transactionDate, setTransactionDate] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState<boolean>(false);

  // ---- Note & loading ----
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const emptyState = () => {
    setAmount("");
    setType("expense");
    setCategory("");
    setNote("");
    setTransactionDate(new Date());
    setNewCategory("");
  };

  const formatDate = (date: Date): string =>
    date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const handleAddCategory = () => {
    const label = newCategory.trim();
    if (!label) {
      alert("Please enter a category name.");
      return;
    }

    // avoid duplicates
    const exists = categoryItems.some(
      (item) => item.value.toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      alert("This category already exists.");
      return;
    }

    const newItem = { label, value: label };
    setCategoryItems((prev) => [...prev, newItem]);
    setCategory(label);
    setNewCategory("");
    alert(`Category "${label}" added.`);
  };

  const handlePress = async () => {
    if (!amount) {
      alert("Amount is required");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert("Please enter a valid positive number for amount.");
      return;
    }

    if (!type || (type !== "income" && type !== "expense")) {
      alert('Type must be "income" or "expense".');
      return;
    }

    if (!category) {
      alert("Category is required");
      return;
    }

    setLoading(true);

    const auth = getAuth();
    const db = getFirestore();

    if (auth.currentUser) {
      const currentUser: User = auth.currentUser;
      const now = new Date();
      const transactionDateMs = transactionDate.getTime();

      try {
        await addDoc(collection(db, "Transactions"), {
          amount: parsedAmount,
          type: type, // "income" or "expense"
          category: category,
          note: note,
          transactionDate: transactionDateMs,
          createdDate: now.getTime(),
          updatedDate: now.getTime(),
          CreatedUser: {
            CreatedUserId: currentUser.uid,
            CreatedUserName: currentUser.displayName,
            CreatedUserPhoto: currentUser.photoURL,
          },
        });

        emptyState();
        setLoading(false);
        alert("Transaction added successfully.");
        // navigation.goBack();
      } catch (error: any) {
        setLoading(false);
        alert("Error adding transaction: " + error.message);
      }
    } else {
      setLoading(false);
      alert("No user is logged in.");
    }
  };

  const onDateSelect = (day: any) => {
    const selectedDate = new Date(day.dateString);
    setTransactionDate(selectedDate);
    setShowCalendar(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Add Transaction"
          leftContent={
            <Ionicons
              name="chevron-back"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          leftAction={() => navigation.goBack()}
          rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          rightAction={() => {
            if (isDarkmode) {
              setTheme("light");
            } else {
              setTheme("dark");
            }
          }}
        />

        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 10,
          }}
        >
          {/* Amount */}
          <Text>Amount (RM)</Text>
          <TextInput
            containerStyle={{ marginTop: 10 }}
            placeholder="0.00"
            value={amount}
            keyboardType="numeric"
            autoCapitalize="none"
            autoCompleteType="off"
            autoCorrect={false}
            onChangeText={(text) => setAmount(text)}
          />

          {/* Type dropdown */}
          <Text style={{ marginTop: 15 }}>Type</Text>
          <View style={{ marginTop: 10, zIndex: 3000 }}>
            <DropDownPicker
              open={typeOpen}
              value={type}
              items={typeItems}
              setOpen={setTypeOpen}
              setValue={setType}
              setItems={setTypeItems}
              placeholder="Select type"
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

          {/* Category dropdown + add category */}
          <Text style={{ marginTop: 15 }}>Category</Text>
          <View
            style={{
              marginTop: 10,
              flexDirection: "row",
              alignItems: "center",
              zIndex: 2000,
            }}
          >
            <View style={{ flex: 1, zIndex: 2000 }}>
              <DropDownPicker
                open={categoryOpen}
                value={category}
                items={categoryItems}
                setOpen={setCategoryOpen}
                setValue={setCategory}
                setItems={setCategoryItems}
                placeholder="Select category"
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

            <Button
              text="+"
              onPress={handleAddCategory}
              style={{
                marginLeft: 10,
                width: 50,
                height: 50,
                justifyContent: "center",
              }}
              textStyle={{ fontSize: 22 }}
            />
          </View>

          {/* New category input */}
          <TextInput
            containerStyle={{ marginTop: 10 }}
            placeholder="Type new category name then press +"
            value={newCategory}
            autoCapitalize="words"
            autoCompleteType="off"
            autoCorrect={false}
            onChangeText={(text) => setNewCategory(text)}
          />

          {/* Date with calendar */}
          <Text style={{ marginTop: 15 }}>Date</Text>
          <TouchableOpacity
            onPress={() => setShowCalendar(true)}
            style={{
              marginTop: 10,
              padding: 15,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: "#ccc",
              backgroundColor: isDarkmode ? themeColor.dark200 : "#f5f5f5",
            }}
          >
            <Text>{formatDate(transactionDate)}</Text>
          </TouchableOpacity>

          {/* Calendar Modal */}
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
                  <Calendar
                    current={transactionDate
                      .toISOString()
                      .split("T")[0]}
                    maxDate={new Date().toISOString().split("T")[0]}
                    onDayPress={onDateSelect}
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
                      monthTextColor: isDarkmode
                        ? themeColor.white
                        : themeColor.dark,
                      arrowColor: themeColor.primary,
                    }}
                    markedDates={{
                      [transactionDate.toISOString().split("T")[0]]: {
                        selected: true,
                        selectedColor: themeColor.primary,
                      },
                    }}
                  />

                  <Button
                    text="Close"
                    onPress={() => setShowCalendar(false)}
                    style={{ marginTop: 20 }}
                  />
                </View>
              </View>
            </Modal>
          )}

          {/* Note */}
          <Text style={{ marginTop: 15 }}>Note (optional)</Text>
          <TextInput
            containerStyle={{ marginTop: 10 }}
            placeholder="Any extra details..."
            value={note}
            autoCapitalize="none"
            autoCompleteType="off"
            autoCorrect={false}
            onChangeText={(text) => setNote(text)}
          />

          {/* Save button */}
          <Button
            text={loading ? "Saving..." : "Save Transaction"}
            onPress={handlePress}
            style={{
              marginTop: 20,
            }}
            disabled={loading}
          />
        </View>
      </Layout>
    </KeyboardAvoidingView>
  );
}
