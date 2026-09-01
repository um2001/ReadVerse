import { useState } from "react";
import type { Book } from "./types";
import { Shelf } from "./pages/Shelf";
import { Reader } from "./pages/Reader";

export default function App() {
  const [book, setBook] = useState<Book | null>(null);

  if (book) {
    return <Reader book={book} onBack={() => setBook(null)} />;
  }

  return <Shelf onOpen={setBook} />;
}
