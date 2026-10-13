// Hook cleanup can run after Expo has released the native shared object.
export function pausePlayerSafely(player: { pause(): void }) {
  try {
    player.pause();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already released/i.test(message)) throw error;
  }
}
