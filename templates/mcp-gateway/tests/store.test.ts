import { describe, it, expect } from "vitest";
import { NoteStore } from "../src/store.js";

/**
 * The store is tested; the MCP wiring is not.
 *
 * Testing `createServer()` would mostly assert that the SDK registers what we
 * told it to — a test of the library. The domain logic is where a bug of ours
 * would actually live.
 */

describe("NoteStore", () => {
  it("seeds from the constructor", () => {
    const store = new NoteStore([{ title: "A", body: "one" }]);
    expect(store.size).toBe(1);
  });

  it("assigns ids and timestamps", () => {
    const store = new NoteStore();
    const note = store.add("Title", "Body");
    expect(note.id).toBe("1");
    expect(() => new Date(note.createdAt).toISOString()).not.toThrow();
    expect(store.add("Second", "Body").id).toBe("2");
  });

  it("trims whitespace and rejects blank fields", () => {
    const store = new NoteStore();
    expect(store.add("  Padded  ", "  Body  ").title).toBe("Padded");
    expect(() => store.add("   ", "body")).toThrow(/title/);
    expect(() => store.add("title", "   ")).toThrow(/body/);
  });

  it("ranks a TITLE match above a body-only match", () => {
    // Someone searching "invoice" wants the note called Invoice, not the one
    // that mentions invoices in passing.
    const store = new NoteStore([
      { title: "Meeting", body: "We discussed the invoice process at length." },
      { title: "Invoice", body: "Numbering scheme." },
    ]);

    expect(store.search("invoice").map((n) => n.title)).toEqual(["Invoice", "Meeting"]);
  });

  it("is case-insensitive", () => {
    const store = new NoteStore([{ title: "Portal Spec", body: "x" }]);
    expect(store.search("portal")).toHaveLength(1);
    expect(store.search("PORTAL")).toHaveLength(1);
  });

  it("returns nothing for a blank query rather than everything", () => {
    const store = new NoteStore([{ title: "A", body: "b" }]);
    expect(store.search("")).toEqual([]);
    expect(store.search("   ")).toEqual([]);
  });

  it("clamps the limit into a sane range", () => {
    const store = new NoteStore(
      Array.from({ length: 60 }, (_, i) => ({ title: `note ${i}`, body: "x" })),
    );
    expect(store.search("note", 3)).toHaveLength(3);
    expect(store.search("note", 999)).toHaveLength(50); // capped
    expect(store.search("note", 0)).toHaveLength(1); // floored
  });

  it("all() returns a copy, so callers cannot mutate the store", () => {
    const store = new NoteStore([{ title: "A", body: "b" }]);
    store.all().push({ id: "x", title: "injected", body: "", createdAt: "" });
    expect(store.size).toBe(1);
  });
});
