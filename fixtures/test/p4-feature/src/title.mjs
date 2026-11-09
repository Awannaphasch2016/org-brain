export function normalizeTitle(value) {
  const title = String(value ?? "").trim();
  if (!title) throw new Error("title is required");
  return title;
}
