import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";

export default function AuthCallbackScreen() {
  const { code, error_description: errorDescription } = useLocalSearchParams<{
    code?: string | string[];
    error_description?: string | string[];
  }>();
  const { completeOAuthCode } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const authorizationCode = Array.isArray(code) ? code[0] : code;
    const providerError = Array.isArray(errorDescription) ? errorDescription[0] : errorDescription;

    if (providerError || !authorizationCode) {
      setError(providerError || "Google sign-in returned without an authorization code.");
      return;
    }

    completeOAuthCode(authorizationCode)
      .then(() => router.replace("/profile"))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Google sign-in did not finish.");
      });
  }, [code, completeOAuthCode, errorDescription]);

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>PULSEREEL</Text>
      {error ? (
        <>
          <Text style={styles.title}>Sign-in needs another try.</Text>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.button} onPress={() => router.replace("/profile")}>
            <Text style={styles.buttonText}>Back to PulseReel</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.orange} size="large" />
          <Text style={styles.title}>Bringing your movies home.</Text>
          <Text style={styles.body}>Finishing your secure Google sign-in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    gap: 18,
  },
  brand: {
    color: colors.orangeSoft,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2.2,
    marginBottom: 24,
  },
  title: {
    color: colors.ivory,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center",
  },
  body: { color: colors.muted, fontSize: 15, textAlign: "center" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: "center" },
  button: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.orange,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonText: { color: colors.black, fontSize: 15, fontWeight: "900" },
});
