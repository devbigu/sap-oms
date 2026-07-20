export async function parsePhpJsonResponse<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) return {} as T;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some legacy PHP endpoints emit warning HTML before the JSON payload.
  }

  for (let index = trimmed.indexOf("{"); index >= 0; index = trimmed.indexOf("{", index + 1)) {
    try {
      return JSON.parse(trimmed.slice(index)) as T;
    } catch {
      // Keep scanning for the actual JSON object.
    }
  }

  throw new SyntaxError("Unable to parse PHP JSON response");
}
