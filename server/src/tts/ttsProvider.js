export function createTtsProvider(name, providers) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unsupported TTS provider: ${name}`);
  if (typeof provider.healthCheck !== "function" || typeof provider.synthesize !== "function") {
    throw new Error(`TTS provider ${name} is incomplete`);
  }
  return provider;
}
