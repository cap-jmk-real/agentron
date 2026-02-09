export type OllamaInstallStep = {
  title: string;
  command: string;
};

export const getOllamaInstallSteps = (platform: NodeJS.Platform): OllamaInstallStep[] => {
  if (platform === "darwin") {
    return [
      { title: "Install Ollama", command: "brew install ollama" },
      { title: "Start Ollama", command: "ollama serve" }
    ];
  }

  if (platform === "win32") {
    return [
      { title: "Install Ollama", command: "Download installer from https://ollama.com" },
      { title: "Start Ollama", command: "ollama serve" }
    ];
  }

  return [
    { title: "Install Ollama", command: "curl -fsSL https://ollama.com/install.sh | sh" },
    { title: "Start Ollama", command: "ollama serve" }
  ];
};
