import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "./lib/api";
import type { Book, Settings } from "./types";
import { Shelf } from "./pages/Shelf";
import { Reader } from "./pages/Reader";

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<Settings>({
    theme: "light",
    font_family: "默认",
    line_height: "1.8",
  });

  useEffect(() => {
    void getSettings().then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      void saveSettings(next).catch(() => undefined);
      return next;
    });
  }

  if (book) {
    return (
      <Reader
        book={book}
        settings={settings}
        onSettingsChange={updateSettings}
        onBack={() => setBook(null)}
      />
    );
  }

  return (
    <Shelf
      onOpen={setBook}
      settings={settings}
      onSettingsChange={updateSettings}
    />
  );
}
