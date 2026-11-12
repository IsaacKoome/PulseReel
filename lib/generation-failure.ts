export function generationFailureCode(error?: string): string | undefined {
  return error?.includes("InvalidEndpoint.ClosedEndpoint") ? "InvalidEndpoint.ClosedEndpoint" : undefined;
}

export function generationFailureMessage(error?: string): string {
  return generationFailureCode(error)
    ? "Our video provider is temporarily unavailable. Please try again later."
    : "We couldn't generate this movie. Please try again later.";
}
