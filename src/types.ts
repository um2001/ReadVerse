export interface Book {
  id: number;
  title: string;
  file_path: string;
  file_size: number;
  encoding: string;
  char_count: number;
  created_at: string;
  format: string;
  cover_path: string;
  is_favorite: boolean;
  is_read: boolean;
  missing: boolean;
  last_char_offset: number;
  font_size: number;
  last_read_at: string;
}

export interface ReadingProgress {
  book_id: number;
  char_offset: number;
  font_size: number;
  encoding: string;
  updated_at: string;
}

export interface PageResult {
  text: string;
  start_offset: number;
  next_offset: number;
  eof: boolean;
}

export interface Chapter {
  id: number;
  book_id: number;
  title: string;
  char_offset: number;
}

export interface Bookmark {
  id: number;
  book_id: number;
  char_offset: number;
  excerpt: string;
  created_at: string;
}

export interface SearchResult {
  char_offset: number;
  snippet: string;
  chapter_title: string;
}

export interface Settings {
  theme: "light" | "sepia" | "night";
  font_family: string;
  line_height: string;
}
