// src/screens/MemoryBook/NotificationService.ts
import * as Notifications from "expo-notifications";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
} from "firebase/firestore";

<<<<<<< Updated upstream
=======
// ✅ Fix warning: shouldShowAlert deprecated
>>>>>>> Stashed changes
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let unsubscribeNotifSnap: (() => void) | null = null;

async function ensureNotificationPermission() {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") {
      await Notifications.requestPermissionsAsync();
    }
  } catch (e) {
    console.log("Notification permission error:", e);
  }
}

function titleFromType(type?: string) {
  switch (type) {
    case "message":
      return "New message";
    case "follow":
      return "New follower";
    case "mood":
      return "Mood update";
    default:
      return "Notification";
  }
}

function startFirestoreNotificationListener(uid: string) {
  const db = getFirestore();

<<<<<<< Updated upstream
=======
  // Only listen unread
>>>>>>> Stashed changes
  const qUnread = query(
    collection(db, "notifications", uid, "items"),
    where("read", "==", false)
  );

  unsubscribeNotifSnap = onSnapshot(qUnread, async (snap) => {
    for (const d of snap.docs) {
      const data: any = d.data();

<<<<<<< Updated upstream
      // prevent duplicate popups
=======
      // ✅ prevent duplicate popups
>>>>>>> Stashed changes
      if (data?.delivered === true) continue;

      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: titleFromType(data?.type),
            body: data?.text || "You have a new notification",
            data: {
              ...data,
              notifDocId: d.id,
            },
          },
<<<<<<< Updated upstream
          trigger: null,
=======
          trigger: null, // show immediately
>>>>>>> Stashed changes
        });
      } catch (e) {
        console.log("scheduleNotificationAsync failed:", e);
      }

<<<<<<< Updated upstream
      // mark delivered (NOT read)
=======
      // ✅ mark delivered (NOT read)
>>>>>>> Stashed changes
      try {
        await updateDoc(doc(db, "notifications", uid, "items", d.id), {
          delivered: true,
        });
      } catch (e) {
        console.log("Failed to mark delivered:", e);
      }
    }
  });
}

export function startNotificationListener() {
  const auth = getAuth();
<<<<<<< Updated upstream
  ensureNotificationPermission();

  const unsubAuth = onAuthStateChanged(auth, (user) => {
=======

  // ask permission once
  ensureNotificationPermission();

  // attach Firestore listener after login
  const unsubAuth = onAuthStateChanged(auth, (user) => {
    // clean previous
>>>>>>> Stashed changes
    if (unsubscribeNotifSnap) {
      unsubscribeNotifSnap();
      unsubscribeNotifSnap = null;
    }

    if (user?.uid) {
      startFirestoreNotificationListener(user.uid);
    }
  });

<<<<<<< Updated upstream
=======
  // cleanup function
>>>>>>> Stashed changes
  return () => {
    if (unsubscribeNotifSnap) unsubscribeNotifSnap();
    unsubAuth();
  };
}
