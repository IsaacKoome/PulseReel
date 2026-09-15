import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { colors } from "@/theme";

export function PulseDock() {
  const pathname = usePathname();
  const onWatch = pathname === "/";
  const onProfile = pathname === "/profile";

  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="Watch" style={styles.side} onPress={() => router.replace("/")}>
        <Ionicons name={onWatch ? "play" : "play-outline"} size={22} color={onWatch ? colors.ivory : colors.muted} />
        <Text style={[styles.label, onWatch && styles.active]}>Watch</Text>
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Create a movie" style={styles.create} onPress={() => router.push("/create")}>
        <Ionicons name="add" size={36} color={colors.black} />
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Your movies" style={styles.side} onPress={() => router.replace("/profile")}>
        <Ionicons name={onProfile ? "person" : "person-outline"} size={22} color={onProfile ? colors.ivory : colors.muted} />
        <Text style={[styles.label, onProfile && styles.active]}>You</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(10,10,9,0.94)",
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 18,
  },
  side: { width: 72, alignItems: "center", gap: 3 },
  label: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  active: { color: colors.ivory },
  create: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -14 }],
    shadowColor: colors.orange,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
