import React, { useContext } from "react";
import { getApps, initializeApp } from "firebase/app";
import { AuthContext } from "../provider/AuthProvider";

import { NavigationContainer } from "@react-navigation/native";

import Main from "./MainStack";
import Auth from "./AuthStack";
import Loading from "../screens/utils/Loading";

// Better put your these secret keys in .env file
const firebaseConfig = {
  apiKey: "AIzaSyCh_I6y5GCLkzFRFdbl8Na69SomyiVBysI",
  authDomain: "myminiprojectjay.firebaseapp.com",
  projectId: "myminiprojectjay",
  storageBucket: "myminiprojectjay.firebasestorage.app",
  messagingSenderId: "96591390670",
  appId: "1:96591390670:web:7d80f3f3e61252b21d6d9f",
  measurementId: "G-17X825V6HB",
};
if (getApps().length === 0) {
  initializeApp(firebaseConfig);
}

export default () => {
  const auth = useContext(AuthContext);
  const user = auth.user;
  return (
    <NavigationContainer>
      {user == null && <Loading />}
      {user == false && <Auth />}
      {user == true && <Main />}
    </NavigationContainer>
  );
};
