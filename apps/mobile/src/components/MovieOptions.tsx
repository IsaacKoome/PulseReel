import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

export type MovieOption = { text: string; onPress?: () => void; style?: "cancel" | "destructive" };
export function MovieOptions({ options, onClose }: { options: MovieOption[] | null; onClose: () => void }) {
  return <Modal visible={options !== null} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss movie options" onPress={onClose} />
      <View style={styles.panel} accessibilityViewIsModal>
        <Text style={styles.title}>Movie options</Text>
        <ScrollView>
          {options?.map(option => <Pressable key={option.text} accessibilityRole="button" style={styles.action} onPress={() => { onClose(); option.onPress?.(); }}>
            <Text style={[styles.label, option.style === "destructive" && styles.danger]}>{option.text}</Text>
          </Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 24 },
  panel: { backgroundColor: colors.black, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: colors.line, maxHeight: "80%" },
  title: { color: colors.ivory, fontSize: 22, fontWeight: "800", marginBottom: 12 },
  action: { paddingVertical: 17, minHeight: 48 },
  label: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  danger: { color: colors.danger },
});
