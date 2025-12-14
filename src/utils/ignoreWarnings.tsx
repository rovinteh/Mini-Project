import { LogBox } from "react-native";

if (__DEV__) {
  const originalError = console.error;
  const originalWarn = console.warn;

  const shouldIgnore = (args: any[]) => {
    const msg = args.join(" ");
    return (
      msg.includes("Invalid DOM property") ||
      msg.includes("transform-origin") ||
      msg.includes("Unknown event handler property") ||
      msg.includes("onStartShouldSetResponder") ||
      msg.includes("onResponderGrant") ||
      msg.includes("onResponderMove") ||
      msg.includes("onResponderRelease") ||
      msg.includes("onResponderTerminate") ||
      msg.includes("onResponderTerminationRequest") ||
      msg.includes("The action 'NAVIGATE'") ||
      msg.includes("Unexpected text node")
    );
  };

  console.error = (...args) => {
    if (shouldIgnore(args)) return;
    originalError(...args);
  };

  console.warn = (...args) => {
    if (shouldIgnore(args)) return;
    originalWarn(...args);
  };
  
  // Also use LogBox for React Native specific warnings if needed
  LogBox.ignoreLogs([
    "AsyncStorage has been extracted",
    "Invalid DOM property",
    "Unknown event handler property"
  ]);
}