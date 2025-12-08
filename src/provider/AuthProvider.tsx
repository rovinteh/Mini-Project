import React, { createContext, useState, useEffect } from "react"; 
import { getAuth, onAuthStateChanged } from "firebase/auth"; 
 
type ContextProps = { 
  user: null | boolean; 
  displayName: null | string; 
}; 
 
const AuthContext = createContext<Partial<ContextProps>>({}); 
 
interface Props { 
  children: React.ReactNode; 
} 
 
const AuthProvider = (props: Props) => { 
  const auth = getAuth(); 
  // user null = loading 
  const [user, setUser] = useState<null | boolean>(null); 
  const [displayName, setDisplayName] = useState<null | string>(null); 
 
  useEffect(() => { 
    checkLogin(); 
  }, []); 
 
  function checkLogin() { 
    onAuthStateChanged(auth, function (u) { 
      if (u) { 
        setUser(true); 
        setDisplayName(u.displayName); 
        // getUserData(); 
      } else { 
        setUser(false); 
        // setUserData(null); 
      } 
    }); 
  } 
 
  return ( 
    <AuthContext.Provider 
      value={{ 
        user, 
        displayName, 
      }} 
    > 
      {props.children} 
    </AuthContext.Provider> 
  ); 
}; 
 
export { AuthContext, AuthProvider };