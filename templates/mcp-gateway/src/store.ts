/**
 * The thing this gateway exposes.
 *
 * An in-memory note store, kept deliberately boring: swapping it for a real
 * database, an HTTP API, or a filesystem is the exercise. Everything in
 * server.ts is about MCP; everything here is about your domain.
 */

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export class NoteStore {
  #notes: Note[] = [];
  #nextId = 1;

  constructor(seed: Array<Pick<Note, "title" | "body">> = []) {
    for (const note of seed) this.add(note.title, note.body);
  }

  add(title: string, body: string): Note {
    if (!title.trim()) throw new Error("A note needs a title.");
    if (!body.trim()) throw new Error("A note needs a body.");

    const note: Note = {
      id: String(this.#nextId++),
      title: title.trim(),
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    this.#notes.push(note);
    return note;
  }

  /**
   * Case-insensitive substring search over title and body.
   *
   * Title matches rank above body-only matches: someone searching "invoice"
   * wants the note called "Invoice", not the one that mentions invoices once.
   */
  search(query: string, limit = 5): Note[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const scored = this.#notes
      .map((note) => {
        const inTitle = note.title.toLowerCase().includes(needle);
        const inBody = note.body.toLowerCase().includes(needle);
        return { note, score: inTitle ? 2 : inBody ? 1 : 0 };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, Math.max(1, Math.min(limit, 50))).map((entry) => entry.note);
  }

  all(): Note[] {
    return [...this.#notes];
  }

  get size(): number {
    return this.#notes.length;
  }
}
