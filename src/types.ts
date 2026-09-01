export interface Book {
  id: number;
  title: string;
  file_path: string;
  file_size: number;
  encoding: string;
  char_count: number;
  created_at: string;
}

export interface ReadingProgress {
  book_id: number;
  char_offset: number;
  font_size: number;
  updated_at: string;
}

export interface PageResult {
  text: string;
  start_offset: number;
  next_offset: number;
  eof: boolean;
}
