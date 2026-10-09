export function createSttProvider(name, providers) {
  const provider = providers?.[name];
  if (!provider) {
    const error = new Error(`Unsupported STT provider: ${name}`);
    error.code = "STT_PROVIDER_UNSUPPORTED";
    error.status = 500;
    throw error;
  }
  if (typeof provider.transcribe !== "function" || typeof provider.healthCheck !== "function") {
    throw new Error(`Invalid STT provider: ${name}`);
  }
  return provider;
}
