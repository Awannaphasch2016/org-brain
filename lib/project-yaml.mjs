function parseScalar(raw) {
  if (raw === "null" || raw === "~" || raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) {
    if (raw.replace(/^-/, "").length > 15) return raw;
    return Number(raw);
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, container: root, kind: "object" }];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (line.startsWith("- ")) {
      if (parent.kind !== "array") {
        throw new Error(`YAML list item is not inside an array: ${line}`);
      }
      parent.container.push(parseScalar(line.slice(2).trim()));
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`YAML line is not a key: ${line}`);
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (parent.kind !== "object") throw new Error(`YAML key inside a list: ${key}`);
    if (rest === "[]") {
      parent.container[key] = [];
      continue;
    }
    if (rest !== "") {
      parent.container[key] = parseScalar(rest);
      continue;
    }
    let next = index + 1;
    while (next < lines.length && (!lines[next].trim() || lines[next].trim().startsWith("#"))) {
      next += 1;
    }
    const nextLine = lines[next] ?? "";
    const nextIndent = nextLine.match(/^ */)[0].length;
    const isArray = nextIndent > indent && nextLine.trim().startsWith("- ");
    const child = isArray ? [] : {};
    parent.container[key] = child;
    stack.push({ indent, container: child, kind: isArray ? "array" : "object" });
  }
  return root;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^\d{16,}$/.test(text)) return JSON.stringify(text);
  if (/^[A-Za-z0-9_@./+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function setYamlPath(text, dottedPath, value) {
  const parts = dottedPath.split(".");
  const lines = text.split(/\r?\n/);
  const key = parts[parts.length - 1];
  const ancestors = parts.slice(0, -1);
  const expectedIndent = ancestors.length * 2;
  let depth = 0;
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    if (line.startsWith("- ")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (indent < depth * 2) depth = indent / 2;
    if (indent === depth * 2 && name === ancestors[depth]) {
      depth += 1;
      continue;
    }
    if (depth === ancestors.length && indent === expectedIndent && name === key) {
      lines[index] = `${" ".repeat(expectedIndent)}${key}: ${formatScalar(value)}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    throw new Error(`YAML path not found: ${dottedPath}`);
  }
  return lines.join("\n").replace(/\n?$/, "\n");
}

export function torSection(text) {
  const match = text.match(/^tor:\n(?:  .*\n)*/m);
  return match ? match[0] : "";
}
