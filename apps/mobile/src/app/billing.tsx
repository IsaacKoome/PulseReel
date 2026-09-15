import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBillingStatus, startBillingCheckout } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";
import type { BillingStatus } from "@/types";

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.access_token) {
      router.replace("/profile");
      return;
    }
    try {
      setStatus(await getBillingStatus(session.access_token));
      setMessage(null);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Billing could not load.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void refresh();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => listener.remove();
  }, [refresh]);

  async function buy() {
    if (!session?.access_token || !status?.ready) return;
    setBuying(true);
    setMessage(null);
    try {
      const { url } = await startBillingCheckout(session.access_token);
      await WebBrowser.openBrowserAsync(url);
      await refresh();
      setMessage("If you completed payment, tap Check my attempts while Paystack confirms it.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Checkout could not start.");
    } finally {
      setBuying(false);
    }
  }

  const price = status
    ? `${status.offer.currency} ${(status.offer.amount / 100).toLocaleString("en-KE")}`
    : "KES 675";

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 24 }]}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={25} color={colors.ivory} />
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.eyebrow}>PULSEREEL CREDITS</Text>
        <Text style={styles.title}>Keep creating.</Text>
        <Text style={styles.subtitle}>Five more chances to turn yourself into the lead.</Text>

        <View style={styles.card}>
          <Text style={styles.pack}>{status?.offer.attempts ?? 5} MOVIE ATTEMPTS</Text>
          <Text style={styles.price}>{price}</Text>
          <Text style={styles.approx}>Approximately US${status?.offer.approximateUsd ?? 5}</Text>
          <View style={styles.line} />
          <Text style={styles.detail}>One attempt per generated movie</Text>
          <Text style={styles.detail}>5-second AI result · 480p portrait · audio</Text>
          <Text style={styles.detail}>Confirmed technical failures restore the attempt</Text>
          <Text style={styles.balance}>Available now: {status?.attempts ?? 0}</Text>
        </View>

        {loading ? <ActivityIndicator color={colors.orange} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {(status?.attempts ?? 0) > 0 ? (
          <Pressable style={styles.buyButton} onPress={() => router.replace("/create")}>
            <Ionicons name="add" size={21} color={colors.black} />
            <Text style={styles.buyText}>Create a movie</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.buyButton, (!status?.ready || buying) && styles.disabled]}
            disabled={!status?.ready || buying}
            onPress={buy}
          >
            {buying ? <ActivityIndicator color={colors.black} /> : <Ionicons name="card" size={19} color={colors.black} />}
            <Text style={styles.buyText}>
              {buying
                ? "Opening Paystack…"
                : status?.ready
                  ? `Buy 5 attempts · ${price}`
                  : "Purchases unavailable"}
            </Text>
          </Pressable>
        )}

        <Pressable style={styles.checkButton} onPress={refresh} disabled={loading}>
          <Text style={styles.checkText}>Check my attempts</Text>
        </Pressable>
        <Text style={styles.safe}>You review the exact KES 675 charge in Paystack before paying.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black, paddingHorizontal: 22 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, justifyContent: "center", gap: 14 },
  eyebrow: { color: colors.orangeSoft, fontSize: 12, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: colors.ivory, fontSize: 38, lineHeight: 43, fontWeight: "900", letterSpacing: -1 },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 23, marginBottom: 8 },
  card: { borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 22, gap: 9 },
  pack: { color: colors.orangeSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  price: { color: colors.ivory, fontSize: 39, fontWeight: "900", letterSpacing: -1 },
  approx: { color: colors.muted, fontSize: 13 },
  line: { height: 1, backgroundColor: colors.line, marginVertical: 7 },
  detail: { color: colors.ivory, fontSize: 13, lineHeight: 19 },
  balance: { color: colors.orangeSoft, fontSize: 14, fontWeight: "900", marginTop: 8 },
  message: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  buyButton: { height: 54, borderRadius: 27, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  buyText: { color: colors.black, fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.42 },
  checkButton: { height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  checkText: { color: colors.ivory, fontSize: 14, fontWeight: "800" },
  safe: { color: colors.faint, fontSize: 11, lineHeight: 16, textAlign: "center" },
});
