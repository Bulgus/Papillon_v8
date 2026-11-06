// Silence known, non-actionable warnings/errors at the console level (not just
// the in-app LogBox overlay) so they don't spam the Metro terminal output.
const SILENCED_LOG_PATTERNS = [
  "is missing the required default export",
  "Found screens with the same name nested inside one another",
  "Linking found multiple possible URI schemes",
  "You must pass your PostHog project's api key",
  "i18next is made possible by our own product, Locize",
  // expo-router 58 preview bug: native tabs preload, router rejects it. Dev-only.
  "The action 'PRELOAD' with payload",
  // From react-native-gesture-handler's legacy exports, not our code.
  "DrawerLayoutAndroid is deprecated",
  // Fabric perf advice on translucent shadowed views, not actionable per-view.
  "cannot calculate shadow efficiently",
];

const shouldSilence = (args) =>
  typeof args[0] === "string" &&
  SILENCED_LOG_PATTERNS.some((pattern) => args[0].includes(pattern));

const originalWarn = console.warn;
console.warn = (...args) => {
  if (shouldSilence(args)) return;
  originalWarn(...args);
};

const originalError = console.error;
console.error = (...args) => {
  if (shouldSilence(args)) return;
  originalError(...args);
};

const originalLog = console.log;
console.log = (...args) => {
  if (shouldSilence(args)) return;
  originalLog(...args);
};

const originalInfo = console.info;
console.info = (...args) => {
  if (shouldSilence(args)) return;
  originalInfo(...args);
};

// A fatal JS error in a release build closes the app on the splash screen
// with nothing to report. Show it instead, so it can be copied and sent.
let fatalShown = false;
const errorUtils = global.ErrorUtils;
const defaultErrorHandler = errorUtils?.getGlobalHandler?.();
errorUtils?.setGlobalHandler?.((error, isFatal) => {
  if (!isFatal || fatalShown) {
    defaultErrorHandler?.(error, isFatal);
    return;
  }
  fatalShown = true;
  const details = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}\n\n${String(error?.stack ?? "").slice(0, 1500)}`;
  try {
    const { Alert } = require("react-native");
    Alert.alert("Papillon n'a pas pu démarrer", details, [
      {
        text: "Copier l'erreur",
        onPress: () => {
          try {
            require("expo-clipboard").setStringAsync(details);
          } catch {
            // nothing to copy with
          }
        },
      },
      { text: "Fermer", style: "cancel" },
    ]);
  } catch {
    defaultErrorHandler?.(error, isFatal);
  }
});

// require, not import: imports are hoisted above the handler above.
require("expo-router/entry");
