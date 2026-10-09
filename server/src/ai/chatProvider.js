export function createChatProvider(providerName, provider) {
  if (providerName !== "ollama") throw new Error(`Unsupported chat provider: ${providerName}`);
  return provider;
}

// Provider contract: generate(), stream(), and healthCheck().
